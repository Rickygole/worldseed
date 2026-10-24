import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A fake clock and animation-frame queue, so the camera engine runs without a browser. */
function harness(reduced = false) {
  let t = 1000;
  const q: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    q.push(cb);
    return q.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }), setTimeout: () => 0 });
  vi.spyOn(performance, "now").mockImplementation(() => t);
  return {
    step(ms: number) {
      t += ms;
      for (const cb of q.splice(0)) cb(t);
    },
    run(totalMs: number, stepMs = 16) {
      for (let e = 0; e < totalMs; e += stepMs) this.step(stepMs);
    },
  };
}

async function load() {
  vi.resetModules();
  return import("../../lib/ui/mapDirector");
}

function fakeDriver() {
  let cam = { longitude: -76.5, latitude: 39.2, zoom: 10, pitch: 40, bearing: 350 };
  const writes: (typeof cam)[] = [];
  return {
    get cam() {
      return cam;
    },
    writes,
    driver: {
      getCamera: () => cam,
      setCamera: (c: typeof cam) => {
        cam = c;
        writes.push(c);
      },
    },
  };
}

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("scene contract", () => {
  it("has every scene with a story-length, eased camera move", async () => {
    const d = await load();
    const ids = ["intro", "crossing", "averages", "held", "freight", "fix", "explore"] as const;
    for (const id of ids) {
      const s = d.SCENES[id];
      expect(s.id).toBe(id);
      expect(s.camera.durationMs).toBeGreaterThanOrEqual(1200);
      expect(s.camera.durationMs).toBeLessThanOrEqual(2500);
      expect(s.camera.pitch).toBeLessThanOrEqual(75);
      expect(s.camera.zoom).toBeGreaterThanOrEqual(9);
      expect(["easeInOut", "fly", "easeOut", "linear"]).toContain(s.camera.curve);
    }
  });

  it("frames each story beat as designed", async () => {
    const { SCENES } = await load();
    expect(SCENES.intro.orbit).toBe(true);
    expect(SCENES.crossing.layers.bridgeEmphasis).toBe(1);
    expect(SCENES.averages.camera.pitch).toBeGreaterThan(SCENES.intro.camera.pitch);
    expect(SCENES.averages.camera.driftDegPerSec).toBeGreaterThan(0);
    expect(SCENES.held.layers.stations).toBe(true);
    expect(SCENES.held.layers.hospitals).toBe(true);
    expect(SCENES.freight.layers.trails).toBe("all");
    expect(SCENES.freight.layers.tunnels).toBe(true);
    expect(SCENES.intro.layers.trails).toBe("off");
    expect(SCENES.explore.orbit).toBe(false);
  });

  it("never lets a scene animate the bridge: emphasis is a volume, not a motion", async () => {
    const { SCENES } = await load();
    for (const s of Object.values(SCENES)) {
      expect(s.layers.bridgeEmphasis).toBeGreaterThanOrEqual(0);
      expect(s.layers.bridgeEmphasis).toBeLessThanOrEqual(1);
    }
  });
});

describe("goToScene", () => {
  it("remembers a scene requested before the map exists and applies it on mount", async () => {
    const h = harness();
    const d = await load();
    await d.goToScene("crossing");
    expect(d.currentScene()).toBe("crossing");
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    h.run(3000);
    expect(f.cam.zoom).toBeCloseTo(d.SCENES.crossing.camera.zoom, 5);
  });

  it("eases the camera to the target and resolves at the end", async () => {
    const h = harness();
    const d = await load();
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    let done = false;
    const p = d.goToScene("crossing").then(() => (done = true));
    h.run(1000);
    expect(done).toBe(false);
    // mid-move the camera is between start and target
    expect(f.cam.pitch).toBeGreaterThan(40);
    expect(f.cam.pitch).toBeLessThan(d.SCENES.crossing.camera.pitch);
    h.run(2000);
    await p;
    expect(done).toBe(true);
    expect(f.cam.latitude).toBeCloseTo(d.SCENES.crossing.camera.latitude, 6);
    expect(f.cam.longitude).toBeCloseTo(d.SCENES.crossing.camera.longitude, 6);
  });

  it("turns the short way round to the target bearing", async () => {
    const h = harness();
    const d = await load();
    const f = fakeDriver(); // bearing 350
    d.registerMapDriver(f.driver);
    void d.goToScene("crossing"); // target 24: 34 degrees away through north, not 326 the long way
    h.run(500);
    expect(f.cam.bearing).toBeGreaterThan(350);
    h.run(3000);
    expect(((f.cam.bearing % 360) + 360) % 360).toBeCloseTo(24, 5);
  });

  it("is an instant cut with { instant: true } and under reduced motion", async () => {
    harness();
    let d = await load();
    let f = fakeDriver();
    d.registerMapDriver(f.driver);
    await d.goToScene("held", { instant: true });
    expect(f.cam.zoom).toBe(d.SCENES.held.camera.zoom);
    expect(d.getVisual().stations).toBe(1);
    vi.unstubAllGlobals();
    harness(true);
    d = await load();
    f = fakeDriver();
    d.registerMapDriver(f.driver);
    await d.goToScene("freight");
    expect(f.cam.zoom).toBe(d.SCENES.freight.camera.zoom);
    expect(d.getVisual().trails).toBe(1);
  });

  it("fades map-only layers over about 0.3 s instead of cutting them", async () => {
    const h = harness();
    const d = await load();
    d.registerMapDriver(fakeDriver().driver);
    void d.goToScene("held");
    h.step(16);
    expect(d.getVisual().stations).toBeGreaterThan(0);
    expect(d.getVisual().stations).toBeLessThan(1);
    h.run(600);
    expect(d.getVisual().stations).toBe(1);
    expect(d.getVisual().terrain).toBeCloseTo(0.55, 5);
  });

  it("notifies scene subscribers once per change", async () => {
    harness();
    const d = await load();
    const seen: (string | null)[] = [];
    const off = d.subscribeScene((id) => seen.push(id));
    await d.goToScene("intro");
    await d.goToScene("intro");
    await d.goToScene("fix");
    off();
    await d.goToScene("held");
    expect(seen).toEqual(["intro", "fix"]);
  });
});

describe("user control", () => {
  it("a drag or scroll cancels the move, resolves the promise, and stops the drift", async () => {
    const h = harness();
    const d = await load();
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    let done = false;
    const p = d.goToScene("averages").then(() => (done = true));
    h.run(500);
    d.interruptCamera();
    await p;
    expect(done).toBe(true);
    expect(d.isUserControlled()).toBe(true);
    const at = f.writes.length;
    h.run(2000);
    expect(f.writes.length).toBe(at); // nothing moves the camera any more
  });

  it("ambient drift turns the bearing slowly when a drifting scene rests, and stops on interruption", async () => {
    const h = harness();
    const d = await load();
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    await d.goToScene("intro", { instant: true });
    const b0 = f.cam.bearing;
    h.run(2000);
    const turned = f.cam.bearing - b0;
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThan(d.SCENES.intro.camera.driftDegPerSec * 2 * 1.5);
    d.interruptCamera();
    const b1 = f.cam.bearing;
    h.run(1000);
    expect(f.cam.bearing).toBe(b1);
  });

  it("no ambient drift under reduced motion", async () => {
    const h = harness(true);
    const d = await load();
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    await d.goToScene("intro");
    const b0 = f.cam.bearing;
    h.run(2000);
    expect(f.cam.bearing).toBe(b0);
  });

  it("resetView returns to the scene's framing after the user moved", async () => {
    const h = harness();
    const d = await load();
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    await d.goToScene("crossing", { instant: true });
    d.interruptCamera();
    f.driver.setCamera({ ...f.cam, zoom: 14 });
    void d.resetView();
    h.run(3000);
    expect(f.cam.zoom).toBeCloseTo(d.SCENES.crossing.camera.zoom, 5);
    expect(d.isUserControlled()).toBe(false);
  });

  it("flyTo eases any framing without changing the scene", async () => {
    const h = harness();
    const d = await load();
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    await d.goToScene("fix", { instant: true });
    void d.flyTo({ zoom: 12.5 }, { durationMs: 1200 });
    h.run(1500);
    expect(f.cam.zoom).toBeCloseTo(12.5, 5);
    expect(d.currentScene()).toBe("fix");
  });
});

describe("padding, freight highlight, readiness", () => {
  it("keeps the safe-area padding and tells subscribers", async () => {
    harness();
    const d = await load();
    let n = 0;
    d.subscribePadding(() => n++);
    expect(d.getViewportPadding()).toBeNull();
    d.setViewportPadding({ left: 320, top: 64 });
    d.setViewportPadding({ right: 380 });
    expect(d.getViewportPadding()).toEqual({ left: 320, right: 380, top: 64, bottom: 0 });
    expect(n).toBe(2);
  });

  it("highlights one freight trip and clears it", async () => {
    harness();
    const d = await load();
    let n = 0;
    d.subscribeFreightHighlight(() => n++);
    d.setFreightTripHighlight("TP>HP");
    d.setFreightTripHighlight("TP>HP");
    expect(d.getFreightTripHighlight()).toBe("TP>HP");
    d.setFreightTripHighlight(null);
    expect(d.getFreightTripHighlight()).toBeNull();
    expect(n).toBe(2);
  });

  it("whenMapReady resolves after markMapReady", async () => {
    harness();
    const d = await load();
    let ready = false;
    const p = d.whenMapReady().then(() => (ready = true));
    await Promise.resolve();
    expect(ready).toBe(false);
    d.markMapReady();
    await p;
    expect(ready).toBe(true);
    await d.whenMapReady();
  });
});

describe("quality tiers", () => {
  it("auto starts at full quality; high and low pin it", async () => {
    harness();
    const d = await load();
    expect(d.qualityLevel()).toBe(0);
    d.setQuality("low");
    expect(d.qualityLevel()).toBe(2);
    d.setQuality("high");
    expect(d.qualityLevel()).toBe(0);
    d.setQuality("auto");
    expect(d.qualityLevel()).toBe(0);
  });

  it("auto drops a level after 3 s of p95 over 25 ms, logs once per decision, and never below the floor", async () => {
    const h = harness();
    const d = await load();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("document", { hidden: false });
    const stop = d.startFrameMonitor();
    h.run(1200, 40); // 40 ms frames for 1.2 s: not yet 3 s
    expect(d.qualityLevel()).toBe(0);
    h.run(3400, 40);
    expect(d.qualityLevel()).toBe(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toMatch(/quality auto/);
    h.run(9000, 40);
    expect(d.qualityLevel()).toBe(2);
    h.run(9000, 40);
    expect(d.qualityLevel()).toBe(2); // the floor
    stop();
  });

  it("healthy frames never downgrade", async () => {
    const h = harness();
    const d = await load();
    vi.stubGlobal("document", { hidden: false });
    const stop = d.startFrameMonitor();
    h.run(12000, 16);
    expect(d.qualityLevel()).toBe(0);
    const s = d.frameStats();
    expect(s.p50).toBe(16);
    expect(s.p95).toBe(16);
    stop();
  });
});

describe("the whole-Earth intro (globe)", () => {
  it("starts in space and the globe turns westward by itself", async () => {
    const h = harness();
    const d = await load();
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    expect(d.enterGlobe()).toBe(true);
    await d.goToScene("intro");
    expect(d.globeStage()).toBe("orbit");
    expect(f.cam.zoom).toBe(d.GLOBE_VIEW.zoom);
    expect(f.cam.pitch).toBe(0);
    const lng0 = f.cam.longitude;
    h.run(2000);
    const turned = f.cam.longitude - lng0;
    expect(Math.sign(turned)).toBe(Math.sign(d.GLOBE_SPIN_DEG_PER_SEC));
    expect(Math.abs(turned)).toBeCloseTo(Math.abs(d.GLOBE_SPIN_DEG_PER_SEC) * 2, 0);
    // The intro scene does not pull the camera out of space.
    expect(f.cam.zoom).toBe(d.GLOBE_VIEW.zoom);
  });

  it("frames the globe when the map mounts after the intro asked for it", async () => {
    const h = harness();
    const d = await load();
    d.enterGlobe();
    await d.goToScene("intro");
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    h.run(100);
    expect(f.cam.zoom).toBe(d.GLOBE_VIEW.zoom);
    expect(d.globeStage()).toBe("orbit");
  });

  it("pauses while the visitor handles the globe and resumes a few seconds later", async () => {
    const h = harness();
    const d = await load();
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    d.enterGlobe();
    await d.goToScene("intro");
    h.run(500);
    d.interruptCamera();
    const lng = f.cam.longitude;
    h.run(d.GLOBE_RESUME_MS - 500);
    expect(f.cam.longitude).toBe(lng);
    h.run(1500);
    expect(f.cam.longitude).not.toBe(lng);
  });

  it("the next scene flies down from space, cannot be interrupted, lands exactly, and the globe never comes back", async () => {
    const h = harness();
    const d = await load();
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    d.enterGlobe();
    await d.goToScene("intro");
    h.run(40000); // the spin can leave the camera anywhere in longitude
    let done = false;
    const p = d.goToScene("crossing").then(() => (done = true));
    expect(d.globeStage()).toBe("descent");
    h.run(d.GLOBE_DESCENT_MS * 0.4);
    d.interruptCamera(); // a stray scroll mid-flight
    expect(d.isUserControlled()).toBe(false);
    // The turn comes before the tilt: still looking straight down this early.
    expect(f.cam.pitch).toBe(0);
    h.run(d.GLOBE_DESCENT_MS);
    await p;
    expect(done).toBe(true);
    const c = d.SCENES.crossing.camera;
    expect(f.cam.longitude).toBeCloseTo(c.longitude, 6);
    expect(f.cam.latitude).toBeCloseTo(c.latitude, 6);
    expect(f.cam.zoom).toBeCloseTo(c.zoom, 6);
    expect(f.cam.pitch).toBeCloseTo(c.pitch, 6);
    expect(d.globeStage()).toBe("off");
    expect(d.enterGlobe()).toBe(false);
  });

  it("from a zoomed-in spot far away, the flight rises before it turns (no whip across the planet at street level)", async () => {
    const h = harness();
    const d = await load();
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    d.enterGlobe();
    await d.goToScene("intro");
    f.driver.setCamera({ longitude: 44, latitude: 9.5, zoom: 14, pitch: 0, bearing: 0 });
    d.interruptCamera();
    const p = d.goToScene("crossing");
    let minZoom = Infinity;
    let lngWhileHigh = 0;
    for (let e = 0; e < d.GLOBE_DESCENT_MS + 100; e += 16) {
      h.step(16);
      minZoom = Math.min(minZoom, f.cam.zoom);
      if (f.cam.zoom > 8 && minZoom > 8) lngWhileHigh = Math.max(lngWhileHigh, Math.abs(f.cam.longitude - 44));
    }
    await p;
    expect(minZoom).toBeLessThan(4);
    expect(lngWhileHigh).toBeLessThan(1);
    expect(f.cam.longitude).toBeCloseTo(d.SCENES.crossing.camera.longitude, 6);
  });

  it("an instant scene change (deep link, remount) cuts straight to the region", async () => {
    harness();
    const d = await load();
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    d.enterGlobe();
    await d.goToScene("explore", { instant: true });
    expect(d.globeStage()).toBe("off");
    expect(f.cam.zoom).toBeCloseTo(d.SCENES.explore.camera.zoom, 6);
  });

  it("never under reduced motion: the intro is the regional view, exactly as without the globe", async () => {
    const h = harness(true);
    const d = await load();
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    expect(d.enterGlobe()).toBe(false);
    await d.goToScene("intro");
    expect(d.globeStage()).toBe("off");
    expect(f.cam.zoom).toBeCloseTo(d.SCENES.intro.camera.zoom, 6);
    const lng = f.cam.longitude;
    h.run(3000);
    expect(f.cam.longitude).toBe(lng);
  });

  it("never once the region has been shown (no flying back out to space)", async () => {
    const h = harness();
    const d = await load();
    const f = fakeDriver();
    d.registerMapDriver(f.driver);
    void d.goToScene("crossing");
    h.run(3000);
    expect(d.enterGlobe()).toBe(false);
    expect(d.globeStage()).toBe("off");
  });
});

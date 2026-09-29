import { afterEach, describe, expect, it, vi } from "vitest";
import { TerrainAnimator } from "../../lib/ui/terrainAnimator";
import type { Encoded } from "../../lib/ui/lenses";

function clock() {
  let t = 0;
  const q: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    q.push(cb);
    return q.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    q.length = 0;
  });
  vi.spyOn(performance, "now").mockImplementation(() => t);
  return {
    run(ms: number, step = 16) {
      for (let e = 0; e < ms; e += step) {
        t += step;
        for (const cb of q.splice(0)) cb(t);
      }
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const enc = (elev: number[], hatch: number[] = []): Encoded => ({
  elev: Float32Array.from(elev),
  rgb: Float32Array.from(elev.flatMap((e) => [e, e / 2, 10])),
  hatch: Uint8Array.from(hatch.length ? hatch : elev.map(() => 0)),
});

describe("terrain animator", () => {
  it("writes into the same buffers in place and lands exactly on the target", () => {
    const c = clock();
    const a = new TerrainAnimator(3);
    const elev = a.elev;
    const rgb = a.rgb;
    let frames = 0;
    let settled = false;
    a.start(enc([0, 100, 400]), Float32Array.from([0, 1, 2]), { ms: 1000, stagger: 0.5, linear: false }, () => frames++, () => (settled = true));
    c.run(1500);
    expect(a.elev).toBe(elev);
    expect(a.rgb).toBe(rgb);
    expect(Array.from(a.elev)).toEqual([0, 100, 400]);
    expect(frames).toBeGreaterThan(30);
    expect(settled).toBe(true);
  });

  it("staggers: hexes near the ripple origin rise before far ones", () => {
    const c = clock();
    const a = new TerrainAnimator(2);
    a.start(enc([300, 300]), Float32Array.from([0, 10]), { ms: 1000, stagger: 0.6, linear: false }, () => {}, () => {});
    c.run(300);
    expect(a.elev[0]).toBeGreaterThan(a.elev[1]);
    expect(a.elev[1]).toBe(0);
  });

  it("holds the hatch back until the terrain settles", () => {
    const c = clock();
    const a = new TerrainAnimator(2);
    a.start(enc([200, 200], [1, 0]), Float32Array.from([0, 1]), { ms: 800, stagger: 0.5, linear: false }, () => {}, () => {});
    c.run(300);
    expect(Array.from(a.hatch)).toEqual([0, 0]);
    c.run(1000);
    expect(Array.from(a.hatch)).toEqual([1, 0]);
  });

  it("sinks smoothly to the new target (no overshoot below it)", () => {
    const c = clock();
    const a = new TerrainAnimator(1);
    a.start(enc([500]), Float32Array.from([0]), { ms: 600, stagger: 0, linear: false }, () => {}, () => {});
    c.run(800);
    a.start(enc([0]), Float32Array.from([0]), { ms: 900, stagger: 0, linear: false }, () => {}, () => {});
    let prev = a.elev[0];
    for (let i = 0; i < 70; i++) {
      c.run(16);
      expect(a.elev[0]).toBeLessThanOrEqual(prev + 1e-6);
      expect(a.elev[0]).toBeGreaterThanOrEqual(0);
      prev = a.elev[0];
    }
    expect(a.elev[0]).toBe(0);
  });

  it("linear mode (reduced motion) moves without easing", () => {
    const c = clock();
    const a = new TerrainAnimator(1);
    a.start(enc([100]), Float32Array.from([0]), { ms: 400, stagger: 0, linear: true }, () => {}, () => {});
    c.run(208); // ~half way
    expect(a.elev[0]).toBeGreaterThan(40);
    expect(a.elev[0]).toBeLessThan(60);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimulator } from "../../lib/sim";
import { SimEngine } from "../../lib/sim/engine";
import { formatRunnerLabel } from "../../lib/sim/runner";
import { SnapshotMissingError } from "../../lib/sim/snapshot";
import { buildHarbor, harborReader } from "./fixtures";

const h = buildHarbor();

/** Serve the fixture files from a stubbed fetch; `omit` files answer 404. */
function stubFetch(omit: string[] = [], extra: Record<string, unknown> = {}) {
  const read = harborReader(h, extra, omit);
  vi.stubGlobal("fetch", async (url: string) => {
    const file = url.replace("/snapshot/", "");
    try {
      const buf = await read(file);
      return new Response(buf, { status: 200, headers: { "content-type": file.endsWith(".json") ? "application/json" : "application/octet-stream" } });
    } catch (e) {
      if (e instanceof SnapshotMissingError) return new Response("not found", { status: 404 });
      throw e;
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("snapshot-backed Simulator behind the existing interface", () => {
  it("loads the world from the snapshot: real cells, honest provenance (no demo chip), assumptions from files", async () => {
    stubFetch();
    const sim = createSimulator();
    const world = await sim.loadWorld();
    expect(sim.meta.kind).toBe("browser");
    expect(world.cells).toHaveLength(h.snap.hexes.count);
    expect(world.cells[5].id).toBe("fx-5");
    expect(world.cells[5].lat).toBeCloseTo(h.snap.hexes.lat[5], 5);
    expect(world.cells.every((c) => c.edgeFade > 0 && c.edgeFade <= 1)).toBe(true);
    // The footer renders "Demo data" whenever provenance is truthy.
    expect(world.provenance).toBe("");
    expect(world.assumptions.length).toBeGreaterThan(5);
    expect(world.assumptions.some((a) => a.label === "Snapshot" && a.value === "fixture-harbor-v1")).toBe(true);
    expect(world.assumptions.some((a) => /Call-processing/.test(a.label) && a.value === "90 s")).toBe(true);
    expect(world.assumptions.every((a) => a.placeholder === false)).toBe(true);
    expect(world.assumptions.some((a) => /not a traffic forecast/i.test(a.note ?? "") || /Stress scenarios/.test(a.value))).toBe(true);
    expect(sim.snapshotBacked).not.toBeNull();
  });

  it("run(): minutes are computed and the Key Bridge scenario is a close_link on L-KEYBRIDGE", async () => {
    stubFetch();
    const sim = createSimulator();
    const world = await sim.loadWorld();
    const base = await sim.run(world, { removedLinks: [] }, { lens: "access" });
    expect(base.minutes).toHaveLength(world.cells.length);
    expect(base.detail?.lens).toBe("access");
    expect(base.detail?.minutesKind).toBe("added");
    expect(Math.max(...base.minutes)).toBe(0);
    const cut = await sim.run(world, { removedLinks: ["key_bridge"] }, { lens: "access" });
    expect(Math.max(...cut.minutes)).toBeGreaterThan(0);
    expect(cut.metrics.pctWithin8).toBeLessThan(100);
    expect(cut.detail?.metrics.popAddedS as number).toBeGreaterThan(0);
    expect(cut.detail?.meta.runner).toBe("local-node");
    expect(cut.computeMs).toBe(cut.detail?.meta.ms);
    expect(sim.snapshotBacked?.worldState({ removedLinks: ["key_bridge"] }).mutations[0].m).toEqual({ kind: "close_link", linkId: "L-KEYBRIDGE" });
    // default lens = xharbor (the hero); EMS stays selectable and is always in detail.lenses
    expect((await sim.run(world, { removedLinks: [] })).detail?.lens).toBe("xharbor");
    const ems = await sim.run(world, { removedLinks: [] }, { lens: "ems" });
    expect(ems.detail?.lens).toBe("ems");
    expect(ems.detail?.minutesKind).toBe("response");
    expect(ems.metrics.p50).toBeCloseTo((ems.detail?.metrics.p50S as number) / 60, 6);
    const direct = (await SimEngine.fromReader(harborReader(h))).runDeterministic({ snapshotId: h.snap.id, mutations: [] }, "ems");
    for (const i of [0, 7, 50]) expect(ems.minutes[i]).toBeCloseTo(direct.field[i] / 60, 5);
  });

  it("extended scenarios (mutations) reach the simulator", async () => {
    stubFetch();
    const sim = createSimulator();
    const world = await sim.loadWorld();
    const closed = await sim.run(world, { removedLinks: ["key_bridge"] }, { lens: "access" });
    const fixed = await sim.run(
      world,
      { removedLinks: ["key_bridge"], mutations: [{ id: "c1", m: { kind: "apply_candidate", candidateId: "TL-TEMP" }, origin: "user", label: "temp link", confirmedAt: "2026-09-26T00:00:00Z" }] },
      { lens: "access" },
    );
    expect(fixed.detail?.metrics.popAddedS as number).toBeLessThan(closed.detail?.metrics.popAddedS as number);
  });

  it("futures and explain are available through the snapshot-backed handle", async () => {
    stubFetch();
    const sim = createSimulator();
    await sim.loadWorld();
    const real = sim.snapshotBacked!;
    const seen: number[] = [];
    const f = await real.runFutures({ removedLinks: ["key_bridge"] }, "access", { n: 12, seed: 1, tod: "pm", closureProb: 0.1 }, { onProgress: (d) => seen.push(d) });
    expect(f.samples).toHaveLength(12);
    expect(seen[seen.length - 1]).toBe(12);
    expect(f.meta.workers).toBe(1); // no Worker in Node: one in-process engine, reported as such
    const c = await real.explain({ removedLinks: ["key_bridge"] }, "access", h.node(1, 2));
    expect(c.lostLinks).toEqual(["L-KEYBRIDGE"]);
  });

  it("runner sentence never mentions a cloud", () => {
    expect(formatRunnerLabel({ runner: "local-browser", workers: 4, ms: 612.4 })).toBe("Computed locally in your browser (4 workers, 612 ms)");
    expect(formatRunnerLabel({ runner: "local-browser", workers: 1, ms: 9 })).toBe("Computed locally in your browser (1 worker, 9 ms)");
    expect(formatRunnerLabel({ runner: "local-node", workers: 1, ms: 9 })).not.toMatch(/cloud|server/i);
  });
});

describe("hero lens: cross-harbor terrain and side-by-side numbers", () => {
  it("run() with the default lens returns added-minutes terrain (>= 0), per-hex loss, headline, equity and named worst block groups", async () => {
    stubFetch();
    const sim = createSimulator();
    const world = await sim.loadWorld();
    const base = await sim.run(world, { removedLinks: [] });
    expect(base.detail?.lens).toBe("xharbor");
    expect(base.detail?.minutesKind).toBe("added");
    expect(Math.max(...base.minutes)).toBe(0);
    expect(base.detail?.xharbor?.headline.peopleLosingGt10).toBe(0);

    const cut = await sim.run(world, { removedLinks: ["key_bridge"] });
    const d = cut.detail!;
    const x = d.xharbor!;
    expect(cut.minutes).toHaveLength(world.cells.length);
    expect(Math.min(...cut.minutes)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...cut.minutes)).toBeGreaterThan(0);
    expect(x.lossFrac).toHaveLength(world.cells.length);
    expect(x.isOrigin[0]).toBe(0); // the fixture's ambiguous-shore hex
    expect(cut.minutes[0]).toBe(0);
    expect(x.headline.meanAddedMin).toBeCloseTo((d.metrics.xharbor!.popMeanAddedS as number) / 60, 9);
    expect(x.headline.peopleLosingGt10).toBeGreaterThanOrEqual(x.headline.peopleLosingGt25);
    // (the fixture is small enough that everything stays within 30 min, so loss counts can be zero here)
    expect(x.headline.peopleLosingGt10Pct).toBeGreaterThanOrEqual(0);
    expect(x.headline.baselineMeanJobs).toBeGreaterThanOrEqual(x.headline.worldMeanJobs);
    expect(x.headline.meanAddedMin).toBeGreaterThan(0);
    expect(x.equity.addedGapMin).toBeCloseTo(x.equity.lowWageMeanAddedMin - x.equity.popMeanAddedMin, 9);
    expect(x.equity.lossGapPct).toBeCloseTo(x.equity.lowWageMeanLossPct - x.equity.popMeanLossPct, 9);
    const worst = x.worstBlockGroups.byLossPct;
    expect(worst.length).toBeGreaterThan(0);
    expect(worst[0].geoid).toMatch(/^2451000/);
    expect(worst[0].name).toMatch(/Fixture County.*Tract .*Block Group/);
    expect(worst[0].meanAddedMin).toBeCloseTo(worst[0].meanAddedS / 60, 9);
    // honest labelling of the approximation and of where it ran
    expect(d.approximation).toMatch(/approximation/i);
    expect(d.runnerText).toMatch(/^Computed locally/);
    expect(d.meta.variant?.approximate).toBe(true);
    // regional and EMS lenses are always alongside, so the small regional number is never hidden
    expect(d.lenses.access.lens).toBe("access");
    expect(d.lenses.ems.lens).toBe("ems");
    expect(d.lenses.xharbor.lens).toBe("xharbor");
    expect(d.lenses.access.popAddedS as number).toBeGreaterThan(0);
    expect(d.lenses.access.popAddedS as number).toBeLessThan(d.lenses.xharbor.popAddedS as number);
  });

  it("the exact variant is selectable and not labelled an approximation; EMS and access stay selectable as the terrain", async () => {
    stubFetch();
    const sim = createSimulator();
    const world = await sim.loadWorld();
    const ex = await sim.run(world, { removedLinks: ["key_bridge"] }, { xharborMode: "exact" });
    expect(ex.detail?.approximation).toBeNull();
    const fast = await sim.run(world, { removedLinks: ["key_bridge"] });
    expect(fast.detail?.approximation).not.toBeNull();
    const ems = await sim.run(world, { removedLinks: ["key_bridge"] }, { lens: "ems" });
    expect(ems.detail?.lens).toBe("ems");
    expect(ems.detail?.xharbor).toBeUndefined();
    expect(ems.detail?.lenses.xharbor.xharbor).toBeDefined();
    const acc = await sim.run(world, { removedLinks: ["key_bridge"] }, { lens: "access" });
    expect(acc.detail?.minutesKind).toBe("added");
  });

  it("futures on the cross-harbor lens go through the real simulator handle with progress", async () => {
    stubFetch();
    const sim = createSimulator();
    await sim.loadWorld();
    const seen: number[] = [];
    const f = await sim.snapshotBacked!.runFutures({ removedLinks: ["key_bridge"] }, "xharbor", { n: 10, seed: 3, tod: "am", closureProb: 0.1, goal: { metric: "popLossGt10pct", op: "<=", target: 1e12 } }, { onProgress: (d) => seen.push(d) });
    expect(f.samples).toHaveLength(10);
    expect(f.pGoal).toBe(1);
    expect(f.meta.variant?.approximate).toBe(true);
    expect(seen[seen.length - 1]).toBe(10);
  });
});

describe("dev fallback", () => {
  it("snapshot ABSENT (404): falls back to the mock, whose world keeps a non-empty provenance so the Demo chip shows", async () => {
    stubFetch(["graph.meta.json", "graph.bin", "hexes.bin", "hexes.meta.json", "facilities.json", "destinations.json"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sim = createSimulator();
    const world = await sim.loadWorld();
    expect(sim.meta.kind).toBe("mock");
    expect(world.provenance).not.toBe("");
    expect(sim.snapshotBacked).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("snapshot PRESENT but invalid: an error, never a silent fallback to demo data", async () => {
    const bad = h.snap.facilities.map((f, i) => (i === 0 ? { ...f, node: 10_000_000 } : f));
    stubFetch([], { "facilities.json": bad });
    const sim = createSimulator();
    await expect(sim.loadWorld()).rejects.toThrow(/facilities\.json/);
    expect(sim.meta.kind).toBe("browser");
  });

  it("snapshot partly missing (graph present, a required file 404): error, not the mock", async () => {
    stubFetch(["destinations.json"]);
    const sim = createSimulator();
    await expect(sim.loadWorld()).rejects.toThrow(/destinations\.json/);
  });
});

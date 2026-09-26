import { describe, expect, it } from "vitest";
import type { WorldState } from "../../lib/sim/contract";
import { SimEngine } from "../../lib/sim/engine";
import { XHARBOR_T_MAIN_S } from "../../lib/sim/lenses/xharbor";
import { buildHarbor, HARBOR_ID, naiveDistances, rec } from "./fixtures";

const h = buildHarbor();
const eng = new SimEngine({ snapshot: h.snap, params: h.params });
const g = h.snap.graph;
const hx = h.snap.hexes;
const w = (...m: ReturnType<typeof rec>[]): WorldState => ({ snapshotId: HARBOR_ID, mutations: m });
const closeBridge = rec("kb", { kind: "close_link", linkId: "L-KEYBRIDGE" });

/** Brute force straight from the definition: every origin hex against every opposite-shore destination hex. */
function reference(world: WorldState) {
  const cw = eng.compileWorld(world);
  const edges = Array.from({ length: g.edgeCount }, (_, e) => ({ from: g.edgeFrom[e], to: g.edgeTo[e], timeS: g.edgeTimeS[e] }));
  const dests = [...Array(hx.count).keys()].filter((i) => hx.jobs[i] > 0 && hx.shore[i] < 2);
  const perDest = new Map<number, Float64Array>();
  for (const j of dests) if (!perDest.has(hx.node[j])) perDest.set(hx.node[j], naiveDistances(g.nodeCount, edges, cw.edgeEnabled, cw.edgeCostMul, [hx.node[j]], [0], true, Infinity));
  const mean = new Float64Array(hx.count).fill(NaN);
  const jobs = new Float64Array(hx.count).fill(NaN);
  for (let o = 0; o < hx.count; o++) {
    if (hx.shore[o] > 1) continue;
    let sum = 0;
    let den = 0;
    let J = 0;
    for (const j of dests) {
      if (hx.shore[j] === hx.shore[o]) continue;
      const D = hx.snapS[o] + (perDest.get(hx.node[j]) as Float64Array)[hx.node[o]] + hx.snapS[j];
      sum += hx.jobs[j] * Math.min(D, 7200);
      den += hx.jobs[j];
      if (D <= XHARBOR_T_MAIN_S) J += hx.jobs[j];
    }
    mean[o] = sum / den;
    jobs[o] = J;
  }
  return { mean, jobs };
}

describe("xharbor exact vs a brute-force reference (fixture)", () => {
  for (const [name, world] of [["baseline", w()], ["bridge closed", w(closeBridge)], ["bridge + tunnel closed", w(closeBridge, rec("t", { kind: "close_link", linkId: "L-HARBORTUNNEL" }))]] as const) {
    it(name, () => {
      const r = eng.runDeterministic(world, "xharbor", 1, { mode: "exact" });
      const ref = reference(world);
      for (let i = 0; i < hx.count; i++) {
        if (hx.shore[i] > 1) {
          expect(Number.isNaN(r.field[i])).toBe(true);
          expect(Number.isNaN(r.jobsWithin![i])).toBe(true);
          continue;
        }
        expect(r.field[i], `mean hex ${i}`).toBeCloseTo(ref.mean[i], 2);
        expect(r.jobsWithin![i], `jobs hex ${i}`).toBe(ref.jobs[i]);
      }
      expect(r.meta.variant).toMatchObject({ mode: "exact", approximate: false });
    });
  }

  it("shore-2 hexes are neither origins nor destinations: their jobs never appear and they carry no weight", () => {
    expect(hx.shore[0]).toBe(2);
    expect(hx.jobs[0]).toBeGreaterThan(0);
    const r = eng.runDeterministic(w(closeBridge), "xharbor", 1, { mode: "exact" });
    const total = [...Array(hx.count).keys()].filter((i) => hx.shore[i] < 2).reduce((s, i) => s + hx.jobs[i], 0);
    const maxJobs = Math.max(...[...Array(hx.count).keys()].filter((i) => hx.shore[i] < 2).map((i) => r.jobsWithin![i]));
    expect(maxJobs).toBeLessThan(total); // the ambiguous hex's 50+ jobs are in neither shore's total
    expect(r.added![0]).toBe(0);
    expect(r.lossFrac![0]).toBe(0);
    const ex = r.metrics.xharbor!;
    const originPop = [...Array(hx.count).keys()].filter((i) => hx.shore[i] < 2).reduce((s, i) => s + hx.pop[i], 0);
    expect(ex.popCovered).toBeCloseTo(originPop, 3);
  });
});

describe("xharbor semantics", () => {
  it("baseline: zero loss and zero added time; closing the bridge only raises mean time and lowers jobs within 30 min", () => {
    const b = eng.runDeterministic(w(), "xharbor");
    expect(b.metrics.xharbor?.popMeanLossPct).toBe(0);
    expect(b.metrics.xharbor?.popMeanAddedS).toBe(0);
    expect(Math.max(...b.added!)).toBe(0);
    const c = eng.runDeterministic(w(closeBridge), "xharbor");
    for (let i = 0; i < hx.count; i++) {
      if (hx.shore[i] > 1) continue;
      expect(c.added![i]).toBeGreaterThanOrEqual(-1e-3);
      expect(c.jobsWithin![i]).toBeLessThanOrEqual(b.jobsWithin![i] + 1e-3);
      expect(c.lossFrac![i]).toBeGreaterThanOrEqual(-1e-6);
      expect(c.lossFrac![i]).toBeLessThanOrEqual(1);
    }
    expect(c.metrics.xharbor!.popMeanAddedS).toBeGreaterThan(0);
    expect(c.metrics.popAddedS).toBe(c.metrics.xharbor!.popMeanAddedS);
    expect(c.metrics.equityGapS).toBe(c.metrics.xharbor!.equityGapAddedS);
  });

  it("a candidate link wins time back; metrics are consistent (>25% subset of >10% subset of >5%)", () => {
    const closed = eng.runDeterministic(w(closeBridge), "xharbor").metrics.xharbor!;
    const fixed = eng.runDeterministic(w(closeBridge, rec("t", { kind: "apply_candidate", candidateId: "TL-TEMP" })), "xharbor").metrics.xharbor!;
    expect(fixed.popMeanAddedS).toBeLessThan(closed.popMeanAddedS);
    expect(closed.popLossGt25pct).toBeLessThanOrEqual(closed.popLossGt10pct);
    expect(closed.popLossGt10pct).toBeLessThanOrEqual(closed.popLossGt5pct);
    expect(closed.lowWageLossGt10pct).toBeLessThanOrEqual(closed.lowWageCovered);
    expect(closed.byOriginShore["0"].pop + closed.byOriginShore["1"].pop).toBeCloseTo(closed.popCovered, 3);
  });

  it("worst block groups are named from blockgroups.json, sorted, and skip block groups under 200 people", () => {
    const c = eng.runDeterministic(w(closeBridge), "xharbor").metrics.xharbor!;
    const rows = c.worst!.byLossPct;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].geoid).toMatch(/^2451000/);
    expect(rows[0].county).toMatch(/Fixture County/);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].meanLossPct).toBeGreaterThanOrEqual(rows[i].meanLossPct);
    for (const r of rows) expect(r.pop).toBeGreaterThanOrEqual(200);
    const byAdded = c.worst!.byAddedS;
    for (let i = 1; i < byAdded.length; i++) expect(byAdded[i - 1].meanAddedS).toBeGreaterThanOrEqual(byAdded[i].meanAddedS);
  });
});

describe("xharbor fast anchors", () => {
  it("with one anchor per destination hex it reproduces the exact result (the approximation is only in the clustering)", () => {
    const world = w(closeBridge);
    const ex = eng.runDeterministic(world, "xharbor", 1, { mode: "exact" });
    const fast = eng.runDeterministic(world, "xharbor", 1, { mode: "fast", anchorsPerShore: 1000 });
    for (let i = 0; i < hx.count; i++) {
      if (hx.shore[i] > 1) continue;
      expect(fast.field[i]).toBeCloseTo(ex.field[i], 2);
      expect(fast.jobsWithin![i]).toBeCloseTo(ex.jobsWithin![i], 1);
    }
    expect(fast.metrics.xharbor!.popMeanAddedS).toBeCloseTo(ex.metrics.xharbor!.popMeanAddedS, 3);
  });

  it("is labelled as an approximation in the result meta; exact is not", () => {
    const f = eng.runDeterministic(w(), "xharbor", 1, { mode: "fast", anchorsPerShore: 4 });
    expect(f.meta.variant).toMatchObject({ mode: "fast-anchors", approximate: true, anchorsPerShore: 4 });
    expect(f.meta.variant?.label).toMatch(/approximation/i);
    expect(eng.runDeterministic(w(), "ems").meta.variant?.approximate).toBe(false);
  });

  it("a coarse clustering stays close on the aggregate that matters (mean added time within 25 percent on the fixture)", () => {
    const world = w(closeBridge);
    const ex = eng.runDeterministic(world, "xharbor", 1, { mode: "exact" }).metrics.xharbor!;
    const fast = eng.runDeterministic(world, "xharbor", 1, { mode: "fast", anchorsPerShore: 6 }).metrics.xharbor!;
    expect(Math.abs(fast.popMeanAddedS - ex.popMeanAddedS)).toBeLessThan(0.25 * ex.popMeanAddedS);
  });

  it("clustering is deterministic", () => {
    const a = eng.runDeterministic(w(closeBridge), "xharbor", 1, { mode: "fast", anchorsPerShore: 5 });
    const b = new SimEngine({ snapshot: h.snap, params: h.params }).runDeterministic(w(closeBridge), "xharbor", 1, { mode: "fast", anchorsPerShore: 5 });
    expect(new Uint8Array(a.field.buffer)).toEqual(new Uint8Array(b.field.buffer));
    expect(a.metrics).toEqual(b.metrics);
  });
});

describe("xharbor futures", () => {
  const o = { n: 20, seed: 9, tod: "pm" as const, closureProb: 0.2 };
  it("runs with the fast variant, is deterministic, reports real progress and honours cancel", async () => {
    const seen: number[] = [];
    const a = await eng.runFutures(w(closeBridge), "xharbor", o, { onProgress: (d) => seen.push(d) });
    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(a.headlineMetric).toBe("popLossGt10pct");
    expect(a.meta.variant?.approximate).toBe(true);
    expect(a.hexAddedP90).toHaveLength(hx.count);
    const b = await new SimEngine({ snapshot: h.snap, params: h.params }).runFutures(w(closeBridge), "xharbor", o);
    expect(JSON.stringify(a.samples)).toBe(JSON.stringify(b.samples));
    let cancel = false;
    let done = 0;
    await expect(eng.runFutures(w(closeBridge), "xharbor", { ...o, n: 500 }, { onProgress: (d) => { done = d; if (d === 3) cancel = true; }, isCancelled: () => cancel })).rejects.toMatchObject({ name: "AbortError" });
    expect(done).toBe(3);
  });

  it("added time is measured against the baseline under the same future (paired), so it is never negative for a closure", async () => {
    const r = await eng.runFutures(w(closeBridge), "xharbor", { ...o, headline: "popMeanAddedS", closureProb: 0 });
    for (const s of r.samples) expect(s.xharbor!.popMeanAddedS).toBeGreaterThan(0);
    const same = await eng.runFutures(w(), "xharbor", o);
    for (const s of same.samples) {
      expect(s.xharbor!.popMeanAddedS).toBe(0);
      expect(s.xharbor!.popLossGt10pct).toBe(0);
    }
  });

  it("supports pGoal on cross-harbor metrics and rejects goals that do not exist for the lens", async () => {
    const r = await eng.runFutures(w(closeBridge), "xharbor", { ...o, goal: { metric: "popLossGt10pct", op: "<=", target: 1e12 } });
    expect(r.pGoal).toBe(1);
    await expect(eng.runFutures(w(), "ems", { ...o, goal: { metric: "popLossGt10pct", op: "<=", target: 1 } })).rejects.toThrow(/not available/);
  });
});

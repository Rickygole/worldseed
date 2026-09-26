import { describe, expect, it } from "vitest";
import type { FuturesOptions, FuturesResult, LensId, WorldState } from "../../lib/sim/contract";
import { CancelledError, SimEngine } from "../../lib/sim/engine";
import { aggregateFutures, splitRange } from "../../lib/sim/futures";
import { DEFAULT_FUTURES_PARAMS, drawFuture, newSample, resolveFutures } from "../../lib/sim/sample";
import { buildHarbor, HARBOR_ID, rec } from "./fixtures";

const h = buildHarbor();
const fresh = (fp = DEFAULT_FUTURES_PARAMS) => new SimEngine({ snapshot: h.snap, params: h.params }, fp);
const eng = fresh();
const w = (...m: ReturnType<typeof rec>[]): WorldState => ({ snapshotId: HARBOR_ID, mutations: m });
const closeBridge = rec("kb", { kind: "close_link", linkId: "L-KEYBRIDGE" });
const opts = (o: Partial<FuturesOptions> = {}): FuturesOptions => ({ n: 40, seed: 12345, tod: "am", closureProb: 0, ...o });

/** Comparable form of a result: everything except wall-clock time. */
function canon(r: FuturesResult): string {
  const { meta, hexP90, hexAddedP90, ...rest } = r;
  return JSON.stringify({ rest, meta: { ...meta, ms: 0 }, hexP90: Array.from(hexP90), hexAddedP90: hexAddedP90 ? Array.from(hexAddedP90) : null });
}

describe("determinism", () => {
  for (const lens of ["ems", "access"] as LensId[]) {
    it(`${lens}: same seed gives identical futures byte for byte; another seed does not`, async () => {
      const o = opts({ closureProb: 0.3 });
      const a = await eng.runFutures(w(closeBridge), lens, o);
      const b = await fresh().runFutures(w(closeBridge), lens, o);
      expect(canon(a)).toBe(canon(b));
      expect(new Uint8Array(a.hexP90.buffer)).toEqual(new Uint8Array(b.hexP90.buffer));
      const c = await eng.runFutures(w(closeBridge), lens, { ...o, seed: 999 });
      expect(canon(c)).not.toBe(canon(a));
    });
  }

  it("future i does not depend on n: the first 10 futures of n=10 equal the first 10 of n=50", async () => {
    const small = await eng.runFutures(w(closeBridge), "ems", opts({ n: 10 }));
    const big = await eng.runFutures(w(closeBridge), "ems", opts({ n: 50 }));
    expect(JSON.stringify(small.samples)).toBe(JSON.stringify(big.samples.slice(0, 10)));
  });

  it("ranges computed separately (as on separate workers) aggregate to the single-run result", async () => {
    const o = opts({ n: 37, closureProb: 0.2 });
    const one = await eng.runFutures(w(closeBridge), "access", o);
    for (const parts of [2, 3, 4, 5]) {
      const ranges = splitRange(o.n, parts);
      const partials = await Promise.all(ranges.map(([s, e]) => fresh().runFuturesRange(w(closeBridge), "access", o, s, e)));
      const agg = aggregateFutures("access", partials, h.snap.hexes.count, o, { runner: "local-node", workers: 1, ms: 0, snapshotId: HARBOR_ID });
      expect(canon(agg)).toBe(canon({ ...one, meta: { ...one.meta, ms: 0 } }));
    }
  });
});

describe("common random numbers: paired futures share draws", () => {
  it("draws do not depend on the world (a sample is a function of seed and index only)", () => {
    const rf = resolveFutures(DEFAULT_FUTURES_PARAMS, h.snap.graph, h.snap.hexes);
    const a = newSample(rf, h.snap.hexes.count, true);
    const b = newSample(rf, h.snap.hexes.count, true);
    drawFuture(rf, 7, 3, "am", 0.5, 100, a);
    drawFuture(rf, 7, 9, "pm", 0.9, 10, b); // disturb b with other draws first
    drawFuture(rf, 7, 3, "am", 0.5, 100, b);
    expect(Array.from(b.zClass)).toEqual(Array.from(a.zClass));
    expect(b.zGlobal).toBe(a.zGlobal);
    expect(Array.from(b.zCorr)).toEqual(Array.from(a.zCorr));
    expect(b.closeLink).toBe(a.closeLink);
    expect(Array.from(b.incidents as Float32Array)).toEqual(Array.from(a.incidents as Float32Array));
    expect((a.incidents as Float32Array).reduce((s, x) => s + x, 0)).toBe(100);
  });

  it("congestion draws are the same across lenses and closure settings (separate streams)", () => {
    const rf = resolveFutures(DEFAULT_FUTURES_PARAMS, h.snap.graph, h.snap.hexes);
    const a = newSample(rf, h.snap.hexes.count, false);
    const b = newSample(rf, h.snap.hexes.count, true);
    drawFuture(rf, 1, 5, "am", 0, 1, a);
    drawFuture(rf, 1, 5, "am", 1, 300, b);
    expect(Array.from(a.zClass)).toEqual(Array.from(b.zClass));
    expect(a.closeLink).toBe(-1);
    expect(b.closeLink).toBeGreaterThanOrEqual(0);
  });

  it("per future, closing a link never helps and a speed-up never hurts (only possible if both worlds saw the same draw)", async () => {
    const base = await eng.runFutures(w(), "ems", opts({ n: 60 }));
    const closed = await eng.runFutures(w(closeBridge), "ems", opts({ n: 60 }));
    const sped = await eng.runFutures(w(rec("sp", { kind: "apply_candidate", candidateId: "SP-TUNNEL" })), "ems", opts({ n: 60 }));
    for (let i = 0; i < 60; i++) {
      expect(closed.samples[i].p90S).toBeGreaterThanOrEqual(base.samples[i].p90S);
      expect(sped.samples[i].p90S).toBeLessThanOrEqual(base.samples[i].p90S);
    }
  });

  it("paired differences are much tighter than the futures themselves", async () => {
    const o = opts({ n: 80, tod: "pm" });
    const base = await eng.runFutures(w(), "access", { ...o, headline: "p90S" });
    const closed = await eng.runFutures(w(closeBridge), "access", { ...o, headline: "p90S" });
    const sd = (v: number[]) => {
      const m = v.reduce((a, c) => a + c, 0) / v.length;
      return Math.sqrt(v.reduce((a, c) => a + (c - m) ** 2, 0) / v.length);
    };
    const level = base.samples.map((s) => s.p90S);
    const diff = closed.samples.map((s, i) => s.p90S - base.samples[i].p90S);
    expect(sd(level)).toBeGreaterThan(0);
    expect(sd(diff)).toBeLessThan(sd(level));
  });

  it("Access 'added' is measured against the reference world under the SAME future", async () => {
    const r = await eng.runFutures(w(), "access", opts({ n: 20 })); // world == reference
    for (const s of r.samples) {
      expect(s.addedP90S).toBe(0);
      expect(s.pctWithin).toBe(100);
    }
    const closed = await eng.runFutures(w(closeBridge), "access", opts({ n: 20 }));
    for (const s of closed.samples) expect(s.addedP90S as number).toBeGreaterThan(0);
    // measured against a custom reference (the closed world itself) the added time vanishes again
    const vs = await eng.runFutures(w(closeBridge), "access", opts({ n: 20, referenceWorld: w(closeBridge) }));
    for (const s of vs.samples) expect(s.addedP90S).toBe(0);
  });

  it("a warm reference cache gives the same answer as a cold engine", async () => {
    const warm = fresh();
    await warm.runFutures(w(rec("sp", { kind: "apply_candidate", candidateId: "SP-TUNNEL" })), "access", opts());
    const a = await warm.runFutures(w(closeBridge), "access", opts());
    const b = await fresh().runFutures(w(closeBridge), "access", opts());
    expect(canon(a)).toBe(canon(b));
  });
});

describe("the model", () => {
  it("multipliers are floored at 1: no future is faster than free-flow", async () => {
    const base = eng.runDeterministic(w(), "ems").field;
    const r = await eng.runFutures(w(), "ems", opts({ n: 30, tod: "night" }));
    for (let i = 0; i < base.length; i++) expect(r.hexP90[i]).toBeGreaterThanOrEqual(base[i] - 1e-3);
  });

  it("peak periods are slower than night", async () => {
    const night = await eng.runFutures(w(), "access", opts({ n: 40, tod: "night", headline: "p50S" }));
    const am = await eng.runFutures(w(), "access", opts({ n: 40, tod: "am", headline: "p50S" }));
    expect(am.headline.p50).toBeGreaterThan(night.headline.p50);
  });

  it("correlated congestion widens the spread of futures (not artificially narrow)", async () => {
    const lowRho = fresh({ ...DEFAULT_FUTURES_PARAMS, rho: 0 });
    const highRho = fresh({ ...DEFAULT_FUTURES_PARAMS, rho: 0.9 });
    const o = opts({ n: 200, tod: "pm", headline: "p50S" });
    const a = await lowRho.runFutures(w(), "access", o);
    const b = await highRho.runFutures(w(), "access", o);
    expect(b.headline.p90 - b.headline.p10).toBeGreaterThan(a.headline.p90 - a.headline.p10);
  });

  it("random closures: prob 0 never closes, prob 1 always closes an eligible link", () => {
    const rf = resolveFutures(DEFAULT_FUTURES_PARAMS, h.snap.graph, h.snap.hexes);
    expect(rf.eligible).toEqual([h.snap.graph.linkIndex.get("L-HARBORTUNNEL")]); // others absent from this snapshot
    const s = newSample(rf, h.snap.hexes.count, false);
    for (let i = 0; i < 50; i++) {
      drawFuture(rf, 3, i, "am", 0, 1, s);
      expect(s.closeLink).toBe(-1);
      drawFuture(rf, 3, i, "am", 1, 1, s);
      expect(s.closeLink).toBe(rf.eligible[0]);
    }
  });

  it("a closure future with the bridge also closed cuts the shores apart", async () => {
    const r = await eng.runFutures(w(closeBridge), "access", opts({ n: 20, closureProb: 1, headline: "p90S" }));
    const noClosure = await eng.runFutures(w(closeBridge), "access", opts({ n: 20, closureProb: 0, headline: "p90S" }));
    expect(r.headline.p50).toBeGreaterThan(noClosure.headline.p50);
  });

  it("diversion load: closing the bridge slows tunnel corridors relative to no diversion", async () => {
    const noDiv = fresh({ ...DEFAULT_FUTURES_PARAMS, diversion: { ...DEFAULT_FUTURES_PARAMS.diversion, factor: 1 } });
    const o = opts({ n: 30, headline: "p90S" });
    const a = await eng.runFutures(w(closeBridge), "access", o);
    const b = await noDiv.runFutures(w(closeBridge), "access", o);
    expect(a.headline.p50).toBeGreaterThan(b.headline.p50);
  });

  it("incident management (smaller corridor sigma) narrows the tunnel's contribution", async () => {
    const o = opts({ n: 60, tod: "pm", headline: "p90S" });
    const closed = await eng.runFutures(w(closeBridge), "access", o);
    const managed = await eng.runFutures(w(closeBridge, rec("im", { kind: "apply_candidate", candidateId: "IM-TUNNEL" })), "access", o);
    // same draws, half the corridor sigma: the spread of the tunnel multiplier shrinks
    expect(managed.p90.p90 - managed.p90.p10).toBeLessThanOrEqual(closed.p90.p90 - closed.p90.p10 + 1e-6);
  });
});

describe("aggregates", () => {
  it("p10 <= p50 <= p90, isolated frequencies are sorted shares of n, hexP90 has one value per hex", async () => {
    const r = await eng.runFutures(w(closeBridge), "access", opts({ n: 50, closureProb: 0.4 }));
    for (const d of [r.p50, r.p90, r.headline, r.pctWithin, r.equityGapS, r.isolatedCount]) {
      expect(d.p10).toBeLessThanOrEqual(d.p50);
      expect(d.p50).toBeLessThanOrEqual(d.p90);
    }
    expect(r.samples).toHaveLength(50);
    expect(r.hexP90).toHaveLength(h.snap.hexes.count);
    expect(r.hexAddedP90).toHaveLength(h.snap.hexes.count);
    for (let i = 1; i < r.worstIsolated.length; i++) expect(r.worstIsolated[i - 1].freq).toBeGreaterThanOrEqual(r.worstIsolated[i].freq);
    for (const x of r.worstIsolated) {
      expect(x.freq).toBeGreaterThan(0);
      expect(x.freq).toBeLessThanOrEqual(1);
      expect(Number.isInteger(x.freq * 50)).toBe(true);
    }
    expect(r.worstIsolatedCount).toBe(Math.max(...r.samples.map((s) => s.isolatedBg.length)));
    expect(r.meta.model).toMatch(/not a traffic forecast/i);
    expect(r.meta).toMatchObject({ n: 50, seed: 12345, tod: "am", runner: "local-node", workers: 1, snapshotId: HARBOR_ID });
  });

  it("EMS futures have no Access-only fields; headline defaults are lens-specific", async () => {
    const e = await eng.runFutures(w(), "ems", opts({ n: 5 }));
    expect(e.hexAddedP90).toBeUndefined();
    expect(e.headlineMetric).toBe("p90S");
    const a = await eng.runFutures(w(), "access", opts({ n: 5 }));
    expect(a.headlineMetric).toBe("addedP90S");
    await expect(eng.runFutures(w(), "ems", opts({ n: 5, headline: "addedP90S" }))).rejects.toThrow(/not available/);
  });

  it("pGoal is the share of futures meeting the goal and is monotone in the target", async () => {
    const o = opts({ n: 50, tod: "pm" });
    const at = async (target: number) => (await eng.runFutures(w(closeBridge), "access", { ...o, goal: { metric: "addedP90S", op: "<=", target } })).pGoal as number;
    const none = await at(-1);
    const all = await at(1e9);
    expect(none).toBe(0);
    expect(all).toBe(1);
    const r = await eng.runFutures(w(closeBridge), "access", { ...o });
    const median = r.headline.p50;
    const mid = await at(median);
    expect(mid).toBeGreaterThanOrEqual(0.5);
    expect(mid).toBeLessThan(1);
    expect(await at(median * 2)).toBeGreaterThanOrEqual(mid);
    const ge = await eng.runFutures(w(closeBridge), "access", { ...o, goal: { metric: "pctWithin", op: ">=", target: 0 } });
    expect(ge.pGoal).toBe(1);
    const isoGoal = await eng.runFutures(w(), "ems", { ...o, goal: { metric: "isolatedCount", op: "<=", target: 0 } });
    expect(isoGoal.pGoal).toBeGreaterThanOrEqual(0);
  });

  it("rejects bad options", async () => {
    await expect(eng.runFutures(w(), "ems", opts({ n: 0 }))).rejects.toThrow(RangeError);
    await expect(eng.runFutures(w(), "ems", opts({ closureProb: 2 }))).rejects.toThrow(RangeError);
    await expect(eng.runFutures(w(), "ems", opts({ tod: "noon" as never }))).rejects.toThrow(RangeError);
    await expect(eng.runFuturesRange(w(), "ems", opts({ n: 10 }), 5, 20)).rejects.toThrow(RangeError);
  });
});

describe("progress and cancellation", () => {
  it("reports the real completed count after every future", async () => {
    const seen: number[] = [];
    const r = await eng.runFutures(w(closeBridge), "access", opts({ n: 25 }), { onProgress: (d) => seen.push(d) });
    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(r.samples).toHaveLength(25);
  });

  it("stops at the next future boundary when cancelled, and the count reflects work actually done", async () => {
    let done = 0;
    let cancel = false;
    await expect(
      eng.runFutures(w(closeBridge), "access", opts({ n: 100 }), {
        onProgress: (d) => {
          done = d;
          if (d === 7) cancel = true;
        },
        isCancelled: () => cancel,
      }),
    ).rejects.toThrow(CancelledError);
    expect(done).toBe(7);
  });
});

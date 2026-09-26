import { describe, expect, it } from "vitest";
import type { Hexes, ModelParams } from "../../lib/sim/contract";
import { MetricsWorkspace, originMaskedHexes, quantileSortedRank, weightedQuantile, worstBlockGroups } from "../../lib/sim/metrics";
import { lcg } from "./fixtures";

const params: ModelParams = { call_to_wheels_delay_min: 1, emsThresholdS: 480, accessCapS: 7200, accessAddedOkS: 300, accessCutoffS: 250 };

function toy(over: Partial<Record<"pop" | "zvh" | "lowWage" | "bg", number[]>> = {}): Hexes {
  const n = 6;
  const f = (a: number[]) => Float32Array.from(a);
  return {
    count: n,
    h3: Array.from({ length: n }, (_, i) => `t${i}`),
    lat: new Float32Array(n),
    lng: new Float32Array(n),
    node: new Uint32Array(n),
    snapS: new Float32Array(n),
    pop: f(over.pop ?? [10, 10, 10, 10, 10, 10]),
    zvh: f(over.zvh ?? [0, 0, 0, 0, 6, 0]),
    lowWage: f(over.lowWage ?? [0, 0, 0, 0, 0, 10]),
    jobs: new Float32Array(n),
    bg: Uint16Array.from(over.bg ?? [0, 0, 0, 1, 1, 1]),
    shore: new Uint8Array(n),
  };
}

describe("weighted quantile", () => {
  it("no interpolation: first value whose cumulative weight >= q * total", () => {
    const v = [100, 200, 300, 400, 500, 600];
    const w = [10, 10, 10, 10, 10, 10];
    expect(weightedQuantile(v, w, 0.5)).toBe(300); // cum 30 >= 30
    expect(weightedQuantile(v, w, 0.9)).toBe(600); // 54 -> cum 60
    expect(weightedQuantile(v, w, 0.1)).toBe(100);
    expect(weightedQuantile(v, w, 1)).toBe(600);
  });

  it("weights move the answer; zero weights never win; zero total gives NaN", () => {
    expect(weightedQuantile([1, 2, 3], [0, 0, 5], 0.5)).toBe(3);
    expect(weightedQuantile([1, 2, 3], [9, 0, 1], 0.9)).toBe(1);
    expect(weightedQuantile([1, 2, 3], [0, 0, 0], 0.5)).toBeNaN();
  });

  it("ties are ordered by index and the workspace agrees with the reference on random data", () => {
    const r = lcg(3);
    for (let trial = 0; trial < 50; trial++) {
      const n = 40;
      const hexes = toy();
      const big: Hexes = {
        ...hexes,
        count: n,
        h3: Array.from({ length: n }, (_, i) => `t${i}`),
        lat: new Float32Array(n),
        lng: new Float32Array(n),
        node: new Uint32Array(n),
        snapS: new Float32Array(n),
        pop: Float32Array.from({ length: n }, () => Math.floor(r() * 50)),
        zvh: Float32Array.from({ length: n }, () => Math.floor(r() * 10)),
        lowWage: Float32Array.from({ length: n }, () => Math.floor(r() * 10)),
        jobs: new Float32Array(n),
        bg: Uint16Array.from({ length: n }, (_, i) => Math.floor(i / 8)),
        shore: new Uint8Array(n),
      };
      const field = Float32Array.from({ length: n }, () => Math.floor(r() * 12) * 60); // many ties
      const mw = new MetricsWorkspace(big);
      const m = mw.ems(field, params);
      expect(m.p50S).toBe(weightedQuantile(field, big.pop, 0.5));
      expect(m.p90S).toBe(weightedQuantile(field, big.pop, 0.9));
      const zp90 = weightedQuantile(field, big.zvh, 0.9);
      if (Number.isFinite(zp90 - m.p90S)) expect(m.equityGapS).toBe(zp90 - m.p90S);
      const iso: number[] = [];
      for (let b = 0; b < 5; b++) {
        const idx = [...Array(n).keys()].filter((i) => big.bg[i] === b);
        const pw = idx.map((i) => big.pop[i]);
        if (pw.reduce((a, c) => a + c, 0) <= 0) continue;
        if (weightedQuantile(idx.map((i) => field[i]), pw, 0.5) > params.emsThresholdS) iso.push(b);
      }
      expect(m.isolatedBg).toEqual(iso);
    }
  });
});

describe("EMS metrics, hand-computed", () => {
  const field = Float32Array.from([100, 200, 300, 400, 500, 600]);
  it("p50 / p90 / % within / isolated block groups / equity gap", () => {
    const m = new MetricsWorkspace(toy()).ems(field, params);
    expect(m.lens).toBe("ems");
    expect(m.p50S).toBe(300);
    expect(m.p90S).toBe(600);
    // 4 of 6 hexes (100..400) are <= 480 s
    expect(m.pctWithin).toBeCloseTo((40 / 60) * 100, 10);
    // BG0 = {100,200,300} median 200 (ok); BG1 = {400,500,600} median 500 > 480
    expect(m.isolatedBg).toEqual([1]);
    // all zero-vehicle households are in hex 4 (500 s): zvh p90 = 500, pop p90 = 600
    expect(m.equityGapS).toBe(500 - 600);
    // zvh within: hex 4 is 500 > 480, so 0 %
    expect(m.zvhWithin).toBe(0);
    expect(m.unreachableHexes).toBe(0);
  });

  it("unreachable hexes are Infinity: they count as beyond the threshold and can make a quantile Infinity", () => {
    const f = Float32Array.from([100, 200, 300, 400, Infinity, Infinity]);
    const m = new MetricsWorkspace(toy()).ems(f, params);
    expect(m.p50S).toBe(300);
    expect(m.p90S).toBe(Infinity);
    expect(m.unreachableHexes).toBe(2);
    expect(m.isolatedBg).toEqual([1]); // BG1 median = 500-ish -> Infinity
    expect(m.pctWithin).toBeCloseTo((40 / 60) * 100, 10);
  });

  it("a block group with no population is never isolated", () => {
    const h = toy({ pop: [10, 10, 10, 0, 0, 0] });
    const m = new MetricsWorkspace(h).ems(field, params);
    expect(m.isolatedBg).toEqual([]);
  });

  it("incident weights replace population for the quantiles but not for isolation", () => {
    const inc = Float32Array.from([5, 0, 0, 0, 0, 0]);
    const m = new MetricsWorkspace(toy()).ems(field, params, inc);
    expect(m.p50S).toBe(100);
    expect(m.p90S).toBe(100);
    expect(m.pctWithin).toBe(100);
    expect(m.isolatedBg).toEqual([1]);
  });
});

describe("Access metrics, hand-computed", () => {
  const baseline = Float32Array.from([600, 600, 600, 600, 600, 600]);
  const field = Float32Array.from([600, 700, 800, 900, 1000, 1100]);
  // added = [0, 100, 200, 300, 400, 500]

  it("p50/p90 of access time, % added <= 5 min, cut-off block groups, equity gap", () => {
    const m = new MetricsWorkspace(toy()).access(field, baseline, params);
    expect(m.lens).toBe("access");
    expect(m.p50S).toBe(800);
    expect(m.p90S).toBe(1100);
    expect(m.pctWithin).toBeCloseTo((40 / 60) * 100, 10); // added <= 300 : 4 hexes
    expect(m.addedP50S).toBe(200);
    expect(m.addedP90S).toBe(500);
    expect(m.popAddedS).toBeCloseTo(250, 10);
    expect(m.lowWageAddedS).toBeCloseTo(500, 10); // all low-wage workers sit in the +500 hex
    expect(m.equityGapS).toBeCloseTo(250, 10);
    // cut-off = BG median added > 250 (test param): BG0 {0,100,200} -> 100; BG1 {300,400,500} -> 400
    expect(m.isolatedBg).toEqual([1]);
  });

  it("with no baseline, added time is zero everywhere", () => {
    const m = new MetricsWorkspace(toy()).access(field, null, params);
    expect(m.pctWithin).toBe(100);
    expect(m.isolatedBg).toEqual([]);
    expect(m.equityGapS).toBe(0);
    expect(m.addedP90S).toBe(0);
  });
});

describe("nearest-rank quantile across futures", () => {
  it("returns the first value whose cumulative share >= q", () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantileSortedRank(a, 0.1)).toBe(1);
    expect(quantileSortedRank(a, 0.5)).toBe(5);
    expect(quantileSortedRank(a, 0.9)).toBe(9);
    expect(quantileSortedRank([], 0.5)).toBeNaN();
  });
});

describe("xharbor metrics, hand-computed", () => {
  const f = (a: number[]) => Float32Array.from(a);
  const mean = f([100, 110, 120, 130, 140, 150]);
  const base = f([100, 100, 100, 100, 100, 100]);
  const jobs = f([1000, 900, 800, 700, 600, 500]);
  const baseJobs = f([1000, 1000, 1000, 1000, 1000, 1000]);
  const hexes = toy({ lowWage: [0, 0, 0, 0, 0, 10] });
  const m = new MetricsWorkspace(originMaskedHexes(hexes)).xharbor(mean, jobs, base, baseJobs, params).xharbor!;

  it("loss thresholds are strict (>), weighted by population and by low-wage workers", () => {
    // loss = [0, .1, .2, .3, .4, .5]
    expect(m.popLossGt5pct).toBe(50);
    expect(m.popLossGt10pct).toBe(40); // 0.1 is not > 0.1
    expect(m.popLossGt25pct).toBe(30);
    expect(m.popLossGt50pct).toBe(0);
    expect(m.lowWageLossGt10pct).toBe(10);
    expect(m.lowWageLossGt50pct).toBe(0);
    expect(m.popMeanLossPct).toBeCloseTo(25, 10);
    expect(m.lowWageMeanLossPct).toBeCloseTo(50, 10);
    expect(m.equityGapLossPct).toBeCloseTo(25, 10);
    expect(m.originsWithoutBaselineJobs).toBe(0);
  });

  it("jobs and added-time distributions", () => {
    expect(m.popMeanJobs).toBeCloseTo(750, 10);
    expect([m.jobsP10, m.jobsP50, m.jobsP90]).toEqual([500, 700, 1000]);
    expect(m.popMeanAddedS).toBeCloseTo(25, 10);
    expect(m.lowWageMeanAddedS).toBeCloseTo(50, 10);
    expect(m.equityGapAddedS).toBeCloseTo(25, 10);
    expect([m.addedP50S, m.addedP90S, m.addedP99S, m.addedMaxS]).toEqual([20, 50, 50, 50]);
    expect(m.popAddedGt60s).toBe(0);
    expect(m.popMeanMeanTimeS).toBeCloseTo(125, 10);
  });

  it("generic LensMetrics fields are derived consistently", () => {
    const g = new MetricsWorkspace(originMaskedHexes(hexes)).xharbor(mean, jobs, base, baseJobs, params);
    expect(g.lens).toBe("xharbor");
    expect([g.p50S, g.p90S]).toEqual([120, 150]);
    expect(g.pctWithin).toBe(100);
    expect(g.isolatedBg).toEqual([]);
    expect(g.equityGapS).toBe(m.equityGapAddedS);
  });

  it("non-origin hexes (NaN) carry no weight; baseline jobs of zero count as no loss", () => {
    const mean2 = f([100, 110, NaN, 130, 140, 150]);
    const hx2 = { ...hexes, shore: Uint8Array.from([0, 0, 2, 0, 0, 0]) };
    const r = new MetricsWorkspace(originMaskedHexes(hx2)).xharbor(mean2, jobs, base, f([1000, 1000, 1000, 1000, 1000, 0]), params).xharbor!;
    expect(r.popCovered).toBe(50);
    expect(r.originsWithoutBaselineJobs).toBe(1);
    expect(r.popLossGt25pct).toBe(20); // hexes 3 and 4; hex 5 has no baseline jobs -> loss 0
    expect(r.byOriginShore["0"].pop).toBe(50);
  });

  it("worstBlockGroups follows golden.py: only >= 200 people, sorted by loss then geoid", () => {
    const bg = (geoid: string, i: number, pop: number, hs: number[]) => ({ geoid, i, county: "c", pop, households: 0, zvh: 0, lowWageWorkers: 0, centroid: [0, 0] as [number, number], hexes: hs });
    const bgs = [bg("B", 0, 500, [0, 1, 2]), bg("A", 1, 500, [3, 4, 5]), bg("C", 2, 100, [5])];
    const loss = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
    const w = worstBlockGroups(hexes, bgs, loss, [0, 10, 20, 30, 40, 50], baseJobs, hexes.pop);
    expect(w.byLossPct.map((r) => r.geoid)).toEqual(["A", "B"]);
    expect(w.byLossPct[0].meanLossPct).toBeCloseTo(40, 10);
    expect(w.byLossPct[0].meanAddedS).toBeCloseTo(40, 10);
    expect(w.byLossPct[0].meanBaselineJobs).toBe(1000);
  });
});

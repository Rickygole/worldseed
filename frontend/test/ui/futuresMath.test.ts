import { describe, expect, it } from "vitest";
import type { LensMetrics } from "../../lib/sim/contract";
import { EvaluatedRowSchema } from "../../lib/agent/tools";
import { dist3, dominatedIds, durationTicks, goalValue, niceTicks, paired, pairedPGoal, quantile, rate, ridge, rowFromSamples, SERIES_COLORS, seriesColor, shareAtOrBelow } from "../../lib/ui/futuresMath";

const m = (p50S: number, p90S: number, iso = 0, eq = 0, pct = 90): LensMetrics => ({
  lens: "xharbor",
  p50S,
  p90S,
  pctWithin: pct,
  isolatedBg: Array.from({ length: iso }, (_, i) => i),
  equityGapS: eq,
});

describe("quantiles", () => {
  it("nearest rank, no interpolation", () => {
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1)).toBe(1);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
  it("dist3 sorts its input", () => {
    expect(dist3([9, 1, 5, 3, 7])).toEqual({ p10: 1, p50: 5, p90: 9 });
  });
});

describe("paired comparison", () => {
  it("subtracts future by future and refuses different futures", () => {
    expect(paired([10, 20], [9, 21])).toEqual([1, -1]);
    expect(() => paired([1], [1, 2])).toThrow(/same futures/);
  });
  it("P(goal) is the share of futures within the target of the pre-collapse value in the SAME future", () => {
    // option vs pre-collapse: +5, +30, +61 seconds; target +60 s -> 2 of 3
    expect(pairedPGoal([105, 230, 361], [100, 200, 300], 60)).toBeCloseTo(2 / 3);
    expect(pairedPGoal([], [], 60)).toBeNull();
    expect(pairedPGoal([1, 2], [1], 60)).toBeNull();
  });
});

describe("rowFromSamples", () => {
  it("builds a row the machine accepts, with the real futures count and medians", () => {
    const samples = [m(600, 1800, 1, -2), m(620, 1900, 3, -1), m(610, 1850, 2, 0)];
    const pre = [m(590, 1750), m(600, 1880), m(600, 1700)];
    const row = rowFromSamples({ bundleId: "B1", candidateIds: ["CP-I95-FLOW"], costTier: "$$", samples, preCollapse: pre, metric: "p90", targetDelta: 60 });
    expect(EvaluatedRowSchema.safeParse(row).success).toBe(true);
    expect(row.futures).toBe(3);
    expect(row.p50S).toBe(610);
    expect(row.p90S).toBe(1850);
    expect(row.isolatedCount).toBe(2);
    expect(row.equityGapS).toBe(-1); // signed median
    // 1800<=1810 yes, 1900<=1940 yes, 1850<=1760 no
    expect(row.pGoal).toBeCloseTo(2 / 3);
  });
  it("goalValue maps the agent metrics onto lens metrics", () => {
    const s = m(1, 2, 4, 7);
    expect(goalValue(m(1, 2, 0, -5), "equityGap")).toBe(-5); // signed: the group fares better
    expect([goalValue(s, "p50"), goalValue(s, "p90"), goalValue(s, "isolatedCount"), goalValue(s, "equityGap")]).toEqual([1, 2, 4, 7]);
  });
});

describe("dominance", () => {
  it("an option no better on P(goal), change and cost than another is dominated", () => {
    const d = dominatedIds([
      { id: "A", median: -10, pGoal: 0.5, costTier: "$" },
      { id: "B", median: -5, pGoal: 0.4, costTier: "$$" }, // worse on all three than A
      { id: "C", median: -20, pGoal: 0.3, costTier: "$$$" }, // better change, so not dominated
    ]);
    expect([...d]).toEqual(["B"]);
  });
  it("identical options do not dominate each other", () => {
    expect(dominatedIds([
      { id: "A", median: 0, pGoal: 0, costTier: "$" },
      { id: "B", median: 0, pGoal: 0, costTier: "$" },
    ]).size).toBe(0);
  });
});

describe("ridge and rate", () => {
  it("normalizes a density to a peak of 1 and draws a bump for identical values", () => {
    const r = ridge([5, 5, 5], 0, 10, 11);
    expect(Math.max(...r)).toBeCloseTo(1);
    expect(r[5]).toBeCloseTo(1);
    expect(ridge([], 0, 1, 4)).toEqual([0, 0, 0, 0]);
  });
  it("rate is futures per second, null before any work", () => {
    expect(rate(0, 100)).toBeNull();
    expect(rate(30, 1500)).toBeCloseTo(20);
  });
});

describe("chart helpers", () => {
  it("finalist colors are fixed by rank, never cycled, and never a status token", () => {
    expect(seriesColor(0)).toBe("#3987e5");
    expect(seriesColor(1)).toBe("#d95926");
    expect(seriesColor(2)).toBe("#199e70");
    expect(seriesColor(5)).toBeNull();
    expect(seriesColor(-1)).toBeNull();
    const status = ["#2dd4bf", "#f5a524", "#ff3d71", "#4c8dff", "#a78bfa"];
    for (const c of SERIES_COLORS) expect(status).not.toContain(c.toLowerCase());
  });
  it("share of runs at or below a value (lower is better)", () => {
    expect(shareAtOrBelow([1, 2, 3, 4], 2)).toBe(0.5);
    expect(shareAtOrBelow([1, 2, 3, 4], 0)).toBe(0);
    expect(shareAtOrBelow([], 3)).toBe(0);
  });
  it("nice ticks include zero and use 1-2-5 steps", () => {
    expect(niceTicks(-23, 7, 4)).toEqual([-20, -10, 0]);
    expect(niceTicks(-0.9, 0.9, 4)).toContain(0);
  });
  it("duration ticks never mix seconds and minutes on one axis", () => {
    expect(durationTicks(-40, 10).unit).toBe("s");
    const m = durationTicks(-300, 60);
    expect(m.unit).toBe("min");
    for (const t of m.ticks) expect(Number.isInteger(Math.round(t * 1e6) / 1e6)).toBe(true);
    expect(m.ticks).toContain(0);
  });
});

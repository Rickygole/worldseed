/**
 * Pure helpers for scoring candidate bundles across stress futures (no React, no workers; unit-tested in
 * test/ui). Every figure these return is computed from per-future simulator metrics passed in.
 *
 * Paired comparison: every option, the pre-collapse network and "do nothing" run under the SAME futures
 * (same seed, same draws), so future i of one world is compared with future i of another. That removes
 * the future-to-future spread (tens of minutes) from comparisons whose effects are seconds.
 */
import type { LensMetrics } from "../sim/contract";
import type { EvaluatedRow, GoalMetric } from "../agent/tools";


/** Agent goal metric -> the value in one future's lens metrics. Lower is better for all four. */
export function goalValue(s: LensMetrics, metric: GoalMetric): number {
  // equityGap is signed (group minus everyone): lower is better, negative means the group fares better.
  switch (metric) {
    case "p50":
      return s.p50S;
    case "p90":
      return s.p90S;
    case "isolatedCount":
      return s.isolatedBg.length;
    case "equityGap":
      return s.equityGapS;
  }
}

export interface Dist3 {
  p10: number;
  p50: number;
  p90: number;
}

/** Nearest-rank quantile (first sorted value whose cumulative share is >= q), the simulator's convention. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const k = Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
  return sorted[k];
}

export function dist3(values: readonly number[]): Dist3 {
  const s = Float64Array.from(values).sort();
  return { p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) };
}

export const median = (values: readonly number[]): number => dist3(values).p50;

/** Element-wise a[i] - b[i]. The arrays must be the same futures (same seed, same length). */
export function paired(a: readonly number[], b: readonly number[]): number[] {
  if (a.length !== b.length) throw new Error(`paired comparison needs the same futures (${a.length} vs ${b.length})`);
  return a.map((x, i) => x - b[i]);
}

/**
 * Share of futures in which the option meets the goal "metric <= pre-collapse value in the same future +
 * targetDelta". Paired per future; null when there is nothing to compare.
 */
export function pairedPGoal(option: readonly number[], preCollapse: readonly number[], targetDelta: number): number | null {
  if (option.length === 0 || option.length !== preCollapse.length) return null;
  let ok = 0;
  for (let i = 0; i < option.length; i++) if (option[i] <= preCollapse[i] + targetDelta + 1e-9) ok++;
  return ok / option.length;
}

/** The evaluation row the planner machine receives: medians across futures, paired P(goal), real futures count. */
export function rowFromSamples(opts: {
  bundleId: string;
  candidateIds: string[];
  costTier: "$" | "$$" | "$$$";
  samples: readonly LensMetrics[];
  preCollapse: readonly LensMetrics[];
  metric: GoalMetric;
  targetDelta: number;
}): EvaluatedRow {
  const { samples } = opts;
  const pick = (f: (s: LensMetrics) => number) => median(samples.map(f));
  return {
    bundleId: opts.bundleId,
    candidateIds: opts.candidateIds,
    p50S: pick((s) => s.p50S),
    p90S: pick((s) => s.p90S),
    pctWithin: Math.min(100, Math.max(0, pick((s) => s.pctWithin))),
    isolatedCount: Math.round(pick((s) => s.isolatedBg.length)),
    equityGapS: pick((s) => s.equityGapS),
    pGoal: pairedPGoal(
      samples.map((s) => goalValue(s, opts.metric)),
      opts.preCollapse.map((s) => goalValue(s, opts.metric)),
      opts.targetDelta,
    ),
    costTier: opts.costTier,
    futures: samples.length,
  };
}

/** Median across futures of each metric, for the planner's baseline row (the no-intervention world passed in). */
export function baselineFromSamples(samples: readonly LensMetrics[]) {
  const pick = (f: (s: LensMetrics) => number) => median(samples.map(f));
  return {
    p50S: pick((s) => s.p50S),
    p90S: pick((s) => s.p90S),
    pctWithin: Math.min(100, Math.max(0, pick((s) => s.pctWithin))),
    isolatedCount: Math.round(pick((s) => s.isolatedBg.length)),
    equityGapS: pick((s) => s.equityGapS),
  };
}

export const TIER_RANK: Record<string, number> = { $: 1, $$: 2, $$$: 3 };

export interface Branch {
  id: string;
  /** Median paired change versus doing nothing (lower is better). */
  median: number;
  pGoal: number | null;
  costTier: string;
}

/**
 * Branches another branch dominates: it is at least as good on P(goal), on the median change and on cost,
 * and strictly better on one of them. Dominated options are dimmed and folded in the fan.
 */
export function dominatedIds(branches: readonly Branch[], eps = 1e-6): Set<string> {
  const out = new Set<string>();
  for (const a of branches) {
    for (const b of branches) {
      if (a.id === b.id) continue;
      const pa = a.pGoal ?? 0;
      const pb = b.pGoal ?? 0;
      const ta = TIER_RANK[a.costTier] ?? 9;
      const tb = TIER_RANK[b.costTier] ?? 9;
      const noWorse = pb >= pa - eps && b.median <= a.median + eps && tb <= ta;
      const better = pb > pa + eps || b.median < a.median - eps || tb < ta;
      if (noWorse && better) {
        out.add(a.id);
        break;
      }
    }
  }
  return out;
}

/**
 * A small density for a ridgeline: `bins` evenly spaced points over [lo, hi] with a Gaussian kernel
 * (Silverman bandwidth, floored so identical values still draw a bump). Returns heights normalized to 1.
 */
export function ridge(values: readonly number[], lo: number, hi: number, bins = 32): number[] {
  const n = values.length;
  if (n === 0 || !(hi > lo)) return new Array(bins).fill(0);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const h = Math.max(1.06 * sd * Math.pow(n, -0.2), (hi - lo) / 40);
  const out: number[] = [];
  for (let i = 0; i < bins; i++) {
    const x = lo + ((hi - lo) * i) / (bins - 1);
    let d = 0;
    for (const v of values) d += Math.exp(-0.5 * ((x - v) / h) ** 2);
    out.push(d);
  }
  const max = Math.max(...out);
  return max > 0 ? out.map((d) => d / max) : out;
}

/**
 * Categorical identity for finalists (fan, ridgelines, cards, compare strip), checked against the page ground
 * #070b12. Slot n is always finalist n (by rank): never cycled, never reassigned when the set changes. These are
 * NOT the status tokens (ok / warn / critical / ai / future), which keep their reserved meanings.
 */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"] as const;

/** The fixed color of the finalist at `rank` (0-based), or null past the validated set (draw it neutral). */
export function seriesColor(rank: number): string | null {
  return Number.isInteger(rank) && rank >= 0 && rank < SERIES_COLORS.length ? SERIES_COLORS[rank] : null;
}

/** Share of values at or below `x` (lower is better, so: the share of runs at least this good). 0 when empty. */
export function shareAtOrBelow(values: readonly number[], x: number): number {
  if (values.length === 0) return 0;
  let k = 0;
  for (const v of values) if (v <= x + 1e-9) k++;
  return k / values.length;
}

/**
 * Axis ticks for a signed change in seconds: whole minutes when the span reaches 90 s, seconds otherwise, so one
 * axis never mixes units. Returns the unit and tick values in seconds.
 */
export function durationTicks(lo: number, hi: number, count = 4): { unit: "s" | "min"; ticks: number[] } {
  const span = Math.max(Math.abs(lo), Math.abs(hi));
  const unit = span >= 90 ? "min" : "s";
  const k = unit === "min" ? 60 : 1;
  return { unit, ticks: niceTicks(lo / k, hi / k, count).map((t) => t * k) };
}

/** Round-number ticks inside [lo, hi] (1, 2, 5 steps), always including 0 when it is in range. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.abs(t) < step * 1e-6 ? 0 : Number(t.toPrecision(12)));
  return out;
}

/** Futures completed per second, or null before there is anything to measure. */
export function rate(done: number, ms: number): number | null {
  return done > 0 && ms > 0 ? (1000 * done) / ms : null;
}

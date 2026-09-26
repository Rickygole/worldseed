/**
 * Futures aggregation (contract 2.6). The per-future model lives in ./sample.ts and the loop that runs
 * futures against a compiled world lives in ./engine.ts; this file turns per-future metrics into the
 * per-scenario summary: p10/p50/p90 of the headline metric, P(goal met), worst-case isolated block groups
 * and the per-hex p90 field.
 *
 * Distributions across futures use the nearest-rank quantile (first sorted value whose cumulative share
 * is >= q), the same no-interpolation convention as the population-weighted quantiles.
 */
import { FUTURES_MODEL_LABEL } from "./sample";
import { quantileSortedRank } from "./metrics";
import type {
  Dist,
  FuturesMeta,
  FuturesOptions,
  FuturesPartial,
  FuturesResult,
  Goal,
  GoalMetric,
  LensId,
  LensMetrics,
} from "./contract";

export const DEFAULT_HEADLINE: Record<LensId, GoalMetric> = { ems: "p90S", access: "addedP90S", xharbor: "popLossGt10pct", freight: "p90S" };

const LENS_METRICS: Record<LensId, GoalMetric[]> = {
  ems: ["p50S", "p90S", "pctWithin", "equityGapS", "isolatedCount"],
  access: ["p50S", "p90S", "pctWithin", "equityGapS", "addedP50S", "addedP90S", "isolatedCount"],
  freight: ["p50S", "p90S", "pctWithin", "equityGapS", "isolatedCount"],
  xharbor: [
    "p50S", "p90S", "pctWithin", "equityGapS", "addedP50S", "addedP90S", "isolatedCount",
    "popLossGt10pct", "popLossGt25pct", "lowWageLossGt10pct", "popMeanLossPct", "popMeanAddedS",
  ],
};

export function metricAvailable(lens: LensId, metric: GoalMetric): boolean {
  return LENS_METRICS[lens].includes(metric);
}

export function metricValue(s: LensMetrics, m: GoalMetric): number {
  switch (m) {
    case "isolatedCount":
      return s.isolatedBg.length;
    case "p50S":
      return s.p50S;
    case "p90S":
      return s.p90S;
    case "pctWithin":
      return s.pctWithin;
    case "equityGapS":
      return s.equityGapS;
    case "popLossGt10pct":
    case "popLossGt25pct":
    case "lowWageLossGt10pct":
    case "popMeanLossPct":
    case "popMeanAddedS": {
      if (!s.xharbor) throw new Error(`metric ${m} is not available for the ${s.lens} lens`);
      return s.xharbor[m];
    }
    case "addedP50S":
      if (s.addedP50S === undefined) throw new Error(`metric ${m} is not available for the ${s.lens} lens`);
      return s.addedP50S;
    case "addedP90S":
      if (s.addedP90S === undefined) throw new Error(`metric ${m} is not available for the ${s.lens} lens`);
      return s.addedP90S;
  }
}

export function meetsGoal(value: number, goal: Goal): boolean {
  if (Number.isNaN(value)) return false;
  return goal.op === "<=" ? value <= goal.target : value >= goal.target;
}

export function distOf(values: ArrayLike<number>): Dist {
  const a = Float64Array.from(values as ArrayLike<number>).sort(); // NaN last
  return { p10: quantileSortedRank(a, 0.1), p50: quantileSortedRank(a, 0.5), p90: quantileSortedRank(a, 0.9) };
}

export function validateFuturesOptions(lens: LensId, o: FuturesOptions): void {
  if (!Number.isInteger(o.n) || o.n < 1) throw new RangeError(`n must be a positive integer, got ${o.n}`);
  if (!Number.isFinite(o.seed)) throw new RangeError("seed must be a finite number");
  if (!(o.closureProb >= 0 && o.closureProb <= 1)) throw new RangeError(`closureProb must be in [0, 1], got ${o.closureProb}`);
  if (!["am", "mid", "pm", "night"].includes(o.tod)) throw new RangeError(`unknown time of day "${o.tod}"`);
  const headline = o.headline ?? DEFAULT_HEADLINE[lens];
  if (!metricAvailable(lens, headline)) throw new RangeError(`headline metric ${headline} is not available for the ${lens} lens`);
  if (o.goal && !metricAvailable(lens, o.goal.metric)) throw new RangeError(`goal metric ${o.goal.metric} is not available for the ${lens} lens`);
  if (o.xharborAnchors !== undefined && (!Number.isInteger(o.xharborAnchors) || o.xharborAnchors < 1)) throw new RangeError("xharborAnchors must be a positive integer");
  if (o.incidents !== undefined && (!Number.isInteger(o.incidents) || o.incidents < 1)) throw new RangeError("incidents must be a positive integer");
}

/** Split [0, n) into `parts` contiguous ranges (some may be empty when parts > n). */
export function splitRange(n: number, parts: number): [number, number][] {
  const out: [number, number][] = [];
  const base = Math.floor(n / parts);
  const extra = n % parts;
  let s = 0;
  for (let i = 0; i < parts; i++) {
    const len = base + (i < extra ? 1 : 0);
    if (len > 0) out.push([s, s + len]);
    s += len;
  }
  return out;
}

export function aggregateFutures(
  lens: LensId,
  partials: FuturesPartial[],
  hexCount: number,
  opts: FuturesOptions,
  meta: Omit<FuturesMeta, "lens" | "n" | "seed" | "tod" | "closureProb" | "model">,
): FuturesResult {
  const parts = [...partials].sort((a, b) => a.start - b.start);
  let expect = 0;
  for (const p of parts) {
    if (p.start !== expect) throw new Error(`futures ranges are not contiguous: expected start ${expect}, got ${p.start}`);
    expect = p.end;
  }
  if (expect !== opts.n) throw new Error(`futures ranges cover ${expect} futures, expected ${opts.n}`);

  const samples: LensMetrics[] = parts.flatMap((p) => p.samples);
  const n = samples.length;
  const headlineMetric = opts.headline ?? DEFAULT_HEADLINE[lens];

  const isolatedFreq = new Map<number, number>();
  let worstCount = 0;
  for (const s of samples) {
    worstCount = Math.max(worstCount, s.isolatedBg.length);
    for (const b of s.isolatedBg) isolatedFreq.set(b, (isolatedFreq.get(b) ?? 0) + 1);
  }
  const worstIsolated = [...isolatedFreq.entries()]
    .map(([bg, c]) => ({ bg, freq: c / n }))
    .sort((a, b) => b.freq - a.freq || a.bg - b.bg);

  // per-hex p90 over futures
  const hexP90 = new Float32Array(hexCount);
  const hexAddedP90 = parts.every((p) => p.hexAdded) && (lens === "access" || lens === "xharbor" || lens === "freight") ? new Float32Array(hexCount) : undefined;
  const col = new Float32Array(n);
  const rank = Math.min(n - 1, Math.max(0, Math.ceil(0.9 * n) - 1));
  const rows = (pick: (p: FuturesPartial) => Float32Array | undefined, target: Float32Array) => {
    for (let h = 0; h < hexCount; h++) {
      let i = 0;
      for (const p of parts) {
        const m = pick(p) as Float32Array;
        const count = p.end - p.start;
        for (let r = 0; r < count; r++) col[i++] = m[r * hexCount + h];
      }
      col.sort();
      target[h] = col[rank];
    }
  };
  rows((p) => p.hexField, hexP90);
  if (hexAddedP90) rows((p) => p.hexAdded, hexAddedP90);

  const result: FuturesResult = {
    lens,
    samples,
    p50: distOf(samples.map((s) => s.p50S)),
    p90: distOf(samples.map((s) => s.p90S)),
    pctWithin: distOf(samples.map((s) => s.pctWithin)),
    isolatedCount: distOf(samples.map((s) => s.isolatedBg.length)),
    equityGapS: distOf(samples.map((s) => s.equityGapS)),
    headlineMetric,
    headline: distOf(samples.map((s) => metricValue(s, headlineMetric))),
    worstIsolated,
    worstIsolatedCount: worstCount,
    hexP90,
    meta: {
      lens,
      variant: parts[0].variant,
      n: opts.n,
      seed: opts.seed,
      tod: opts.tod,
      closureProb: opts.closureProb,
      model: FUTURES_MODEL_LABEL,
      ...meta,
    },
  };
  if (hexAddedP90) result.hexAddedP90 = hexAddedP90;
  if (opts.goal) {
    result.goal = opts.goal;
    let ok = 0;
    for (const s of samples) if (meetsGoal(metricValue(s, opts.goal.metric), opts.goal)) ok++;
    result.pGoal = ok / n;
  }
  return result;
}

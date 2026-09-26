/**
 * Exhaustive-search check: does the AI's pick hold up against trying everything?
 *
 * Enumerates every bundle of one to three eligible catalog candidates (respecting the mission's
 * lens, cost tier and type constraints), scores them all with an injected DETERMINISTIC evaluator
 * (the simulator's deterministic run, no futures), and reports the true optimum on the mission's
 * goal metric, the rank of any bundle you ask about, and how many evaluations it took. It is
 * cancellable through an AbortSignal and never calls a model.
 *
 * Ranking is by the goal metric alone, lower first (every goal metric is lower-is-better); ties
 * break by cost tier, then by the candidate list. Ties share the better rank: a bundle's rank is
 * one more than the number of bundles strictly better than it. pGoal is not used: a deterministic
 * run has no futures.
 */
import { COST_TIER_RANK, eligibleCandidates, type Catalog, type CostTier } from "./catalog";
import type { BaselineRow, BundleSpec, ConfirmedMission, GoalMetric } from "./tools";
import { bundleKey, constraintsOf } from "./validator";

/** What the deterministic evaluator returns per bundle (the fields of an EvaluationRow the check needs). */
export interface DeterministicRow {
  bundleId: string;
  candidateIds: string[];
  p50S: number;
  p90S: number;
  isolatedCount: number;
  equityGapS: number;
}

export type DeterministicEvaluateFn = (
  bundles: BundleSpec[],
  ctx: { mission: ConfirmedMission; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
) => Promise<{ rows: readonly DeterministicRow[]; baseline?: BaselineRow }>;

export interface ExhaustiveEntry {
  candidateIds: string[];
  costTier: CostTier;
  /** The goal metric's value (seconds, or groups for isolatedCount). */
  value: number;
  /** 1 = best; ties share a rank. */
  rank: number;
}

export interface ExhaustiveResult {
  /** Every scored bundle, best first. */
  ranked: ExhaustiveEntry[];
  /** The true optimum on the goal metric (first of `ranked`), or null when nothing was scored. */
  optimum: ExhaustiveEntry | null;
  /** How many bundles the evaluator actually scored. */
  evaluations: number;
  /** How many bundles were enumerated (equals `evaluations` unless the evaluator skipped some). */
  enumerated: number;
}

/** Number of bundles of 1..3 candidates out of `n`: n + C(n,2) + C(n,3). For showing the cost before a run. */
export function countBundles(n: number): number {
  if (n <= 0) return 0;
  return n + (n * (n - 1)) / 2 + (n * (n - 1) * (n - 2)) / 6;
}

/** All bundles of 1..3 eligible candidates, in a fixed order (size, then candidate id order). */
export function enumerateBundles(catalog: Catalog, mission: ConfirmedMission): BundleSpec[] {
  const ids = eligibleCandidates(catalog, constraintsOf(mission)).map((c) => c.id).sort();
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i++) out.push([ids[i]]);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) for (let k = j + 1; k < ids.length; k++) out.push([ids[i], ids[j], ids[k]]);
  return out.map((candidateIds, n) => ({ id: `E${n + 1}`, candidateIds }));
}

function metricOf(metric: GoalMetric, r: DeterministicRow): number {
  switch (metric) {
    case "p50":
      return r.p50S;
    case "p90":
      return r.p90S;
    case "isolatedCount":
      return r.isolatedCount;
    case "equityGap":
      return r.equityGapS;
  }
}

const abortError = (): Error => new DOMException("The exhaustive check was cancelled.", "AbortError");

export async function exhaustiveSearch(opts: {
  catalog: Catalog;
  mission: ConfirmedMission;
  evaluate: DeterministicEvaluateFn;
  signal?: AbortSignal;
  /** Bundles per evaluator call (default 24). The signal is checked between calls. */
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<ExhaustiveResult> {
  const all = enumerateBundles(opts.catalog, opts.mission);
  const size = Math.max(1, opts.batchSize ?? 24);
  const scored: { candidateIds: string[]; costTier: CostTier; value: number }[] = [];
  let done = 0;
  for (let i = 0; i < all.length; i += size) {
    if (opts.signal?.aborted) throw abortError();
    const batch = all.slice(i, i + size);
    const want = new Map(batch.map((b) => [b.id, b]));
    const res = await opts.evaluate(batch, { mission: opts.mission, signal: opts.signal });
    if (opts.signal?.aborted) throw abortError();
    const seen = new Set<string>();
    for (const r of res.rows) {
      const b = want.get(r.bundleId);
      const v = metricOf(opts.mission.goal.metric, r);
      // Same acceptance rules as the machine: a row must be for a bundle we asked about, once, with the same candidates and a usable number.
      if (!b || seen.has(r.bundleId) || bundleKey(b.candidateIds) !== bundleKey(r.candidateIds) || !Number.isFinite(v) || v < 0) continue;
      seen.add(r.bundleId);
      scored.push({ candidateIds: b.candidateIds, costTier: tierOf(opts.catalog, b.candidateIds), value: v });
    }
    done += batch.length;
    opts.onProgress?.(done, all.length);
  }
  scored.sort((a, b) => a.value - b.value || COST_TIER_RANK[a.costTier] - COST_TIER_RANK[b.costTier] || a.candidateIds.join("+").localeCompare(b.candidateIds.join("+")));
  // Ties share the better rank: one more than the number of bundles strictly better.
  const ranked: ExhaustiveEntry[] = [];
  scored.forEach((s, i) => ranked.push({ ...s, rank: i > 0 && scored[i - 1].value === s.value ? ranked[i - 1].rank : i + 1 }));
  return { ranked, optimum: ranked[0] ?? null, evaluations: scored.length, enumerated: all.length };
}

function tierOf(catalog: Catalog, ids: readonly string[]): CostTier {
  let best: CostTier = "$";
  for (const id of ids) {
    const c = catalog.byId.get(id);
    if (c && COST_TIER_RANK[c.costTier] > COST_TIER_RANK[best]) best = c.costTier;
  }
  return best;
}

/** Rank of a bundle (any candidate order) in the result, or null when it was not scored. */
export function rankOf(result: ExhaustiveResult, candidateIds: readonly string[]): { rank: number; of: number } | null {
  const key = bundleKey(candidateIds);
  const hit = result.ranked.find((e) => bundleKey(e.candidateIds) === key);
  return hit ? { rank: hit.rank, of: result.evaluations } : null;
}

/**
 * The UI's summary line: "Exhaustive check: the AI's top pick is rank 3 of 341 bundles evaluated."
 * Both numbers come from the run; nothing is written by a model.
 */
export function exhaustiveSummaryLine(r: { rank: number; of: number }): string {
  return r.rank === 1
    ? `Exhaustive check: the AI's top pick is rank ${r.rank} of ${r.of} bundles evaluated (it matches the best bundle on the goal metric).`
    : `Exhaustive check: the AI's top pick is rank ${r.rank} of ${r.of} bundles evaluated.`;
}

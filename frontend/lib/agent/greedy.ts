/**
 * Deterministic fallback search (labeled non-AI in the UI).
 *
 * Used when the planner is unavailable, its output was rejected twice, or the budget is spent.
 * Everything here is a pure function of the catalog, the mission and the evaluator's results, so
 * the same inputs always produce the same bundles and the same finalists.
 *
 *   round 1: up to 6 single candidates, taken round-robin across intervention types, cheapest first
 *   round 2: the best bundle so far extended by up to 3 further candidates
 *   round 3: the best bundle that still has room extended by up to 3 further candidates
 * That is at most 12 evaluated bundles, matching the per-mission cap.
 */
import {
  COST_TIER_RANK,
  eligibleCandidates,
  type Candidate,
  type Catalog,
} from "./catalog";
import type { EvaluateFn } from "./evaluate";
import type { BundleSpec, ConfirmedMission, EvaluationRow, GoalMetric } from "./tools";
import { MAX_BUNDLE_SIZE, MAX_EVALUATED_BUNDLES, MAX_ROUNDS, mintBundleIds } from "./tools";
import { bundleKey, constraintsOf } from "./validator";

export interface GreedyFinalist {
  bundleId: string;
  candidateIds: string[];
  /** Application-authored label without any numbers: how this finalist was chosen. */
  note: string;
}

/** Candidates in the deterministic exploration order: round-robin over types, cheapest first. */
export function orderedCandidates(catalog: Catalog, mission: ConfirmedMission): Candidate[] {
  const pool = eligibleCandidates(catalog, constraintsOf(mission));
  const byType = new Map<string, Candidate[]>();
  for (const c of pool) byType.set(c.type, [...(byType.get(c.type) ?? []), c]);
  const lanes = [...byType.keys()].sort().map((t) =>
    (byType.get(t) as Candidate[]).sort(
      (a, b) => COST_TIER_RANK[a.costTier] - COST_TIER_RANK[b.costTier] || a.id.localeCompare(b.id),
    ),
  );
  const out: Candidate[] = [];
  for (let i = 0; lanes.some((l) => i < l.length); i++) {
    for (const l of lanes) if (i < l.length) out.push(l[i]);
  }
  return out;
}

function goalValue(metric: GoalMetric, row: EvaluationRow): number {
  switch (metric) {
    case "p50":
      return row.p50S;
    case "p90":
      return row.p90S;
    case "isolatedCount":
      return row.isolatedCount;
    case "equityGap":
      return row.equityGapS;
  }
}

/** Best first: higher pGoal, then a lower goal metric, then a cheaper tier, then id. */
export function rankRows(rows: readonly EvaluationRow[], mission: ConfirmedMission): EvaluationRow[] {
  return [...rows].sort(
    (a, b) =>
      (b.pGoal ?? -1) - (a.pGoal ?? -1) ||
      goalValue(mission.goal.metric, a) - goalValue(mission.goal.metric, b) ||
      COST_TIER_RANK[a.costTier] - COST_TIER_RANK[b.costTier] ||
      a.bundleId.localeCompare(b.bundleId),
  );
}

export interface GreedyRoundInput {
  catalog: Catalog;
  mission: ConfirmedMission;
  round: number;
  /** Rows evaluated in earlier rounds. */
  rows: readonly EvaluationRow[];
  /** Every bundle already proposed (evaluated or not). */
  known: readonly BundleSpec[];
}

/** Bundles to evaluate in `round`. Empty when there is nothing new to try. */
export function greedyPlanRound(input: GreedyRoundInput): BundleSpec[] {
  const { catalog, mission, round, rows, known } = input;
  if (round > MAX_ROUNDS) return [];
  const order = orderedCandidates(catalog, mission);
  const room = MAX_EVALUATED_BUNDLES - known.length;
  const seen = new Set(known.map((b) => bundleKey(b.candidateIds)));
  // Bundle IDs are application-minted (B1..B12, first unused), the same scheme the AI path uses.
  const free = mintBundleIds(known.map((b) => b.id), Math.max(room, 0));
  let next = 0;
  const mint = (candidateIds: string[]): BundleSpec => ({ id: free[next++] ?? "B12", candidateIds });

  if (round <= 1) {
    const fresh = order.filter((c) => !seen.has(bundleKey([c.id])));
    return fresh.slice(0, Math.min(6, Math.max(room, 0))).map((c) => mint([c.id]));
  }

  const ranked = rankRows(rows.filter((r) => r.candidateIds.length < MAX_BUNDLE_SIZE), mission);
  const base = ranked[0];
  if (!base) return [];
  const out: BundleSpec[] = [];
  for (const c of order) {
    if (out.length >= Math.min(3, room)) break;
    if (base.candidateIds.includes(c.id)) continue;
    const ids = [...base.candidateIds, c.id];
    const key = bundleKey(ids);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mint(ids));
  }
  return out;
}

/** Top three by rank, skipping excluded bundles (dropped or vetoed). Fewer if fewer exist. */
export function greedyFinalists(
  rows: readonly EvaluationRow[],
  mission: ConfirmedMission,
  excluded: ReadonlySet<string> = new Set(),
): GreedyFinalist[] {
  let pool = rows.filter((r) => !excluded.has(r.bundleId));
  if (pool.length < 3) pool = [...rows];
  return rankRows(pool, mission)
    .slice(0, 3)
    .map((r) => ({
      bundleId: r.bundleId,
      candidateIds: r.candidateIds,
      note: "Ranked by deterministic search (not AI) on the goal metric.",
    }));
}

/* ------------------------ standalone convenience ------------------------ */

export interface GreedyResult {
  finalists: GreedyFinalist[];
  rows: EvaluationRow[];
  rounds: number;
  bundlesEvaluated: number;
  futuresEvaluated: number;
}

/** Runs the whole deterministic search with the injected evaluator ("Deterministic search" button). */
export async function greedySearch(opts: {
  catalog: Catalog;
  mission: ConfirmedMission;
  evaluate: EvaluateFn;
  signal?: AbortSignal;
}): Promise<GreedyResult> {
  const rows: EvaluationRow[] = [];
  const known: BundleSpec[] = [];
  let bundlesEvaluated = 0;
  let futuresEvaluated = 0;
  let rounds = 0;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (opts.signal?.aborted) throw new Error("aborted");
    const bundles = greedyPlanRound({ catalog: opts.catalog, mission: opts.mission, round, rows, known });
    if (bundles.length === 0) break;
    known.push(...bundles);
    const res = await opts.evaluate(bundles, { mission: opts.mission, round, signal: opts.signal });
    // Counted from the rows themselves, never from an aggregate the evaluator claims.
    for (const { futures, ...r } of res.rows) {
      rows.push(r);
      bundlesEvaluated += 1;
      futuresEvaluated += futures;
    }
    rounds = round;
  }
  return { finalists: greedyFinalists(rows, opts.mission), rows, rounds, bundlesEvaluated, futuresEvaluated };
}

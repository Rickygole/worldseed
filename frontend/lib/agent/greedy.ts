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
import { pickDeterministicStress, type DeterministicStressResult } from "./critic";
import { exhaustiveSearch, type DeterministicEvaluateFn, type ExhaustiveEntry, type ExhaustiveResult } from "./exhaustive";
import type { EvaluateFn } from "./evaluate";
import type { BundleSpec, ConfirmedMission, EvaluationRow, GoalMetric } from "./tools";
import { displayedGoal, displayedPGoal } from "./slots";
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

/**
 * Best first. Values are compared as DISPLAYED (pGoal in whole percent, times in tenths of a
 * minute, counts whole), so what the reader sees is what ties. Ties prefer the SMALLER bundle
 * (fewer options), then the lower cost tier, then the candidate ids in a fixed order, then the
 * bundle id. So an option that adds nothing visible never outranks the bundle without it.
 */
export function rankRows(rows: readonly EvaluationRow[], mission: ConfirmedMission): EvaluationRow[] {
  const metric = mission.goal.metric;
  return [...rows].sort(
    (a, b) =>
      displayedPGoal(b.pGoal) - displayedPGoal(a.pGoal) ||
      displayedGoal(metric, goalValue(metric, a)) - displayedGoal(metric, goalValue(metric, b)) ||
      a.candidateIds.length - b.candidateIds.length ||
      COST_TIER_RANK[a.costTier] - COST_TIER_RANK[b.costTier] ||
      [...a.candidateIds].sort().join("+").localeCompare([...b.candidateIds].sort().join("+")) ||
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

/* ------------------------- two-stage (screened) search ------------------------- */

/** Default size of the shortlist that gets the full futures run (also the per-mission cap on evaluated bundles). */
export const DEFAULT_SHORTLIST = MAX_EVALUATED_BUNDLES;

/** Two bundles that share two or more members are near-duplicates (two of three members in common). */
export function nearDuplicate(a: readonly string[], b: readonly string[]): boolean {
  return a.filter((x) => b.includes(x)).length >= 2;
}

/**
 * The shortlist for the futures run, from ALL screened bundles best first: the top two thirds of
 * the slots by rank alone (the true leaders always make it), then the remaining slots go to the
 * best bundles that are not near-duplicates of any bundle already chosen, then, if slots are still
 * free, to the best of the rest. So the shortlist is mostly the leaders and always has variety.
 */
export function selectShortlist(ranked: readonly ExhaustiveEntry[], k: number = DEFAULT_SHORTLIST): ExhaustiveEntry[] {
  const size = Math.max(1, Math.min(k, ranked.length));
  const chosen: ExhaustiveEntry[] = ranked.slice(0, Math.ceil((size * 2) / 3));
  const taken = new Set(chosen);
  for (const e of ranked) {
    if (chosen.length >= size) break;
    if (!taken.has(e) && !chosen.some((c) => nearDuplicate(c.candidateIds, e.candidateIds))) {
      chosen.push(e);
      taken.add(e);
    }
  }
  for (const e of ranked) {
    if (chosen.length >= size) break;
    if (!taken.has(e)) {
      chosen.push(e);
      taken.add(e);
    }
  }
  return chosen;
}

/** Best first, skipping near-duplicates of a bundle already picked; if fewer than `n` remain, the best of the skipped fill the gap. */
export function pickDiverse<T extends { candidateIds: readonly string[] }>(rankedRows: readonly T[], n = 3): T[] {
  const out: T[] = [];
  for (const r of rankedRows) {
    if (out.length >= n) break;
    if (!out.some((c) => nearDuplicate(c.candidateIds, r.candidateIds))) out.push(r);
  }
  for (const r of rankedRows) {
    if (out.length >= n) break;
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

/** Bundles for the futures run from a screening result, with application-minted ids. */
export function shortlistBundles(screened: Pick<ExhaustiveResult, "ranked">, k: number = DEFAULT_SHORTLIST): BundleSpec[] {
  const list = selectShortlist(screened.ranked, k);
  const ids = mintBundleIds([], list.length);
  return list.map((e, i) => ({ id: ids[i], candidateIds: e.candidateIds }));
}

/** Top three by rank, skipping excluded bundles (dropped or vetoed). Fewer if fewer exist. With `diverse`, no two share two members unless nothing else is left. */
export function greedyFinalists(
  rows: readonly EvaluationRow[],
  mission: ConfirmedMission,
  excluded: ReadonlySet<string> = new Set(),
  opts: { diverse?: boolean } = {},
): GreedyFinalist[] {
  let pool = rows.filter((r) => !excluded.has(r.bundleId));
  if (pool.length < 3) pool = [...rows];
  const ranked = rankRows(pool, mission);
  return (opts.diverse ? pickDiverse(ranked, 3) : ranked.slice(0, 3))
    .map((r) => ({
      bundleId: r.bundleId,
      candidateIds: r.candidateIds,
      note: "Ranked by deterministic search (not AI) on the goal metric.",
    }));
}

/* ------------------------ standalone convenience ------------------------ */

export interface GreedyResult {
  /** Stage-1 result when a screening evaluator was given and scored at least three bundles. */
  screened?: ExhaustiveResult;
  /** Stress tests the deterministic critic ran (after rounds 1 and 2), labeled non-AI in the UI. */
  stresses: DeterministicStressResult[];
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
  /** Run the deterministic stress step after rounds 1 and 2 (default true). */
  stress?: boolean;
  /**
   * A deterministic one-run-per-bundle evaluator (no futures). When given, stage 1 scores EVERY
   * eligible bundle with it and stage 2 runs the futures evaluation only on the shortlist.
   * Without it the round-by-round search below runs unchanged.
   */
  screen?: DeterministicEvaluateFn;
  /** Shortlist size for stage 2 (default 12, the per-mission cap on evaluated bundles). */
  shortlist?: number;
  onScreenProgress?: (done: number, total: number) => void;
}): Promise<GreedyResult> {
  const rows: EvaluationRow[] = [];
  const known: BundleSpec[] = [];
  let bundlesEvaluated = 0;
  let futuresEvaluated = 0;
  let rounds = 0;
  const stresses: DeterministicStressResult[] = [];
  let screened: ExhaustiveResult | undefined;
  if (opts.screen) {
    screened = await exhaustiveSearch({ catalog: opts.catalog, mission: opts.mission, evaluate: opts.screen, signal: opts.signal, onProgress: opts.onScreenProgress });
  }
  if (screened && screened.ranked.length >= 3) {
    const bundles = shortlistBundles(screened, opts.shortlist);
    known.push(...bundles);
    const res = await opts.evaluate(bundles, { mission: opts.mission, round: 1, signal: opts.signal });
    const want = new Map(bundles.map((b) => [b.id, b]));
    for (const { futures, ...r } of res.rows) {
      const b = want.get(r.bundleId);
      if (!b || rows.some((x) => x.bundleId === r.bundleId) || b.candidateIds.join("|") !== r.candidateIds.join("|")) continue;
      rows.push(r);
      bundlesEvaluated += 1;
      futuresEvaluated += futures;
    }
    rounds = 1;
    for (let attack = 0; attack < 2 && opts.stress !== false && rows.length > 0; attack++) {
      const leaders = rankRows(rows, opts.mission).slice(0, 4).map((r) => ({ id: r.bundleId, candidateIds: r.candidateIds }));
      const pick = await pickDeterministicStress({ evaluate: opts.evaluate, mission: opts.mission, round: 1, leaders, normal: rows, tried: stresses.map((x) => x.spec), signal: opts.signal });
      if (!pick) break;
      stresses.push(pick);
      for (const r of pick.rows) futuresEvaluated += r.futures;
    }
    return { stresses, screened, finalists: greedyFinalists(rows, opts.mission, new Set(), { diverse: true }), rows, rounds, bundlesEvaluated, futuresEvaluated };
  }
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
    if (opts.stress !== false && round < MAX_ROUNDS && rows.length > 0) {
      const leaders = rankRows(rows, opts.mission).slice(0, 4).map((r) => ({ id: r.bundleId, candidateIds: r.candidateIds }));
      const pick = await pickDeterministicStress({ evaluate: opts.evaluate, mission: opts.mission, round, leaders, normal: rows, tried: stresses.map((x) => x.spec), signal: opts.signal });
      if (pick) {
        stresses.push(pick);
        for (const r of pick.rows) futuresEvaluated += r.futures;
      }
    }
  }
  return { stresses, finalists: greedyFinalists(rows, opts.mission), rows, rounds, bundlesEvaluated, futuresEvaluated };
}

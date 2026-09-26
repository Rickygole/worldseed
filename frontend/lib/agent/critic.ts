/**
 * The deterministic critic (no AI): picks the stress test that hurts the current leaders most,
 * from the evaluator's OWN results. It is what runs the stress step when the mission is in
 * deterministic mode (the "Deterministic search" button, or after the AI planner was unavailable
 * or its output rejected), and what stands in when the AI critic's answer is rejected.
 *
 * Method: re-score the leading bundles under each single-link closure that has not been tried yet,
 * and choose the closure that raises the leaders' goal metric the most in total. Ties go to the
 * earlier link in STRESS_LINKS. The chosen stress's rows are returned so nothing is evaluated twice.
 */
import type { EvaluateFn } from "./evaluate";
import { benefitLoss } from "./slots";
import { linkStresses, stressContext, stressKey, type StressSpec } from "./stress";
import { EvaluatedRowSchema, type BaselineRow, type BundleSpec, type ConfirmedMission, type EvaluatedRow, type EvaluationRow } from "./tools";

export interface DeterministicStressResult {
  spec: StressSpec;
  rows: EvaluatedRow[];
  baseline?: BaselineRow;
  /** How many single-link stresses were scored to make the choice. */
  scanned: number;
  /** Total increase of the leaders' goal metric under the chosen stress (seconds, or groups for isolatedCount). */
  harm: number;
}

export async function pickDeterministicStress(opts: {
  evaluate: EvaluateFn;
  mission: ConfirmedMission;
  round: number;
  leaders: readonly BundleSpec[];
  /** The leaders' normal (unstressed) rows. */
  normal: readonly EvaluationRow[];
  /** Stresses already run; they are skipped. */
  tried?: readonly StressSpec[];
  signal?: AbortSignal;
}): Promise<DeterministicStressResult | null> {
  const tried = new Set((opts.tried ?? []).map(stressKey));
  const candidates = linkStresses().filter((s) => !tried.has(stressKey(s)));
  const normalById = new Map(opts.normal.map((r) => [r.bundleId, r]));
  let best: DeterministicStressResult | null = null;
  let scanned = 0;
  for (const spec of candidates) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const batch = await opts.evaluate([...opts.leaders], { mission: opts.mission, round: opts.round, signal: opts.signal, stress: stressContext(spec) });
    const rows = batch.rows.filter((r) => EvaluatedRowSchema.safeParse(r).success && normalById.has(r.bundleId));
    if (rows.length === 0) continue;
    scanned++;
    let harm = 0;
    for (const r of rows) harm += benefitLoss(opts.mission.goal.metric, normalById.get(r.bundleId) as EvaluationRow, r);
    if (best === null || harm > best.harm) best = { spec, rows, baseline: batch.baseline, scanned: 0, harm };
  }
  return best ? { ...best, scanned } : null;
}

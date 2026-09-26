/**
 * The evaluator contract. The machine is handed an `evaluate` function (in the app, the simulator
 * worker pool; in tests, a fake).
 *
 * For the simulator and UI owners: every returned row carries its own `futures` count, the number
 * of simulated futures actually run for that bundle. The decision log's "futures" figure is the SUM
 * of `futures` over the rows the machine accepts (after dropping unknown, duplicate, mismatched or
 * malformed rows). An aggregate claimed for the batch is not part of the contract and is ignored.
 */
import type { StressContext } from "./stress";
import type { BaselineRow, BundleSpec, ConfirmedMission, EvaluatedRow } from "./tools";

export interface EvaluationBatch {
  /** One row per bundle that was actually scored, each with its own futures count. */
  rows: EvaluatedRow[];
  baseline?: BaselineRow;
}

export interface EvaluateContext {
  mission: ConfirmedMission;
  round: number;
  /**
   * When present, score the bundles UNDER this stress: close `closedLinks` (simulator link ids) and,
   * if `tod` is set, evaluate at that time of day ("am" | "midday" | "pm" | "night"; the simulator's
   * name for midday is "mid"). Rows may echo `label` in `stressLabel`. The returned `baseline` must be
   * the no-intervention baseline under the SAME stress, so benefits can be compared like for like.
   * An evaluator that ignores this field returns normal results; the machine cannot detect that.
   */
  stress?: StressContext;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export type EvaluateFn = (bundles: BundleSpec[], ctx: EvaluateContext) => Promise<EvaluationBatch>;

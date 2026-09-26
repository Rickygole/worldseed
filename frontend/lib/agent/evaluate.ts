/**
 * The evaluator contract. The machine is handed an `evaluate` function (in the app, the simulator
 * worker pool; in tests, a fake). The counts it reports are what the decision log shows.
 */
import type { BaselineRow, BundleSpec, ConfirmedMission, EvaluationRow } from "./tools";

export interface EvaluationBatch {
  /** One row per bundle that was actually scored. */
  rows: EvaluationRow[];
  baseline?: BaselineRow;
  /** Bundles the evaluator really scored. */
  bundlesEvaluated: number;
  /** Simulated futures the evaluator really ran for this batch. */
  futuresEvaluated: number;
}

export interface EvaluateContext {
  mission: ConfirmedMission;
  round: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export type EvaluateFn = (bundles: BundleSpec[], ctx: EvaluateContext) => Promise<EvaluationBatch>;

import type { BlockGroup, CompiledWorld, LensId, LensMetrics, LensVariant, ModelParams, Snapshot } from "../contract";
import type { DijkstraWorkspace } from "../dijkstra";
import type { MetricsWorkspace } from "../metrics";
import type { EdgeScratch, FutureSample, ResolvedFutures } from "../sample";

/** Everything a lens needs. One per engine; owns all scratch memory so a run allocates almost nothing. */
export interface LensContext {
  snap: Snapshot;
  params: ModelParams;
  futures: ResolvedFutures;
  dj: DijkstraWorkspace;
  mw: MetricsWorkspace;
  scratch: EdgeScratch;
}

export interface LensAux {
  /** xharbor: jobs within 30 min per hex for the world, and for the baseline/reference (null = none). */
  jobs: Float32Array;
  baselineJobs: Float32Array | null;
  /** Deterministic runs only: block-group table, to name the worst-hit block groups. */
  blockGroups?: BlockGroup[];
}

export interface Lens {
  id: LensId;
  label: string;
  unitLabel: string;
  variant: LensVariant;
  /**
   * Length of the `field` array this lens fills, or null for one value per hex. Freight fills one value per trip
   * (there is no terrain for it).
   */
  size: number | null;
  /**
   * Optional per-value "added" rule when it is not simply field - baseline (freight: unreachable trips count as a
   * fixed detour). Fills `out` (same length as the field).
   */
  addedInto?(field: Float32Array, baseline: Float32Array, out: Float32Array): void;
  /** true when `field` also fills the secondary per-hex array (`aux`), as xharbor does with jobs within 30 min. */
  hasAux: boolean;
  /** Per-hex seconds for (world, future). `sample` null = free-flow, no noise. */
  field(cw: CompiledWorld, sample: FutureSample | null, out: Float32Array, aux?: Float32Array): void;
  /**
   * Metrics for a field. Access needs the baseline (or reference) field to measure added time;
   * EMS uses the sample's incident counts when given.
   */
  metrics(field: Float32Array, baseline?: Float32Array | null, sample?: FutureSample | null, aux?: LensAux | null): LensMetrics;
}

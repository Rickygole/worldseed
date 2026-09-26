/**
 * Simulator contract.
 *
 * The UI only talks to `Simulator`. Today the implementation is a MOCK
 * (lib/sim/mock.ts). Later a snapshot-backed / server runner implements the
 * same interface and is swapped in at lib/sim/index.ts. Nothing else changes.
 */

import type { LensId, LensMetrics, MutationRecord, RunMeta, WorstBlockGroup, XharborMetrics } from "./contract";

export type CoverageStatus = "ok" | "degraded" | "isolated";

/** Response-time thresholds (minutes). */
export const OK_MAX_MIN = 8;
export const ISOLATED_MIN = 15;

export function statusOf(minutes: number): CoverageStatus {
  if (minutes <= OK_MAX_MIN) return "ok";
  if (minutes < ISOLATED_MIN) return "degraded";
  return "isolated";
}

export type LinkId = "key_bridge";

export interface Cell {
  /** H3 index (resolution 9). */
  id: string;
  lat: number;
  lng: number;
  /** Distance to the bridge in km; drives the animation stagger. */
  bridgeKm: number;
  /** 0..1 opacity factor so the plain fades out at the region edge. */
  edgeFade: number;
}

export interface Assumption {
  label: string;
  value: string;
  note?: string;
  /** True while the value is a stand-in rather than read from the snapshot. */
  placeholder: boolean;
}

export interface World {
  regionName: string;
  cells: Cell[];
  /** Max Cell.bridgeKm, for normalizing stagger delays. */
  maxBridgeKm: number;
  assumptions: Assumption[];
  /** Human-readable provenance shown in the UI. */
  provenance: string;
}

export interface Scenario {
  removedLinks: LinkId[];
  /**
   * Full world changes (agent bundles, candidates, user closures), applied after `removedLinks`. Only the
   * snapshot-backed simulator reads this; the mock ignores it.
   */
  mutations?: MutationRecord[];
}

/** Optional per-run settings. `lens` defaults to DEFAULT_LENS in ./real.ts. */
export interface RunOptions {
  lens?: LensId;
  /** xharbor variant: "fast" (default, job-weighted anchors) or "exact" (all pairs, about 8 s per world in Node). */
  xharborMode?: "fast" | "exact";
}

/** Cross-harbor headline numbers, unit-converted for display (minutes, people, percent). */
export interface XharborHeadline {
  /** People (population) whose cross-harbor jobs within 30 min drop by more than 10 / 25 percent. */
  peopleLosingGt10: number;
  peopleLosingGt25: number;
  lowWageLosingGt10: number;
  lowWageLosingGt25: number;
  /** Same, as a share (percent) of everyone / of all low-wage workers in the study area. */
  peopleLosingGt10Pct: number;
  peopleLosingGt25Pct: number;
  lowWageLosingGt10Pct: number;
  lowWageLosingGt25Pct: number;
  meanLossPct: number;
  /** Mean added cross-harbor travel time, minutes: population mean and pop-weighted p50/p90/p99/max. */
  meanAddedMin: number;
  addedP50Min: number;
  addedP90Min: number;
  addedP99Min: number;
  addedMaxMin: number;
  /** Baseline mean cross-harbor jobs within 30 min per person, and in the world. */
  baselineMeanJobs: number;
  worldMeanJobs: number;
  popCovered: number;
  lowWageCovered: number;
}

/** Low-wage workers versus everyone (percent points and minutes). */
export interface XharborEquity {
  lowWageMeanLossPct: number;
  popMeanLossPct: number;
  /** low-wage minus population; positive = low-wage workers lose more. */
  lossGapPct: number;
  lowWageMeanAddedMin: number;
  popMeanAddedMin: number;
  addedGapMin: number;
  /** Share of low-wage workers / of everyone losing more than 10 percent of cross-harbor jobs. */
  lowWageShareLosingGt10Pct: number;
  popShareLosingGt10Pct: number;
}

export interface WorstBlockGroupNamed extends WorstBlockGroup {
  /** Derived from the GEOID (county, census tract, block group). Not a neighborhood name. */
  name: string;
  meanAddedMin: number;
}

export interface XharborDetail {
  /** Per hex, minutes. Signed added mean cross-harbor time (negative = a candidate made it faster); NaN never. */
  addedMin: Float32Array;
  /** Per hex, fraction (0..1) of baseline cross-harbor jobs within 30 min that are lost. */
  lossFrac: Float32Array;
  /** Per hex, jobs within 30 min in this world (NaN for hexes that are not origins). */
  jobsWithin: Float32Array;
  /** Per hex: false for hexes on the ambiguous shore (not origins; terrain shows 0 there). */
  isOrigin: Uint8Array;
  headline: XharborHeadline;
  equity: XharborEquity;
  metrics: XharborMetrics;
  /** Deterministic runs only. */
  worstBlockGroups: { byLossPct: WorstBlockGroupNamed[]; byAddedS: WorstBlockGroupNamed[] };
}

/** What the snapshot-backed runner adds to a SimOutput. Absent on the mock. */
export interface SimDetail {
  /** The lens that drives `SimOutput.minutes`. */
  lens: LensId;
  /** That lens's contract metrics in seconds, unmapped. */
  metrics: LensMetrics;
  meta: RunMeta;
  /** "Computed locally in your browser (N workers, M ms)". */
  runnerText: string;
  /** Set when the lens field is an approximation (xharbor fast variant), for an honest label. */
  approximation: string | null;
  /** What `SimOutput.minutes` holds: EMS response time, or added time versus the baseline (Access, xharbor). */
  minutesKind: "response" | "added";
  /**
   * All three lenses side by side (always computed together), so the small regional number is never hidden
   * behind the cross-harbor one.
   */
  lenses: { xharbor: LensMetrics; access: LensMetrics; ems: LensMetrics };
  /** Present when lens is "xharbor". */
  xharbor?: XharborDetail;
}

export type MetricKey = "p50" | "p90" | "pctWithin8" | "isolated" | "equityGap";

export type Metrics = Record<MetricKey, number>;

export interface SimOutput {
  /** Response time in minutes, aligned by index with World.cells. */
  minutes: Float32Array;
  metrics: Metrics;
  /** Wall-clock compute time reported by the runner. */
  computeMs: number;
  /** Present when the output comes from the snapshot-backed simulator. */
  detail?: SimDetail;
}

export interface SimulatorMeta {
  id: string;
  /** Honest runner label shown in the top bar. */
  runnerLabel: string;
  kind: "mock" | "browser" | "server";
}

export interface Simulator {
  readonly meta: SimulatorMeta;
  loadWorld(): Promise<World>;
  run(world: World, scenario: Scenario, opts?: RunOptions): Promise<SimOutput>;
}

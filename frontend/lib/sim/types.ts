/**
 * Simulator contract.
 *
 * The UI only talks to `Simulator`. Today the implementation is a MOCK
 * (lib/sim/mock.ts). Later a snapshot-backed / server runner implements the
 * same interface and is swapped in at lib/sim/index.ts. Nothing else changes.
 */

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
}

export type MetricKey = "p50" | "p90" | "pctWithin8" | "isolated" | "equityGap";

export type Metrics = Record<MetricKey, number>;

export interface SimOutput {
  /** Response time in minutes, aligned by index with World.cells. */
  minutes: Float32Array;
  metrics: Metrics;
  /** Wall-clock compute time reported by the runner. */
  computeMs: number;
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
  run(world: World, scenario: Scenario): Promise<SimOutput>;
}

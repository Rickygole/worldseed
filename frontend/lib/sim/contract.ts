/**
 * Data contract types for the browser simulator core (ARCHITECTURE.md sections 2.2 to 2.6).
 *
 * These are the pure-TS types shared by csr / compile / lenses / futures / workers. The UI-facing
 * `Simulator` interface stays in ./types.ts; lib/sim/real.ts adapts between the two.
 *
 * Naming notes (kept on purpose):
 *   - The contract calls the metric object `Metrics`. ./types.ts already exports a UI `Metrics`,
 *     so the contract one is `LensMetrics` here.
 *   - The EMS delay is the call-processing and turnout delay. Wire name in assumptions.json is
 *     `A-CALL-TO-WHEELS` (seconds). In code it is `ModelParams.call_to_wheels_delay_min` (minutes).
 */

export type LensId = "access" | "ems" | "xharbor";
export type TimeOfDay = "am" | "mid" | "pm" | "night";
export type Origin = "user" | "agent" | "tavily" | "tour";

/** Where a result was computed. Nothing in this codebase ever reports a cloud runner. */
export type Runner = "local-browser" | "local-node";

// ---------------------------------------------------------------------------------------------
// World state and mutations (2.4)

export type Mutation =
  | { kind: "close_link"; linkId: string }
  /** Re-enable the edges of a named link (a CANDIDATE link, or undo an earlier close in the same list). */
  | { kind: "open_link"; linkId: string }
  | { kind: "close_edges"; edges: number[]; label: string }
  /** `factor` is a speed factor: 1.12 means 12 percent faster (edge time divided by 1.12). */
  | { kind: "scale_corridor_speed"; corridorId: string; factor: number }
  /** Extra EMS source (pre-positioning). `delayS` is an offset added before the source starts. */
  | { kind: "add_source"; node: number; delayS?: number }
  | { kind: "apply_candidate"; candidateId: string }
  | { kind: "set_facility_active"; facilityId: string; active: boolean };

export interface Provenance {
  url: string;
  quote: string;
  retrievedAt: string;
}

export interface MutationRecord {
  id: string;
  m: Mutation;
  origin: Origin;
  label: string;
  provenance?: Provenance;
  /** ISO time set by a user action. Compile refuses a record without it. */
  confirmedAt: string;
}

export interface WorldState {
  snapshotId: string;
  mutations: MutationRecord[];
}

export interface AppliedEffect {
  mutationId: string;
  kind: Mutation["kind"];
  label: string;
  origin: Origin;
  provenance?: Provenance;
  /** Number of edges whose enabled flag or cost changed by this mutation (0 for source-only ones). */
  edgesTouched: number;
}

export interface CompiledWorld {
  /** 1 = usable. Baseline: 0 on CANDIDATE-flagged edges. length E */
  edgeEnabled: Uint8Array;
  /** Multiplier on free-flow edge time. length E */
  edgeCostMul: Float32Array;
  extraSources: { node: number; delayS: number }[];
  /** Per facility (snapshot order): 1 = counts as an EMS source. */
  sourceMask: Uint8Array;
  /** Per edge: 1 = hazmat allowed despite HAZMAT_PROHIBITED (escort window). length E */
  hazmatAllowed: Uint8Array;
  /** Per edge: extra seconds charged when hazmat uses an allowed edge. length E */
  hazmatPenaltyS: Float32Array;
  /** Per corridor: multiplier on the congestion sigma. length C */
  corridorSigmaScale: Float32Array;
  applied: AppliedEffect[];
}

// ---------------------------------------------------------------------------------------------
// Snapshot content (2.1 to 2.3)

export interface GraphMeta {
  nodeCount: number;
  edgeCount: number;
  classes: string[];
  flags: Record<string, number>;
  corridors: { id: string; name: string }[];
  links: { id: string; name: string; edges: number[] }[];
  /** Candidate (disabled in the baseline) links, e.g. temporary shuttles. Optional in older snapshots. */
  candidateLinks?: { id: string; edges: number[]; nodes?: number[] }[];
  buffers: Record<string, { offset: number; length: number; type: "f32" | "f64" | "u32" | "u16" | "u8" }>;
}

export const NO_CORRIDOR = 0xffff;

export interface LinkInfo {
  id: string;
  name: string;
  edges: number[];
  /** true for a candidate link (meta.candidateLinks): disabled in the baseline. */
  candidate: boolean;
}

export interface Graph {
  meta: GraphMeta;
  /** meta.links followed by meta.candidateLinks (named by id). linkIndex and edgeLink index into this list. */
  links: LinkInfo[];
  nodeCount: number;
  edgeCount: number;
  nodeLon: Float32Array;
  nodeLat: Float32Array;
  nodeOsmId: Float64Array;
  edgeFrom: Uint32Array;
  edgeTo: Uint32Array;
  edgeTimeS: Float32Array;
  edgeLenM: Float32Array;
  edgeClass: Uint8Array;
  edgeFlags: Uint8Array;
  edgeCorridor: Uint16Array;
  edgeOsmWay: Float64Array;
  fwdOff: Uint32Array;
  fwdEdge: Uint32Array;
  revOff: Uint32Array;
  revEdge: Uint32Array;
  /** Flag bit values by name (TUNNEL, BRIDGE, HAZMAT_PROHIBITED, TOLL, CANDIDATE, KEYBRIDGE). */
  flag: { [name: string]: number };
  linkIndex: Map<string, number>;
  corridorIndex: Map<string, number>;
  /** Index (into `links`) of the first link containing each edge, -1 if none. length E */
  edgeLink: Int32Array;
}

export interface Hexes {
  count: number;
  h3: string[];
  lat: Float32Array;
  lng: Float32Array;
  node: Uint32Array;
  snapS: Float32Array;
  pop: Float32Array;
  zvh: Float32Array;
  lowWage: Float32Array;
  jobs: Float32Array;
  bg: Uint16Array;
  shore: Uint8Array;
}

export interface Facility {
  id: string;
  kind: "fire_station" | "ems_station" | "hospital";
  name: string;
  lat: number;
  lng: number;
  node: number;
  snapM?: number | null;
  /** "node/123" for OSM-sourced facilities; null for iMAP-only ones (contract says string). */
  osm?: string | null;
  active: boolean;
}

export interface Destination {
  id: string;
  name: string;
  node: number;
  jobs: number;
  shore?: number;
}

export type CandidateEffect =
  | { op: "enable_edges"; edges: number[] }
  | { op: "corridor_speed"; corridor: string; factor: number }
  | { op: "add_source"; facilityLike: { lat: number; lng: number; node: number }; delayS?: number }
  | { op: "allow_class_on"; edges: number[]; vehicleClass: "hazmat"; timePenaltyS: number }
  | { op: "congestion_sigma"; corridor: string; scale: number };

export interface Candidate {
  id: string;
  type: string;
  title: string;
  /**
   * Lens tags. The contract lists "access" and "ems"; the pipeline also writes "xharbor" (a third lens the
   * simulator does not compute yet), so this is a plain string list.
   */
  lens: string[];
  costTier: string;
  leadTime?: string;
  hypothetical?: boolean;
  effect: CandidateEffect;
  assumptions?: string[];
  sources?: unknown[];
  notes?: string;
}

export interface AssumptionRecord {
  id: string;
  label: string;
  value: number | string | boolean;
  unit?: string | null;
  /** Documented bounds (informational; the simulator uses `value`). */
  min?: number;
  max?: number;
  status: "assumption" | "sourced";
  source?: string | null;
  note?: string;
}

export interface BlockGroup {
  geoid: string;
  i: number;
  county: string;
  pop: number;
  households: number;
  zvh: number;
  lowWageWorkers: number;
  centroid: [number, number];
  hexes: number[];
}

export interface Manifest {
  snapshotId: string;
  pipelineVersion?: string;
  builtAt?: string;
  osmDate?: string;
  acsVintage?: string;
  lodes?: string;
  bbox?: number[];
  h3Res?: number;
  files?: Record<string, { sha256: string; bytes: number }>;
  sources?: { name: string; license?: string; attribution?: string }[];
}

export interface Snapshot {
  /** Block groups (names, ids, county, whole-BG population). Empty when blockgroups.json is absent. */
  blockGroups: BlockGroup[];
  id: string;
  manifest: Manifest | null;
  graph: Graph;
  hexes: Hexes;
  facilities: Facility[];
  destinations: Destination[];
  candidates: Candidate[];
  assumptions: AssumptionRecord[];
}

// ---------------------------------------------------------------------------------------------
// Model parameters (seconds internally; the EMS delay is exposed in minutes under its neutral name)

export interface ModelParams {
  /** Call-processing and turnout delay added once to every EMS response time (minutes). */
  call_to_wheels_delay_min: number;
  /** EMS "within" and "isolated" threshold, seconds. */
  emsThresholdS: number;
  /** Access-lens cap on a destination time and on the weighted hex time, seconds. */
  accessCapS: number;
  /** Access "added time acceptable" threshold, seconds. */
  accessAddedOkS: number;
  /** Access "cut-off" block-group threshold on added time, seconds. */
  accessCutoffS: number;
}

// ---------------------------------------------------------------------------------------------
// Lens results (2.5, 2.6)

export interface LensMetrics {
  lens: LensId;
  /** Population-weighted quantiles of the hex time, seconds. Infinity = the quantile is an unreachable hex. */
  p50S: number;
  p90S: number;
  /** EMS: % pop with time <= threshold. Access: % pop with added time <= accessAddedOkS. */
  pctWithin: number;
  /** EMS: BGs whose pop-weighted median time > threshold. Access: BGs whose median added time > cut-off. */
  isolatedBg: number[];
  /** EMS: zvh-weighted p90 minus pop-weighted p90. Access: low-wage-weighted added minus pop-weighted added. */
  equityGapS: number;
  /** EMS only. */
  zvhWithin?: number;
  /** Access only. */
  lowWageAddedS?: number;
  popAddedS?: number;
  addedP50S?: number;
  addedP90S?: number;
  /** Hexes with no route (EMS: no source reaches them). */
  unreachableHexes?: number;
  /** xharbor only: the full cross-harbor metric set. */
  xharbor?: XharborMetrics;
}

/**
 * Cross-harbor lens metrics (pipeline xharbor.py `summarize`, same names). Population and low-wage weights
 * cover origins only (shore 0 or 1). Loss = (baseline jobs within 30 min - world jobs) / baseline jobs.
 */
export interface XharborMetrics {
  popCovered: number;
  lowWageCovered: number;
  originsWithoutBaselineJobs: number;
  popMeanJobs: number;
  jobsP10: number;
  jobsP50: number;
  jobsP90: number;
  popMeanLossPct: number;
  lowWageMeanLossPct: number;
  /** low-wage mean loss minus population mean loss, percentage points. */
  equityGapLossPct: number;
  popLossGt5pct: number;
  lowWageLossGt5pct: number;
  popLossGt10pct: number;
  lowWageLossGt10pct: number;
  popLossGt25pct: number;
  lowWageLossGt25pct: number;
  popLossGt50pct: number;
  lowWageLossGt50pct: number;
  popMeanMeanTimeS: number;
  popMeanAddedS: number;
  lowWageMeanAddedS: number;
  equityGapAddedS: number;
  addedP50S: number;
  addedP90S: number;
  addedP99S: number;
  addedMaxS: number;
  popAddedGt60s: number;
  lowWageAddedGt60s: number;
  popAddedGt300s: number;
  lowWageAddedGt300s: number;
  /** Split by the origin's shore ("0" north/east, "1" south/west). */
  byOriginShore: Record<string, { pop: number; popMeanLossPct: number; popLossGt10pct: number; popLossGt25pct: number; lowWageLossGt10pct: number; popMeanAddedS: number; popAddedGt60s: number; meanBaselineJobs: number }>;
  /** Present on deterministic runs: the ten block groups with the highest mean loss and the ten with the highest mean added time. */
  worst?: { byLossPct: WorstBlockGroup[]; byAddedS: WorstBlockGroup[] };
}

export interface WorstBlockGroup {
  /** Index into the block-group list (hexes.bg). */
  bg: number;
  geoid: string | null;
  county: string | null;
  pop: number;
  meanLossPct: number;
  meanAddedS: number;
  meanBaselineJobs: number;
}

/** How a lens field was computed. Only xharbor has more than one way. */
export interface LensVariant {
  /** "exact": every origin-destination pair (test oracle). "fast-anchors": job-weighted destination anchors. */
  mode: "exact" | "fast-anchors" | "standard";
  approximate: boolean;
  /** Anchors per shore (fast-anchors). */
  anchorsPerShore?: number;
  /** Text the UI can show as is. */
  label: string;
}

export interface RunMeta {
  lens: LensId;
  variant?: LensVariant;
  runner: Runner;
  workers: number;
  ms: number;
  snapshotId: string;
  seed?: number;
}

export interface RunResult {
  /** Per-hex seconds (lens field). xharbor: mean cross-harbor travel time; NaN for non-origin hexes. Transferable. */
  field: Float32Array;
  /** Access and xharbor: per-hex added seconds versus the snapshot baseline (0 for non-origin hexes). Transferable. */
  added?: Float32Array;
  /** xharbor: per-hex jobs within 30 min (opposite shore); NaN for non-origin hexes. Transferable. */
  jobsWithin?: Float32Array;
  /** xharbor: per-hex fraction (0..1) of baseline cross-harbor jobs within 30 min that are lost; 0 if none. Transferable. */
  lossFrac?: Float32Array;
  metrics: LensMetrics;
  meta: RunMeta;
  applied: AppliedEffect[];
}

export interface Dist {
  p10: number;
  p50: number;
  p90: number;
}

export type GoalMetric =
  | "p50S" | "p90S" | "pctWithin" | "equityGapS" | "addedP50S" | "addedP90S" | "isolatedCount"
  /** xharbor: people (population) losing more than 10 percent / 25 percent of their cross-harbor jobs within 30 min. */
  | "popLossGt10pct" | "popLossGt25pct" | "lowWageLossGt10pct" | "popMeanLossPct" | "popMeanAddedS";

export interface Goal {
  metric: GoalMetric;
  op: "<=" | ">=";
  /** Same unit as the metric (seconds for times, percent for pctWithin, count for isolatedCount). */
  target: number;
}

export interface FuturesOptions {
  n: number;
  seed: number;
  tod: TimeOfDay;
  /** Probability that one eligible link is closed in a future. */
  closureProb: number;
  goal?: Goal;
  /** Metric summarised as `headline`. Default: EMS p90S, Access addedP90S. */
  headline?: GoalMetric;
  /** xharbor only: "fast" (default, anchors) or "exact" (all pairs; far too slow for futures). */
  xharborMode?: "fast" | "exact";
  /** xharbor fast variant: anchors per shore for THIS futures run. Default FUTURES_ANCHORS_PER_SHORE (32). */
  xharborAnchors?: number;
  /** Access "added" is measured against this world under the same future. Default: the snapshot baseline. */
  referenceWorld?: WorldState;
  /** EMS incidents sampled per future. Default from FuturesParams. */
  incidents?: number;
}

export interface FuturesMeta {
  lens: LensId;
  variant?: LensVariant;
  n: number;
  seed: number;
  tod: TimeOfDay;
  closureProb: number;
  runner: Runner;
  workers: number;
  ms: number;
  snapshotId: string;
  model: string;
}

export interface FuturesResult {
  lens: LensId;
  samples: LensMetrics[];
  p50: Dist;
  p90: Dist;
  pctWithin: Dist;
  isolatedCount: Dist;
  equityGapS: Dist;
  headlineMetric: GoalMetric;
  headline: Dist;
  goal?: Goal;
  /** Share of futures meeting the goal, 0..1. */
  pGoal?: number;
  /** Block groups isolated (or cut off) in at least one future, by frequency (0..1), most frequent first. */
  worstIsolated: { bg: number; freq: number }[];
  /** Largest isolated-BG count seen in any single future. */
  worstIsolatedCount: number;
  /** Per-hex p90 across futures of the lens field (seconds). */
  hexP90: Float32Array;
  /** Access and xharbor: per-hex p90 across futures of added seconds. */
  hexAddedP90?: Float32Array;
  meta: FuturesMeta;
}

/** Per-range partial produced by one worker; aggregated by futures.ts. */
export interface FuturesPartial {
  /** How the lens was computed (same for every range of one run). */
  variant?: LensVariant;
  start: number;
  end: number;
  samples: LensMetrics[];
  /** (end - start) x hexCount, row-major. */
  hexField: Float32Array;
  hexAdded?: Float32Array;
}

// ---------------------------------------------------------------------------------------------
// Explain (2.6): data only. The template carries {{slots}}; the UI fills them from `slots`.

export interface RouteSummary {
  timeS: number;
  /** Edge indices in travel order. */
  edges: number[];
  /** Node indices in travel order (edges.length + 1 entries when the route is non-empty). */
  nodes: number[];
  lengthM: number;
  viaLinks: string[];
  viaCorridors: string[];
  tunnelEdges: number;
  bridgeEdges: number;
  reachable: boolean;
}

export interface CausalChain {
  lens: LensId;
  hex: number;
  h3: string;
  snapshotId: string;
  /** Snapshot baseline. */
  before: { timeS: number; viaLinks: string[]; route: RouteSummary };
  /** The world being explained. */
  after: { timeS: number; viaLinks: string[]; route: RouteSummary };
  /** Hex lens time in the world minus the baseline, seconds. */
  deltaS: number;
  routeChanged: boolean;
  /** Links used by the baseline route that are disabled in the world. */
  lostLinks: string[];
  focus:
    | { kind: "station"; facilityId: string | null; name: string | null; node: number }
    | { kind: "destination"; id: string; name: string; weight: number; deltaS: number };
  /** Access only: every destination with weight and baseline/world times. */
  perDestination?: { id: string; name: string; weight: number; beforeS: number; afterS: number }[];
  template: string;
  slots: Record<string, string>;
}

/**
 * The snapshot-backed Simulator: the same `Simulator` interface the shell UI already uses, computed by the
 * browser simulator core (Web Workers) from the pipeline snapshot.
 *
 * Honesty rules:
 *  - Every number comes from computation over the snapshot. Nothing here is a demo value.
 *  - `World.provenance` is the empty string. The footer shows its "Demo data" chip whenever provenance is
 *    non-empty, so an empty string is what keeps the chip off for real data.
 *  - Each SimOutput carries `detail` with the raw contract metrics and the runner sentence
 *    ("Computed locally in your browser (N workers, M ms)").
 *
 * Metric mapping for the legacy five-number ribbon (minutes):
 *   EMS    minutes = per-hex response time;  p50/p90 = p50S/p90S, pctWithin8 = % pop within the EMS threshold,
 *          isolated = isolated block groups, equityGap = zero-vehicle-weighted p90 minus population p90
 *   Access minutes = per-hex ADDED time vs the snapshot baseline; p50/p90 = added p50/p90,
 *          pctWithin8 = % pop with added time within the Access threshold, isolated = cut-off block groups,
 *          equityGap = low-wage-weighted mean added minus population mean added
 */
import { BRIDGE, distKm, toLocalKm } from "../geo";
import type { AssumptionRecord, BundleInput, FuturesOptions, FuturesResult, Hexes, LensId, LensMetrics, Manifest, MutationRecord, RunResult, WorldState, WorstBlockGroup } from "./contract";
import { formatRunnerLabel } from "./runner";
import { fetchReader, parseHexes, SnapshotMissingError, type SnapshotReader } from "./snapshot";
import type { SnapshotInfo } from "./engine";
import type { TripsResult } from "./trips";
import { abortError, SimPool, type DeterministicManyOptions, type DeterministicManyResult, type FuturesRunOptions, type PairedOptions, type PairedResult, type PoolOptions } from "../workers/pool";
import type { Assumption, Cell, RunOptions, Scenario, SimOutput, Simulator, SimulatorMeta, World, WorstBlockGroupNamed, XharborDetail } from "./types";

/**
 * Lens that drives the terrain: cross-harbor access (the hero). Regional access and the EMS "resilience
 * check" are always computed alongside and returned in `detail.lenses`; pass `{lens: "ems"}` to make EMS
 * the terrain.
 */
export const DEFAULT_LENS: LensId = "xharbor";

export const DEFAULT_SNAPSHOT_URL = "/snapshot/";

const LINK_IDS: Record<string, string> = { key_bridge: "L-KEYBRIDGE" };

export interface RealSimulator extends Simulator {
  /** Resolves after loadWorld() with the snapshot summary (links, corridors, candidates, parameters). */
  info(): SnapshotInfo;
  /** Compile the UI scenario to a WorldState (what the workers receive). */
  worldState(scenario: Scenario): WorldState;
  /**
   * Freight and hazmat trips in the scenario's world: per trip and vehicle class, baseline / current / added minutes,
   * ratio and unreachable, plus a per-class summary over the cross-harbor pairs. A few tens of milliseconds.
   */
  runTrips(scenario: Scenario, opts?: { classes?: string[]; tripIds?: string[]; includeRoutes?: boolean; signal?: AbortSignal }): Promise<TripsResult>;
  /** Exhaustive check: deterministic metrics for many bundles (candidate combinations) on top of the scenario. */
  runDeterministicMany(scenario: Scenario, bundles: BundleInput[], opts: DeterministicManyOptions): Promise<DeterministicManyResult>;
  /** Futures for a stressed baseline and each bundle with identical draws (paired). */
  runBundlesPaired(scenario: Scenario, bundles: BundleInput[], opts: PairedOptions): Promise<PairedResult>;
  runFutures(scenario: Scenario, lens: LensId, opts: FuturesOptions, run?: FuturesRunOptions): Promise<FuturesResult>;
  explain(scenario: Scenario, lens: LensId, hexIndex: number): ReturnType<SimPool["explain"]>;
  dispose(): void;
}

export interface RealSimulatorOptions {
  baseUrl?: string;
  /** For tests. */
  reader?: SnapshotReader;
  pool?: Partial<PoolOptions>;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function buildCells(h: Hexes): { cells: Cell[]; maxBridgeKm: number } {
  let maxR = 0;
  for (let i = 0; i < h.count; i++) {
    const [x, y] = toLocalKm(h.lat[i], h.lng[i]);
    maxR = Math.max(maxR, Math.hypot(x, y));
  }
  const cells: Cell[] = [];
  let maxBridgeKm = 0;
  for (let i = 0; i < h.count; i++) {
    const lat = h.lat[i];
    const lng = h.lng[i];
    const [x, y] = toLocalKm(lat, lng);
    const r = maxR > 0 ? Math.hypot(x, y) / maxR : 0;
    const bridgeKm = distKm(lat, lng, BRIDGE.lat, BRIDGE.lng);
    maxBridgeKm = Math.max(maxBridgeKm, bridgeKm);
    // Cosmetic: fade the plain toward the edge of the study area (geometry only, not data).
    const edgeFade = r < 0.72 ? 1 : Math.max(0.12, 1 - smooth((r - 0.72) / 0.28));
    cells.push({ id: h.h3[i], lat, lng, bridgeKm, edgeFade, residents: h.pop[i], lowWageResidents: h.lowWage[i], jobs: h.jobs[i] });
  }
  return { cells, maxBridgeKm };
}

function fmtValue(a: AssumptionRecord): string {
  const v = typeof a.value === "boolean" ? (a.value ? "yes" : "no") : String(a.value);
  return a.unit ? `${v} ${a.unit}` : v;
}

function assumptionsFor(list: AssumptionRecord[], manifest: Manifest | null, info: SnapshotInfo): Assumption[] {
  const out: Assumption[] = [];
  if (manifest) {
    out.push({ label: "Snapshot", value: manifest.snapshotId, note: manifest.builtAt ? `Built ${manifest.builtAt}` : undefined, placeholder: false });
    if (manifest.osmDate) out.push({ label: "Road network date (OpenStreetMap)", value: manifest.osmDate, placeholder: false });
    if (manifest.acsVintage) out.push({ label: "Census / ACS vintage", value: manifest.acsVintage, placeholder: false });
    if (manifest.lodes) out.push({ label: "Jobs data (LODES)", value: manifest.lodes, placeholder: false });
  }
  for (const a of list) {
    const status = a.status === "sourced" ? `Sourced${a.source ? `: ${a.source}` : ""}` : "Assumption";
    out.push({ label: a.label, value: fmtValue(a), note: [status, a.note].filter(Boolean).join(". "), placeholder: false });
  }
  for (const a of info.futuresParams) {
    out.push({ label: a.label, value: fmtValue(a), note: a.note, placeholder: false });
  }
  return out;
}

async function readOptional(read: SnapshotReader, file: string): Promise<unknown | null> {
  try {
    return JSON.parse(new TextDecoder().decode(await read(file)));
  } catch (e) {
    if (e instanceof SnapshotMissingError) return null;
    throw e;
  }
}

function bgName(geoid: string | null, county: string | null): string {
  if (!geoid || geoid.length < 12) return county ?? "Block group";
  const tract = `${geoid.slice(5, 9)}.${geoid.slice(9, 11)}`;
  return `${county ?? "County " + geoid.slice(2, 5)}, Tract ${tract}, Block Group ${geoid.slice(11)}`;
}

function xharborDetail(r: RunResult, metricsOf: LensMetrics, hx: Hexes): XharborDetail {
  const xm = metricsOf.xharbor;
  if (!xm || !r.added || !r.jobsWithin || !r.lossFrac || !r.baselineField || !r.baselineJobsWithin) throw new Error("xharbor result is missing its detail arrays");
  const n = r.field.length;
  const addedMin = new Float32Array(n);
  const isOrigin = new Uint8Array(n);
  const isPopulated = new Uint8Array(n);
  const meanBeforeMin = new Float32Array(n);
  const meanAfterMin = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    addedMin[i] = r.added[i] / 60;
    isOrigin[i] = Number.isNaN(r.field[i]) ? 0 : 1;
    isPopulated[i] = isOrigin[i] === 1 && hx.pop[i] > 0 ? 1 : 0;
    meanBeforeMin[i] = r.baselineField[i] / 60; // NaN stays NaN
    meanAfterMin[i] = r.field[i] / 60;
  }
  const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : 0);
  const named = (rows: WorstBlockGroup[] | undefined): WorstBlockGroupNamed[] =>
    (rows ?? []).map((w) => ({ ...w, name: bgName(w.geoid, w.county), meanAddedMin: w.meanAddedS / 60 }));
  // population-weighted mean of the baseline jobs, from the per-shore means (exact: weights are the shore populations)
  const shores = Object.values(xm.byOriginShore);
  const baselineMeanJobs = shores.reduce((a, b) => a + b.pop * b.meanBaselineJobs, 0) / (shores.reduce((a, b) => a + b.pop, 0) || 1);
  return {
    addedMin,
    lossFrac: r.lossFrac,
    jobsWithin: r.jobsWithin,
    meanBeforeMin,
    meanAfterMin,
    baselineJobsWithin: r.baselineJobsWithin,
    residents: hx.pop,
    lowWageResidents: hx.lowWage,
    jobsHere: hx.jobs,
    isPopulated,
    isOrigin,
    metrics: xm,
    headline: {
      peopleLosingGt10: xm.popLossGt10pct,
      peopleLosingGt25: xm.popLossGt25pct,
      lowWageLosingGt10: xm.lowWageLossGt10pct,
      lowWageLosingGt25: xm.lowWageLossGt25pct,
      peopleLosingGt10Pct: pct(xm.popLossGt10pct, xm.popCovered),
      peopleLosingGt25Pct: pct(xm.popLossGt25pct, xm.popCovered),
      lowWageLosingGt10Pct: pct(xm.lowWageLossGt10pct, xm.lowWageCovered),
      lowWageLosingGt25Pct: pct(xm.lowWageLossGt25pct, xm.lowWageCovered),
      meanLossPct: xm.popMeanLossPct,
      meanAddedMin: xm.popMeanAddedS / 60,
      addedP50Min: xm.addedP50S / 60,
      addedP90Min: xm.addedP90S / 60,
      addedP99Min: xm.addedP99S / 60,
      addedMaxMin: xm.addedMaxS / 60,
      addedMaxPopulatedMin: xm.addedMaxPopulatedS / 60,
      addedMaxPopulatedHex: xm.addedMaxPopulatedHex,
      addedP99PopulatedMin: xm.addedP99PopulatedS / 60,
      populatedHexes: xm.populatedHexes,
      baselineMeanJobs,
      worldMeanJobs: xm.popMeanJobs,
      popCovered: xm.popCovered,
      lowWageCovered: xm.lowWageCovered,
    },
    equity: {
      lowWageMeanLossPct: xm.lowWageMeanLossPct,
      popMeanLossPct: xm.popMeanLossPct,
      lossGapPct: xm.equityGapLossPct,
      lowWageMeanAddedMin: xm.lowWageMeanAddedS / 60,
      popMeanAddedMin: xm.popMeanAddedS / 60,
      addedGapMin: xm.equityGapAddedS / 60,
      lowWageShareLosingGt10Pct: pct(xm.lowWageLossGt10pct, xm.lowWageCovered),
      popShareLosingGt10Pct: pct(xm.popLossGt10pct, xm.popCovered),
    },
    worstBlockGroups: { byLossPct: named(xm.worst?.byLossPct), byAddedS: named(xm.worst?.byAddedS) },
  };
}

export function createRealSimulator(options: RealSimulatorOptions = {}): RealSimulator {
  const baseUrl = options.baseUrl ?? DEFAULT_SNAPSHOT_URL;
  const meta: SimulatorMeta = { id: "snapshot-browser", runnerLabel: "Local (browser)", kind: "browser" };
  let pool: SimPool | null = null;
  let loading: Promise<World> | null = null;
  let snapshotInfo: SnapshotInfo | null = null;
  let mainHexes: Hexes | null = null;

  const need = (): SimPool => {
    if (!pool) throw new Error("simulator not loaded: call loadWorld() first");
    return pool;
  };

  function worldState(scenario: Scenario): WorldState {
    const id = need().info.id;
    const mutations: MutationRecord[] = [];
    const now = new Date().toISOString();
    for (const l of scenario.removedLinks) {
      const linkId = LINK_IDS[l];
      if (!linkId) throw new Error(`unknown link "${l}"`);
      mutations.push({ id: `ui-close-${l}`, m: { kind: "close_link", linkId }, origin: "user", label: `Remove link ${linkId}`, confirmedAt: now });
    }
    if (scenario.mutations) mutations.push(...scenario.mutations);
    return { snapshotId: id, mutations };
  }

  async function load(): Promise<World> {
    const read = options.reader ?? fetchReader(baseUrl);
    // Sentinel: if the snapshot is absent this throws SnapshotMissingError("graph.meta.json") before any
    // worker is started, so the caller can tell "no snapshot" from "broken snapshot".
    await read("graph.meta.json");
    const poolPromise = SimPool.create({ baseUrl, ...options.pool });
    const viewPromise = (async () => {
      const [hexMeta, hexBin] = await Promise.all([read("hexes.meta.json"), read("hexes.bin")]);
      const hexes = parseHexes(JSON.parse(new TextDecoder().decode(hexMeta)), hexBin);
      const [assumptions, manifest] = await Promise.all([readOptional(read, "assumptions.json"), readOptional(read, "manifest.json")]);
      return { hexes, assumptions: (assumptions ?? []) as AssumptionRecord[], manifest: manifest as Manifest | null };
    })();
    let view: Awaited<typeof viewPromise>;
    try {
      [pool, view] = await Promise.all([poolPromise, viewPromise]);
    } catch (e) {
      void poolPromise.then((p) => p.dispose(), () => {});
      throw e;
    }
    snapshotInfo = pool.info;
    mainHexes = view.hexes;
    void pool.warm(); // baselines and anchors in the background; the first real request is then fast
    if (view.hexes.count !== pool.info.hexCount) {
      throw new Error(`main thread and workers disagree on the hex count (${view.hexes.count} vs ${pool.info.hexCount})`);
    }
    const { cells, maxBridgeKm } = buildCells(view.hexes);
    return {
      regionName: "Key Bridge Region",
      cells,
      maxBridgeKm,
      assumptions: assumptionsFor(view.assumptions, view.manifest, pool.info),
      // Empty on purpose: the footer's "Demo data" chip renders whenever provenance is non-empty.
      provenance: "",
    };
  }

  return {
    meta,

    loadWorld() {
      loading ??= load().catch((e) => {
        loading = null; // allow a retry after a failure
        throw e;
      });
      return loading;
    },

    async run(world: World, scenario: Scenario, opts: RunOptions = {}): Promise<SimOutput> {
      const lens = opts.lens ?? DEFAULT_LENS;
      const p = need();
      if (world.cells.length !== p.info.hexCount) throw new Error("world does not belong to the loaded snapshot");
      const ws = worldState(scenario);
      const x = opts.xharborMode ? { mode: opts.xharborMode } : undefined;
      // All three lenses are computed together (in parallel across workers) so the regional and EMS numbers
      // are never hidden behind the cross-harbor one.
      const t0 = performance.now();
      const all: LensId[] = ["xharbor", "access", "ems"];
      if (opts.signal?.aborted) throw abortError();
      const results = await p.runDeterministicBatch(ws, all.map((l) => ({ lens: l, xharbor: l === "xharbor" ? x : undefined })), { signal: opts.signal });
      if (opts.signal?.aborted) throw abortError();
      const wall = performance.now() - t0;
      const by = Object.fromEntries(all.map((l, i) => [l, results[i]])) as Record<LensId, RunResult>;
      const r = by[lens];
      const meta = { ...r.meta, workers: Math.min(all.length, p.workerCount), ms: wall };
      const m = r.metrics;
      const n = r.field.length;
      const cap = p.info.params.accessCapS;
      const minutes = new Float32Array(n);
      const minutesKind = lens === "ems" ? "response" : "added";
      const source = lens === "ems" ? r.field : (r.added as Float32Array);
      for (let i = 0; i < n; i++) {
        const s = source[i];
        // xharbor terrain is ADDED time and never below the baseline plain (a candidate that helps shows in addedMin)
        minutes[i] = (Number.isFinite(s) ? (lens === "xharbor" ? Math.max(0, s) : s) : cap) / 60;
      }
      const finite = (s: number | undefined) => (s !== undefined && Number.isFinite(s) ? s / 60 : cap / 60);
      const usesAdded = lens !== "ems";
      const out: SimOutput = {
        minutes,
        metrics: {
          p50: finite(usesAdded ? m.addedP50S : m.p50S),
          p90: finite(usesAdded ? m.addedP90S : m.p90S),
          pctWithin8: m.pctWithin,
          isolated: m.isolatedBg.length,
          equityGap: Number.isFinite(m.equityGapS) ? m.equityGapS / 60 : 0,
        },
        computeMs: wall,
        detail: {
          lens,
          metrics: m,
          meta,
          runnerText: formatRunnerLabel(meta),
          approximation: r.meta.variant?.approximate ? r.meta.variant.label : null,
          minutesKind,
          lenses: { xharbor: by.xharbor.metrics, access: by.access.metrics, ems: by.ems.metrics },
        },
      };
      if (lens === "xharbor") out.detail!.xharbor = xharborDetail(r, by.xharbor.metrics, mainHexes as Hexes);
      return out;
    },

    info() {
      if (!snapshotInfo) throw new Error("simulator not loaded: call loadWorld() first");
      return snapshotInfo;
    },

    worldState,

    runTrips(scenario, opts = {}) {
      return need().runTrips(worldState(scenario), opts);
    },

    runDeterministicMany(scenario, bundles, opts) {
      return need().runDeterministicMany(worldState(scenario), bundles, opts);
    },

    runBundlesPaired(scenario, bundles, opts) {
      return need().runBundlesPaired(worldState(scenario), bundles, opts);
    },

    runFutures(scenario, lens, opts, run) {
      return need().runFutures(worldState(scenario), lens, opts, run);
    },

    explain(scenario, lens, hexIndex) {
      return need().explain(worldState(scenario), lens, hexIndex);
    },

    dispose() {
      pool?.dispose();
      pool = null;
      loading = null;
    },
  };
}

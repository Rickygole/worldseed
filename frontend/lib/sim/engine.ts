/**
 * SimEngine: the pure simulator. One instance owns a snapshot plus all scratch memory and answers
 * (compiledWorld, lens, futureSample) -> fields + metrics. It has no Comlink and no DOM dependency, so the
 * same class runs in a Web Worker, on the main thread (fallback) and in Node (tests, golden).
 */
import { compile, emptyWorld, worldStateSchema, type CompileContext } from "./compile";
import type {
  BundleInput,
  BundleRow,
  CausalChain,
  CompiledWorld,
  FuturesOptions,
  FuturesPartial,
  FuturesResult,
  LensId,
  LensMetrics,
  ModelParams,
  Runner,
  RunResult,
  Snapshot,
  WorldState,
} from "./contract";
import { DijkstraWorkspace } from "./dijkstra";
import { explainHex } from "./explain";
import { aggregateFutures, validateFuturesOptions } from "./futures";
import { createAccessLens } from "./lenses/access";
import { createEmsLens } from "./lenses/ems";
import { createFreightLens } from "./lenses/freight";
import { LENS_DISPLAY, type LensDisplay } from "./lenses/meta";
import { createXharborLens, DEFAULT_ANCHORS_PER_SHORE, FUTURES_ANCHORS_PER_SHORE, type XharborOptions } from "./lenses/xharbor";
import type { Lens, LensAux, LensContext } from "./lenses/types";
import { MetricsWorkspace } from "./metrics";
import { bundleWorld } from "./stress";
import { TripsEngine, type TripsRequest, type TripsResult } from "./trips";
import {
  DEFAULT_FUTURES_PARAMS,
  describeFuturesParams,
  drawFuture,
  newEdgeScratch,
  newSample,
  resolveFutures,
  resolveFuturesParams,
  type FuturesParams,
} from "./sample";
import { loadSnapshot, type SnapshotReader } from "./snapshot";
import type { AssumptionRecord } from "./contract";

export function detectRunner(): Runner {
  const g = globalThis as { window?: unknown; WorkerGlobalScope?: unknown };
  return typeof g.window !== "undefined" || typeof g.WorkerGlobalScope !== "undefined" ? "local-browser" : "local-node";
}

export class CancelledError extends Error {
  constructor() {
    super("computation cancelled");
    this.name = "AbortError";
  }
}

export interface EngineHooks {
  /** Called after each completed future with the count completed so far in this range. */
  onProgress?: (done: number) => void;
  isCancelled?: () => boolean;
}

/** What the UI needs to know about a loaded snapshot, in a structured-clone-safe shape. */
export interface SnapshotInfo {
  id: string;
  nodeCount: number;
  edgeCount: number;
  hexCount: number;
  links: { id: string; name: string; edgeCount: number; alias?: boolean }[];
  corridors: { id: string; name: string }[];
  destinations: { id: string; name: string; jobs: number }[];
  facilityCount: number;
  candidates: { id: string; type: string; title: string; lens: string[]; costTier: string; hypothetical: boolean }[];
  params: ModelParams;
  paramSources: { fromSnapshot: string[]; defaulted: string[]; futuresFromSnapshot: string[] };
  /** Trip anchors, trip definitions and vehicle classes (null when the snapshot has none). */
  trips: import("./contract").TripsMeta | null;
  /** The lenses this snapshot supports, with display names for their search measures (freight only when trips exist). */
  lenses: LensDisplay[];
  futuresParams: AssumptionRecord[];
  runner: Runner;
}

const REF_CACHE_MAX = 1200;
const YIELD_EVERY_MS = 8;

let yieldFn: (() => Promise<void>) | null = null;
/** Let queued messages (cancel, progress flushes) run. setImmediate where it exists (Node), else a MessageChannel. */
function yieldToEventLoop(): Promise<void> {
  if (!yieldFn) {
    if (typeof setImmediate === "function") {
      yieldFn = () => new Promise<void>((r) => setImmediate(r));
    } else if (typeof MessageChannel !== "undefined") {
      const ch = new MessageChannel();
      const waiting: (() => void)[] = [];
      ch.port1.onmessage = () => waiting.shift()?.();
      yieldFn = () => new Promise<void>((r) => {
        waiting.push(r);
        ch.port2.postMessage(0);
      });
    } else {
      yieldFn = () => new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  return yieldFn();
}

const worldKey = (w: WorldState): string => JSON.stringify(w.mutations.map((r) => r.m));

export class SimEngine {
  readonly snap: Snapshot;
  readonly params: ModelParams;
  readonly futuresParams: FuturesParams;
  readonly info: SnapshotInfo;
  private readonly ctx: LensContext;
  private readonly cctx: CompileContext;
  private readonly lenses: Record<"ems" | "access", Lens>;
  private freightLens: Lens | null = null;
  private readonly xharborLenses = new Map<string, Lens>();
  private readonly xharborAnchors: number;
  private readonly baselineCw: CompiledWorld;
  private readonly baselineField = new Map<Lens, { field: Float32Array; aux?: Float32Array }>();
  private readonly refCache = new Map<string, { field: Float32Array; aux?: Float32Array }>();
  private readonly fingerprint: string;
  private readonly tripsEngine: TripsEngine | null;

  constructor(
    loaded: { snapshot: Snapshot; params: ModelParams; paramSources?: { fromSnapshot: string[]; defaulted: string[] } },
    futuresParams?: FuturesParams,
    xharborAnchors: number = DEFAULT_ANCHORS_PER_SHORE,
  ) {
    const snap = loaded.snapshot;
    this.xharborAnchors = xharborAnchors;
    this.snap = snap;
    this.params = loaded.params;
    const resolved = futuresParams
      ? { params: futuresParams, fromSnapshot: false }
      : resolveFuturesParams(snap.assumptions);
    this.futuresParams = resolved.params;
    const futuresUsed = "usedIds" in resolved ? resolved.usedIds : [];
    const rf = resolveFutures(this.futuresParams, snap.graph, snap.hexes);
    this.ctx = {
      snap,
      params: this.params,
      futures: rf,
      dj: new DijkstraWorkspace(snap.graph),
      mw: new MetricsWorkspace(snap.hexes),
      scratch: newEdgeScratch(snap.graph, rf),
    };
    this.cctx = { id: snap.id, graph: snap.graph, facilities: snap.facilities, candidates: snap.candidates };
    this.lenses = { ems: createEmsLens(this.ctx), access: createAccessLens(this.ctx) };
    this.baselineCw = compile(emptyWorld(snap.id), this.cctx);
    this.fingerprint = JSON.stringify([this.params, this.futuresParams]);
    this.tripsEngine = snap.trips ? new TripsEngine(snap.graph, this.ctx.dj, snap.trips, this.baselineCw) : null;
    this.info = {
      id: snap.id,
      nodeCount: snap.graph.nodeCount,
      edgeCount: snap.graph.edgeCount,
      hexCount: snap.hexes.count,
      links: snap.graph.links.filter((l) => !l.candidate).map((l) => ({ id: l.id, name: l.name, edgeCount: l.edges.length, ...(l.alias ? { alias: true } : {}) })),
      corridors: snap.graph.meta.corridors,
      destinations: snap.destinations.map((d) => ({ id: d.id, name: d.name, jobs: d.jobs })),
      facilityCount: snap.facilities.length,
      candidates: snap.candidates.map((c) => ({ id: c.id, type: c.type, title: c.title, lens: c.lens, costTier: c.costTier, hypothetical: c.hypothetical ?? true })),
      params: this.params,
      paramSources: { ...(loaded.paramSources ?? { fromSnapshot: [], defaulted: [] }), futuresFromSnapshot: futuresUsed },
      trips: snap.trips,
      lenses: (["xharbor", "access", "ems", ...(snap.trips ? ["freight" as const] : [])] as LensId[]).map((id) => LENS_DISPLAY[id]),
      futuresParams: describeFuturesParams(this.futuresParams, resolved.fromSnapshot),
      runner: detectRunner(),
    };
  }

  static async fromReader(read: SnapshotReader, futuresParams?: FuturesParams, xharborAnchors?: number): Promise<SimEngine> {
    return new SimEngine(await loadSnapshot(read), futuresParams, xharborAnchors);
  }

  /** Freight and hazmat trips in a world (see ./trips.ts). Throws when the snapshot has no trip definitions. */
  runTrips(world: WorldState, req: TripsRequest = {}): TripsResult {
    if (!this.tripsEngine) throw new Error("this snapshot has no trip definitions (trips.json or golden.json trips)");
    return this.tripsEngine.run(this.compileWorld(world), this.snap.id, req, detectRunner());
  }

  /** Compile a world, validating its shape first (it may come from an agent tool call). */
  compileWorld(world: WorldState): CompiledWorld {
    const parsed = worldStateSchema.safeParse(world);
    if (!parsed.success) throw new Error(`invalid world state: ${parsed.error.message}`);
    return compile(world, this.cctx);
  }

  /** The lens object for `id`. xharbor takes its variant: fast anchors (default) or exact. */
  lens(id: LensId, x: Partial<XharborOptions> = {}): Lens {
    if (id === "freight") {
      this.freightLens ??= createFreightLens(this.ctx);
      return this.freightLens;
    }
    if (id !== "xharbor") return this.lenses[id];
    const o: XharborOptions = { mode: x.mode ?? "fast", anchorsPerShore: x.anchorsPerShore ?? this.xharborAnchors, rampScale: x.rampScale };
    const key = o.mode === "exact" ? "exact" : `fast:${o.anchorsPerShore}:${o.rampScale ?? "d"}`;
    let l = this.xharborLenses.get(key);
    if (!l) {
      l = createXharborLens(this.ctx, this.baselineCw, o);
      this.xharborLenses.set(key, l);
    }
    return l;
  }

  private baseline(l: Lens): { field: Float32Array; aux?: Float32Array } {
    let b = this.baselineField.get(l);
    if (!b) {
      const N = l.size ?? this.snap.hexes.count;
      b = { field: new Float32Array(N), aux: l.hasAux ? new Float32Array(N) : undefined };
      l.field(this.baselineCw, null, b.field, b.aux);
      this.baselineField.set(l, b);
    }
    return b;
  }

  /** Free-flow, no noise. `x` selects the xharbor variant. */
  runDeterministic(world: WorldState, lens: LensId, workers = 1, x: Partial<XharborOptions> = {}): RunResult {
    const t0 = performance.now();
    const cw = this.compileWorld(world);
    const l = this.lens(lens, x);
    const H = l.size ?? this.snap.hexes.count;
    const base = this.baseline(l);
    const isBase = world.mutations.length === 0;
    const field = isBase ? base.field.slice() : new Float32Array(H);
    const aux = l.hasAux ? (isBase ? (base.aux as Float32Array).slice() : new Float32Array(H)) : undefined;
    if (!isBase) l.field(cw, null, field, aux);
    const usesBase = lens === "access" || lens === "xharbor" || lens === "freight";
    const laux: LensAux | null = aux ? { jobs: aux, baselineJobs: base.aux ?? null, blockGroups: this.snap.blockGroups } : null;
    const metrics: LensMetrics = l.metrics(field, usesBase ? base.field : null, null, laux);
    const result: RunResult = {
      field,
      metrics,
      meta: { lens, variant: l.variant, runner: detectRunner(), workers, ms: 0, snapshotId: this.snap.id },
      applied: cw.applied,
    };
    if (usesBase) {
      const added = new Float32Array(H);
      if (l.addedInto) l.addedInto(field, base.field, added);
      else {
        for (let h = 0; h < H; h++) {
          const d = field[h] - base.field[h];
          added[h] = Number.isNaN(d) ? 0 : d;
        }
      }
      result.added = added;
      result.baselineField = base.field.slice();
      if (base.aux) result.baselineJobsWithin = base.aux.slice();
    }
    if (aux && base.aux) {
      result.jobsWithin = aux;
      const loss = new Float32Array(H);
      for (let h = 0; h < H; h++) {
        const j0 = base.aux[h];
        loss[h] = j0 > 0 ? (j0 - aux[h]) / j0 : 0;
      }
      result.lossFrac = loss;
    }
    result.meta.ms = performance.now() - t0;
    return result;
  }

  /**
   * Deterministic metrics for many bundles (each = `world` plus the bundle's candidates) on one lens: the
   * exhaustive check. No fields are kept. Yields to the event loop every few milliseconds so a cancel or a
   * progress message gets through; `hooks.onProgress(done)` is the number of bundles finished so far. A bundle
   * the compiler rejects (unknown or already applied candidate) yields a row with `error`, not an exception.
   */
  async runDeterministicMany(world: WorldState, bundles: BundleInput[], lensId: LensId, x: Partial<XharborOptions> = {}, hooks: EngineHooks = {}): Promise<BundleRow[]> {
    const l = this.lens(lensId, x);
    const base = this.baseline(l);
    const usesBase = lensId === "access" || lensId === "xharbor" || lensId === "freight";
    const H = l.size ?? this.snap.hexes.count;
    const field = new Float32Array(H);
    const aux = l.hasAux ? new Float32Array(H) : undefined;
    const now = new Date().toISOString();
    const rows: BundleRow[] = [];
    let lastYield = performance.now();
    for (let i = 0; i < bundles.length; i++) {
      if (hooks.isCancelled?.()) throw new CancelledError();
      const b = bundles[i];
      try {
        const cw = this.compileWorld(bundleWorld(world, b, now));
        l.field(cw, null, field, aux);
        const laux: LensAux | null = aux ? { jobs: aux, baselineJobs: base.aux ?? null } : null;
        rows.push({ bundleId: b.id, candidateIds: b.candidateIds, metrics: l.metrics(field, usesBase ? base.field : null, null, laux) });
      } catch (e) {
        rows.push({ bundleId: b.id, candidateIds: b.candidateIds, error: e instanceof Error ? e.message : String(e) });
      }
      hooks.onProgress?.(i + 1);
      const t = performance.now();
      if (t - lastYield > YIELD_EVERY_MS) {
        await yieldToEventLoop();
        lastYield = performance.now();
      }
    }
    return rows;
  }

  /** Run futures [start, end) of a scenario. Future i depends only on (seed, i), so ranges can run anywhere. */
  async runFuturesRange(
    world: WorldState,
    lensId: LensId,
    opts: FuturesOptions,
    start: number,
    end: number,
    hooks: EngineHooks = {},
  ): Promise<FuturesPartial> {
    validateFuturesOptions(lensId, opts);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > opts.n || start >= end) {
      throw new RangeError(`bad futures range [${start}, ${end}) for n=${opts.n}`);
    }
    const lens = this.lens(lensId, { mode: opts.xharborMode, anchorsPerShore: opts.xharborAnchors ?? FUTURES_ANCHORS_PER_SHORE });
    const H = lens.size ?? this.snap.hexes.count;
    const usesRef = lensId === "access" || lensId === "xharbor" || lensId === "freight";
    const cw = this.compileWorld(world);
    const refWorld = opts.referenceWorld ?? emptyWorld(this.snap.id);
    const sameAsRef = usesRef && worldKey(world) === worldKey(refWorld);
    const refCw = usesRef && !sameAsRef ? this.compileWorld(refWorld) : null;
    const refKeyBase = usesRef
      ? `${this.fingerprint}|${lensId}|${lens.variant.label}|${opts.seed}|${opts.tod}|${opts.closureProb}|${worldKey(refWorld)}|`
      : "";

    const rf = this.ctx.futures;
    const incidents = opts.incidents ?? this.futuresParams.incidents;
    const sample = newSample(rf, this.snap.hexes.count, lensId === "ems");
    const field = new Float32Array(H);
    const aux = lens.hasAux ? new Float32Array(H) : undefined;
    const refBuf = new Float32Array(H);
    const refAux = lens.hasAux ? new Float32Array(H) : undefined;
    const rows = end - start;
    const hexField = new Float32Array(rows * H);
    const hexAdded = usesRef ? new Float32Array(rows * H) : undefined;
    const samples: LensMetrics[] = [];
    let lastYield = performance.now();

    for (let i = start; i < end; i++) {
      if (hooks.isCancelled?.()) throw new CancelledError();
      drawFuture(rf, opts.seed, i, opts.tod, opts.closureProb, incidents, sample);
      lens.field(cw, sample, field, aux);

      let base: { field: Float32Array; aux?: Float32Array } | null = null;
      if (usesRef) {
        if (sameAsRef) {
          base = { field, aux };
        } else {
          const key = refKeyBase + i;
          let cached = this.refCache.get(key);
          if (!cached) {
            lens.field(refCw as CompiledWorld, sample, refBuf, refAux);
            cached = { field: refBuf.slice(), aux: refAux?.slice() };
            if (this.refCache.size >= REF_CACHE_MAX) {
              const oldest = this.refCache.keys().next().value;
              if (oldest !== undefined) this.refCache.delete(oldest);
            }
            this.refCache.set(key, cached);
          }
          base = cached;
        }
      }
      const laux: LensAux | null = aux ? { jobs: aux, baselineJobs: base?.aux ?? null } : null;
      samples.push(lens.metrics(field, base ? base.field : null, sample, laux));
      const row = (i - start) * H;
      hexField.set(field, row);
      if (hexAdded && base) {
        if (lens.addedInto) lens.addedInto(field, base.field, hexAdded.subarray(row, row + H));
        else {
          for (let h = 0; h < H; h++) {
            const d = field[h] - base.field[h];
            hexAdded[row + h] = Number.isNaN(d) ? 0 : d;
          }
        }
      }

      hooks.onProgress?.(i - start + 1);
      const now = performance.now();
      if (now - lastYield > YIELD_EVERY_MS) {
        await yieldToEventLoop();
        lastYield = performance.now();
      }
    }
    const partial: FuturesPartial = { variant: lens.variant, start, end, samples, hexField };
    if (hexAdded) partial.hexAdded = hexAdded;
    return partial;
  }

  /** All futures on this engine (single worker). Used by the main-thread fallback and by tests. */
  async runFutures(world: WorldState, lens: LensId, opts: FuturesOptions, hooks: EngineHooks = {}): Promise<FuturesResult> {
    const t0 = performance.now();
    const part = await this.runFuturesRange(world, lens, opts, 0, opts.n, hooks);
    return aggregateFutures(lens, [part], part.hexField.length / (part.end - part.start), opts, {
      runner: detectRunner(),
      workers: 1,
      ms: performance.now() - t0,
      snapshotId: this.snap.id,
    });
  }

  explain(world: WorldState, lens: LensId, hex: number): CausalChain {
    if (lens === "freight") throw new RangeError("explain is per hex and the freight lens has no hexes; use runTrips(includeRoutes) for trip routes");
    this.compileWorld(world); // validates the world shape
    return explainHex(this.ctx, this.cctx, lens, world, hex);
  }
}

export { DEFAULT_FUTURES_PARAMS };

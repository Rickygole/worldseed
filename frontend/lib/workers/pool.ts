/**
 * Comlink worker pool: fans futures out across up to 4 workers by contiguous index ranges.
 *
 *  - pool size = min(4, max(1, hardwareConcurrency - 1)), overridable
 *  - each worker fetches and parses the snapshot itself (files are HTTP-cached), so the pool never ships
 *    the 1-2 MB graph through postMessage
 *  - future i depends only on (seed, i), so the result is identical for any worker count
 *  - results carry runner, worker count and elapsed ms; nothing here can report a cloud runner
 *  - progress is the sum of futures actually completed across workers
 *  - cancelation: AbortSignal -> worker.cancel(jobId) at the next future boundary; the returned promise
 *    rejects with an AbortError immediately
 *  - without Worker support (SSR, old browsers) the pool runs one engine in-process and says workers = 1
 */
import * as Comlink from "comlink";
import type {
  BundleInput,
  BundleRow,
  CausalChain,
  DeterministicRow,
  Dist,
  Goal,
  GoalMetric,
  LensMetrics,
  TimeOfDay,
  FuturesOptions,
  FuturesPartial,
  FuturesResult,
  LensId,
  RunResult,
  WorldState,
} from "../sim/contract";
import { detectRunner, type SnapshotInfo } from "../sim/engine";
import type { XharborOptions } from "../sim/lenses/xharbor";
import type { TripsRequest, TripsResult } from "../sim/trips";
import { aggregateFutures, distOf, meetsGoal, metricValue, splitRange, validateFuturesOptions } from "../sim/futures";
import { FUTURES_ANCHORS_PER_SHORE } from "../sim/lenses/xharbor";
import { bundleCostTier, bundleWorld, simTod, worldWithStress, type StressApplied, type StressLike } from "../sim/stress";
import { createWorkerApi, type WorkerApi } from "./api";

export interface WorkerLike {
  api: WorkerApi;
  terminate(): void;
  /** true when calls do not cross a message boundary (no Comlink proxies for callbacks). */
  local: boolean;
}

export type WorkerFactory = () => WorkerLike;

export interface PoolOptions {
  /** Where the snapshot files are served, e.g. "/snapshot/". */
  baseUrl: string;
  /** Upper bound on workers. Default 4. */
  maxWorkers?: number;
  /** For tests and SSR. Default: a module Web Worker per slot. */
  workerFactory?: WorkerFactory;
  /** Override navigator.hardwareConcurrency. */
  hardwareConcurrency?: number;
}

export interface RunOptions {
  signal?: AbortSignal;
}

export interface FuturesRunOptions extends RunOptions {
  /** Called with the number of futures completed so far (across all workers). */
  onProgress?: (done: number, total: number) => void;
}

export interface DeterministicManyOptions {
  lens: LensId;
  /** Score every bundle UNDER this stress (its closed links are added to `world`). */
  stress?: StressLike;
  /** xharbor: anchors per shore (default 32, the futures setting: hundreds of bundles must stay affordable). */
  xharborAnchors?: number;
  signal?: AbortSignal;
  /** Bundles finished so far, of the total. Real counts. */
  onProgress?: (done: number, total: number) => void;
}

export interface DeterministicManyResult {
  lens: LensId;
  stress: StressApplied | null;
  /** The no-intervention world under the same stress, on the same lens. */
  baseline: Omit<DeterministicRow, "bundleId" | "candidateIds" | "costTier">;
  /** One row per bundle the compiler accepted, in input order. */
  rows: DeterministicRow[];
  /** Bundles the compiler rejected (unknown or already-applied candidate). Not scored. */
  errors: { bundleId: string; error: string }[];
  evaluated: number;
  meta: { runner: RunResult["meta"]["runner"]; workers: number; ms: number; snapshotId: string };
}

export interface PairedOptions {
  lens: LensId;
  /** Futures per scenario (baseline and every bundle each run exactly this many). */
  n: number;
  seed: number;
  /** Simulator time of day, or the app's names ("midday"). A stress's own tod wins. Default "am". */
  tod?: TimeOfDay | "midday";
  closureProb?: number;
  stress?: StressLike;
  /** Absolute goal on a per-future metric, evaluated for every bundle and the baseline. */
  goal?: Goal;
  /**
   * Relative goal: target = the stressed baseline's median (across futures) of `metric` + targetDelta. Ignored when
   * `goal` is given. Metric names are the simulator's (p50S, p90S, isolatedCount, equityGapS, ...).
   */
  goalDelta?: { metric: GoalMetric; targetDelta: number };
  headline?: GoalMetric;
  xharborAnchors?: number;
  /** Keep the per-future metric objects in each result (off by default). */
  keepSamples?: boolean;
  signal?: AbortSignal;
  /** Futures completed so far across baseline and bundles, of the total scheduled. Real counts. */
  onProgress?: (done: number, total: number) => void;
}

export interface PairedRow {
  bundleId: string;
  candidateIds: string[];
  costTier: string | null;
  /** Futures actually completed for this row (equals n; 0 for a bundle that could not be scored). */
  futures: number;
  error?: string;
  /** Median across futures of each per-future metric (seconds; counts for isolatedCount). */
  row: { p50S: number; p90S: number; pctWithin: number; isolatedCount: number; equityGapS: number };
  headlineMetric: GoalMetric;
  headline: Dist;
  p50: Dist;
  p90: Dist;
  pGoal: number | null;
  worstIsolated: { bg: number; freq: number }[];
  worstIsolatedCount: number;
  /** Paired comparison against the stressed baseline: same futures, bundle minus baseline on the headline metric. */
  vsBaseline: { headlineDelta: Dist; /** share of futures where the bundle is strictly lower (better) */ pBetter: number; /** ... lower or equal */ pNoWorse: number } | null;
  samples?: LensMetrics[];
}

export interface PairedResult {
  lens: LensId;
  n: number;
  seed: number;
  tod: TimeOfDay;
  closureProb: number;
  stress: StressApplied | null;
  headlineMetric: GoalMetric;
  goal: Goal | null;
  baseline: PairedRow;
  bundles: PairedRow[];
  /** Sum of `futures` over baseline and bundles. */
  futuresTotal: number;
  meta: { runner: RunResult["meta"]["runner"]; workers: number; ms: number; snapshotId: string; model: string; variant?: FuturesResult["meta"]["variant"] };
}

export function defaultWorkerCount(hardwareConcurrency?: number, max = 4): number {
  const hc = hardwareConcurrency ?? (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined) ?? 2;
  return Math.max(1, Math.min(max, hc - 1));
}

export function abortError(): Error {
  const e = new Error("computation cancelled");
  e.name = "AbortError";
  return e;
}

/** Reject with an AbortError as soon as `signal` aborts; otherwise settle like `p`. */
function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function browserWorker(): WorkerLike {
  const worker = new Worker(new URL("./sim.worker.ts", import.meta.url));
  const api = Comlink.wrap<WorkerApi>(worker);
  return {
    api: api as unknown as WorkerApi,
    local: false,
    terminate: () => {
      api[Comlink.releaseProxy]();
      worker.terminate();
    },
  };
}

/** One engine on the calling thread. */
function inProcessWorker(): WorkerLike {
  return { api: createWorkerApi({ transfer: false }), local: true, terminate: () => {} };
}

let jobSeq = 0;

function rowNumbers(m: LensMetrics): Omit<DeterministicRow, "bundleId" | "candidateIds" | "costTier"> {
  return { p50S: m.p50S, p90S: m.p90S, pctWithin: m.pctWithin, isolatedCount: m.isolatedBg.length, equityGapS: m.equityGapS, metrics: m };
}

export class SimPool {
  readonly info: SnapshotInfo;
  private readonly workers: WorkerLike[];
  private disposed = false;

  private constructor(workers: WorkerLike[], info: SnapshotInfo) {
    this.workers = workers;
    this.info = info;
  }

  static async create(opts: PoolOptions): Promise<SimPool> {
    const factory = opts.workerFactory ?? (typeof Worker !== "undefined" ? browserWorker : inProcessWorker);
    const inProcess = !opts.workerFactory && typeof Worker === "undefined";
    const count = inProcess ? 1 : defaultWorkerCount(opts.hardwareConcurrency, opts.maxWorkers ?? 4);
    const workers: WorkerLike[] = [];
    try {
      for (let i = 0; i < count; i++) workers.push(factory());
      const infos = await Promise.all(workers.map((w) => w.api.load(opts.baseUrl)));
      for (const inf of infos) {
        if (inf.id !== infos[0].id) throw new Error(`workers loaded different snapshots (${inf.id} vs ${infos[0].id})`);
      }
      return new SimPool(workers, infos[0]);
    } catch (e) {
      for (const w of workers) w.terminate();
      throw e;
    }
  }

  get workerCount(): number {
    return this.workers.length;
  }

  private live(): void {
    if (this.disposed) throw new Error("pool has been disposed");
  }

  /** Kick off baseline and anchor computation in every worker. Not awaited by default users; never rejects. */
  warm(lenses?: LensId[]): Promise<void> {
    // In-process (no Web Worker) the call would block the calling thread, so it is skipped there.
    if (this.workers.every((w) => w.local)) return Promise.resolve();
    return Promise.all(this.workers.map((w) => w.api.warm(lenses))).then(() => undefined, () => undefined);
  }

  // ---- deterministic-run scheduling -----------------------------------------------------------------
  // At most one deterministic run is sent to a worker at a time, and the caller's AbortSignal is
  // checked before each send, so cancelling stops the runs that have not started yet (a run that is
  // already computing cannot be interrupted, but its result is dropped and the caller is released at once).
  private busy: boolean[] = [];
  private waiters: { resolve: (i: number) => void; reject: (e: Error) => void }[] = [];

  private acquire(signal?: AbortSignal): Promise<number> {
    if (this.busy.length !== this.workers.length) this.busy = this.workers.map(() => false);
    const free = this.busy.indexOf(false);
    if (free >= 0) {
      this.busy[free] = true;
      return Promise.resolve(free);
    }
    return new Promise<number>((resolve, reject) => {
      const waiter = { resolve, reject };
      this.waiters.push(waiter);
      signal?.addEventListener(
        "abort",
        () => {
          const k = this.waiters.indexOf(waiter);
          if (k >= 0) {
            this.waiters.splice(k, 1);
            reject(abortError());
          }
        },
        { once: true },
      );
    });
  }

  private release(i: number): void {
    const next = this.waiters.shift();
    if (next) next.resolve(i); // the worker stays marked busy for the next run
    else this.busy[i] = false;
  }

  /**
   * Free-flow run on one worker (`meta.workers` is 1); `xharbor` picks that lens's variant. Rejects with an
   * AbortError if `signal` is aborted before the run starts or while it computes.
   */
  async runDeterministic(world: WorldState, lens: LensId, opts: RunOptions & { xharbor?: Partial<XharborOptions> } = {}): Promise<RunResult> {
    const t0 = performance.now();
    const r = await this.runOn(opts.signal, (api) => api.runDeterministic(world, lens, opts.xharbor));
    // ms is the round trip the user waited for (worker compute + transfer)
    return { ...r, meta: { ...r.meta, ms: performance.now() - t0, workers: 1, runner: detectRunner() } };
  }

  /** Freight and hazmat trips (a few tens of ms). Same scheduling and AbortSignal rules as runDeterministic. */
  async runTrips(world: WorldState, req: TripsRequest & RunOptions = {}): Promise<TripsResult> {
    const { signal, ...rest } = req;
    const t0 = performance.now();
    const r = await this.runOn(signal, (api) => api.runTrips(world, rest));
    return { ...r, meta: { ...r.meta, ms: performance.now() - t0, workers: 1, runner: detectRunner() } };
  }

  /** Run one call on a free worker (waiting for one if all are busy); AbortSignal rules as documented above. */
  private async runOn<T>(signal: AbortSignal | undefined, fn: (api: WorkerApi) => Promise<T>): Promise<T> {
    this.live();
    if (signal?.aborted) throw abortError();
    const i = await this.acquire(signal);
    let call: Promise<T>;
    try {
      if (signal?.aborted) throw abortError();
      this.live();
      call = fn(this.workers[i].api);
    } catch (e) {
      this.release(i);
      throw e;
    }
    call.then(() => this.release(i), () => this.release(i));
    return raceAbort(call, signal);
  }

  /** Several deterministic runs of one world (different lenses). Runs in parallel up to the worker count. */
  runDeterministicBatch(world: WorldState, requests: { lens: LensId; xharbor?: Partial<XharborOptions> }[], opts: RunOptions = {}): Promise<RunResult[]> {
    return Promise.all(requests.map((q) => this.runDeterministic(world, q.lens, { signal: opts.signal, xharbor: q.xharbor })));
  }

  /**
   * Deterministic metrics for many bundles: the exhaustive check. Bundles are split into contiguous ranges over
   * the workers (results are in input order and identical for any worker count). Cancelable (AbortSignal rejects with
   * an AbortError at once and stops the workers at the next bundle boundary) and reports real progress.
   */
  async runDeterministicMany(world: WorldState, bundles: BundleInput[], opts: DeterministicManyOptions): Promise<DeterministicManyResult> {
    this.live();
    if (opts.signal?.aborted) throw abortError();
    const t0 = performance.now();
    const { world: sw, applied } = worldWithStress(world, opts.stress);
    const x = opts.lens === "xharbor" ? { mode: "fast" as const, anchorsPerShore: opts.xharborAnchors ?? FUTURES_ANCHORS_PER_SHORE } : undefined;
    const tiers = new Map(this.info.candidates.map((c) => [c.id, c.costTier]));

    const b = await this.runDeterministic(sw, opts.lens, { signal: opts.signal, xharbor: x });
    const baseline = rowNumbers(b.metrics);

    const total = bundles.length;
    const jobId = `job-${++jobSeq}`;
    const ranges = splitRange(total, Math.min(this.workers.length, Math.max(1, total)));
    const done = new Array<number>(ranges.length).fill(0);
    opts.onProgress?.(0, total);
    const stopper = this.stopper(jobId, ranges.length, opts.signal);
    const calls = ranges.map(([s, e], i) => {
      const cb = (d: number) => {
        if (d > done[i]) {
          done[i] = d;
          opts.onProgress?.(done.reduce((p, q) => p + q, 0), total);
        }
      };
      const w = this.workers[i];
      return w.api.runDeterministicMany(jobId, sw, bundles.slice(s, e), opts.lens, x, w.local ? cb : Comlink.proxy(cb)).then((rows) => {
        cb(e - s);
        return rows;
      });
    });
    for (const c of calls) c.catch((err) => stopper.stop(err instanceof Error ? err : new Error(String(err))));
    let parts: BundleRow[][];
    try {
      parts = await Promise.race([Promise.all(calls), stopper.stopped]);
    } finally {
      stopper.dispose();
    }
    const rows: DeterministicRow[] = [];
    const errors: { bundleId: string; error: string }[] = [];
    for (const r of parts.flat()) {
      if (r.metrics) rows.push({ bundleId: r.bundleId, candidateIds: r.candidateIds, costTier: bundleCostTier(r.candidateIds, tiers), ...rowNumbers(r.metrics) });
      else errors.push({ bundleId: r.bundleId, error: r.error ?? "unknown error" });
    }
    return {
      lens: opts.lens,
      stress: applied,
      baseline,
      rows,
      errors,
      evaluated: rows.length,
      meta: { runner: detectRunner(), workers: ranges.length, ms: performance.now() - t0, snapshotId: this.info.id },
    };
  }

  /**
   * Futures for a stressed no-intervention baseline and for every bundle, with the SAME seed and therefore the same
   * draws for each (future i is a function of (seed, i) only), so the comparison is paired: `vsBaseline` is the
   * distribution of bundle minus baseline over identical futures. `world` is the user's current world; each bundle adds
   * its candidates on top, and a stress adds its closed links (and sets the time of day) for baseline and bundles alike.
   * Progress counts futures actually completed. Cancelable.
   */
  async runBundlesPaired(world: WorldState, bundles: BundleInput[], opts: PairedOptions): Promise<PairedResult> {
    this.live();
    if (opts.signal?.aborted) throw abortError();
    const t0 = performance.now();
    const { world: sw, tod: stressTod, applied } = worldWithStress(world, opts.stress);
    const tod: TimeOfDay = stressTod ?? (opts.tod === undefined ? "am" : simTod(opts.tod));
    const closureProb = opts.closureProb ?? 0;
    const tiers = new Map(this.info.candidates.map((c) => [c.id, c.costTier]));
    const now = new Date().toISOString();
    let goal: Goal | null = opts.goal ?? null;
    let planned = (bundles.length + 1) * opts.n;
    let completed = 0;
    let workersUsed = 1;
    let variant: FuturesResult["meta"]["variant"];
    const progress = (extra: number) => opts.onProgress?.(completed + extra, planned);
    const base: FuturesOptions = { n: opts.n, seed: opts.seed, tod, closureProb, headline: opts.headline, xharborAnchors: opts.xharborAnchors ?? (opts.lens === "xharbor" ? FUTURES_ANCHORS_PER_SHORE : undefined) };
    validateFuturesOptions(opts.lens, base);
    progress(0);

    const run = async (wd: WorldState, g: Goal | null): Promise<FuturesResult> => {
      const r = await this.runFutures(wd, opts.lens, { ...base, ...(g ? { goal: g } : {}) }, { signal: opts.signal, onProgress: (d) => progress(d) });
      completed += r.samples.length;
      workersUsed = Math.max(workersUsed, r.meta.workers);
      variant = r.meta.variant;
      return r;
    };
    const toRow = (id: string, candidateIds: string[], r: FuturesResult, g: Goal | null, ref: FuturesResult | null): PairedRow => {
      const samples = r.samples;
      let vs: PairedRow["vsBaseline"] = null;
      if (ref) {
        const hm = r.headlineMetric;
        const d = samples.map((s, i) => metricValue(s, hm) - metricValue(ref.samples[i], hm));
        vs = { headlineDelta: distOf(d), pBetter: d.filter((x) => x < 0).length / d.length, pNoWorse: d.filter((x) => x <= 0).length / d.length };
      }
      const med = (f: (s: LensMetrics) => number) => distOf(samples.map(f)).p50;
      const row: PairedRow = {
        bundleId: id,
        candidateIds,
        costTier: bundleCostTier(candidateIds, tiers),
        futures: samples.length,
        row: { p50S: r.p50.p50, p90S: r.p90.p50, pctWithin: r.pctWithin.p50, isolatedCount: Math.round(r.isolatedCount.p50), equityGapS: med((s) => s.equityGapS) },
        headlineMetric: r.headlineMetric,
        headline: r.headline,
        p50: r.p50,
        p90: r.p90,
        pGoal: g ? samples.filter((s) => meetsGoal(metricValue(s, g.metric), g)).length / samples.length : null,
        worstIsolated: r.worstIsolated,
        worstIsolatedCount: r.worstIsolatedCount,
        vsBaseline: vs,
      };
      if (opts.keepSamples) row.samples = samples;
      return row;
    };

    const baseRes = await run(sw, goal);
    if (!goal && opts.goalDelta) {
      const m = opts.goalDelta.metric;
      goal = { metric: m, op: "<=", target: distOf(baseRes.samples.map((s) => metricValue(s, m))).p50 + opts.goalDelta.targetDelta };
    }
    const baselineRow = toRow("baseline", [], baseRes, goal, null);
    const out: PairedRow[] = [];
    for (const b of bundles) {
      try {
        const r = await run(bundleWorld(sw, b, now), goal);
        out.push(toRow(b.id, b.candidateIds, r, goal, baseRes));
      } catch (e) {
        if ((e as Error)?.name === "AbortError") throw e;
        // a bundle the compiler rejects: not scored, and the plan shrinks by its futures
        planned -= opts.n;
        progress(0);
        out.push({
          bundleId: b.id,
          candidateIds: b.candidateIds,
          costTier: bundleCostTier(b.candidateIds, tiers),
          futures: 0,
          error: e instanceof Error ? e.message : String(e),
          row: { p50S: NaN, p90S: NaN, pctWithin: NaN, isolatedCount: NaN, equityGapS: NaN },
          headlineMetric: baseRes.headlineMetric,
          headline: { p10: NaN, p50: NaN, p90: NaN },
          p50: { p10: NaN, p50: NaN, p90: NaN },
          p90: { p10: NaN, p50: NaN, p90: NaN },
          pGoal: null,
          worstIsolated: [],
          worstIsolatedCount: 0,
          vsBaseline: null,
        });
      }
    }
    return {
      lens: opts.lens,
      n: opts.n,
      seed: opts.seed,
      tod,
      closureProb,
      stress: applied,
      headlineMetric: baseRes.headlineMetric,
      goal,
      baseline: baselineRow,
      bundles: out,
      futuresTotal: completed,
      meta: { runner: detectRunner(), workers: workersUsed, ms: performance.now() - t0, snapshotId: this.info.id, model: baseRes.meta.model, variant },
    };
  }

  /** Shared abort/failure plumbing for fanned-out jobs: `stopped` rejects on abort or when `stop(err)` is called. */
  private stopper(jobId: string, workerCount: number, signal?: AbortSignal): { stop: (e: Error) => void; stopped: Promise<never>; dispose: () => void } {
    let stop: (err: Error) => void = () => {};
    const stopped = new Promise<never>((_, reject) => {
      stop = (err) => {
        for (let i = 0; i < workerCount; i++) void this.workers[i].api.cancel(jobId).catch(() => {});
        reject(err);
      };
    });
    stopped.catch(() => {});
    const onAbort = () => stop(abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
    return { stop, stopped, dispose: () => signal?.removeEventListener("abort", onAbort) };
  }

  async runFutures(world: WorldState, lens: LensId, opts: FuturesOptions, run: FuturesRunOptions = {}): Promise<FuturesResult> {
    this.live();
    validateFuturesOptions(lens, opts);
    if (run.signal?.aborted) throw abortError();
    const t0 = performance.now();
    const ranges = splitRange(opts.n, Math.min(this.workers.length, opts.n));
    const jobId = `job-${++jobSeq}`;
    const done = new Array<number>(ranges.length).fill(0);
    const report = () => run.onProgress?.(done.reduce((a, b) => a + b, 0), opts.n);

    let stop: (err: Error) => void = () => {};
    const stopped = new Promise<never>((_, reject) => {
      stop = (err) => {
        for (let i = 0; i < ranges.length; i++) void this.workers[i].api.cancel(jobId).catch(() => {});
        reject(err);
      };
    });
    stopped.catch(() => {}); // never an unhandled rejection if the run finishes first
    const onAbort = () => stop(abortError());
    run.signal?.addEventListener("abort", onAbort, { once: true });

    const calls = ranges.map(([s, e], i) => {
      // Progress messages travel on their own ports and may land after the result, so counts only move
      // forward, and a finished range counts as fully done (it returned every future it was asked for).
      const cb = (d: number) => {
        if (d > done[i]) {
          done[i] = d;
          report();
        }
      };
      const w = this.workers[i];
      return w.api.runFuturesRange(jobId, world, lens, opts, s, e, w.local ? cb : Comlink.proxy(cb)).then((part) => {
        cb(e - s);
        return part;
      });
    });
    // A failure in one range stops the others and surfaces its own error.
    for (const c of calls) c.catch((err) => stop(err instanceof Error ? err : new Error(String(err))));

    try {
      const partials: FuturesPartial[] = await Promise.race([Promise.all(calls), stopped]);
      return aggregateFutures(lens, partials, partials[0].hexField.length / (partials[0].end - partials[0].start), opts, {
        runner: detectRunner(),
        workers: ranges.length,
        ms: performance.now() - t0,
        snapshotId: this.info.id,
      });
    } finally {
      run.signal?.removeEventListener("abort", onAbort);
    }
  }

  async explain(world: WorldState, lens: LensId, hexIndex: number): Promise<CausalChain> {
    this.live();
    return this.workers[0].api.explain(world, lens, hexIndex);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const w of this.waiters.splice(0)) w.reject(new Error("pool has been disposed"));
    for (const w of this.workers) w.terminate();
  }
}

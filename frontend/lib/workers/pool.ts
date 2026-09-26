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
  CausalChain,
  FuturesOptions,
  FuturesPartial,
  FuturesResult,
  LensId,
  RunResult,
  WorldState,
} from "../sim/contract";
import { detectRunner, type SnapshotInfo } from "../sim/engine";
import type { XharborOptions } from "../sim/lenses/xharbor";
import { aggregateFutures, splitRange, validateFuturesOptions } from "../sim/futures";
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

export function defaultWorkerCount(hardwareConcurrency?: number, max = 4): number {
  const hc = hardwareConcurrency ?? (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined) ?? 2;
  return Math.max(1, Math.min(max, hc - 1));
}

function abortError(): Error {
  const e = new Error("computation cancelled");
  e.name = "AbortError";
  return e;
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

  private rr = 0;

  /**
   * Free-flow run on one worker (round-robin, so parallel calls for different lenses land on different
   * workers). `meta.workers` is 1; `xharbor` picks that lens's variant.
   */
  async runDeterministic(world: WorldState, lens: LensId, opts: RunOptions & { xharbor?: Partial<XharborOptions> } = {}): Promise<RunResult> {
    this.live();
    if (opts.signal?.aborted) throw abortError();
    const t0 = performance.now();
    const w = this.workers[this.rr++ % this.workers.length];
    const r = await w.api.runDeterministic(world, lens, opts.xharbor);
    // ms is the round trip the user waited for (worker compute + transfer)
    return { ...r, meta: { ...r.meta, ms: performance.now() - t0, workers: 1, runner: detectRunner() } };
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
      return aggregateFutures(lens, partials, this.info.hexCount, opts, {
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
    for (const w of this.workers) w.terminate();
  }
}

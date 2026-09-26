/**
 * The object a simulator worker exposes over Comlink. Kept free of `self` so tests can expose it on a
 * MessagePort and the main-thread fallback can call it directly.
 *
 * Cancellation: Comlink calls are messages, and a message is only handled when the worker yields. The engine
 * yields between futures (every few milliseconds), so `cancel(jobId)` takes effect at the next future
 * boundary. A cancelled range rejects with an AbortError.
 */
import * as Comlink from "comlink";
import type { CausalChain, FuturesOptions, FuturesPartial, LensId, RunResult, WorldState } from "../sim/contract";
import { SimEngine, type SnapshotInfo } from "../sim/engine";
import type { XharborOptions } from "../sim/lenses/xharbor";
import { fetchReader, type SnapshotReader } from "../sim/snapshot";

export interface WorkerApi {
  /** Fetch and parse the snapshot in this worker. */
  load(snapshotBaseUrl: string): Promise<SnapshotInfo>;
  /** `x` picks the xharbor variant (fast anchors by default, or exact). */
  runDeterministic(world: WorldState, lens: LensId, x?: Partial<XharborOptions>): Promise<RunResult>;
  /** Compute baselines and anchors now so the first real request is fast. Resolves when done. */
  warm(lenses?: LensId[]): Promise<void>;
  /** Futures [start, end) of a scenario. `onProgress` receives the count completed in this range. */
  runFuturesRange(
    jobId: string,
    world: WorldState,
    lens: LensId,
    opts: FuturesOptions,
    start: number,
    end: number,
    onProgress?: (done: number) => void,
  ): Promise<FuturesPartial>;
  explain(world: WorldState, lens: LensId, hexIndex: number): Promise<CausalChain>;
  cancel(jobId: string): Promise<void>;
}

export interface WorkerApiOptions {
  /** Override how snapshot files are read (tests). Default: fetch(baseUrl + file). */
  reader?: (baseUrl: string) => SnapshotReader;
  /** Wrap results for zero-copy transfer. Off for in-process use, where there is no message boundary. */
  transfer?: boolean;
}

export function createWorkerApi(options: WorkerApiOptions = {}): WorkerApi {
  let engine: SimEngine | null = null;
  let info: SnapshotInfo | null = null;
  const cancelled = new Set<string>();
  const need = (): SimEngine => {
    if (!engine) throw new Error("worker has no snapshot loaded; call load() first");
    return engine;
  };
  const xfer = options.transfer !== false;

  return {
    async load(baseUrl) {
      if (engine && info) return info;
      const read = options.reader ? options.reader(baseUrl) : fetchReader(baseUrl);
      engine = await SimEngine.fromReader(read);
      info = engine.info;
      return info;
    },

    async runDeterministic(world, lens, x) {
      const r = need().runDeterministic(world, lens, 1, x);
      if (!xfer) return r;
      const buffers: ArrayBuffer[] = [r.field.buffer as ArrayBuffer];
      for (const a of [r.added, r.jobsWithin, r.lossFrac]) if (a) buffers.push(a.buffer as ArrayBuffer);
      return Comlink.transfer(r, buffers);
    },

    async warm(lenses = ["ems", "access", "xharbor"]) {
      const e = need();
      const empty = { snapshotId: e.snap.id, mutations: [] };
      for (const l of lenses) {
        e.runDeterministic(empty, l);
        await Promise.resolve(); // let a queued request in between
      }
    },

    async runFuturesRange(jobId, world, lens, opts, start, end, onProgress) {
      try {
        const part = await need().runFuturesRange(world, lens, opts, start, end, {
          onProgress,
          isCancelled: () => cancelled.has(jobId),
        });
        if (!xfer) return part;
        const buffers: ArrayBuffer[] = [part.hexField.buffer as ArrayBuffer];
        if (part.hexAdded) buffers.push(part.hexAdded.buffer as ArrayBuffer);
        return Comlink.transfer(part, buffers);
      } finally {
        cancelled.delete(jobId);
      }
    },

    async explain(world, lens, hexIndex) {
      return need().explain(world, lens, hexIndex);
    },

    async cancel(jobId) {
      cancelled.add(jobId);
    },
  };
}

import * as Comlink from "comlink";
import { afterEach, describe, expect, it } from "vitest";
import type { FuturesOptions, WorldState } from "../../lib/sim/contract";
import { SimEngine } from "../../lib/sim/engine";
import { createWorkerApi, type WorkerApi } from "../../lib/workers/api";
import { defaultWorkerCount, SimPool, type WorkerFactory } from "../../lib/workers/pool";
import { buildHarbor, harborReader, HARBOR_ID, rec } from "./fixtures";

/**
 * The pool is exercised through the real Comlink protocol over Node MessageChannels (each "worker" is an
 * engine on the other end of a port, running the same createWorkerApi() the browser worker exposes).
 * A real browser Worker is not started here.
 */
const h = buildHarbor();
const w = (...m: ReturnType<typeof rec>[]): WorldState => ({ snapshotId: HARBOR_ID, mutations: m });
const closeBridge = rec("kb", { kind: "close_link", linkId: "L-KEYBRIDGE" });
const o = (n = 40, extra: Partial<FuturesOptions> = {}): FuturesOptions => ({ n, seed: 4242, tod: "am", closureProb: 0.25, ...extra });

const pools: SimPool[] = [];
function channelFactory(): WorkerFactory {
  return () => {
    const { port1, port2 } = new MessageChannel();
    Comlink.expose(createWorkerApi({ reader: () => harborReader(h) }), port1 as unknown as Comlink.Endpoint);
    const api = Comlink.wrap<WorkerApi>(port2 as unknown as Comlink.Endpoint);
    return {
      api: api as unknown as WorkerApi,
      local: false,
      terminate: () => {
        api[Comlink.releaseProxy]();
        port1.close();
        port2.close();
      },
    };
  };
}
async function pool(workers: number): Promise<SimPool> {
  const p = await SimPool.create({ baseUrl: "/snapshot/", hardwareConcurrency: workers + 1, workerFactory: channelFactory() });
  pools.push(p);
  return p;
}
afterEach(() => {
  while (pools.length) pools.pop()?.dispose();
});

describe("pool sizing", () => {
  it("min(4, hardwareConcurrency - 1), at least 1", () => {
    expect(defaultWorkerCount(1)).toBe(1);
    expect(defaultWorkerCount(2)).toBe(1);
    expect(defaultWorkerCount(4)).toBe(3);
    expect(defaultWorkerCount(8)).toBe(4);
    expect(defaultWorkerCount(64)).toBe(4);
    expect(defaultWorkerCount(64, 2)).toBe(2);
  });
});

describe("SimPool over Comlink", () => {
  it("loads the snapshot in every worker and exposes its info", async () => {
    const p = await pool(3);
    expect(p.workerCount).toBe(3);
    expect(p.info.id).toBe(HARBOR_ID);
    expect(p.info.hexCount).toBe(h.snap.hexes.count);
    expect(p.info.links.map((l) => l.id)).toContain("L-KEYBRIDGE");
  });

  it("runDeterministic returns a transferred field and honest meta", async () => {
    const p = await pool(2);
    const r = await p.runDeterministic(w(closeBridge), "access");
    const direct = (await SimEngine.fromReader(harborReader(h))).runDeterministic(w(closeBridge), "access");
    expect(Array.from(r.field)).toEqual(Array.from(direct.field));
    expect(Array.from(r.added as Float32Array)).toEqual(Array.from(direct.added as Float32Array));
    expect(r.metrics).toEqual(direct.metrics);
    expect(r.meta).toMatchObject({ lens: "access", workers: 1, snapshotId: HARBOR_ID, runner: "local-node" });
    expect(r.meta.ms).toBeGreaterThan(0);
  });

  it("futures are identical for 1, 2, 3 and 4 workers and match the in-process engine", async () => {
    const eng = await SimEngine.fromReader(harborReader(h)); // same files the workers read
    for (const lens of ["ems", "access", "xharbor"] as const) {
      const want = await eng.runFutures(w(closeBridge), lens, o(37));
      const norm = (r: typeof want) => JSON.stringify({ ...r, meta: { ...r.meta, ms: 0, workers: 0 }, hexP90: Array.from(r.hexP90), hexAddedP90: r.hexAddedP90 ? Array.from(r.hexAddedP90) : null });
      for (const n of [1, 2, 3, 4]) {
        const p = await pool(n);
        const got = await p.runFutures(w(closeBridge), lens, o(37));
        expect(got.meta.workers).toBe(n);
        expect(norm(got)).toBe(norm(want));
        p.dispose();
      }
    }
  });

  it("reports the real completed count, ending exactly at n", async () => {
    const p = await pool(4);
    const seen: [number, number][] = [];
    const r = await p.runFutures(w(closeBridge), "access", o(30), { onProgress: (d, t) => seen.push([d, t]) });
    expect(r.samples).toHaveLength(30);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(([, t]) => t === 30)).toBe(true);
    const counts = seen.map(([d]) => d);
    expect(counts[counts.length - 1]).toBe(30);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(Math.max(...counts)).toBeLessThanOrEqual(30);
  });

  it("more workers than futures uses only as many workers as there are futures", async () => {
    const p = await pool(4);
    const r = await p.runFutures(w(), "ems", o(2));
    expect(r.meta.workers).toBe(2);
    expect(r.samples).toHaveLength(2);
  });

  it("cancel: an AbortSignal rejects with AbortError, stops the workers, and the pool stays usable", async () => {
    const p = await pool(2);
    const ac = new AbortController();
    let last = 0;
    const run = p.runFutures(w(closeBridge), "access", o(5000), {
      signal: ac.signal,
      onProgress: (d) => {
        last = d;
        if (d >= 5) ac.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(last).toBeLessThan(5000);
    // pool still works and results are unaffected by the aborted job
    const again = await p.runFutures(w(closeBridge), "ems", o(10));
    expect(again.samples).toHaveLength(10);
  });

  it("an already-aborted signal rejects without starting work", async () => {
    const p = await pool(1);
    const ac = new AbortController();
    ac.abort();
    await expect(p.runFutures(w(), "ems", o(5), { signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(p.runDeterministic(w(), "ems", { signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("a bad world is rejected by the workers and surfaces as an error", async () => {
    const p = await pool(2);
    await expect(p.runFutures({ snapshotId: "nope", mutations: [] }, "ems", o(4))).rejects.toThrow(/snapshot/);
  });

  it("explain goes through the pool", async () => {
    const p = await pool(1);
    const c = await p.explain(w(closeBridge), "access", h.node(1, 2));
    expect(c.lostLinks).toEqual(["L-KEYBRIDGE"]);
  });

  it("dispose terminates workers and later calls fail loudly", async () => {
    const p = await pool(2);
    p.dispose();
    await expect(p.runFutures(w(), "ems", o(4))).rejects.toThrow(/disposed/);
  });

  it("creation fails cleanly when a worker cannot load the snapshot", async () => {
    const bad: WorkerFactory = () => {
      const { port1, port2 } = new MessageChannel();
      Comlink.expose(createWorkerApi({ reader: () => harborReader(h, {}, ["graph.bin"]) }), port1 as unknown as Comlink.Endpoint);
      const api = Comlink.wrap<WorkerApi>(port2 as unknown as Comlink.Endpoint);
      return { api: api as unknown as WorkerApi, local: false, terminate: () => { port1.close(); port2.close(); } };
    };
    await expect(SimPool.create({ baseUrl: "/x/", workerFactory: bad, hardwareConcurrency: 3 })).rejects.toThrow(/graph\.bin/);
  });
});

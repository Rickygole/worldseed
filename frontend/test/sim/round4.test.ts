/**
 * Round 4: cross-harbor explain, per-hex absolute/population terrain arrays, lens labels, populated-only
 * added-time maxima, cancellable deterministic runs.
 */
import * as Comlink from "comlink";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimulator } from "../../lib/sim";
import type { RunResult, WorldState } from "../../lib/sim/contract";
import { SimEngine } from "../../lib/sim/engine";
import { originMaskedHexes, MetricsWorkspace } from "../../lib/sim/metrics";
import { createRealSimulator } from "../../lib/sim/real";
import { SnapshotMissingError } from "../../lib/sim/snapshot";
import { fsReader } from "../../lib/sim/node";
import { createWorkerApi, type WorkerApi } from "../../lib/workers/api";
import { SimPool, type WorkerFactory, type WorkerLike } from "../../lib/workers/pool";
import { buildHarbor, harborReader, HARBOR_ID, rec } from "./fixtures";
import { SKIP_REASON, SNAPSHOT_DIR, snapshotExists } from "./snapshotPath";

const h = buildHarbor();
const hx = h.snap.hexes;
const eng = new SimEngine({ snapshot: h.snap, params: h.params });
const w = (...m: ReturnType<typeof rec>[]): WorldState => ({ snapshotId: HARBOR_ID, mutations: m });
const closeBridge = rec("kb", { kind: "close_link", linkId: "L-KEYBRIDGE" });

afterEach(() => vi.unstubAllGlobals());

describe("(3) lens labels", () => {
  it("the regional lens is 'Regional access'; cross-harbor keeps its own label", () => {
    expect(eng.lens("access").label).toBe("Regional access");
    expect(eng.lens("xharbor").label).toBe("Cross-harbor access");
    expect(eng.lens("ems").label).toBe("EMS response");
  });
});

describe("(1) explain: cross-harbor branch (fixture)", () => {
  const origin = h.node(1, 2); // west shore (shore 1), level with the bridge
  it("routes to an OPPOSITE-shore job cluster, names the lost link, and reports data only", () => {
    expect(hx.shore[origin]).toBe(1);
    const c = eng.explain(w(closeBridge), "xharbor", origin);
    expect(c.lens).toBe("xharbor");
    expect(c.focus.kind).toBe("destination");
    if (c.focus.kind !== "destination") return;
    expect(c.focus.id).toMatch(/^XH-0-\d+$/); // destination shore 0
    expect(c.focus.cluster?.shore).toBe(0);
    const anchorHex = hx.h3.indexOf(c.focus.cluster!.h3);
    expect(hx.shore[anchorHex]).toBe(0);
    expect(hx.lat[anchorHex]).toBeCloseTo(c.focus.cluster!.lat, 4);
    expect(c.focus.deltaS).toBeGreaterThan(0);
    expect(c.before.viaLinks).toContain("L-KEYBRIDGE");
    expect(c.after.viaLinks).not.toContain("L-KEYBRIDGE");
    expect(c.lostLinks).toEqual(["L-KEYBRIDGE"]);
    expect(c.routeChanged).toBe(true);
    expect(c.after.route.bridgeEdges).toBe(0);
    for (const r of [c.before.route, c.after.route]) {
      expect(r.nodes.length).toBe(r.edges.length + 1);
      r.edges.forEach((e, i) => {
        expect(h.snap.graph.edgeFrom[e]).toBe(r.nodes[i]);
        expect(h.snap.graph.edgeTo[e]).toBe(r.nodes[i + 1]);
      });
      expect(r.nodes[0]).toBe(hx.node[origin]); // origin -> destination order
    }
    // the destination end of both routes is the cluster anchor
    expect(c.after.route.nodes[c.after.route.nodes.length - 1]).toBe(c.before.route.nodes[c.before.route.nodes.length - 1]);
    // no numbers baked into text
    expect(/\d/.test(c.template)).toBe(false);
    expect(c.template).toMatch(/across the harbor/);
    expect(c.slots["before.via"]).toContain("Fixture Key Bridge");
    expect(c.slots.deltaMin).toMatch(/^\+\d+\.\d$/);
    expect(c.perDestination!.length).toBeGreaterThan(1);
    expect(c.perDestination!.length).toBeLessThanOrEqual(10);
    // ordered by the cluster's contribution to the hex's mean time change: share of jobs x growth
    const growth = c.perDestination!.map((d) => d.weight * (d.afterS - d.beforeS));
    for (let i = 1; i < growth.length; i++) expect(growth[i - 1]).toBeGreaterThanOrEqual(growth[i] - 1e-6);
  });

  it("before/after times, deltaS and jobs within 30 min agree with the exact lens values for that hex", () => {
    const base = eng.runDeterministic(w(), "xharbor", 1, { mode: "exact" });
    const cut = eng.runDeterministic(w(closeBridge), "xharbor", 1, { mode: "exact" });
    const c = eng.explain(w(closeBridge), "xharbor", origin);
    expect(c.before.timeS).toBeCloseTo(base.field[origin], 2);
    expect(c.after.timeS).toBeCloseTo(cut.field[origin], 2);
    expect(c.deltaS).toBeCloseTo(cut.added![origin], 2);
    expect(c.crossHarbor).toEqual({
      originShore: 1,
      jobsWithinBefore: base.jobsWithin![origin],
      jobsWithinAfter: cut.jobsWithin![origin],
      lossFrac: expect.closeTo(cut.lossFrac![origin], 5),
    });
  });

  it("unchanged world: same routes, zero delta, nothing lost", () => {
    const c = eng.explain(w(), "xharbor", origin);
    expect(c.routeChanged).toBe(false);
    expect(c.deltaS).toBe(0);
    expect(c.lostLinks).toEqual([]);
    expect(c.crossHarbor?.lossFrac).toBe(0);
    expect(c.template).toMatch(/unchanged/);
  });

  it("an ambiguous-shore hex is not an origin: explain says so; the other lenses are unaffected", () => {
    expect(hx.shore[0]).toBe(2);
    expect(() => eng.explain(w(closeBridge), "xharbor", 0)).toThrow(RangeError);
    expect(() => eng.explain(w(closeBridge), "xharbor", 0)).toThrow(/ambiguous shore/);
    expect(eng.explain(w(closeBridge), "access", h.node(1, 2)).lens).toBe("access");
  });

  it("east-shore origins route to west-shore clusters", () => {
    const east = h.node(10, 2);
    expect(hx.shore[east]).toBe(0);
    const c = eng.explain(w(closeBridge), "xharbor", east);
    expect(c.focus.kind === "destination" && c.focus.id).toMatch(/^XH-1-/);
  });
});

describe("(2) per-hex terrain arrays (fixture)", () => {
  it("run(): absolute before/after mean minutes, baseline jobs, residents, jobs located in the hex, populated flag", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const read = harborReader(h);
      try {
        const buf = await read(url.replace("/snapshot/", ""));
        return new Response(buf, { status: 200, headers: { "content-type": url.endsWith(".json") ? "application/json" : "application/octet-stream" } });
      } catch (e) {
        if (e instanceof SnapshotMissingError) return new Response("nf", { status: 404 });
        throw e;
      }
    });
    const sim = createSimulator();
    const world = await sim.loadWorld();
    const out = await sim.run(world, { removedLinks: ["key_bridge"] });
    const x = out.detail!.xharbor!;
    const n = world.cells.length;
    for (const a of [x.meanBeforeMin, x.meanAfterMin, x.baselineJobsWithin, x.residents, x.lowWageResidents, x.jobsHere, x.isPopulated, x.addedMin, x.lossFrac]) expect(a).toHaveLength(n);
    const base = eng.runDeterministic(w(), "xharbor");
    for (let i = 0; i < n; i++) {
      // residents / jobs are the snapshot's, per hex; also on the world cells
      expect(x.residents[i]).toBe(hx.pop[i]);
      expect(x.lowWageResidents[i]).toBe(hx.lowWage[i]);
      expect(x.jobsHere[i]).toBe(hx.jobs[i]);
      expect(world.cells[i].residents).toBe(hx.pop[i]);
      expect(world.cells[i].jobs).toBe(hx.jobs[i]);
      if (x.isOrigin[i] === 0) {
        expect(Number.isNaN(x.meanBeforeMin[i])).toBe(true);
        expect(Number.isNaN(x.meanAfterMin[i])).toBe(true);
        expect(x.isPopulated[i]).toBe(0);
        continue;
      }
      expect(x.meanBeforeMin[i]).toBeCloseTo(base.field[i] / 60, 4);
      expect(x.meanAfterMin[i] - x.meanBeforeMin[i]).toBeCloseTo(x.addedMin[i], 4);
      expect(x.baselineJobsWithin[i]).toBe(base.jobsWithin![i]);
      expect(x.isPopulated[i]).toBe(hx.pop[i] > 0 ? 1 : 0);
    }
    const industrial = h.node(3, 7);
    expect(x.isPopulated[industrial]).toBe(0);
    expect(x.residents[industrial]).toBe(0);
    expect(x.jobsHere[industrial]).toBe(500);
    // the baseline run's absolute means equal its "before" (added is zero)
    const b = await sim.run(world, { removedLinks: [] });
    for (let i = 0; i < n; i++) if (b.detail!.xharbor!.isOrigin[i]) expect(b.detail!.xharbor!.meanAfterMin[i]).toBe(b.detail!.xharbor!.meanBeforeMin[i]);
  });
});

describe("(4) populated-only added-time maxima", () => {
  it("toy: the unweighted max sits on an empty hex; the populated variants ignore it", () => {
    const n = 6;
    const f = (a: number[]) => Float32Array.from(a);
    const hexes = {
      count: n, h3: Array.from({ length: n }, (_, i) => `t${i}`), lat: new Float32Array(n), lng: new Float32Array(n), node: new Uint32Array(n),
      snapS: new Float32Array(n), pop: f([10, 10, 0, 10, 10, 10]), zvh: new Float32Array(n), lowWage: f([1, 1, 0, 1, 1, 1]), jobs: new Float32Array(n),
      bg: Uint16Array.from([0, 0, 0, 1, 1, 1]), shore: new Uint8Array(n),
    };
    const base = f([100, 100, 100, 100, 100, 100]);
    const mean = f([100, 110, 900, 130, 140, 150]); // hex 2 is empty and jumps by 800 s
    const jobs = f([1, 1, 1, 1, 1, 1]);
    const m = new MetricsWorkspace(originMaskedHexes(hexes)).xharbor(mean, jobs, base, jobs, { call_to_wheels_delay_min: 1, emsThresholdS: 480, accessCapS: 7200, accessAddedOkS: 300, accessCutoffS: 600 }).xharbor!;
    expect(m.addedMaxS).toBe(800);
    expect(m.addedMaxPopulatedS).toBe(50);
    expect(m.addedMaxPopulatedHex).toBe(5);
    expect(m.populatedHexes).toBe(5);
    // populated added = [0, 10, 30, 40, 50]; nearest-rank p99 of 5 = the largest
    expect(m.addedP99PopulatedS).toBe(50);
  });

  it("fixture: the industrial cell is excluded from the populated max but not from the legacy field", () => {
    // make the industrial cell (no residents) the worst-hit place by cutting every crossing near it
    const c = eng.runDeterministic(w(closeBridge, rec("t", { kind: "close_link", linkId: "L-HARBORTUNNEL" })), "xharbor").metrics.xharbor!;
    const industrial = h.node(3, 7);
    expect(c.addedMaxS).toBeGreaterThanOrEqual(c.addedMaxPopulatedS);
    expect(c.addedMaxPopulatedHex).not.toBe(industrial);
    expect(hx.pop[c.addedMaxPopulatedHex]).toBeGreaterThan(0);
    expect(c.populatedHexes).toBe([...Array(hx.count).keys()].filter((i) => hx.shore[i] < 2 && hx.pop[i] > 0).length);
    expect(c.addedP99PopulatedS).toBeLessThanOrEqual(c.addedMaxPopulatedS);
  });

  it("headline exposes both (minutes) and keeps addedMaxMin", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const read = harborReader(h);
      const buf = await read(url.replace("/snapshot/", ""));
      return new Response(buf, { status: 200, headers: { "content-type": url.endsWith(".json") ? "application/json" : "application/octet-stream" } });
    });
    const sim = createSimulator();
    const world = await sim.loadWorld();
    const hl = (await sim.run(world, { removedLinks: ["key_bridge"] })).detail!.xharbor!.headline;
    expect(hl.addedMaxMin).toBeGreaterThanOrEqual(hl.addedMaxPopulatedMin);
    expect(hl.addedMaxPopulatedMin).toBeGreaterThanOrEqual(hl.addedP99PopulatedMin);
    expect(hl.addedMaxPopulatedHex).toBeGreaterThanOrEqual(0);
    expect(hl.populatedHexes).toBeGreaterThan(0);
  });
});

// ---- (5) cancellable deterministic runs -------------------------------------------------------------------------------

function controllable() {
  const calls: { lens: string; resolve: (r: RunResult) => void }[] = [];
  const factory: WorkerFactory = () => {
    const inner = createWorkerApi({ transfer: false, reader: () => harborReader(h) });
    const api = {
      ...inner,
      runDeterministic: (world: WorldState, lens: string) =>
        new Promise<RunResult>((resolve) => calls.push({ lens, resolve: () => resolve(inner.runDeterministic(world, lens as never) as never) as never })),
    } as unknown as WorkerApi;
    return { api, terminate() {}, local: true } satisfies WorkerLike;
  };
  return { calls, factory };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

describe("(5) AbortSignal on deterministic runs", () => {
  it("pool: one worker, three lenses queued: aborting rejects immediately and the queued lenses are never sent", async () => {
    const { calls, factory } = controllable();
    const pool = await SimPool.create({ baseUrl: "x", workerFactory: factory, hardwareConcurrency: 2 });
    expect(pool.workerCount).toBe(1);
    const ac = new AbortController();
    const batch = pool.runDeterministicBatch(w(closeBridge), [{ lens: "xharbor" }, { lens: "access" }, { lens: "ems" }], { signal: ac.signal });
    const settled = batch.then(() => "ok", (e) => e.name);
    await tick();
    expect(calls).toHaveLength(1); // only the first lens has been handed to the worker
    ac.abort();
    expect(await settled).toBe("AbortError");
    await tick();
    expect(calls).toHaveLength(1); // the waiting lenses were dropped, not started later
    // the running lens finishes; the pool recovers and serves the next run
    calls[0].resolve(undefined as never);
    await tick();
    const next = pool.runDeterministic(w(), "ems");
    await tick();
    expect(calls).toHaveLength(2);
    calls[1].resolve(undefined as never);
    expect((await next).meta.lens).toBe("ems");
    pool.dispose();
  });

  it("pool: a run that is already computing rejects at once on abort (the result is dropped)", async () => {
    const { calls, factory } = controllable();
    const pool = await SimPool.create({ baseUrl: "x", workerFactory: factory, hardwareConcurrency: 4 });
    const ac = new AbortController();
    const p = pool.runDeterministic(w(closeBridge), "access", { signal: ac.signal });
    const settled = p.then(() => "ok", (e) => e.name);
    await tick();
    ac.abort();
    expect(await settled).toBe("AbortError");
    calls[0].resolve(undefined as never); // late result: must not throw or leak
    await tick();
    pool.dispose();
  });

  it("pool: pre-aborted signals reject without starting a run; disposing rejects waiters", async () => {
    const { calls, factory } = controllable();
    const pool = await SimPool.create({ baseUrl: "x", workerFactory: factory, hardwareConcurrency: 2 });
    const ac = new AbortController();
    ac.abort();
    await expect(pool.runDeterministic(w(), "ems", { signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(0);
    const first = pool.runDeterministic(w(), "ems");
    const queued = pool.runDeterministic(w(), "access");
    const queuedResult = queued.then(() => "ok", (e: Error) => e.message);
    await tick();
    pool.dispose();
    expect(await queuedResult).toMatch(/disposed/);
    void first.catch(() => {});
  });

  it("Simulator.run(): rejects with AbortError before starting, and mid-run stops starting the remaining lenses", async () => {
    const seen: string[] = [];
    const factory: WorkerFactory = () => {
      const { port1, port2 } = new MessageChannel();
      const inner = createWorkerApi({ reader: () => harborReader(h) });
      Comlink.expose({ ...inner, runDeterministic: (world: WorldState, lens: never, x: never) => { seen.push(lens as string); return inner.runDeterministic(world, lens, x); } }, port1 as unknown as Comlink.Endpoint);
      const api = Comlink.wrap<WorkerApi>(port2 as unknown as Comlink.Endpoint);
      return { api: api as unknown as WorkerApi, local: false, terminate: () => { port1.close(); port2.close(); } };
    };
    const sim = createRealSimulator({ reader: harborReader(h), pool: { workerFactory: factory, hardwareConcurrency: 2 } });
    const world = await sim.loadWorld();
    const pre = new AbortController();
    pre.abort();
    await expect(sim.run(world, { removedLinks: [] }, { signal: pre.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toHaveLength(0);
    const ac = new AbortController();
    const p = sim.run(world, { removedLinks: ["key_bridge"] }, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    await tick();
    expect(seen.length).toBeLessThan(3); // one worker: the queued lenses never started
    // a fresh, un-aborted run still works afterwards
    const ok = await sim.run(world, { removedLinks: ["key_bridge"] });
    expect(ok.detail?.lens).toBe("xharbor");
    sim.dispose();
  });
});

// ---- real snapshot ---------------------------------------------------------------------------------------------------

describe.skipIf(!snapshotExists)(`round 4 on the real snapshot${snapshotExists ? "" : ` [SKIPPED: ${SKIP_REASON}]`}`, () => {
  it("explain (bridge removed) for the worst populated hex routes to an opposite-shore job cluster, not a regional center, and matches golden", async () => {
    const real = await SimEngine.fromReader(fsReader(SNAPSHOT_DIR));
    const gold = JSON.parse(readFileSync(join(SNAPSHOT_DIR, "golden.json"), "utf8")).xharbor;
    const gb = gold.worlds.find((x: { id: string }) => x.id === "baseline");
    const gk = gold.worlds.find((x: { id: string }) => x.id === "keybridge_removed");
    const world: WorldState = { snapshotId: real.snap.id, mutations: [{ id: "kb", m: { kind: "close_link", linkId: "L-KEYBRIDGE" }, origin: "user", label: "Key Bridge", confirmedAt: "2026-09-26T00:00:00Z" }] };
    const run = real.runDeterministic(world, "xharbor");
    const m = run.metrics.xharbor!;
    const hex = m.addedMaxPopulatedHex;
    expect(real.snap.hexes.pop[hex]).toBeGreaterThan(0);
    const c = real.explain(world, "xharbor", hex);
    expect(c.focus.kind).toBe("destination");
    if (c.focus.kind !== "destination") return;
    expect(c.focus.id).toMatch(/^XH-[01]-\d+$/);
    expect(c.focus.id.startsWith("D-")).toBe(false); // not one of the 8 regional job centers
    const oShore = real.snap.hexes.shore[hex];
    expect(c.focus.cluster!.shore).toBe(1 - oShore);
    expect(real.snap.hexes.shore[real.snap.hexes.h3.indexOf(c.focus.cluster!.h3)]).toBe(1 - oShore);
    expect(c.lostLinks).toContain("L-KEYBRIDGE");
    expect(c.after.viaLinks).not.toContain("L-KEYBRIDGE");
    expect(c.routeChanged).toBe(true);
    expect(c.deltaS).toBeGreaterThan(60);
    // exact hex values equal golden's
    expect(Math.abs(c.before.timeS - gb.meanTimeS[hex])).toBeLessThan(0.5);
    expect(Math.abs(c.after.timeS - gk.meanTimeS[hex])).toBeLessThan(0.5);
    const within = (arr: number[], v: number) => {
      const b = (gk.boundary as [number, number, number][]).find((x) => x[0] === hex);
      return b ? v >= b[1] && v <= b[2] : v === arr[hex];
    };
    expect(within(gk.jobsWithin1800, c.crossHarbor!.jobsWithinAfter)).toBe(true);
    console.info(
      `explain worst populated hex ${hex} (${real.snap.hexes.h3[hex]}, ${real.snap.hexes.pop[hex].toFixed(0)} residents, added ${(c.deltaS / 60).toFixed(1)} min): ` +
        `to ${c.focus.name} near (${c.focus.cluster!.lat.toFixed(4)}, ${c.focus.cluster!.lng.toFixed(4)}); before via ${c.slots["before.via"]}, after via ${c.slots["after.via"]}; ` +
        `jobs within 30 min ${c.crossHarbor!.jobsWithinBefore} -> ${c.crossHarbor!.jobsWithinAfter}`,
    );
    // populated-only maximum vs the legacy unweighted one
    console.info(`addedMaxS ${(m.addedMaxS / 60).toFixed(1)} min (all hexes), addedMaxPopulatedS ${(m.addedMaxPopulatedS / 60).toFixed(1)} min, addedP99PopulatedS ${(m.addedP99PopulatedS / 60).toFixed(1)} min (${m.populatedHexes} populated hexes)`);
    expect(m.addedMaxS).toBeGreaterThanOrEqual(m.addedMaxPopulatedS);
  }, 60_000);
});

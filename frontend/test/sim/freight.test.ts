/**
 * Freight lens: hazmat cross-harbor detours as a search lens (deterministic, screening, futures, paired bundles).
 */
import * as Comlink from "comlink";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSimulator } from "../../lib/sim";
import { FREIGHT_LONG_DETOUR_S, FREIGHT_UNREACHABLE_ADDED_S, type BundleInput, type MutationRecord, type WorldState } from "../../lib/sim/contract";
import { SimEngine } from "../../lib/sim/engine";
import { freightAdded } from "../../lib/sim/lenses/freight";
import { quantileSortedRank } from "../../lib/sim/metrics";
import { fsReader } from "../../lib/sim/node";
import { loadSnapshot, SnapshotMissingError } from "../../lib/sim/snapshot";
import { bundleWorld, worldWithStress } from "../../lib/sim/stress";
import { createWorkerApi, type WorkerApi } from "../../lib/workers/api";
import { SimPool, type WorkerFactory } from "../../lib/workers/pool";
import { buildHarbor, harborReader, HARBOR_ID, rec } from "./fixtures";
import { SKIP_REASON, SNAPSHOT_DIR, snapshotExists } from "./snapshotPath";

const h = buildHarbor();
const closeBridge = rec("kb", { kind: "close_link", linkId: "L-KEYBRIDGE" });
const w0: WorldState = { snapshotId: HARBOR_ID, mutations: [] };
const w1: WorldState = { snapshotId: HARBOR_ID, mutations: [closeBridge] };
const B = (id: string, ...c: string[]): BundleInput => ({ id, candidateIds: c });
let eng: SimEngine;
beforeAll(async () => {
  eng = await SimEngine.fromReader(harborReader(h));
});
afterEach(() => vi.unstubAllGlobals());

const pools: SimPool[] = [];
async function pool(workers: number): Promise<SimPool> {
  const factory: WorkerFactory = () => {
    const { port1, port2 } = new MessageChannel();
    Comlink.expose(createWorkerApi({ reader: () => harborReader(h) }), port1 as unknown as Comlink.Endpoint);
    const api = Comlink.wrap<WorkerApi>(port2 as unknown as Comlink.Endpoint);
    return { api: api as unknown as WorkerApi, local: false, terminate: () => { port1.close(); port2.close(); } };
  };
  const p = await SimPool.create({ baseUrl: "x", workerFactory: factory, hardwareConcurrency: workers + 1 });
  pools.push(p);
  return p;
}
afterEach(() => {
  while (pools.length) pools.pop()?.dispose();
});

describe("freight added time and metrics (fixture)", () => {
  it("baseline: zero everywhere; the row is p50 0, p90 0, no long detours, equity gap not applicable", () => {
    const r = eng.runDeterministic(w0, "freight");
    const f = r.metrics.freight!;
    expect(f.tripIds).toEqual(["W1>E1", "E1>W1", "W1>E2", "E2>W1", "W2>E1", "E1>W2"]); // cross-harbor only, definition order
    expect(f.tripAddedS.every((x) => x === 0)).toBe(true);
    expect([r.metrics.p50S, r.metrics.p90S, r.metrics.isolatedBg.length, r.metrics.equityGapS, r.metrics.pctWithin]).toEqual([0, 0, 0, 0, 100]);
    expect(r.metrics.lens).toBe("freight");
    expect(f.vehicleClass).toBe("hazmat_truck");
    expect(f.longDetourS).toBe(300);
    expect(f.capS).toBe(7200);
  });

  it("no terrain: field, added and baselineField are per trip (length 6), not per hex; the meta says exact", () => {
    const r = eng.runDeterministic(w1, "freight");
    expect(r.field).toHaveLength(6);
    expect(r.added).toHaveLength(6);
    expect(r.baselineField).toHaveLength(6);
    expect(r.jobsWithin).toBeUndefined();
    expect(r.lossFrac).toBeUndefined();
    expect(r.meta.variant).toMatchObject({ mode: "standard", approximate: false });
    for (let i = 0; i < 6; i++) expect(r.added![i]).toBeCloseTo(r.field[i] - r.baselineField![i], 3);
  });

  it("agrees with runTrips: per-trip added seconds are the hazmat_truck addedMinutes x 60 of the cross-harbor trips", () => {
    for (const world of [w1, bundleWorld(w1, B("x", "HW-TUNNEL"))]) {
      const f = eng.runDeterministic(world, "freight").metrics.freight!;
      const t = eng.runTrips(world, { classes: ["hazmat_truck"] });
      f.tripIds.forEach((id, i) => {
        const trip = t.trips.find((x) => x.id === id)!;
        expect(f.tripAddedS[i]).toBeCloseTo((trip.classes.hazmat_truck.addedMinutes as number) * 60, 3);
      });
      expect(f.meanAddedS / 60).toBeCloseTo(t.summary.hazmat_truck.crossHarborMeanAddedMinutes, 6);
    }
  });

  it("row definitions: nearest-rank median and p90 over the 24 (here 6) trips, long detours are > 300 s, indices name the trips", () => {
    const r = eng.runDeterministic(w1, "freight");
    const f = r.metrics.freight!;
    const sorted = [...f.tripAddedS].sort((a, b) => a - b);
    expect(r.metrics.p50S).toBe(quantileSortedRank(sorted, 0.5));
    expect(r.metrics.p90S).toBe(quantileSortedRank(sorted, 0.9));
    const long = f.tripAddedS.map((x, i) => (x > FREIGHT_LONG_DETOUR_S ? i : -1)).filter((i) => i >= 0);
    expect(r.metrics.isolatedBg).toEqual(long);
    expect(r.metrics.pctWithin).toBeCloseTo((100 * (6 - long.length)) / 6, 9);
    expect(f.maxAddedS).toBe(sorted[5]);
    expect(f.worstTripId).toBe(f.tripIds[f.tripAddedS.indexOf(sorted[5])]);
    expect(r.metrics.equityGapS).toBe(0);
    expect(r.metrics.p90S).toBeGreaterThan(0);
  });

  it("no route counts as 7200 s added; a trip unreachable in the reference counts 0; signed values are kept", () => {
    expect(freightAdded(Infinity, 900)).toBe(FREIGHT_UNREACHABLE_ADDED_S);
    expect(freightAdded(Infinity, Infinity)).toBe(0);
    expect(freightAdded(900, Infinity)).toBe(0);
    expect(freightAdded(850, 900)).toBe(-50);
    const g = h.snap.graph;
    const cross: number[] = [];
    for (let e = 0; e < g.edgeCount; e++) if ((g.edgeFrom[e] % h.W < h.W / 2) !== (g.edgeTo[e] % h.W < h.W / 2)) cross.push(e);
    const r = eng.runDeterministic({ snapshotId: HARBOR_ID, mutations: [rec("all", { kind: "close_edges", edges: cross, label: "river" })] }, "freight");
    const f = r.metrics.freight!;
    expect(f.tripAddedS.every((x) => x === 7200)).toBe(true);
    expect(f.unreachableTrips).toBe(6);
    expect([r.metrics.p50S, r.metrics.p90S, r.metrics.isolatedBg.length]).toEqual([7200, 7200, 6]);
    expect(Array.from(r.field).every((x) => x === Infinity)).toBe(true);
    expect(Array.from(r.added!)).toEqual(Array(6).fill(7200));
  });

  it("hazmat windows change the hazmat rows: the tunnel opens, only the bore edges pay the delay; cars are not part of this lens", () => {
    const without = eng.runDeterministic(w1, "freight").metrics.freight!;
    const withWin = eng.runDeterministic(bundleWorld(w1, B("x", "HW-TUNNEL")), "freight").metrics.freight!;
    expect(withWin.meanAddedS).toBeLessThan(without.meanAddedS);
    // W1>E1 through the tunnel = the car's tunnel time + one 30 s window delay (fixture): added = car added + 30
    const car = eng.runTrips(w1, { classes: ["car"], tripIds: ["W1>E1"] }).trips[0].classes.car.addedMinutes as number;
    expect(withWin.tripAddedS[0]).toBeCloseTo(car * 60 + 30, 3);
    // with the bridge open the window changes nothing
    expect(eng.runDeterministic(bundleWorld(w0, B("x", "HW-TUNNEL")), "freight").metrics.freight!.tripAddedS.every((x) => x === 0)).toBe(true);
  });

  it("other candidate types: a speed factor on the tunnel corridor cannot help hazmat (the tunnel is banned) unless a window allows it", () => {
    const base = eng.runDeterministic(w1, "freight").metrics;
    const sp = eng.runDeterministic(bundleWorld(w1, B("x", "SP-TUNNEL")), "freight").metrics;
    expect(sp.freight!.tripAddedS).toEqual(base.freight!.tripAddedS);
    const both = eng.runDeterministic(bundleWorld(w1, B("x", "HW-TUNNEL", "SP-TUNNEL")), "freight").metrics.freight!;
    const win = eng.runDeterministic(bundleWorld(w1, B("x", "HW-TUNNEL")), "freight").metrics.freight!;
    expect(both.meanAddedS).toBeLessThan(win.meanAddedS); // faster tunnel travel, still paying the window delay
    // the temporary link is a plain edge pair: it can help hazmat (not flagged) and never hurts
    const tl = eng.runDeterministic(bundleWorld(w1, B("x", "TL-TEMP")), "freight").metrics.freight!;
    expect(tl.meanAddedS).toBeLessThanOrEqual(base.freight!.meanAddedS);
  });

  it("rejects explain (no hexes) and is unavailable when the snapshot has no trip definitions", async () => {
    expect(() => eng.explain(w1, "freight", 0)).toThrow(/no hexes/);
    const { snapshot, params } = await loadSnapshot(harborReader(h, {}, ["trips.json"]));
    const noTrips = new SimEngine({ snapshot, params });
    expect(() => noTrips.runDeterministic(w1, "freight")).toThrow(/needs trip definitions/);
    expect(noTrips.info.lenses.map((l) => l.id)).not.toContain("freight");
  });

  it("info().lenses lists freight with its display names", () => {
    const l = eng.info.lenses.find((x) => x.id === "freight")!;
    expect(l.hasTerrain).toBe(false);
    expect(l.measures.p50S).toBe("Typical hazmat cross-harbor detour");
    expect(l.measures.p90S).toBe("Slow-end hazmat detour");
    expect(l.measures.isolatedCount).toBe("Trips with long detours");
    expect(eng.info.lenses.map((x) => x.id)).toEqual(["xharbor", "access", "ems", "freight"]);
    for (const x of eng.info.lenses.filter((y) => y.id !== "freight")) expect(x.hasTerrain).toBe(true);
  });
});

describe("freight: screening many bundles", () => {
  const bundles = [B("E1", "TL-TEMP"), B("E2", "SP-TUNNEL"), B("E3", "HW-TUNNEL"), B("E4", "HW-TUNNEL", "SP-TUNNEL"), B("E5", "PP-SITE"), B("BAD", "NOPE")];

  it("equals one-at-a-time runs, in order; bad bundles are errors; identical for 1 and 3 workers", async () => {
    const a = await (await pool(1)).runDeterministicMany(w1, bundles, { lens: "freight" });
    const b = await (await pool(3)).runDeterministicMany(w1, bundles, { lens: "freight" });
    const strip = (r: typeof a) => JSON.stringify({ ...r, meta: null });
    expect(strip(a)).toBe(strip(b));
    expect(a.errors.map((e) => e.bundleId)).toEqual(["BAD"]);
    expect(a.rows.map((r) => r.bundleId)).toEqual(["E1", "E2", "E3", "E4", "E5"]);
    for (const row of a.rows) {
      const want = eng.runDeterministic(bundleWorld(w1, { id: row.bundleId, candidateIds: row.candidateIds }), "freight").metrics;
      expect(row.metrics).toEqual(want);
      expect([row.p50S, row.p90S, row.isolatedCount, row.equityGapS]).toEqual([want.p50S, want.p90S, want.isolatedBg.length, 0]);
    }
    expect(a.baseline.metrics.freight!.tripAddedS).toEqual(eng.runDeterministic(w1, "freight").metrics.freight!.tripAddedS);
    // the stressed baseline is the no-intervention world under the same stress
    const st = await (await pool(2)).runDeterministicMany(w1, [B("E3", "HW-TUNNEL")], { lens: "freight", stress: { closedLinks: ["L-HARBORTUNNEL"], label: "Harbor Tunnel closed" } });
    expect(st.baseline.metrics.freight!.tripAddedS).toEqual(eng.runDeterministic(worldWithStress(w1, { closedLinks: ["L-HARBORTUNNEL"], label: "x" }).world, "freight").metrics.freight!.tripAddedS);
  });

  it("cancels and reports real progress", async () => {
    const p = await pool(2);
    const many = Array.from({ length: 3000 }, (_, i) => B(`C${i}`, "HW-TUNNEL"));
    const ac = new AbortController();
    let last = 0;
    await expect(p.runDeterministicMany(w1, many, { lens: "freight", signal: ac.signal, onProgress: (d) => { last = d; if (d >= 10) ac.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
    expect(last).toBeLessThan(3000);
    const seen: number[] = [];
    await p.runDeterministicMany(w1, many.slice(0, 20), { lens: "freight", onProgress: (d) => seen.push(d) });
    expect(seen[seen.length - 1]).toBe(20);
  });
});

describe("freight in futures (fixture)", () => {
  const o = { n: 20, seed: 31, tod: "pm" as const, closureProb: 0.3 };

  it("futures run, are deterministic byte for byte, and carry per-trip arrays (no hexes)", async () => {
    const a = await eng.runFutures(w1, "freight", o);
    const b = await (await SimEngine.fromReader(harborReader(h))).runFutures(w1, "freight", o);
    expect(JSON.stringify(a.samples)).toBe(JSON.stringify(b.samples));
    expect(a.headlineMetric).toBe("p90S");
    expect(a.hexP90).toHaveLength(6); // per-trip p90 of the absolute hazmat time across futures
    expect(a.hexAddedP90).toHaveLength(6);
    expect(a.samples).toHaveLength(20);
    expect(a.samples.every((s) => s.freight?.tripAddedS.length === 6)).toBe(true);
    expect(a.meta.variant?.approximate).toBe(false);
  });

  it("added time is measured against the pre-collapse network under the SAME future: the baseline world is 0 in every future", async () => {
    const r = await eng.runFutures(w0, "freight", o);
    for (const s of r.samples) {
      expect(s.freight!.tripAddedS.every((x) => x === 0)).toBe(true);
      expect(s.p90S).toBe(0);
    }
  });

  it("congestion and random closures apply to the hazmat trips: futures differ from the deterministic row", async () => {
    const det = eng.runDeterministic(w1, "freight").metrics;
    const r = await eng.runFutures(w1, "freight", { ...o, closureProb: 0 });
    expect(r.samples.some((s) => s.p90S !== det.p90S)).toBe(true);
    // a closed Harbor Tunnel never matters to hazmat (already banned): closureProb on the fixture only has that eligible link
    const cl = await eng.runFutures(w1, "freight", { ...o, closureProb: 1, tod: "night" });
    const noCl = await eng.runFutures(w1, "freight", { ...o, closureProb: 0, tod: "night" });
    expect(JSON.stringify(cl.samples.map((s) => s.freight!.tripAddedS))).toBe(JSON.stringify(noCl.samples.map((s) => s.freight!.tripAddedS)));
  });

  it("hazmat windows change the rows inside futures: paired, every future no worse, most strictly better", async () => {
    const plain = await eng.runFutures(w1, "freight", { ...o, closureProb: 0 });
    const win = await eng.runFutures(bundleWorld(w1, B("x", "HW-TUNNEL")), "freight", { ...o, closureProb: 0 });
    let better = 0;
    for (let i = 0; i < 20; i++) {
      expect(win.samples[i].freight!.meanAddedS).toBeLessThanOrEqual(plain.samples[i].freight!.meanAddedS + 1e-6);
      if (win.samples[i].freight!.meanAddedS < plain.samples[i].freight!.meanAddedS - 1) better++;
    }
    expect(better).toBeGreaterThan(15);
  });

  it("paired bundles under a stress: real futures per row, progress, same draws (a no-effect bundle differs in no future), 1 vs 4 workers identical", async () => {
    const stress = { closedLinks: ["L-KEYBRIDGE"], tod: "midday", label: "Key Bridge closed during midday" };
    const opts = { lens: "freight" as const, n: 12, seed: 5, closureProb: 0.2, stress, keepSamples: true };
    const p4 = await pool(4);
    const seen: [number, number][] = [];
    const r = await p4.runBundlesPaired(w0, [B("HELP", "HW-TUNNEL"), B("NOOP", "SP-TUNNEL")], { ...opts, onProgress: (d, t) => seen.push([d, t]) });
    expect(r.tod).toBe("mid");
    expect([r.baseline.futures, ...r.bundles.map((b) => b.futures)]).toEqual([12, 12, 12]);
    expect(r.futuresTotal).toBe(36);
    expect(seen[seen.length - 1]).toEqual([36, 36]);
    expect(r.headlineMetric).toBe("p90S");
    expect(r.bundles[1].vsBaseline).toMatchObject({ headlineDelta: { p10: 0, p50: 0, p90: 0 }, pBetter: 0, pNoWorse: 1 });
    expect(r.bundles[0].vsBaseline!.pBetter).toBeGreaterThan(0.5);
    expect(r.bundles[0].row.equityGapS).toBe(0);
    const p1 = await pool(1);
    const r1 = await p1.runBundlesPaired(w0, [B("HELP", "HW-TUNNEL"), B("NOOP", "SP-TUNNEL")], { ...opts });
    const strip = (x: typeof r) => JSON.stringify({ ...x, meta: null });
    expect(strip(r1)).toBe(strip(r));
  });

  it("cancels a paired freight run", async () => {
    const p = await pool(2);
    const ac = new AbortController();
    await expect(p.runBundlesPaired(w1, Array.from({ length: 10 }, (_, i) => B(`B${i}`, "HW-TUNNEL")), { lens: "freight", n: 60, seed: 1, signal: ac.signal, onProgress: (d) => { if (d >= 30) ac.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects goal metrics that do not exist for the freight lens", async () => {
    await expect(eng.runFutures(w1, "freight", { ...o, headline: "addedP90S" })).rejects.toThrow(/not available/);
    const r = await eng.runFutures(w1, "freight", { ...o, goal: { metric: "isolatedCount", op: "<=", target: 1e6 } });
    expect(r.pGoal).toBe(1);
  });
});

describe("freight through the Simulator (fixture)", () => {
  it("run({lens: 'freight'}): no terrain (zeros, minutesKind none), freight metrics present; freight also rides along in detail.lenses", async () => {
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
    const out = await sim.run(world, { removedLinks: ["key_bridge"] }, { lens: "freight" });
    expect(out.minutes).toHaveLength(world.cells.length);
    expect(Math.max(...out.minutes)).toBe(0);
    expect(out.detail?.minutesKind).toBe("none");
    expect(out.detail?.metrics.freight?.tripIds).toHaveLength(6);
    expect(out.metrics.p50).toBeCloseTo((out.detail?.metrics.p50S as number) / 60, 9);
    expect(out.detail?.xharbor).toBeUndefined();
    const x = await sim.run(world, { removedLinks: ["key_bridge"] });
    expect(x.detail?.lenses.freight?.freight?.meanAddedS).toBeCloseTo(out.detail!.metrics.freight!.meanAddedS, 9);
    expect(sim.snapshotBacked!.info().lenses.some((l) => l.id === "freight")).toBe(true);
  });
});

// ---- real snapshot -----------------------------------------------------------------------------------------------------

describe.skipIf(!snapshotExists)(`freight lens on the real snapshot${snapshotExists ? "" : ` [SKIPPED: ${SKIP_REASON}]`}`, () => {
  interface GT { id: string; kind: string; results: Record<string, Record<string, { timeS: number | null }>> }
  let real: SimEngine;
  let gold: { trips: GT[] };
  const mk = (ids: string[], extra: MutationRecord[] = []): WorldState => ({ snapshotId: real.snap.id, mutations: [...ids.map((l, i) => rec(`m${i}`, { kind: "close_link", linkId: l })), ...extra] });
  beforeAll(async () => {
    real = await SimEngine.fromReader(fsReader(SNAPSHOT_DIR));
    gold = JSON.parse(readFileSync(join(SNAPSHOT_DIR, "golden.json"), "utf8")).trips;
  });

  const worlds: Record<string, string[]> = { baseline: [], keybridge_removed: ["L-KEYBRIDGE"], harbor_tunnel_closed: ["L-HARBORTUNNEL"], keybridge_and_harbor_tunnel_closed: ["L-KEYBRIDGE", "L-HARBORTUNNEL"] };

  it("GOLDEN: rows for the four golden worlds equal the trips golden (24 cross-harbor hazmat trips, added vs baseline)", () => {
    const cross = gold.trips.filter((t) => t.kind === "cross_harbor");
    expect(cross).toHaveLength(24);
    const table: string[] = [];
    for (const [wid, ids] of Object.entries(worlds)) {
      const r = real.runDeterministic(mk(ids), "freight");
      const f = r.metrics.freight!;
      expect(f.tripIds).toEqual(cross.map((t) => t.id));
      const want = cross.map((t) => (t.results.hazmat_truck[wid].timeS as number) - (t.results.hazmat_truck.baseline.timeS as number));
      want.forEach((x, i) => expect(Math.abs(f.tripAddedS[i] - x), `${wid} ${cross[i].id}`).toBeLessThanOrEqual(0.5));
      const sorted = [...want].sort((a, b) => a - b);
      expect(Math.abs(r.metrics.p50S - quantileSortedRank(sorted, 0.5))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(r.metrics.p90S - quantileSortedRank(sorted, 0.9))).toBeLessThanOrEqual(0.5);
      expect(r.metrics.isolatedBg.length).toBe(want.filter((x) => x > 300).length);
      expect(Math.abs(f.meanAddedS - want.reduce((a, b) => a + b, 0) / 24)).toBeLessThanOrEqual(0.5);
      expect(f.unreachableTrips).toBe(0);
      table.push(`${wid}: p50 +${(r.metrics.p50S / 60).toFixed(1)} min, p90 +${(r.metrics.p90S / 60).toFixed(1)} min, mean +${(f.meanAddedS / 60).toFixed(1)} min, long detours ${r.metrics.isolatedBg.length}/24, worst ${f.worstTripId} +${(f.maxAddedS / 60).toFixed(1)}`);
      if (wid === "baseline") expect(r.metrics.p90S).toBe(0);
      if (wid === "keybridge_removed") expect(f.meanAddedS / 60).toBeCloseTo(14.72, 1);
    }
    console.info(`freight lens, golden worlds (24 hazmat cross-harbor trips):\n  ${table.join("\n  ")}`);
  });

  it("CANDIDATE EFFECTS: every kept candidate under the freight lens equals the pipeline's freight reference in both contexts", () => {
    const eff = JSON.parse(readFileSync(join(SNAPSHOT_DIR, "candidate_effects.json"), "utf8")) as {
      tripIds: string[];
      candidates: { id: string; inBaseline: { metrics: { freight: Record<string, { savedS: number[] }> } }; inKeybridgeRemoved: { metrics: { freight: Record<string, { savedS: number[] }> } } }[];
    };
    const crossIdx = real.snap.trips!.trips.map((t, i) => (t.kind === "cross_harbor" ? i : -1)).filter((i) => i >= 0);
    expect(crossIdx).toHaveLength(24);
    let checked = 0;
    let worst = 0;
    const changes: string[] = [];
    for (const [ctx, ids, key] of [["baseline", [], "inBaseline"], ["keybridge_removed", ["L-KEYBRIDGE"], "inKeybridgeRemoved"]] as const) {
      const ctxRow = real.runDeterministic(mk([...ids]), "freight").metrics;
      for (const c of eff.candidates) {
        const row = real.runDeterministic(mk([...ids], [rec("c", { kind: "apply_candidate", candidateId: c.id })]), "freight").metrics;
        const saved = c[key].metrics.freight.hazmat_truck.savedS;
        // pre-collapse-based added of (ctx + candidate) = added(ctx) - saved(ctx -> ctx + candidate)
        const expected = ctxRow.freight!.tripAddedS.map((a, i) => a - saved[crossIdx[i]]);
        expected.forEach((x, i) => {
          worst = Math.max(worst, Math.abs(row.freight!.tripAddedS[i] - x));
          expect(Math.abs(row.freight!.tripAddedS[i] - x), `${c.id} ${ctx} ${eff.tripIds[crossIdx[i]]}`).toBeLessThanOrEqual(0.5);
        });
        const sorted = [...expected].sort((a, b) => a - b);
        expect(Math.abs(row.p50S - quantileSortedRank(sorted, 0.5)), `${c.id} ${ctx} p50`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(row.p90S - quantileSortedRank(sorted, 0.9)), `${c.id} ${ctx} p90`).toBeLessThanOrEqual(0.5);
        if (!expected.some((x) => Math.abs(x - 300) < 0.6)) expect(row.isolatedBg.length, `${c.id} ${ctx} long detours`).toBe(expected.filter((x) => x > 300).length);
        checked++;
        const changed = row.freight!.tripAddedS.some((x, i) => Math.abs(x - ctxRow.freight!.tripAddedS[i]) > 0.5);
        if (ctx === "keybridge_removed" && changed) changes.push(`${c.id} (p50 ${(ctxRow.p50S / 60).toFixed(1)}->${(row.p50S / 60).toFixed(1)}, p90 ${(ctxRow.p90S / 60).toFixed(1)}->${(row.p90S / 60).toFixed(1)}, long ${ctxRow.isolatedBg.length}->${row.isolatedBg.length})`);
        if (ctx === "baseline") {
          // with the network intact nothing hazmat does is longer than before the collapse; only speed-ups can move rows
          expect(row.freight!.tripAddedS.every((x) => x <= 0.5), `${c.id} baseline`).toBe(true);
        }
      }
    }
    expect(checked).toBe(32);
    console.info(`freight lens vs candidate_effects freight reference: ${checked} (candidate, context) rows, all 24 trips each, max deviation ${worst.toFixed(3)} s\nkept candidates that change the freight rows with the bridge removed:\n  ${changes.join("\n  ")}`);
    expect(changes.length).toBeGreaterThan(0);
  }, 120_000);

  it("windows and connectors: which options move the hazmat rows, and by how much", () => {
    const base = real.runDeterministic(mk(["L-KEYBRIDGE"]), "freight").metrics;
    const at = (id: string) => real.runDeterministic(mk(["L-KEYBRIDGE"], [rec("c", { kind: "apply_candidate", candidateId: id })]), "freight").metrics;
    const hw = at("HW-HARBOR-TUNNEL-ESCORT");
    const fm = at("HW-FORT-MCHENRY-ESCORT");
    expect(hw.p90S).toBeLessThan(base.p90S);
    expect(fm.p90S).toBeLessThanOrEqual(base.p90S);
    expect(hw.freight!.meanAddedS).toBeLessThan(fm.freight!.meanAddedS);
    // corridor speed factors on the tunnel corridors cannot help hazmat by themselves: the bores are banned for it
    for (const id of ["CP-HARBOR-TUNNEL-BORES", "CP-FORT-MCHENRY-TUNNEL-BORES", "CP-HARBOR-TUNNEL-APPROACHES"]) {
      const r = at(id);
      const helps = r.freight!.tripAddedS.some((x, i) => x < base.freight!.tripAddedS[i] - 0.5);
      console.info(`${id}: hazmat rows ${helps ? "change (approaches or portals are usable)" : "unchanged"}`);
    }
    // ... but with a window a faster bore does help
    const both = real.runDeterministic(mk(["L-KEYBRIDGE"], [rec("a", { kind: "apply_candidate", candidateId: "HW-HARBOR-TUNNEL-ESCORT" }), rec("b", { kind: "apply_candidate", candidateId: "CP-HARBOR-TUNNEL-BORES" })]), "freight").metrics;
    expect(both.freight!.meanAddedS).toBeLessThan(hw.freight!.meanAddedS);
    console.info(`bridge removed: none p90 +${(base.p90S / 60).toFixed(1)} min | Harbor Tunnel window +${(hw.p90S / 60).toFixed(1)} | Fort McHenry window +${(fm.p90S / 60).toFixed(1)} | window + faster bores +${(both.p90S / 60).toFixed(1)}`);
  });

  it("TIMING: screening 129 bundles, and 12 bundles x 24 futures, in Node (one thread)", async () => {
    const ids = real.snap.candidates.map((c) => c.id).sort();
    const bundles: BundleInput[] = [];
    for (let i = 0; i < ids.length; i++) bundles.push(B(`E${bundles.length + 1}`, ids[i]));
    for (let i = 0; i < ids.length && bundles.length < 129; i++) for (let j = i + 1; j < ids.length && bundles.length < 129; j++) bundles.push(B(`E${bundles.length + 1}`, ids[i], ids[j]));
    expect(bundles).toHaveLength(129);
    const kb = mk(["L-KEYBRIDGE"]);
    const t0 = performance.now();
    const rows = await real.runDeterministicMany(kb, bundles, "freight");
    const screen = performance.now() - t0;
    expect(rows.every((r) => r.metrics)).toBe(true);
    const t1 = performance.now();
    await real.runFutures(kb, "freight", { n: 24, seed: 3, tod: "am", closureProb: 0.1 });
    const oneScenario = performance.now() - t1;
    console.info(`freight, Node one thread: screen 129 bundles ${screen.toFixed(0)} ms (${(screen / 129).toFixed(1)} ms/bundle); one scenario x 24 futures ${oneScenario.toFixed(0)} ms (reference cold)`);
    expect(screen).toBeLessThan(15000);
  }, 120_000);
});

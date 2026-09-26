/**
 * Freight and hazmat point-to-point trips: fixture semantics, then the real snapshot against golden.json `trips`
 * and candidate_effects.json (freight metrics per class per trip).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Graph, MutationRecord, WorldState } from "../../lib/sim/contract";
import { DijkstraWorkspace } from "../../lib/sim/dijkstra";
import { SimEngine } from "../../lib/sim/engine";
import { fsReader } from "../../lib/sim/node";
import { loadSnapshot } from "../../lib/sim/snapshot";
import { buildHarbor, harborReader, HARBOR_ID, rec } from "./fixtures";
import { SKIP_REASON, SNAPSHOT_DIR, snapshotExists } from "./snapshotPath";

const h = buildHarbor();
const eng = new SimEngine({ snapshot: h.snap, params: h.params });
const w = (...m: MutationRecord[]): WorldState => ({ snapshotId: HARBOR_ID, mutations: m });
const closeBridge = rec("kb", { kind: "close_link", linkId: "L-KEYBRIDGE" });
const window = rec("hw", { kind: "apply_candidate", candidateId: "HW-TUNNEL" });

describe("trips: vehicle-class semantics (fixture)", () => {
  it("baseline: both classes use the short bridge; a same-shore control is identical for both", () => {
    const r = eng.runTrips(w());
    const t = r.trips.find((x) => x.id === "W1>E1")!;
    expect(t.classes.car.addedMinutes).toBe(0);
    expect(t.classes.car.baselineS).toBe(t.classes.hazmat_truck.baselineS);
    const c = r.trips.find((x) => x.id === "W1>W2")!;
    expect(c.classes.car.baselineS).toBe(c.classes.hazmat_truck.baselineS);
    expect(r.summary.car.crossHarborMeanAddedMinutes).toBe(0);
    expect(r.classes).toEqual(["car", "hazmat_truck"]);
  });

  it("bridge closed: a car falls back to the tunnel, a hazmat truck (tunnel prohibited) takes the long way; controls do not move", () => {
    const r = eng.runTrips(w(closeBridge), { includeRoutes: true });
    const t = r.trips.find((x) => x.id === "W1>E1")!;
    const car = t.classes.car;
    const hz = t.classes.hazmat_truck;
    expect(car.addedMinutes as number).toBeGreaterThan(0);
    expect(hz.addedMinutes as number).toBeGreaterThan(car.addedMinutes as number);
    expect(car.route!.viaLinks).toContain("L-HARBORTUNNEL");
    expect(hz.route!.viaLinks).not.toContain("L-HARBORTUNNEL");
    expect(hz.route!.bannedEdgesUsed).toBe(0);
    for (const e of hz.route!.edges) expect(h.snap.graph.edgeFlags[e] & h.snap.graph.flag.HAZMAT_PROHIBITED).toBe(0);
    expect(r.summary.hazmat_truck.sameShoreMaxAbsAddedMinutes).toBe(0);
    expect(r.summary.car.sameShoreMaxAbsAddedMinutes).toBe(0);
    expect(r.summary.hazmat_truck.crossHarborMeanAddedMinutes).toBeGreaterThan(r.summary.car.crossHarborMeanAddedMinutes);
  });

  it("times are node to node: exactly the Dijkstra distance, no snap time", () => {
    const g = h.snap.graph;
    const cw = eng.compileWorld(w(closeBridge));
    const dj = new DijkstraWorkspace(g);
    const t = h.snap.trips!.trips.find((x) => x.id === "W1>E1")!;
    const d = dj.run({ reverse: false, sources: [t.originNode], enabled: cw.edgeEnabled, costMul: cw.edgeCostMul })[t.destinationNode];
    expect(eng.runTrips(w(closeBridge)).trips.find((x) => x.id === "W1>E1")!.classes.car.currentS).toBe(d);
  });

  it("hazmat window: the tunnel opens for hazmat trucks, each bore edge pays the delay once, cars are unaffected", () => {
    const before = eng.runTrips(w(closeBridge));
    const after = eng.runTrips(w(closeBridge, window), { includeRoutes: true });
    const b = before.trips.find((x) => x.id === "W1>E1")!;
    const a = after.trips.find((x) => x.id === "W1>E1")!;
    expect(a.classes.car.currentS).toBe(b.classes.car.currentS);
    expect(a.classes.hazmat_truck.currentS as number).toBeLessThan(b.classes.hazmat_truck.currentS as number);
    expect(a.classes.hazmat_truck.route!.viaLinks).toContain("L-HARBORTUNNEL");
    expect(a.classes.hazmat_truck.route!.bannedEdgesUsed).toBe(0);
    // the same trip as a car through the same tunnel, plus exactly one 30 s penalty (the fixture window's delay)
    const carTunnel = a.classes.car.currentS as number;
    expect(a.classes.hazmat_truck.currentS as number).toBeCloseTo(carTunnel + 30, 3);
    // baseline (bridge open): the window changes nothing for anyone
    const open = eng.runTrips(w(window));
    for (const t of open.trips) for (const c of open.classes) expect(t.classes[c].addedMinutes).toBe(0);
  });

  it("closing both crossings makes the trip unreachable for hazmat, not null-crashing; summary counts it", () => {
    // fixture also has the slow detour crossing, so cut every crossing edge
    const g = h.snap.graph;
    const cross: number[] = [];
    for (let e = 0; e < g.edgeCount; e++) if ((g.edgeFrom[e] % h.W < h.W / 2) !== (g.edgeTo[e] % h.W < h.W / 2)) cross.push(e);
    const r = eng.runTrips(w(rec("all", { kind: "close_edges", edges: cross, label: "river" })));
    const t = r.trips.find((x) => x.id === "W1>E1")!;
    expect(t.classes.car.unreachable).toBe(true);
    expect(t.classes.car.currentS).toBeNull();
    expect(t.classes.car.addedMinutes).toBeNull();
    expect(t.classes.car.ratio).toBeNull();
    expect(t.classes.car.baselineMinutes).toBeGreaterThan(0);
    expect(r.summary.car.unreachableTrips).toBe(6);
    expect(r.summary.car.crossHarborMeanAddedMinutes).toBe(0);
    expect(r.trips.find((x) => x.id === "W1>W2")!.classes.car.unreachable).toBe(false);
  });

  it("options: classes and tripIds subset the result; unknown ids are rejected; deterministic", () => {
    const r = eng.runTrips(w(closeBridge), { classes: ["hazmat_truck"], tripIds: ["W1>E1", "E1>W1"] });
    expect(r.classes).toEqual(["hazmat_truck"]);
    expect(r.trips.map((t) => t.id)).toEqual(["W1>E1", "E1>W1"]);
    expect(Object.keys(r.trips[0].classes)).toEqual(["hazmat_truck"]);
    expect(() => eng.runTrips(w(), { classes: ["boat"] })).toThrow(/unknown vehicle class/);
    expect(() => eng.runTrips(w(), { tripIds: ["NOPE"] })).toThrow(/unknown trip/);
    const strip = (x: ReturnType<typeof eng.runTrips>) => JSON.stringify({ ...x, meta: null });
    expect(strip(eng.runTrips(w(closeBridge)))).toBe(strip(new SimEngine({ snapshot: h.snap, params: h.params }).runTrips(w(closeBridge))));
    // names, shores and coordinates travel with the result
    const t = eng.runTrips(w()).trips[0];
    expect(t.origin.name).toBe("Anchor W1");
    expect(t.names.destination).toBe("Anchor E1");
    expect(t.origin.lat).toBeGreaterThan(39);
  });

  it("a snapshot without trip definitions: runTrips says so; info().trips is null", async () => {
    const { snapshot, params } = await loadSnapshot(harborReader(h, {}, ["trips.json"]));
    const e = new SimEngine({ snapshot, params });
    expect(e.info.trips).toBeNull();
    expect(() => e.runTrips(w())).toThrow(/no trip definitions/);
  });

  it("the loader reads trips.json, validates it, and exposes anchors and vehicle classes via info()", async () => {
    expect(eng.info.trips?.anchors.map((a) => a.id)).toEqual(["W1", "W2", "E1", "E2"]);
    expect(eng.info.trips?.classes.hazmat_truck.removesFlag).toBe("HAZMAT_PROHIBITED");
    const bad = { anchors: h.snap.trips!.anchors, trips: [{ ...h.snap.trips!.trips[0], destination: "ZZ" }], classes: h.snap.trips!.classes };
    await expect(loadSnapshot(harborReader(h, { "trips.json": bad }))).rejects.toThrow(/unknown anchor/);
    const wrongKind = { anchors: h.snap.trips!.anchors, trips: [{ ...h.snap.trips!.trips[0], kind: "same_shore_control" }], classes: h.snap.trips!.classes };
    await expect(loadSnapshot(harborReader(h, { "trips.json": wrongKind }))).rejects.toThrow(/kind/);
    const badFlag = { anchors: h.snap.trips!.anchors, trips: h.snap.trips!.trips, classes: { car: { removesFlag: null }, x: { removesFlag: "NOPE" } } };
    await expect(loadSnapshot(harborReader(h, { "trips.json": badFlag }))).rejects.toThrow(/unknown flag/);
    await expect(loadSnapshot(harborReader(h, { "trips.json": { anchors: [], trips: [], classes: {} } }))).rejects.toThrow(/trips\.json/);
  });

  it("falls back to the trips key of golden.json when trips.json is absent (development snapshots)", async () => {
    const golden = { trips: { anchors: h.snap.trips!.anchors, trips: h.snap.trips!.trips, classes: h.snap.trips!.classes, results: "ignored" } };
    const { snapshot } = await loadSnapshot(harborReader(h, { "golden.json": golden }, ["trips.json"]));
    expect(snapshot.trips?.trips).toHaveLength(8);
  });
});

// ---- real snapshot -----------------------------------------------------------------------------------------------------

interface GoldenTrip {
  id: string;
  kind: string;
  results: Record<string, Record<string, { timeS: number | null; minutes: number | null; unreachable: boolean }>>;
}
const worldIds: Record<string, string[]> = {
  baseline: [],
  keybridge_removed: ["L-KEYBRIDGE"],
  harbor_tunnel_closed: ["L-HARBORTUNNEL"],
  keybridge_and_harbor_tunnel_closed: ["L-KEYBRIDGE", "L-HARBORTUNNEL"],
};

describe.skipIf(!snapshotExists)(`trips on the real snapshot${snapshotExists ? "" : ` [SKIPPED: ${SKIP_REASON}]`}`, () => {
  let real: SimEngine;
  let gold: { trips: GoldenTrip[]; anchors: { id: string; node: number; shore: number }[]; worlds: string[]; tolerance: { timeS: number } };
  const world = (ids: string[], extra: MutationRecord[] = []): WorldState => ({
    snapshotId: real.snap.id,
    mutations: [...ids.map((linkId, i) => rec(`m${i}`, { kind: "close_link", linkId })), ...extra],
  });
  beforeAll(async () => {
    real = await SimEngine.fromReader(fsReader(SNAPSHOT_DIR));
    gold = JSON.parse(readFileSync(join(SNAPSHOT_DIR, "golden.json"), "utf8")).trips;
  });

  it("the round-3 snapshot loads strictly: 40 assumptions (hazmat rule sourced with a URL), 16 candidates incl. hazmat windows", () => {
    const a = real.snap.assumptions;
    expect(a).toHaveLength(40);
    const rule = a.find((x) => x.id === "A-HAZMAT-TUNNELS")!;
    expect(rule.status).toBe("sourced");
    expect(rule.source).toMatch(/https:\/\/mdta\.maryland\.gov/);
    const pen = a.find((x) => x.id === "A-HAZMAT-ESCORT-PENALTY")!;
    expect([pen.value, pen.min, pen.max]).toEqual([300, 60, 900]);
    const windows = real.snap.candidates.filter((c) => c.type === "hazmat_window");
    expect(windows.map((c) => c.id).sort()).toEqual(["HW-FORT-MCHENRY-ESCORT", "HW-HARBOR-TUNNEL-ESCORT"]);
    for (const c of windows) {
      expect(c.lens).toEqual(["freight"]);
      const ef = c.effect;
      expect(ef.op).toBe("allow_class_on");
      if (ef.op === "allow_class_on") {
        expect(ef.vehicleClass).toBe("hazmat");
        expect(ef.timePenaltyS).toBe(300);
        expect(ef.penaltyEdges!.length).toBeGreaterThan(0);
        expect(ef.edges.length).toBeGreaterThanOrEqual(ef.penaltyEdges!.length); // portal stubs (if any) are allowed without a penalty
      }
    }
    expect(real.snap.candidates).toHaveLength(16);
  });

  it("trip definitions load from the snapshot (32 trips, 7 anchors, 2 classes) and match golden's anchors", () => {
    expect(real.info.trips?.trips).toHaveLength(32);
    expect(real.info.trips?.anchors.map((a) => [a.id, a.node, a.shore])).toEqual(gold.anchors.map((a) => [a.id, a.node, a.shore]));
    expect(Object.keys(real.info.trips!.classes)).toEqual(["car", "hazmat_truck"]);
    expect(gold.worlds).toEqual(Object.keys(worldIds));
    for (const a of real.info.trips!.anchors) expect(a.name.length).toBeGreaterThan(3);
  });

  for (const wid of Object.keys(worldIds)) {
    it(`GOLDEN ${wid}: every trip, both classes, within ${0.5} s (null = unreachable)`, () => {
      const r = real.runTrips(world(worldIds[wid]));
      let worst = 0;
      for (const gt of gold.trips) {
        const t = r.trips.find((x) => x.id === gt.id)!;
        expect(t.kind).toBe(gt.kind);
        for (const c of ["car", "hazmat_truck"]) {
          const want = gt.results[c][wid];
          const got = t.classes[c];
          if (want.timeS === null) {
            expect(got.unreachable, `${wid} ${gt.id} ${c}`).toBe(true);
            expect(got.currentS).toBeNull();
          } else {
            const d = Math.abs((got.currentS as number) - want.timeS);
            worst = Math.max(worst, d);
            expect(d, `${wid} ${gt.id} ${c}: ts ${got.currentS} golden ${want.timeS}`).toBeLessThanOrEqual(gold.tolerance.timeS);
            expect(Math.abs((got.currentMinutes as number) - (want.minutes as number))).toBeLessThan(0.01);
          }
        }
      }
      console.info(`trips ${wid}: 64 class-trips within tolerance, max |dt| ${worst.toFixed(4)} s, ${r.meta.ms.toFixed(0)} ms (includes the baseline the first time)`);
    });
  }

  it("same-shore controls do not change in any world; the baseline world adds nothing", () => {
    for (const wid of Object.keys(worldIds)) {
      const r = real.runTrips(world(worldIds[wid]));
      for (const c of r.classes) {
        expect(r.summary[c].sameShoreMaxAbsAddedMinutes, `${wid} ${c}`).toBeLessThan(1e-9);
        if (wid === "baseline") expect(r.summary[c].crossHarborMeanAddedMinutes).toBe(0);
      }
    }
  });

  it("bridge removed: hazmat trucks lose far more than cars (the tunnels are closed to them)", () => {
    const r = real.runTrips(world(["L-KEYBRIDGE"]));
    const car = r.summary.car;
    const hz = r.summary.hazmat_truck;
    expect(hz.crossHarborMeanAddedMinutes).toBeGreaterThan(car.crossHarborMeanAddedMinutes);
    expect(hz.crossHarborOver5Min).toBeGreaterThanOrEqual(car.crossHarborOver5Min);
    expect(hz.worstTripId).not.toBeNull();
    expect(r.summary.car.unreachableTrips + r.summary.hazmat_truck.unreachableTrips).toBe(0);
    console.info(`bridge removed, cross-harbor trips: car mean +${car.crossHarborMeanAddedMinutes.toFixed(1)} min (${car.crossHarborOver5Min}/${car.crossHarborTrips} over 5 min), hazmat mean +${hz.crossHarborMeanAddedMinutes.toFixed(1)} min (${hz.crossHarborOver5Min}/${hz.crossHarborTrips} over 5 min), worst hazmat ${hz.worstTripId} +${hz.worstAddedMinutes.toFixed(1)} min`);
  });

  it("HAZMAT ROUTING: Tradepoint -> Hawkins Point with the bridge removed crosses the western Beltway arc and uses no prohibited edge", () => {
    const g: Graph = real.snap.graph;
    const r = real.runTrips(world(["L-KEYBRIDGE"]), { includeRoutes: true, tripIds: ["TP>HP", "HP>TP"] });
    for (const t of r.trips) {
      const hz = t.classes.hazmat_truck;
      const car = t.classes.car;
      expect(hz.route, t.id).toBeDefined();
      expect(hz.route!.bannedEdgesUsed).toBe(0);
      for (const e of hz.route!.edges) expect(g.edgeFlags[e] & g.flag.HAZMAT_PROHIBITED, `${t.id} edge ${e}`).toBe(0);
      expect(hz.route!.viaLinks).not.toContain("L-HARBORTUNNEL");
      expect(hz.route!.viaLinks).not.toContain("L-FORTMCHENRY");
      expect(hz.route!.viaLinks).not.toContain("L-KEYBRIDGE");
      // it goes around the harbor on I-695: the route reaches well west of the tunnels and the removed bridge
      expect(hz.route!.viaCorridors).toContain("C-I695");
      const lons = hz.route!.nodes.map((n) => g.nodeLon[n]);
      const minLon = Math.min(...lons);
      expect(minLon, `${t.id} westernmost longitude`).toBeLessThan(-76.6);
      // a car takes a tunnel and is faster
      expect(car.route!.viaLinks.some((l) => l === "L-HARBORTUNNEL" || l === "L-FORTMCHENRY")).toBe(true);
      expect(car.currentS as number).toBeLessThan(hz.currentS as number);
      console.info(`${t.id} hazmat: ${(hz.currentMinutes as number).toFixed(1)} min via ${hz.route!.viaCorridors.join(", ")}, westernmost lon ${minLon.toFixed(3)}; car ${(car.currentMinutes as number).toFixed(1)} min via ${car.route!.viaLinks.join(", ")}`);
    }
    // sanity of the route walk itself: continuous and its length adds up
    const t = r.trips[0].classes.hazmat_truck.route!;
    t.edges.forEach((e, i) => {
      expect(g.edgeFrom[e]).toBe(t.nodes[i]);
      expect(g.edgeTo[e]).toBe(t.nodes[i + 1]);
    });
  });

  it("baseline hazmat trips never use a prohibited edge either, and equal cars where no tunnel is involved", () => {
    const r = real.runTrips(world([]), { includeRoutes: true });
    for (const t of r.trips) {
      expect(t.classes.hazmat_truck.route!.bannedEdgesUsed, t.id).toBe(0);
      expect(t.classes.hazmat_truck.baselineS as number).toBeGreaterThanOrEqual(t.classes.car.baselineS as number - 1e-9);
    }
  });

  it("run cost: 32 trips x 2 classes in a world is a few tens of ms once the baseline is cached", () => {
    const wd = world(["L-KEYBRIDGE"]);
    real.runTrips(wd);
    const t: number[] = [];
    for (let i = 0; i < 7; i++) t.push(real.runTrips(wd).meta.ms);
    t.sort((a, b) => a - b);
    console.info(`runTrips (32 trips, 2 classes, warm): median ${t[3].toFixed(0)} ms, min ${t[0].toFixed(0)}, max ${t[6].toFixed(0)}`);
    expect(t[3]).toBeLessThan(250);
  });

  it("CANDIDATE EFFECTS: reference trip minutes and freight savings for all 16 kept candidates in both contexts (0.5 s)", () => {
    const eff = JSON.parse(readFileSync(join(SNAPSHOT_DIR, "candidate_effects.json"), "utf8")) as {
      tripIds: string[];
      reference: Record<string, { tripMinutes: Record<string, number[]> }>;
      candidates: { id: string; inBaseline: { metrics: { freight: FreightRef } }; inKeybridgeRemoved: { metrics: { freight: FreightRef } } }[];
      pruned: { id: string }[];
    };
    type FreightRef = Record<string, { crossHarborMeanSavedS: number; maxSavedS: number; maxSavedTrip: string | null; tripsSaved60s: number; savedS: number[] }>;
    const tripDefs = real.snap.trips!.trips;
    expect(eff.tripIds).toEqual(tripDefs.map((t) => t.id));
    expect(eff.candidates).toHaveLength(16);
    // pruned catalog entries must not be referenced anywhere in the loaded catalog
    const kept = new Set(real.snap.candidates.map((c) => c.id));
    expect(kept.size).toBe(16);
    for (const p of eff.pruned) expect(kept.has(p.id), `pruned ${p.id} must not be in the catalog`).toBe(false);
    expect(new Set(eff.candidates.map((c) => c.id))).toEqual(kept);

    const secs = (wd: WorldState, cls: string) => {
      const r = real.runTrips(wd, { classes: [cls] });
      return tripDefs.map((t) => r.trips.find((x) => x.id === t.id)!.classes[cls].currentS as number);
    };
    let worst = 0;
    let checked = 0;
    for (const [ctxName, ids, key] of [["baseline", [], "inBaseline"], ["keybridge_removed", ["L-KEYBRIDGE"], "inKeybridgeRemoved"]] as const) {
      const refMin = eff.reference[ctxName].tripMinutes;
      for (const cls of ["car", "hazmat_truck"]) {
        const t0 = secs(world([...ids]), cls);
        t0.forEach((s, i) => {
          worst = Math.max(worst, Math.abs(s / 60 - refMin[cls][i]) * 60);
          expect(Math.abs(s / 60 - refMin[cls][i]) * 60, `${ctxName} ${cls} ${tripDefs[i].id} reference minutes`).toBeLessThanOrEqual(0.5);
        });
      }
      for (const c of eff.candidates) {
        const wd = world([...ids], [rec("cand", { kind: "apply_candidate", candidateId: c.id })]);
        const ref = c[key].metrics.freight;
        for (const cls of ["car", "hazmat_truck"]) {
          const t0 = secs(world([...ids]), cls);
          const t1 = secs(wd, cls);
          const saved = t0.map((s, i) => s - t1[i]);
          saved.forEach((s, i) => {
            worst = Math.max(worst, Math.abs(s - ref[cls].savedS[i]));
            expect(Math.abs(s - ref[cls].savedS[i]), `${c.id} ${ctxName} ${cls} ${tripDefs[i].id}: ts ${s} ref ${ref[cls].savedS[i]}`).toBeLessThanOrEqual(0.5);
          });
          const cross = tripDefs.map((t, i) => (t.kind === "cross_harbor" ? saved[i] : null)).filter((x): x is number => x !== null);
          expect(Math.abs(cross.reduce((a, b) => a + b, 0) / cross.length - ref[cls].crossHarborMeanSavedS), `${c.id} ${ctxName} ${cls} mean saved`).toBeLessThanOrEqual(0.5);
          const mx = Math.max(...saved);
          expect(Math.abs(mx - ref[cls].maxSavedS)).toBeLessThanOrEqual(0.5);
          if (ref[cls].maxSavedS > 1) expect(saved[tripDefs.findIndex((t) => t.id === ref[cls].maxSavedTrip)], `${c.id} ${ctxName} ${cls} maxSavedTrip`).toBeGreaterThanOrEqual(mx - 0.5);
          expect(saved.filter((s) => s >= 60 - 0.5).length, `${c.id} ${ctxName} ${cls} trips saved >= 60 s`).toBeGreaterThanOrEqual(ref[cls].tripsSaved60s);
          expect(saved.filter((s) => s >= 60 + 0.5).length).toBeLessThanOrEqual(ref[cls].tripsSaved60s);
          checked++;
        }
      }
    }
    console.info(`candidate_effects freight: ${checked} (candidate, context, class) combinations x 32 trips checked; max deviation ${worst.toFixed(3)} s`);
    expect(checked).toBe(16 * 2 * 2);
  }, 120_000);

  it("hazmat windows help hazmat trucks, never cars, and the Harbor Tunnel window is the stronger one when the bridge is gone", () => {
    const base = world(["L-KEYBRIDGE"]);
    const at = (id: string) => real.runTrips(world(["L-KEYBRIDGE"], [rec("c", { kind: "apply_candidate", candidateId: id })])).summary;
    const s0 = real.runTrips(base).summary;
    const hw = at("HW-HARBOR-TUNNEL-ESCORT");
    const fm = at("HW-FORT-MCHENRY-ESCORT");
    expect(hw.car.crossHarborMeanAddedMinutes).toBeCloseTo(s0.car.crossHarborMeanAddedMinutes, 9);
    expect(fm.car.crossHarborMeanAddedMinutes).toBeCloseTo(s0.car.crossHarborMeanAddedMinutes, 9);
    expect(hw.hazmat_truck.crossHarborMeanAddedMinutes).toBeLessThan(s0.hazmat_truck.crossHarborMeanAddedMinutes);
    expect(fm.hazmat_truck.crossHarborMeanAddedMinutes).toBeLessThan(s0.hazmat_truck.crossHarborMeanAddedMinutes);
    expect(hw.hazmat_truck.crossHarborMeanAddedMinutes).toBeLessThan(fm.hazmat_truck.crossHarborMeanAddedMinutes);
    console.info(`hazmat cross-harbor mean added (bridge removed): none +${s0.hazmat_truck.crossHarborMeanAddedMinutes.toFixed(2)} min, Harbor Tunnel window +${hw.hazmat_truck.crossHarborMeanAddedMinutes.toFixed(2)}, Fort McHenry window +${fm.hazmat_truck.crossHarborMeanAddedMinutes.toFixed(2)}`);
  });
});

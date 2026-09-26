import { describe, expect, it } from "vitest";
import type { LensId, WorldState } from "../../lib/sim/contract";
import { SimEngine } from "../../lib/sim/engine";
import { buildHarbor, HARBOR_ID, naiveDistances, rec } from "./fixtures";

const h = buildHarbor();
const eng = new SimEngine({ snapshot: h.snap, params: h.params });
const w = (...m: ReturnType<typeof rec>[]): WorldState => ({ snapshotId: HARBOR_ID, mutations: m });
const closeBridge = rec("kb", { kind: "close_link", linkId: "L-KEYBRIDGE" });
const g = h.snap.graph;
const allOn = (cw: { edgeEnabled: Uint8Array }) => cw.edgeEnabled;

function crossingEdges(): number[] {
  const half = h.W / 2;
  const out: number[] = [];
  for (let e = 0; e < g.edgeCount; e++) {
    if ((g.edgeFrom[e] % h.W < half) !== (g.edgeTo[e] % h.W < half)) out.push(e);
  }
  return out;
}

function edgeSpecs() {
  return Array.from({ length: g.edgeCount }, (_, e) => ({ from: g.edgeFrom[e], to: g.edgeTo[e], timeS: g.edgeTimeS[e] }));
}

describe("lens fields against a naive reference", () => {
  it("EMS: hexT = call_to_wheels + multi-source distance + snapS", () => {
    const cw = eng.compileWorld(w(closeBridge));
    const sources = h.snap.facilities.filter((_, i) => cw.sourceMask[i] === 1).map((f) => f.node);
    const dist = naiveDistances(g.nodeCount, edgeSpecs(), allOn(cw), cw.edgeCostMul, sources, sources.map(() => 0), false, Infinity);
    const got = eng.runDeterministic(w(closeBridge), "ems").field;
    for (let i = 0; i < h.snap.hexes.count; i++) {
      const want = 60 + dist[h.snap.hexes.node[i]] + h.snap.hexes.snapS[i];
      expect(got[i]).toBeCloseTo(want, 3);
    }
  });

  it("Access: job-weighted reverse distances, capped, plus snapS", () => {
    const cw = eng.compileWorld(w(closeBridge));
    const total = h.snap.destinations.reduce((s, d) => s + d.jobs, 0);
    const got = eng.runDeterministic(w(closeBridge), "access").field;
    const per = h.snap.destinations.map((d) => naiveDistances(g.nodeCount, edgeSpecs(), allOn(cw), cw.edgeCostMul, [d.node], [0], true, Infinity));
    for (let i = 0; i < h.snap.hexes.count; i++) {
      let acc = 0;
      h.snap.destinations.forEach((d, k) => (acc += (d.jobs / total) * Math.min(per[k][h.snap.hexes.node[i]], 7200)));
      expect(got[i]).toBeCloseTo(Math.min(7200, acc + h.snap.hexes.snapS[i]), 3);
    }
  });

  it("the EMS delay is a parameter, in minutes", () => {
    const slow = new SimEngine({ snapshot: h.snap, params: { ...h.params, call_to_wheels_delay_min: 3 } });
    const a = eng.runDeterministic(w(), "ems").field;
    const b = slow.runDeterministic(w(), "ems").field;
    for (let i = 0; i < a.length; i++) expect(b[i] - a[i]).toBeCloseTo(120, 3);
  });
});

describe("world changes move times the right way", () => {
  for (const lens of ["ems", "access"] as LensId[]) {
    it(`${lens}: closing a link never lowers any hex time, and raises some`, () => {
      const base = eng.runDeterministic(w(), lens).field;
      const closed = eng.runDeterministic(w(closeBridge), lens).field;
      let raised = 0;
      for (let i = 0; i < base.length; i++) {
        expect(closed[i]).toBeGreaterThanOrEqual(base[i]);
        if (closed[i] > base[i] + 1e-3) raised++;
      }
      expect(raised).toBeGreaterThan(0);
    });
  }

  it("reopening restores the baseline field byte for byte", () => {
    for (const lens of ["ems", "access"] as LensId[]) {
      const base = eng.runDeterministic(w(), lens).field;
      const back = eng.runDeterministic(w(closeBridge, rec("re", { kind: "open_link", linkId: "L-KEYBRIDGE" })), lens).field;
      expect(new Uint8Array(back.buffer)).toEqual(new Uint8Array(base.buffer));
    }
  });

  it("the baseline world has zero added time and 100 % within the threshold (Access)", () => {
    const r = eng.runDeterministic(w(), "access");
    expect(r.metrics.pctWithin).toBe(100);
    expect(r.metrics.isolatedBg).toEqual([]);
    expect(r.metrics.addedP90S).toBe(0);
    expect(r.metrics.equityGapS).toBe(0);
    expect(Math.max(...(r.added as Float32Array))).toBe(0);
  });

  it("bridge closed: Access added time > 0, and a temporary link wins some of it back", () => {
    const closed = eng.runDeterministic(w(closeBridge), "access");
    expect(closed.metrics.popAddedS as number).toBeGreaterThan(0);
    expect(closed.metrics.pctWithin).toBeLessThan(100);
    const fixed = eng.runDeterministic(w(closeBridge, rec("tl", { kind: "apply_candidate", candidateId: "TL-TEMP" })), "access");
    expect(fixed.metrics.popAddedS as number).toBeLessThan(closed.metrics.popAddedS as number);
    expect(fixed.metrics.addedP90S as number).toBeLessThanOrEqual(closed.metrics.addedP90S as number);
    // tunnel speed-up also helps
    const sp = eng.runDeterministic(w(closeBridge, rec("sp", { kind: "apply_candidate", candidateId: "SP-TUNNEL" })), "access");
    expect(sp.metrics.popAddedS as number).toBeLessThan(closed.metrics.popAddedS as number);
  });

  it("EMS: pre-positioned source and reactivated station lower times; deactivating stations makes far hexes unreachable", () => {
    const base = eng.runDeterministic(w(), "ems");
    const pp = eng.runDeterministic(w(rec("pp", { kind: "apply_candidate", candidateId: "PP-SITE" })), "ems");
    expect(pp.metrics.p50S).toBeLessThanOrEqual(base.metrics.p50S);
    const off = eng.runDeterministic(
      w(rec("a", { kind: "set_facility_active", facilityId: "F-EAST", active: false }), rec("b", { kind: "close_edges", edges: crossingEdges(), label: "river" })),
      "ems",
    );
    expect(off.metrics.unreachableHexes as number).toBeGreaterThan(0);
    expect(off.metrics.p90S).toBe(Infinity);
    expect(off.metrics.isolatedBg.length).toBeGreaterThan(0);
  });

  it("Access: with every crossing closed the cross-river hexes hit the cap", () => {
    const r = eng.runDeterministic(w(rec("all", { kind: "close_edges", edges: crossingEdges(), label: "river" })), "access");
    const westHex = h.node(1, 1);
    expect(r.field[westHex]).toBe(7200);
    expect(r.metrics.p90S).toBe(7200);
  });
});

describe("run results", () => {
  it("carry lens, runner, workers, elapsed ms, snapshot id and the applied mutations", () => {
    const r = eng.runDeterministic(w(closeBridge), "access");
    expect(r.meta.lens).toBe("access");
    expect(r.meta.runner).toBe("local-node"); // vitest runs in Node; the browser build reports local-browser
    expect(r.meta.workers).toBe(1);
    expect(r.meta.ms).toBeGreaterThan(0);
    expect(r.meta.snapshotId).toBe(HARBOR_ID);
    expect(r.applied.map((a) => a.mutationId)).toEqual(["kb"]);
    expect(r.field).toBeInstanceOf(Float32Array);
  });

  it("rejects a malformed or foreign world", () => {
    expect(() => eng.runDeterministic({ snapshotId: "x", mutations: [] }, "ems")).toThrow(/snapshot/);
    expect(() => eng.runDeterministic({ snapshotId: HARBOR_ID, mutations: [{ id: "a" } as never] }, "ems")).toThrow(/invalid world/);
  });
});

describe("explain", () => {
  const hex = h.node(1, 2); // west shore, level with the bridge
  it("Access: before used the bridge, after uses the tunnel; delta and lost link are reported as data", () => {
    const c = eng.explain(w(closeBridge), "access", hex);
    expect(c.before.viaLinks).toContain("L-KEYBRIDGE");
    expect(c.after.viaLinks).not.toContain("L-KEYBRIDGE");
    expect(c.after.viaLinks).toContain("L-HARBORTUNNEL");
    expect(c.lostLinks).toEqual(["L-KEYBRIDGE"]);
    expect(c.routeChanged).toBe(true);
    expect(c.deltaS).toBeGreaterThan(0);
    expect(c.after.timeS - c.before.timeS).toBeCloseTo(c.deltaS, 6);
    expect(c.perDestination).toHaveLength(2);
    expect(c.focus.kind).toBe("destination");
    expect(c.after.route.tunnelEdges).toBeGreaterThan(0);
    expect(c.before.route.bridgeEdges).toBeGreaterThan(0);
    // route continuity
    const r = c.after.route;
    expect(r.nodes.length).toBe(r.edges.length + 1);
    r.edges.forEach((e, i) => {
      expect(g.edgeFrom[e]).toBe(r.nodes[i]);
      expect(g.edgeTo[e]).toBe(r.nodes[i + 1]);
    });
    // the sentence is a template with slots: no digits are baked in
    expect(c.template).toMatch(/\{\{before\.via\}\}/);
    expect(/\d/.test(c.template)).toBe(false);
    expect(c.slots["after.via"]).toContain("Fixture Harbor Tunnel");
    expect(c.slots.deltaMin).toMatch(/^\+\d+\.\d$/);
  });

  it("no change in the world: same route, zero delta", () => {
    for (const lens of ["ems", "access"] as LensId[]) {
      const c = eng.explain(w(), lens, hex);
      expect(c.routeChanged).toBe(false);
      expect(c.deltaS).toBe(0);
      expect(c.lostLinks).toEqual([]);
    }
  });

  it("EMS: names the serving station and the route runs station -> hex", () => {
    const c = eng.explain(w(), "ems", h.node(3, 3));
    expect(c.focus.kind).toBe("station");
    if (c.focus.kind === "station") {
      expect(c.focus.facilityId).toBe("F-WEST");
      expect(c.after.route.nodes[0]).toBe(c.focus.node);
    }
    expect(c.after.route.nodes[c.after.route.nodes.length - 1]).toBe(h.node(3, 3));
  });

  it("validates the hex index", () => {
    expect(() => eng.explain(w(), "ems", -1)).toThrow(RangeError);
    expect(() => eng.explain(w(), "ems", 1e9)).toThrow(RangeError);
  });
});

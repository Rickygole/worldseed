import { describe, expect, it } from "vitest";
import { CompileError, compile, emptyWorld, isLinkClosed, worldStateSchema, type CompileContext } from "../../lib/sim/compile";
import type { CompiledWorld, WorldState } from "../../lib/sim/contract";
import { buildHarbor, HARBOR_ID, rec } from "./fixtures";

const h = buildHarbor();
const ctx: CompileContext = { id: h.snap.id, graph: h.snap.graph, facilities: h.snap.facilities, candidates: h.snap.candidates };
const world = (...mutations: ReturnType<typeof rec>[]): WorldState => ({ snapshotId: HARBOR_ID, mutations });
const same = (a: CompiledWorld, b: CompiledWorld) => {
  expect(Array.from(a.edgeEnabled)).toEqual(Array.from(b.edgeEnabled));
  expect(Array.from(a.edgeCostMul)).toEqual(Array.from(b.edgeCostMul));
  expect(Array.from(a.sourceMask)).toEqual(Array.from(b.sourceMask));
  expect(a.extraSources).toEqual(b.extraSources);
  expect(Array.from(a.corridorSigmaScale)).toEqual(Array.from(b.corridorSigmaScale));
  expect(Array.from(a.hazmatAllowed)).toEqual(Array.from(b.hazmatAllowed));
};

describe("compile: baseline", () => {
  it("disables CANDIDATE edges, leaves costs at 1, and sources = active fire/ems stations", () => {
    const cw = compile(emptyWorld(HARBOR_ID), ctx);
    h.candEdges.forEach((e) => expect(cw.edgeEnabled[e]).toBe(0));
    h.bridgeEdges.forEach((e) => expect(cw.edgeEnabled[e]).toBe(1));
    expect(cw.edgeCostMul.every((x) => x === 1)).toBe(true);
    // F-WEST, F-EAST are sources; F-HOSP is a hospital; F-EAST2 is inactive
    expect(Array.from(cw.sourceMask)).toEqual([1, 1, 0, 0]);
    expect(cw.extraSources).toEqual([]);
    expect(cw.applied).toEqual([]);
  });
});

describe("compile: mutation semantics", () => {
  it("close_link disables every edge of the link and only those", () => {
    const base = compile(emptyWorld(HARBOR_ID), ctx);
    const cw = compile(world(rec("m1", { kind: "close_link", linkId: "L-KEYBRIDGE" })), ctx);
    h.bridgeEdges.forEach((e) => expect(cw.edgeEnabled[e]).toBe(0));
    let diff = 0;
    for (let e = 0; e < cw.edgeEnabled.length; e++) if (cw.edgeEnabled[e] !== base.edgeEnabled[e]) diff++;
    expect(diff).toBe(h.bridgeEdges.length);
    expect(isLinkClosed(cw, h.snap.graph, "L-KEYBRIDGE")).toBe(true);
    expect(isLinkClosed(base, h.snap.graph, "L-KEYBRIDGE")).toBe(false);
    expect(cw.applied[0]).toMatchObject({ mutationId: "m1", kind: "close_link", edgesTouched: 2, origin: "user" });
  });

  it("closing and reopening restores the baseline arrays exactly, and so does dropping the mutation", () => {
    const base = compile(emptyWorld(HARBOR_ID), ctx);
    const closed = compile(world(rec("a", { kind: "close_link", linkId: "L-KEYBRIDGE" })), ctx);
    const reopened = compile(world(rec("a", { kind: "close_link", linkId: "L-KEYBRIDGE" }), rec("b", { kind: "open_link", linkId: "L-KEYBRIDGE" })), ctx);
    same(reopened, base);
    same(compile(world(), ctx), base);
    expect(closed.edgeEnabled).not.toEqual(base.edgeEnabled);
  });

  it("open_link enables a candidate link; last write wins in list order", () => {
    const open = compile(world(rec("o", { kind: "open_link", linkId: "L-TEMPLINK" })), ctx);
    h.candEdges.forEach((e) => expect(open.edgeEnabled[e]).toBe(1));
    const reclosed = compile(world(rec("o", { kind: "open_link", linkId: "L-TEMPLINK" }), rec("c", { kind: "close_link", linkId: "L-TEMPLINK" })), ctx);
    h.candEdges.forEach((e) => expect(reclosed.edgeEnabled[e]).toBe(0));
  });

  it("close_edges validates indices", () => {
    const cw = compile(world(rec("e", { kind: "close_edges", edges: [0, 1], label: "x" })), ctx);
    expect(cw.edgeEnabled[0]).toBe(0);
    expect(() => compile(world(rec("e", { kind: "close_edges", edges: [999999], label: "x" })), ctx)).toThrow(CompileError);
  });

  it("scale_corridor_speed divides edge time by the factor, only on that corridor, and compounds", () => {
    const one = compile(world(rec("s", { kind: "scale_corridor_speed", corridorId: "C-I895-TUNNEL", factor: 2 })), ctx);
    h.tunnelEdges.forEach((e) => expect(one.edgeCostMul[e]).toBe(0.5));
    expect(one.edgeCostMul[0]).toBe(1);
    const two = compile(world(rec("s", { kind: "scale_corridor_speed", corridorId: "C-I895-TUNNEL", factor: 2 }), rec("t", { kind: "scale_corridor_speed", corridorId: "C-I895-TUNNEL", factor: 1.25 })), ctx);
    h.tunnelEdges.forEach((e) => expect(two.edgeCostMul[e]).toBeCloseTo(0.4, 6));
    expect(() => compile(world(rec("s", { kind: "scale_corridor_speed", corridorId: "C-I895-TUNNEL", factor: 0 })), ctx)).toThrow(/positive/);
  });

  it("add_source and set_facility_active change the source set", () => {
    const cw = compile(
      world(
        rec("a", { kind: "add_source", node: 5, delayS: 30 }),
        rec("b", { kind: "set_facility_active", facilityId: "F-EAST2", active: true }),
        rec("c", { kind: "set_facility_active", facilityId: "F-WEST", active: false }),
        rec("d", { kind: "set_facility_active", facilityId: "F-HOSP", active: true }),
      ),
      ctx,
    );
    expect(cw.extraSources).toEqual([{ node: 5, delayS: 30 }]);
    expect(Array.from(cw.sourceMask)).toEqual([0, 1, 0, 1]); // hospital never becomes a source
    expect(() => compile(world(rec("x", { kind: "add_source", node: 99999 })), ctx)).toThrow(/out of range/);
    expect(() => compile(world(rec("x", { kind: "set_facility_active", facilityId: "F-NOPE", active: true })), ctx)).toThrow(/unknown facility/);
  });

  it("apply_candidate compiles each effect op", () => {
    const temp = compile(world(rec("1", { kind: "apply_candidate", candidateId: "TL-TEMP" })), ctx);
    h.candEdges.forEach((e) => expect(temp.edgeEnabled[e]).toBe(1));
    const sp = compile(world(rec("2", { kind: "apply_candidate", candidateId: "SP-TUNNEL" })), ctx);
    h.tunnelEdges.forEach((e) => expect(sp.edgeCostMul[e]).toBe(0.5));
    const pp = compile(world(rec("3", { kind: "apply_candidate", candidateId: "PP-SITE" })), ctx);
    expect(pp.extraSources).toEqual([{ node: h.node(h.W - 1, 4), delayS: 0 }]);
    const im = compile(world(rec("4", { kind: "apply_candidate", candidateId: "IM-TUNNEL" })), ctx);
    expect(im.corridorSigmaScale[0]).toBe(0.5);
  });

  it("apply_candidate rejects unknown ids and double application", () => {
    expect(() => compile(world(rec("1", { kind: "apply_candidate", candidateId: "NOPE" })), ctx)).toThrow(/unknown candidate/);
    expect(() =>
      compile(world(rec("1", { kind: "apply_candidate", candidateId: "TL-TEMP" }), rec("2", { kind: "apply_candidate", candidateId: "TL-TEMP" })), ctx),
    ).toThrow(/twice/);
  });

  it("is pure: compiling twice gives equal results and never mutates the input world", () => {
    const w = world(rec("a", { kind: "close_link", linkId: "L-KEYBRIDGE" }), rec("b", { kind: "apply_candidate", candidateId: "SP-TUNNEL" }));
    const snapshot = JSON.stringify(w);
    same(compile(w, ctx), compile(w, ctx));
    expect(JSON.stringify(w)).toBe(snapshot);
    // arrays are fresh: mutating one result does not leak into the next compile
    const a = compile(w, ctx);
    a.edgeEnabled.fill(0);
    expect(compile(w, ctx).edgeEnabled.some((x) => x === 1)).toBe(true);
  });
});

describe("compile: guards", () => {
  it("refuses an unconfirmed mutation", () => {
    expect(() => compile(world(rec("a", { kind: "close_link", linkId: "L-KEYBRIDGE" }, { confirmedAt: "" })), ctx)).toThrow(/not confirmed/);
    expect(() => compile(world(rec("a", { kind: "close_link", linkId: "L-KEYBRIDGE" }, { confirmedAt: "not a date" })), ctx)).toThrow(/not confirmed/);
  });

  it("requires provenance on tavily mutations and carries it through", () => {
    const m = { kind: "close_link", linkId: "L-KEYBRIDGE" } as const;
    expect(() => compile(world(rec("t", m, { origin: "tavily" })), ctx)).toThrow(/provenance/);
    const p = { url: "https://example.org/a", quote: "closed", retrievedAt: "2026-09-26T00:00:00Z" };
    const cw = compile(world(rec("t", m, { origin: "tavily", provenance: p })), ctx);
    expect(cw.applied[0].provenance).toEqual(p);
    expect(cw.applied[0].origin).toBe("tavily");
  });

  it("rejects duplicate ids, unknown links, and a world from another snapshot", () => {
    const m = { kind: "close_link", linkId: "L-KEYBRIDGE" } as const;
    expect(() => compile(world(rec("a", m), rec("a", m)), ctx)).toThrow(/duplicate/);
    expect(() => compile(world(rec("a", { kind: "close_link", linkId: "L-NOPE" })), ctx)).toThrow(/unknown link/);
    expect(() => compile({ snapshotId: "other", mutations: [] }, ctx)).toThrow(/snapshot/);
    try {
      compile(world(rec("zz", { kind: "close_link", linkId: "L-NOPE" })), ctx);
    } catch (e) {
      expect((e as CompileError).mutationId).toBe("zz");
    }
  });

  it("worldStateSchema rejects unknown keys and unknown kinds (untrusted agent input)", () => {
    const ok = world(rec("a", { kind: "close_link", linkId: "L-KEYBRIDGE" }));
    expect(worldStateSchema.safeParse(ok).success).toBe(true);
    expect(worldStateSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(worldStateSchema.safeParse(world(rec("a", { kind: "delete_everything" } as never))).success).toBe(false);
    expect(worldStateSchema.safeParse(world(rec("a", { kind: "close_link", linkId: "L", hax: 1 } as never))).success).toBe(false);
  });
});

describe("compile: candidateLinks (pipeline round 2 layout)", () => {
  const hc = buildHarbor(12, 8, "candidateLinks");
  const cctx: CompileContext = { id: hc.snap.id, graph: hc.snap.graph, facilities: hc.snap.facilities, candidates: hc.snap.candidates };
  it("baseline keeps them disabled; open_link enables exactly their edges; close_link disables them again", () => {
    const base = compile(emptyWorld(HARBOR_ID), cctx);
    hc.candEdges.forEach((e) => expect(base.edgeEnabled[e]).toBe(0));
    const open = compile({ snapshotId: HARBOR_ID, mutations: [rec("o", { kind: "open_link", linkId: "L-TEMPLINK" })] }, cctx);
    const changed = [...open.edgeEnabled.keys()].filter((e) => open.edgeEnabled[e] !== base.edgeEnabled[e]);
    expect(changed).toEqual(hc.candEdges);
    const closed = compile({ snapshotId: HARBOR_ID, mutations: [rec("o", { kind: "open_link", linkId: "L-TEMPLINK" }), rec("c", { kind: "close_link", linkId: "L-TEMPLINK" })] }, cctx);
    same(closed, base);
  });
  it("explain names a candidate link on the route when it is used", async () => {
    const { SimEngine } = await import("../../lib/sim/engine");
    const eng = new SimEngine({ snapshot: hc.snap, params: hc.params });
    const w = { snapshotId: HARBOR_ID, mutations: [rec("kb", { kind: "close_link", linkId: "L-KEYBRIDGE" }), rec("t", { kind: "apply_candidate", candidateId: "TL-TEMP" })] };
    const c = eng.explain(w, "access", hc.node(1, 4));
    expect(c.after.viaLinks).toContain("L-TEMPLINK");
  });
});

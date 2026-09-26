/**
 * Candidate edges on the real graph: appended after the real edges, flagged CANDIDATE, disabled in the
 * baseline, and enabled by exactly the mutations that name them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compile, emptyWorld, type CompileContext } from "../../lib/sim/compile";
import type { CompiledWorld, Mutation, MutationRecord } from "../../lib/sim/contract";
import { SimEngine } from "../../lib/sim/engine";
import { fsReader } from "../../lib/sim/node";
import { SKIP_REASON, SNAPSHOT_DIR, snapshotExists } from "./snapshotPath";

const at = "2026-09-26T00:00:00Z";
const rec = (id: string, m: Mutation): MutationRecord => ({ id, m, origin: "user", label: id, confirmedAt: at });

describe.skipIf(!snapshotExists)(`candidate edges on the real graph${snapshotExists ? "" : ` [SKIPPED: ${SKIP_REASON}]`}`, () => {
  let engine: SimEngine;
  let ctx: CompileContext;
  let base: CompiledWorld;
  let flagged: number[];
  const golden = () => JSON.parse(readFileSync(join(SNAPSHOT_DIR, "golden.json"), "utf8"));

  beforeAll(async () => {
    engine = await SimEngine.fromReader(fsReader(SNAPSHOT_DIR));
    const s = engine.snap;
    ctx = { id: s.id, graph: s.graph, facilities: s.facilities, candidates: s.candidates };
    base = compile(emptyWorld(s.id), ctx);
    flagged = [];
    for (let e = 0; e < s.graph.edgeCount; e++) if ((s.graph.edgeFlags[e] & s.graph.flag.CANDIDATE) !== 0) flagged.push(e);
  });

  const diff = (cw: CompiledWorld): number[] => {
    const out: number[] = [];
    for (let e = 0; e < cw.edgeEnabled.length; e++) if (cw.edgeEnabled[e] !== base.edgeEnabled[e]) out.push(e);
    return out;
  };

  it("layout: candidate edges are appended after the real ones, class 'candidate', flag 16, and are exactly the candidateLinks edges", () => {
    const g = engine.snap.graph;
    const cls = g.meta.classes.indexOf("candidate");
    expect(g.flag.CANDIDATE).toBe(16);
    expect(cls).toBe(8);
    const nCand = flagged.length;
    expect(nCand).toBe(6); // round 3: 3 kept temporary links x 2 directions
    expect(g.edgeCount).toBe(81443);
    expect(flagged[0]).toBe(g.edgeCount - nCand);
    expect(flagged).toEqual(Array.from({ length: nCand }, (_, i) => g.edgeCount - nCand + i));
    for (const e of flagged) expect(g.edgeClass[e]).toBe(cls);
    for (let e = 0; e < g.edgeCount - flagged.length; e++) expect(g.edgeClass[e]).not.toBe(cls);
    const fromLinks = g.links.filter((l) => l.candidate).flatMap((l) => l.edges).sort((a, b) => a - b);
    expect(fromLinks).toEqual(flagged);
    expect(g.links.filter((l) => l.candidate)).toHaveLength(3);
    for (const l of g.links.filter((x) => x.candidate)) expect(l.edges).toHaveLength(2);
  });

  it("baseline disables every CANDIDATE edge and enables every other edge", () => {
    const g = engine.snap.graph;
    for (let e = 0; e < g.edgeCount; e++) {
      const isCand = (g.edgeFlags[e] & g.flag.CANDIDATE) !== 0;
      expect(base.edgeEnabled[e], `edge ${e}`).toBe(isCand ? 0 : 1);
    }
    expect(base.edgeCostMul.every((x) => x === 1)).toBe(true);
  });

  it("Key Bridge and tunnel edge lists are unchanged (equal the golden disabledEdges) and are not candidates", () => {
    const g = engine.snap.graph;
    const gw = golden().worlds;
    const disabled = (id: string) => gw.find((w: { id: string }) => w.id === id).disabledEdges as number[];
    expect(g.links[g.linkIndex.get("L-KEYBRIDGE") as number].edges.slice().sort((a, b) => a - b)).toEqual(disabled("keybridge_removed"));
    expect(g.links[g.linkIndex.get("L-HARBORTUNNEL") as number].edges.slice().sort((a, b) => a - b)).toEqual(disabled("harbor_tunnel_closed"));
    expect(g.links[g.linkIndex.get("L-FORTMCHENRY") as number].edges.slice().sort((a, b) => a - b)).toEqual(disabled("fort_mchenry_closed"));
    expect(disabled("keybridge_removed")).toEqual([35500, 58242, 80052, 80053, 80054, 80055]);
    for (const id of ["L-KEYBRIDGE", "L-HARBORTUNNEL", "L-FORTMCHENRY"]) {
      for (const e of g.links[g.linkIndex.get(id) as number].edges) expect(g.edgeFlags[e] & g.flag.CANDIDATE).toBe(0);
    }
  });

  it("open_link on each candidate link enables exactly that link's two edges", () => {
    const g = engine.snap.graph;
    for (const l of g.links.filter((x) => x.candidate)) {
      const d = diff(compile({ snapshotId: engine.snap.id, mutations: [rec("o", { kind: "open_link", linkId: l.id })] }, ctx));
      expect(d, l.id).toEqual(l.edges.slice().sort((a, b) => a - b));
      for (const e of d) expect(base.edgeEnabled[e]).toBe(0);
    }
  });

  it("apply_candidate enables exactly the right edges, cost factor or source for all 16 kept candidates", () => {
    const g = engine.snap.graph;
    let enable = 0;
    let speed = 0;
    let source = 0;
    let hazmat = 0;
    for (const c of engine.snap.candidates) {
      const cw = compile({ snapshotId: engine.snap.id, mutations: [rec("a", { kind: "apply_candidate", candidateId: c.id })] }, ctx);
      const ef = c.effect;
      if (ef.op === "enable_edges") {
        enable++;
        expect(diff(cw), c.id).toEqual(ef.edges.slice().sort((a, b) => a - b));
        for (const e of ef.edges) expect(g.edgeFlags[e] & g.flag.CANDIDATE, `${c.id} edge ${e}`).not.toBe(0);
        expect(cw.edgeCostMul.every((x) => x === 1)).toBe(true);
        expect(cw.extraSources).toEqual([]);
        // the same edges are what a candidate link of the same name opens
        const link = g.links.find((l) => l.id === c.id || l.edges.join() === ef.edges.join());
        expect(link?.candidate, `${c.id} maps to a candidate link`).toBe(true);
        // shuttles carry HAZMAT_PROHIBITED as well (a hazmat vehicle cannot ride a shuttle); connectors do not
        const prohibited = ef.edges.every((e) => (g.edgeFlags[e] & g.flag.HAZMAT_PROHIBITED) !== 0);
        expect(prohibited, c.id).toBe(c.id.startsWith("TL-SHUTTLE"));
      } else if (ef.op === "corridor_speed") {
        speed++;
        expect(diff(cw), c.id).toEqual([]);
        const ci = g.corridorIndex.get(ef.corridor) as number;
        let n = 0;
        for (let e = 0; e < g.edgeCount; e++) {
          if (g.edgeCorridor[e] === ci) {
            n++;
            expect(cw.edgeCostMul[e]).toBeCloseTo(1 / ef.factor, 6);
          } else expect(cw.edgeCostMul[e]).toBe(1);
        }
        expect(n).toBeGreaterThan(0);
      } else if (ef.op === "allow_class_on") {
        hazmat++;
        // cars: nothing changes. hazmat: every listed edge is allowed, only the penalty edges pay the delay
        expect(diff(cw), c.id).toEqual([]);
        expect(cw.edgeCostMul.every((x) => x === 1)).toBe(true);
        const allowed = [...cw.hazmatAllowed.keys()].filter((e) => cw.hazmatAllowed[e] === 1);
        expect(allowed, c.id).toEqual(ef.edges.slice().sort((a, b) => a - b));
        const paying = [...cw.hazmatPenaltyS.keys()].filter((e) => cw.hazmatPenaltyS[e] > 0);
        expect(paying, c.id).toEqual((ef.penaltyEdges ?? ef.edges).slice().sort((a, b) => a - b));
        for (const e of paying) expect(cw.hazmatPenaltyS[e]).toBe(ef.timePenaltyS);
        for (const e of ef.penaltyEdges ?? []) expect(ef.edges).toContain(e);
      } else if (ef.op === "add_source") {
        source++;
        expect(diff(cw), c.id).toEqual([]);
        expect(cw.extraSources).toEqual([{ node: ef.facilityLike.node, delayS: ef.delayS ?? 0 }]);
      }
    }
    expect(enable + speed + source + hazmat).toBe(engine.snap.candidates.length);
    expect(engine.snap.candidates).toHaveLength(16);
    expect([enable, speed, source, hazmat]).toEqual([3, 8, 3, 2]);
  });

  it("closing then reopening the Key Bridge restores the baseline exactly; opening a candidate never touches real edges", () => {
    const kb = rec("c", { kind: "close_link", linkId: "L-KEYBRIDGE" });
    const re = rec("r", { kind: "open_link", linkId: "L-KEYBRIDGE" });
    expect(diff(compile({ snapshotId: engine.snap.id, mutations: [kb, re] }, ctx))).toEqual([]);
    expect(diff(compile({ snapshotId: engine.snap.id, mutations: [kb] }, ctx))).toEqual([35500, 58242, 80052, 80053, 80054, 80055]);
  });
});

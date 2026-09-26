/**
 * xharbor on the real snapshot against golden.json's `xharbor` key.
 *
 *  EXACT     must match: meanTimeS within 0.5 s per hex; jobsWithin1800 equal to the golden count except for the
 *            hexes in each world's `boundary` list, where any value in [lo, hi] is accepted; every metric
 *            within the tolerance below.
 *  FAST      accuracy against golden for the two headline worlds, with stated tolerances (see FAST_TOL).
 *
 * Skipped, with the reason printed, when data/snapshot is absent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { WorldState, XharborMetrics } from "../../lib/sim/contract";
import { SimEngine } from "../../lib/sim/engine";
import { fsReader } from "../../lib/sim/node";
import { SKIP_REASON, SNAPSHOT_DIR, snapshotExists } from "./snapshotPath";

interface GoldenWorld {
  id: string;
  jobsWithin1800: (number | null)[];
  meanTimeS: (number | null)[];
  boundary: [number, number, number][];
  metrics: XharborMetrics & Record<string, unknown>;
}
interface GoldenXharbor {
  worlds: GoldenWorld[];
  worstBlockGroups: Record<string, { byLossPct: { geoid: string }[]; byAddedS: { geoid: string }[] }>;
}

const ids: Record<string, string[]> = {
  baseline: [],
  keybridge_removed: ["L-KEYBRIDGE"],
  harbor_tunnel_closed: ["L-HARBORTUNNEL"],
  keybridge_and_harbor_tunnel_closed: ["L-KEYBRIDGE", "L-HARBORTUNNEL"],
  fort_mchenry_closed: ["L-FORTMCHENRY"],
  keybridge_and_fort_mchenry_closed: ["L-KEYBRIDGE", "L-FORTMCHENRY"],
};

/**
 * Exact-mode metrics: relative 1e-4, or absolute 0.01 (a time metric of a fraction of a second is limited by
 * the float32 hex fields, ~1e-4 s, and by golden's 0.01 s rounding of the per-hex means it was built from).
 */
const EXACT_REL = 1e-4;
const EXACT_ABS = 0.01;

/**
 * Stated tolerances for the fast variant at the default anchor count, as relative error of the headline
 * aggregates versus golden (see the printed table for every K).
 */
export const FAST_TOL = {
  // Means and quantiles: within 5 percent. Threshold-count statistics are noisier (they count people whose
  // loss sits near the cut): within 10 percent for >10 percent losers, 20 percent for >25 percent losers.
  popMeanAddedS: 0.05,
  addedP90S: 0.05,
  popMeanLossPct: 0.05,
  popLossGt10pct: 0.1,
  lowWageLossGt10pct: 0.1,
  popLossGt25pct: 0.2,
  meanAbsMeanTimeS: 3,
  maxAbsMeanTimeS: 10,
  minTop10Overlap: 8,
};

const world = (eng: SimEngine, linkIds: string[]): WorldState => ({
  snapshotId: eng.snap.id,
  mutations: linkIds.map((linkId, i) => ({ id: `g${i}`, m: { kind: "close_link" as const, linkId }, origin: "user" as const, label: linkId, confirmedAt: "2026-09-26T00:00:00Z" })),
});

const rel = (got: number, want: number) => (want === 0 ? Math.abs(got) : Math.abs(got - want) / Math.abs(want));

describe.skipIf(!snapshotExists)(`xharbor vs golden.json${snapshotExists ? "" : ` [SKIPPED: ${SKIP_REASON}]`}`, () => {
  let eng: SimEngine;
  let gold: GoldenXharbor;
  beforeAll(async () => {
    eng = await SimEngine.fromReader(fsReader(SNAPSHOT_DIR));
    gold = JSON.parse(readFileSync(join(SNAPSHOT_DIR, "golden.json"), "utf8")).xharbor;
  });

  it("golden.xharbor has the six worlds and per-hex arrays of the right length", () => {
    expect(gold.worlds.map((w) => w.id)).toEqual(Object.keys(ids));
    for (const w of gold.worlds) {
      expect(w.jobsWithin1800).toHaveLength(eng.snap.hexes.count);
      expect(w.meanTimeS).toHaveLength(eng.snap.hexes.count);
    }
  });

  for (const id of Object.keys(ids)) {
    it(`EXACT ${id}: per-hex mean within 0.5 s, jobs exact outside the boundary list, metrics match`, () => {
      const gw = gold.worlds.find((w) => w.id === id) as GoldenWorld;
      const t0 = performance.now();
      const r = eng.runDeterministic(world(eng, ids[id]), "xharbor", 1, { mode: "exact" });
      const ms = performance.now() - t0;
      const bound = new Map(gw.boundary.map(([h, lo, hi]) => [h, [lo, hi]]));
      let maxMean = 0;
      let boundaryHits = 0;
      for (let h = 0; h < eng.snap.hexes.count; h++) {
        const gm = gw.meanTimeS[h];
        const gj = gw.jobsWithin1800[h];
        if (gm === null) {
          expect(Number.isNaN(r.field[h]), `hex ${h} should not be an origin`).toBe(true);
          continue;
        }
        maxMean = Math.max(maxMean, Math.abs(r.field[h] - gm));
        expect(Math.abs(r.field[h] - gm), `${id} hex ${h} meanTimeS ts ${r.field[h]} golden ${gm}`).toBeLessThanOrEqual(0.5);
        const b = bound.get(h);
        if (b) {
          boundaryHits++;
          expect(r.jobsWithin![h], `${id} hex ${h} jobs ${r.jobsWithin![h]} not in [${b[0]}, ${b[1]}]`).toBeGreaterThanOrEqual(b[0]);
          expect(r.jobsWithin![h]).toBeLessThanOrEqual(b[1]);
        } else {
          expect(r.jobsWithin![h], `${id} hex ${h} jobsWithin1800`).toBe(gj);
        }
      }
      const got = r.metrics.xharbor as XharborMetrics;
      let worstRel = 0;
      for (const [k, want] of Object.entries(gw.metrics)) {
        if (typeof want !== "number") continue;
        const v = (got as unknown as Record<string, number>)[k];
        expect(typeof v, `metric ${k}`).toBe("number");
        const okAbs = Math.abs(v - want) <= EXACT_ABS;
        if (!okAbs) worstRel = Math.max(worstRel, rel(v, want));
        expect(okAbs || rel(v, want) <= EXACT_REL, `${id} metric ${k}: ts ${v} golden ${want}`).toBe(true);
      }
      console.info(`xharbor exact ${id}: ${(ms / 1000).toFixed(1)} s, max |dmean| ${maxMean.toFixed(4)} s, ${boundaryHits} boundary hexes checked as ranges, worst metric rel err ${worstRel.toExponential(1)}`);
    }, 300_000);
  }

  it("EXACT worst-hit block groups reproduce golden's rankings (bridge removed, bridge + Harbor Tunnel)", () => {
    for (const wid of Object.keys(gold.worstBlockGroups)) {
      const r = eng.runDeterministic(world(eng, ids[wid]), "xharbor", 1, { mode: "exact" });
      const w = r.metrics.xharbor!.worst!;
      const g = gold.worstBlockGroups[wid];
      expect(w.byLossPct.map((x) => x.geoid), `${wid} byLossPct`).toEqual(g.byLossPct.map((x) => x.geoid));
      // byAddedS has exact ties (block groups sharing hexes' routes); float32 noise reorders them, so compare values and sets
      expect(new Set(w.byAddedS.map((x) => x.geoid)), `${wid} byAddedS set`).toEqual(new Set(g.byAddedS.map((x) => x.geoid)));
      w.byAddedS.forEach((x, i) => expect(Math.abs(x.meanAddedS - (g.byAddedS[i] as unknown as { meanAddedS: number }).meanAddedS), `${wid} byAddedS[${i}]`).toBeLessThan(0.05));
      w.byLossPct.forEach((x, i) => expect(Math.abs(x.meanLossPct - (g.byLossPct[i] as unknown as { meanLossPct: number }).meanLossPct), `${wid} byLossPct[${i}]`).toBeLessThan(0.01));
    }
  }, 300_000);

  describe("FAST anchors (default variant)", () => {
    const table: string[] = [];
    for (const wid of ["keybridge_removed", "keybridge_and_harbor_tunnel_closed"]) {
      it(`${wid}: headline aggregates and per-hex error within the stated tolerance`, () => {
        const gw = gold.worlds.find((w) => w.id === wid) as GoldenWorld;
        const gb = gold.worlds.find((w) => w.id === "baseline") as GoldenWorld;
        const gm = gw.metrics;
        const top = gold.worstBlockGroups[wid].byLossPct.map((x) => x.geoid);
        const n = eng.snap.hexes.count;
        for (const K of [32, 64, 96, 128]) {
          const t0 = performance.now();
          const r = eng.runDeterministic(world(eng, ids[wid]), "xharbor", 1, { mode: "fast", anchorsPerShore: K });
          const first = performance.now() - t0;
          const t1 = performance.now();
          eng.runDeterministic(world(eng, ids[wid]), "xharbor", 1, { mode: "fast", anchorsPerShore: K });
          const warm = performance.now() - t1;
          let cnt = 0, sMean = 0, maxMean = 0, sJ = 0, sAdd = 0, sLoss = 0;
          for (let h = 0; h < n; h++) {
            const m0 = gw.meanTimeS[h];
            if (m0 === null) continue;
            cnt++;
            const e = Math.abs(r.field[h] - m0);
            sMean += e;
            maxMean = Math.max(maxMean, e);
            sJ += Math.abs(r.jobsWithin![h] - (gw.jobsWithin1800[h] as number));
            sAdd += Math.abs(r.added![h] - (m0 - (gb.meanTimeS[h] as number)));
            const b0 = gb.jobsWithin1800[h] as number;
            const gl = b0 > 0 ? (b0 - (gw.jobsWithin1800[h] as number)) / b0 : 0;
            sLoss += Math.abs(r.lossFrac![h] - gl);
          }
          const a = r.metrics.xharbor as XharborMetrics;
          const topK = a.worst!.byLossPct.map((x) => x.geoid);
          const overlap = topK.filter((x) => x !== null && top.includes(x)).length;
          const pc = (x: number, y: number) => `${x.toFixed(x > 1000 ? 0 : 2)} (${(100 * (x / y - 1)).toFixed(1)}%)`;
          table.push(
            `${wid} K=${K}/shore (${2 * K} anchors) first ${first.toFixed(0)} ms warm ${warm.toFixed(0)} ms | per-hex |mean err| avg ${(sMean / cnt).toFixed(1)} s max ${maxMean.toFixed(0)} s; |added err| avg ${(sAdd / cnt).toFixed(1)} s; |jobs30 err| avg ${(sJ / cnt).toFixed(0)}; |loss err| avg ${((100 * sLoss) / cnt).toFixed(2)} pp | meanAdded ${pc(a.popMeanAddedS, gm.popMeanAddedS)} | addedP90 ${pc(a.addedP90S, gm.addedP90S)} | meanLoss% ${pc(a.popMeanLossPct, gm.popMeanLossPct)} | pop>10% ${pc(a.popLossGt10pct, gm.popLossGt10pct)} | pop>25% ${pc(a.popLossGt25pct, gm.popLossGt25pct)} | lw>10% ${pc(a.lowWageLossGt10pct, gm.lowWageLossGt10pct)} | worst-10 BG overlap ${overlap}/10, worst BG same ${topK[0] === top[0]}`,
          );
          if (K === 64) {
            expect(rel(a.popMeanAddedS, gm.popMeanAddedS), "popMeanAddedS").toBeLessThanOrEqual(FAST_TOL.popMeanAddedS);
            expect(rel(a.addedP90S, gm.addedP90S), "addedP90S").toBeLessThanOrEqual(FAST_TOL.addedP90S);
            expect(rel(a.popMeanLossPct, gm.popMeanLossPct), "popMeanLossPct").toBeLessThanOrEqual(FAST_TOL.popMeanLossPct);
            expect(rel(a.popLossGt10pct, gm.popLossGt10pct), "popLossGt10pct").toBeLessThanOrEqual(FAST_TOL.popLossGt10pct);
            expect(rel(a.lowWageLossGt10pct, gm.lowWageLossGt10pct), "lowWageLossGt10pct").toBeLessThanOrEqual(FAST_TOL.lowWageLossGt10pct);
            expect(rel(a.popLossGt25pct, gm.popLossGt25pct), "popLossGt25pct").toBeLessThanOrEqual(FAST_TOL.popLossGt25pct);
            expect(sMean / cnt, "mean |meanTimeS error|").toBeLessThanOrEqual(FAST_TOL.meanAbsMeanTimeS);
            expect(maxMean, "max |meanTimeS error|").toBeLessThanOrEqual(FAST_TOL.maxAbsMeanTimeS);
            expect(overlap, "worst-10 block-group overlap").toBeGreaterThanOrEqual(FAST_TOL.minTop10Overlap);
            expect(topK[0], "worst block group").toBe(top[0]);
            expect(r.meta.variant).toMatchObject({ mode: "fast-anchors", approximate: true, anchorsPerShore: 64 });
          }
        }
      }, 300_000);
    }
    it("prints the error table", () => {
      console.info(`xharbor FAST accuracy vs golden (tolerances at K=64: ${JSON.stringify(FAST_TOL)})\n  ${table.join("\n  ")}`);
    });
  });
});

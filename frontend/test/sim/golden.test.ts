/**
 * Golden test: the TS simulator against the pipeline's independent networkx reference (golden.json).
 * Skipped, with a stated reason, when data/snapshot has not been built.
 *
 * Tolerances (documented):
 *   - per-hex time: golden.tolerance.perHexS (contract: 0.5 s). Golden values are rounded to 0.01 s and the
 *     TS field is float32, so the real difference is far below that; the observed maximum is printed.
 *   - metric times (p50S, p90S, equityGapS, lowWageAddedS, popAddedS, addedP50S, addedP90S): 0.5 s
 *   - percentages (pctWithin, zvhWithin): 0.05 percentage points
 *   - isolatedBg: exact list equality (block-group ids)
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { SimEngine } from "../../lib/sim/engine";
import { fsReader } from "../../lib/sim/node";
import type { LensMetrics, WorldState } from "../../lib/sim/contract";
import { SKIP_REASON, SNAPSHOT_DIR, snapshotExists } from "./snapshotPath";

interface GoldenMetrics {
  p50S: number | null;
  p90S: number | null;
  pctWithin: number;
  zvhWithin?: number;
  isolatedBg: number[];
  equityGapS: number | null;
  lowWageAddedS?: number;
  popAddedS?: number;
  unreachableHexes?: number;
}
interface GoldenWorld {
  id: string;
  closedLinks: string[];
  ems: { metrics: GoldenMetrics; hexTimeS: (number | null)[] };
  access: { metrics: GoldenMetrics; added: { addedP50S: number; addedP90S: number }; hexTimeS: number[] };
}
interface Golden {
  snapshotId: string;
  tolerance: { perHexS: number };
  constants: { callToWheelsS: number; emsThresholdS: number; accessCapS: number; accessAddedOkS: number; accessCutoffS: number };
  emsSourceNodes: number[];
  destinations: { id: string; node: number; jobs: number }[];
  hexCount: number;
  worlds: GoldenWorld[];
}

const T_S = 0.5;
/** Tighter regression bound: golden hexTimeS is rounded to 0.01 s (max error 0.005) and the TS field is float32. */
const OBSERVED_BOUND_S = 0.01;
const T_PCT = 0.05;
const num = (x: number | null) => (x === null ? Infinity : x);
const closeS = (got: number | undefined, want: number | null, what: string) => {
  const w = num(want);
  if (w === Infinity) expect(got, what).toBe(Infinity);
  else expect(Math.abs((got as number) - w), `${what}: got ${got}, golden ${w}`).toBeLessThanOrEqual(T_S);
};

describe.skipIf(!snapshotExists)(`golden.json vs TS simulator${snapshotExists ? "" : ` [SKIPPED: ${SKIP_REASON}]`}`, () => {
  let engine: SimEngine;
  let golden: Golden;
  const report: string[] = [];

  beforeAll(async () => {
    golden = JSON.parse(readFileSync(join(SNAPSHOT_DIR, "golden.json"), "utf8"));
    engine = await SimEngine.fromReader(fsReader(SNAPSHOT_DIR));
  });

  it("the files the simulator reads match manifest.json (sha256); a stale golden.json entry is reported, not fatal", () => {
    const manifest = JSON.parse(readFileSync(join(SNAPSHOT_DIR, "manifest.json"), "utf8"));
    const stale: string[] = [];
    for (const [name, info] of Object.entries(manifest.files as Record<string, { sha256: string; bytes: number }>)) {
      const buf = readFileSync(join(SNAPSHOT_DIR, name));
      const ok = buf.length === info.bytes && createHash("sha256").update(buf).digest("hex") === info.sha256;
      if (ok) continue;
      // golden.json is only a test oracle (its own values are compared below); every other file feeds the simulator.
      if (name === "golden.json") stale.push(name);
      else expect(ok, `${name} does not match manifest.json: the manifest is stale, re-run the pipeline manifest step`).toBe(true);
    }
    if (stale.length) console.warn(`manifest.json is stale for: ${stale.join(", ")} (golden.json was regenerated without re-running manifest)`);
  });

  it("uses the snapshot the golden file was made from, with the same lens constants", () => {
    expect(engine.snap.id).toBe(golden.snapshotId);
    expect(engine.snap.hexes.count).toBe(golden.hexCount);
    expect(engine.params.call_to_wheels_delay_min * 60).toBe(golden.constants.callToWheelsS);
    expect(engine.params.emsThresholdS).toBe(golden.constants.emsThresholdS);
    expect(engine.params.accessCapS).toBe(golden.constants.accessCapS);
    expect(engine.params.accessAddedOkS).toBe(golden.constants.accessAddedOkS);
    expect(engine.params.accessCutoffS).toBe(golden.constants.accessCutoffS);
  });

  it("EMS sources and Access destinations are the ones the reference used", () => {
    const cw = engine.compileWorld({ snapshotId: engine.snap.id, mutations: [] });
    const nodes = [...new Set(engine.snap.facilities.filter((_, i) => cw.sourceMask[i] === 1).map((f) => f.node))].sort((a, b) => a - b);
    expect(nodes).toEqual(golden.emsSourceNodes);
    expect(engine.snap.destinations.map((d) => ({ id: d.id, node: d.node, jobs: d.jobs }))).toEqual(golden.destinations);
  });

  it("every golden world matches: hex fields, metrics, isolated block groups", () => {
    for (const gw of golden.worlds) {
      const world: WorldState = {
        snapshotId: engine.snap.id,
        mutations: gw.closedLinks.map((linkId, i) => ({ id: `g${i}`, m: { kind: "close_link" as const, linkId }, origin: "user" as const, label: linkId, confirmedAt: "2026-09-26T00:00:00.000Z" })),
      };
      const line: string[] = [gw.id];

      const ems = engine.runDeterministic(world, "ems");
      let worst = 0;
      for (let h = 0; h < golden.hexCount; h++) {
        const want = num(gw.ems.hexTimeS[h]);
        if (want === Infinity) expect(ems.field[h], `${gw.id} ems hex ${h}`).toBe(Infinity);
        else {
          const d = Math.abs(ems.field[h] - want);
          worst = Math.max(worst, d);
          expect(d, `${gw.id} ems hex ${h}: ts ${ems.field[h]} vs golden ${want}`).toBeLessThanOrEqual(golden.tolerance.perHexS);
        }
      }
      expect(worst, `${gw.id} ems observed bound`).toBeLessThanOrEqual(OBSERVED_BOUND_S);
      line.push(`ems max|dt| ${worst.toFixed(4)} s`);
      compare(ems.metrics, gw.ems.metrics, `${gw.id} ems`);

      const acc = engine.runDeterministic(world, "access");
      worst = 0;
      for (let h = 0; h < golden.hexCount; h++) {
        const d = Math.abs(acc.field[h] - gw.access.hexTimeS[h]);
        worst = Math.max(worst, d);
        expect(d, `${gw.id} access hex ${h}: ts ${acc.field[h]} vs golden ${gw.access.hexTimeS[h]}`).toBeLessThanOrEqual(golden.tolerance.perHexS);
      }
      expect(worst, `${gw.id} access observed bound`).toBeLessThanOrEqual(OBSERVED_BOUND_S);
      line.push(`access max|dt| ${worst.toFixed(4)} s`);
      compare(acc.metrics, gw.access.metrics, `${gw.id} access`);
      closeS(acc.metrics.addedP50S, gw.access.added.addedP50S, `${gw.id} addedP50S`);
      closeS(acc.metrics.addedP90S, gw.access.added.addedP90S, `${gw.id} addedP90S`);
      report.push(line.join(" | "));
    }
    console.info(`golden: ${golden.worlds.length} worlds, ${golden.hexCount} hexes, tolerance ${golden.tolerance.perHexS} s per hex\n  ${report.join("\n  ")}`);
  });

  it("the first golden world is the empty world, and closing the Key Bridge is the only difference in world 2", () => {
    expect(golden.worlds[0].closedLinks).toEqual([]);
    expect(golden.worlds[1].closedLinks).toEqual(["L-KEYBRIDGE"]);
  });
});

function compare(got: LensMetrics, want: GoldenMetrics, what: string): void {
  closeS(got.p50S, want.p50S, `${what} p50S`);
  closeS(got.p90S, want.p90S, `${what} p90S`);
  closeS(got.equityGapS, want.equityGapS, `${what} equityGapS`);
  expect(Math.abs(got.pctWithin - want.pctWithin), `${what} pctWithin`).toBeLessThanOrEqual(T_PCT);
  if (want.zvhWithin !== undefined) expect(Math.abs((got.zvhWithin as number) - want.zvhWithin), `${what} zvhWithin`).toBeLessThanOrEqual(T_PCT);
  expect(got.isolatedBg, `${what} isolatedBg`).toEqual(want.isolatedBg);
  if (want.lowWageAddedS !== undefined) closeS(got.lowWageAddedS, want.lowWageAddedS, `${what} lowWageAddedS`);
  if (want.popAddedS !== undefined) closeS(got.popAddedS, want.popAddedS, `${what} popAddedS`);
  if (want.unreachableHexes !== undefined) expect(got.unreachableHexes, `${what} unreachable`).toBe(want.unreachableHexes);
}

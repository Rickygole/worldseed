/**
 * End to end on the real pipeline snapshot: Simulator interface -> pool -> engine -> files, then the
 * pool's worker-count invariance on real data. Skipped, with a reason, when data/snapshot is absent.
 */
import * as Comlink from "comlink";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidCell } from "h3-js";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimEngine } from "../../lib/sim/engine";
import { createSimulator } from "../../lib/sim";
import { SnapshotMissingError } from "../../lib/sim/snapshot";
import { fsReader } from "../../lib/sim/node";
import type { FuturesResult, WorldState } from "../../lib/sim/contract";
import { createWorkerApi, type WorkerApi } from "../../lib/workers/api";
import { SimPool, type WorkerFactory } from "../../lib/workers/pool";
import { SKIP_REASON, SNAPSHOT_DIR, snapshotExists } from "./snapshotPath";

afterEach(() => vi.unstubAllGlobals());

describe.skipIf(!snapshotExists)(`real snapshot end to end${snapshotExists ? "" : ` [SKIPPED: ${SKIP_REASON}]`}`, () => {
  const golden = () => JSON.parse(readFileSync(join(SNAPSHOT_DIR, "golden.json"), "utf8"));

  it("Simulator: real cells (valid H3), empty provenance, Key Bridge scenario reproduces golden metrics", async () => {
    const read = fsReader(SNAPSHOT_DIR);
    vi.stubGlobal("fetch", async (url: string) => {
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
    expect(sim.meta.kind).toBe("browser");
    expect(world.provenance).toBe("");
    expect(world.cells).toHaveLength(golden().hexCount);
    for (const i of [0, 1000, 4000, world.cells.length - 1]) {
      expect(isValidCell(world.cells[i].id), world.cells[i].id).toBe(true);
      expect(world.cells[i].lat).toBeGreaterThan(39.0);
      expect(world.cells[i].lat).toBeLessThan(39.4);
      expect(world.cells[i].lng).toBeLessThan(-76.3);
    }
    expect(world.assumptions.some((a) => /OpenStreetMap/.test(a.label))).toBe(true);

    const kb = golden().worlds.find((w: { id: string }) => w.id === "keybridge_removed");
    const acc = await sim.run(world, { removedLinks: ["key_bridge"] }, { lens: "access" });
    expect(Math.abs((acc.detail?.metrics.popAddedS as number) - kb.access.metrics.popAddedS)).toBeLessThan(0.5);
    expect(acc.detail?.metrics.isolatedBg).toEqual(kb.access.metrics.isolatedBg);
    const ems = await sim.run(world, { removedLinks: ["key_bridge"] }, { lens: "ems" });
    expect(Math.abs(ems.metrics.p90 * 60 - kb.ems.metrics.p90S)).toBeLessThan(0.5);
    expect(ems.metrics.isolated).toBe(kb.ems.metrics.isolatedBg.length);
    expect(ems.detail?.runnerText).toMatch(/^Computed locally/);
  });

  it("Simulator default lens is the cross-harbor hero: terrain in added minutes, headline, named worst block groups, regional and EMS alongside", async () => {
    const read = fsReader(SNAPSHOT_DIR);
    vi.stubGlobal("fetch", async (url: string) => {
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
    const kb = golden().xharbor.worlds.find((w: { id: string }) => w.id === "keybridge_removed");
    const gRegional = golden().worlds.find((w: { id: string }) => w.id === "keybridge_removed");
    const out = await sim.run(world, { removedLinks: ["key_bridge"] });
    const d = out.detail!;
    const x = d.xharbor!;
    expect(d.lens).toBe("xharbor");
    expect(Math.min(...out.minutes)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...out.minutes)).toBeGreaterThan(3); // several minutes added somewhere (golden max is about 7 min)
    expect(Math.abs(x.headline.meanAddedMin * 60 - kb.metrics.popMeanAddedS) / kb.metrics.popMeanAddedS).toBeLessThan(0.05);
    expect(Math.abs(x.headline.peopleLosingGt10 - kb.metrics.popLossGt10pct) / kb.metrics.popLossGt10pct).toBeLessThan(0.1);
    expect(x.worstBlockGroups.byLossPct[0].geoid).toBe(golden().xharbor.worstBlockGroups.keybridge_removed.byLossPct[0].geoid);
    expect(x.worstBlockGroups.byLossPct[0].name).toMatch(/County, Tract \d{4}\.\d{2}, Block Group \d/);
    expect(x.equity.lowWageMeanLossPct).toBeGreaterThan(0);
    // the small regional number is right there next to it (golden: +2.9 s), and EMS is unchanged
    expect(Math.abs((d.lenses.access.popAddedS as number) - gRegional.access.metrics.popAddedS)).toBeLessThan(0.5);
    expect(d.lenses.ems.p90S).toBeCloseTo(gRegional.ems.metrics.p90S, 0);
    expect(d.approximation).toMatch(/128 job-weighted destination anchors/);
    console.info(`Simulator.run (3 lenses, in-process pool): ${out.computeMs.toFixed(0)} ms; ${d.runnerText}`);
  }, 60_000);

  it("futures are identical for 1 and 4 workers on the real graph (Comlink over MessageChannel)", async () => {
    const factory: WorkerFactory = () => {
      const { port1, port2 } = new MessageChannel();
      Comlink.expose(createWorkerApi({ reader: () => fsReader(SNAPSHOT_DIR) }), port1 as unknown as Comlink.Endpoint);
      const api = Comlink.wrap<WorkerApi>(port2 as unknown as Comlink.Endpoint);
      return { api: api as unknown as WorkerApi, local: false, terminate: () => { port1.close(); port2.close(); } };
    };
    const world: WorldState = {
      snapshotId: golden().snapshotId,
      mutations: [{ id: "kb", m: { kind: "close_link", linkId: "L-KEYBRIDGE" }, origin: "user", label: "Key Bridge", confirmedAt: "2026-09-26T00:00:00Z" }],
    };
    const o = { n: 12, seed: 7, tod: "pm" as const, closureProb: 0.3 };
    const results: FuturesResult[] = [];
    for (const workers of [1, 4]) {
      const pool = await SimPool.create({ baseUrl: "x", workerFactory: factory, hardwareConcurrency: workers + 1 });
      results.push(await pool.runFutures(world, "ems", o));
      pool.dispose();
    }
    const norm = (r: FuturesResult) => JSON.stringify({ s: r.samples, h: r.headline, w: r.worstIsolated, p: Array.from(r.hexP90) });
    expect(results[0].meta.workers).toBe(1);
    expect(results[1].meta.workers).toBe(4);
    expect(norm(results[0])).toBe(norm(results[1]));
  }, 60_000);

  const hasEffects = existsSync(join(SNAPSHOT_DIR, "candidate_effects.json"));
  it.skipIf(!hasEffects)(`every candidate reproduces the pipeline's independent reference (candidate_effects.json)${hasEffects ? "" : " [SKIPPED: candidate_effects.json not found]"}`, async () => {
    interface Ref {
      access: { popMeanAddedS: number; p50S: number; p90S: number };
      ems: { p50S: number; p90S: number; pctWithin: number; zvhWithin: number; isolatedBgCount: number };
    }
    const effects = JSON.parse(readFileSync(join(SNAPSHOT_DIR, "candidate_effects.json"), "utf8")) as {
      candidates: { id: string; inBaseline: { metrics: Ref }; inKeybridgeRemoved: { metrics: Ref } }[];
    };
    const engine = await SimEngine.fromReader(fsReader(SNAPSHOT_DIR));
    const at = "2026-09-26T00:00:00Z";
    const close = { id: "kb", m: { kind: "close_link" as const, linkId: "L-KEYBRIDGE" }, origin: "user" as const, label: "Key Bridge", confirmedAt: at };
    let checked = 0;
    let worst = 0;
    for (const c of effects.candidates) {
      expect(engine.snap.candidates.some((x) => x.id === c.id), `candidate ${c.id} in candidates.json`).toBe(true);
      const cand = { id: `c-${c.id}`, m: { kind: "apply_candidate" as const, candidateId: c.id }, origin: "user" as const, label: c.id, confirmedAt: at };
      for (const [tag, muts, ref] of [
        ["baseline", [cand], c.inBaseline.metrics],
        ["keybridge removed", [close, cand], c.inKeybridgeRemoved.metrics],
      ] as const) {
        const world: WorldState = { snapshotId: engine.snap.id, mutations: [...muts] };
        const a = engine.runDeterministic(world, "access").metrics;
        const e = engine.runDeterministic(world, "ems").metrics;
        const what = `${c.id} (${tag})`;
        for (const [got, want, name] of [
          [a.popAddedS as number, ref.access.popMeanAddedS, "access popMeanAddedS"],
          [a.p50S, ref.access.p50S, "access p50S"],
          [a.p90S, ref.access.p90S, "access p90S"],
          [e.p50S, ref.ems.p50S, "ems p50S"],
          [e.p90S, ref.ems.p90S, "ems p90S"],
        ] as const) {
          worst = Math.max(worst, Math.abs(got - want));
          expect(Math.abs(got - want), `${what} ${name}: ts ${got} vs reference ${want}`).toBeLessThanOrEqual(0.5);
        }
        expect(Math.abs((e.pctWithin) - ref.ems.pctWithin), `${what} ems pctWithin`).toBeLessThanOrEqual(0.05);
        expect(Math.abs((e.zvhWithin as number) - ref.ems.zvhWithin), `${what} ems zvhWithin`).toBeLessThanOrEqual(0.05);
        expect(e.isolatedBg.length, `${what} ems isolated BG count`).toBe(ref.ems.isolatedBgCount);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    console.info(`candidate_effects: ${checked} candidates x 2 worlds x 2 lenses match the reference; max time deviation ${worst.toFixed(4)} s`);
  }, 120_000);
});

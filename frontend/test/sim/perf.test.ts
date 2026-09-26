/**
 * Performance: one EMS Dijkstra must take under 20 ms in Node (ARCHITECTURE.md step 15).
 * Asserted on the median of repeated runs after warm-up (a single cold run measures the JIT, not the
 * algorithm). Measured numbers are printed. The real-graph test is skipped, with a reason, when the
 * pipeline snapshot is absent; a synthetic graph of realistic size always runs.
 */
import { describe, expect, it } from "vitest";
import { compile, emptyWorld } from "../../lib/sim/compile";
import { DijkstraWorkspace } from "../../lib/sim/dijkstra";
import { SimEngine } from "../../lib/sim/engine";
import { fsReader } from "../../lib/sim/node";
import { buildGraph, lcg, type EdgeSpec } from "./fixtures";
import { SKIP_REASON, SNAPSHOT_DIR, snapshotExists } from "./snapshotPath";

const LIMIT_MS = 20;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function time(fn: () => void, warm = 5, runs = 31): { median: number; min: number; max: number } {
  for (let i = 0; i < warm; i++) fn();
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const a = performance.now();
    fn();
    t.push(performance.now() - a);
  }
  return { median: median(t), min: Math.min(...t), max: Math.max(...t) };
}

describe("Dijkstra speed", () => {
  it("synthetic 36k-node / 82k-edge road-like graph: one multi-source Dijkstra < 20 ms (median)", () => {
    const W = 190;
    const H = 190; // 36,100 nodes
    const r = lcg(1);
    const edges: EdgeSpec[] = [];
    const add = (a: number, b: number) => {
      const t = 5 + r() * 60;
      edges.push({ from: a, to: b, timeS: t });
      if (r() < 0.8) edges.push({ from: b, to: a, timeS: t });
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x + 1 < W && r() < 0.6) add(y * W + x, y * W + x + 1);
        if (y + 1 < H && r() < 0.6) add(y * W + x, (y + 1) * W + x);
      }
    }
    const { graph } = buildGraph({ N: W * H, edges });
    const ws = new DijkstraWorkspace(graph);
    const enabled = new Uint8Array(graph.edgeCount).fill(1);
    const sources = Array.from({ length: 76 }, (_, i) => (i * 467) % (W * H));
    const t = time(() => ws.run({ reverse: false, sources, enabled }));
    console.info(`synthetic ${graph.nodeCount} nodes / ${graph.edgeCount} edges: EMS-style Dijkstra median ${t.median.toFixed(2)} ms (min ${t.min.toFixed(2)}, max ${t.max.toFixed(2)})`);
    expect(t.median).toBeLessThan(LIMIT_MS);
  });

  it.skipIf(!snapshotExists)(`real graph: one EMS Dijkstra < 20 ms (median)${snapshotExists ? "" : ` [SKIPPED: ${SKIP_REASON}]`}`, async () => {
    const eng = await SimEngine.fromReader(fsReader(SNAPSHOT_DIR));
    const g = eng.snap.graph;
    const cw = compile(emptyWorld(eng.snap.id), { id: eng.snap.id, graph: g, facilities: eng.snap.facilities, candidates: eng.snap.candidates });
    const sources = eng.snap.facilities.filter((_, i) => cw.sourceMask[i] === 1).map((f) => f.node);
    const ws = new DijkstraWorkspace(g);
    const dij = time(() => ws.run({ reverse: false, sources, enabled: cw.edgeEnabled, costMul: cw.edgeCostMul }));
    const world = {
      snapshotId: eng.snap.id,
      mutations: [{ id: "kb", m: { kind: "close_link" as const, linkId: "L-KEYBRIDGE" }, origin: "user" as const, label: "Key Bridge", confirmedAt: "2026-09-26T00:00:00.000Z" }],
    };
    const emsField = time(() => eng.lens("ems").field(cw, null, new Float32Array(eng.snap.hexes.count)));
    const accField = time(() => eng.lens("access").field(cw, null, new Float32Array(eng.snap.hexes.count)), 3, 15);
    const run = time(() => eng.runDeterministic(world, "access"), 3, 15);
    const runEms = time(() => eng.runDeterministic(world, "ems"), 3, 15);
    const nF = 20;
    const fut = async (lens: "ems" | "access") => {
      const a = performance.now();
      await eng.runFutures(world, lens, { n: nF, seed: 1, tod: "am", closureProb: 0.1 });
      return (performance.now() - a) / nF;
    };
    await fut("ems");
    const futEms = await fut("ems");
    await fut("access");
    const futAcc = await fut("access");
    console.info(
      `real graph ${g.nodeCount} nodes / ${g.edgeCount} edges, ${sources.length} sources, ${eng.snap.hexes.count} hexes:\n` +
        `  EMS Dijkstra only          median ${dij.median.toFixed(2)} ms (min ${dij.min.toFixed(2)}, max ${dij.max.toFixed(2)})\n` +
        `  EMS field (Dijkstra+hexes) median ${emsField.median.toFixed(2)} ms\n` +
        `  Access field (K=${eng.snap.destinations.length} reverse) median ${accField.median.toFixed(2)} ms\n` +
        `  runDeterministic (Key Bridge closed) access ${run.median.toFixed(2)} ms, ems ${runEms.median.toFixed(2)} ms (medians)\n` +
        `  futures, single thread, per future (warm cache): ems ${futEms.toFixed(2)} ms, access ${futAcc.toFixed(2)} ms (access includes the reference world on first use)`,
    );
    expect(dij.median).toBeLessThan(LIMIT_MS);
  });

  it.skipIf(!snapshotExists)(`real graph: xharbor fast deterministic run < 1 s on ONE thread; exact and futures timings printed${snapshotExists ? "" : ` [SKIPPED: ${SKIP_REASON}]`}`, async () => {
    const eng = await SimEngine.fromReader(fsReader(SNAPSHOT_DIR));
    const world = {
      snapshotId: eng.snap.id,
      mutations: [{ id: "kb", m: { kind: "close_link" as const, linkId: "L-KEYBRIDGE" }, origin: "user" as const, label: "Key Bridge", confirmedAt: "2026-09-26T00:00:00Z" }],
    };
    const first = time(() => eng.runDeterministic(world, "xharbor"), 0, 1); // cold: anchors + baseline + world
    const warm = time(() => eng.runDeterministic(world, "xharbor"), 1, 7);
    const a = performance.now();
    eng.runDeterministic(world, "xharbor", 1, { mode: "exact" });
    const exactCold = performance.now() - a; // includes the exact baseline
    const b = performance.now();
    eng.runDeterministic(world, "xharbor", 1, { mode: "exact" });
    const exactWarm = performance.now() - b;
    const nF = 20;
    const futures = async () => {
      const t = performance.now();
      await eng.runFutures(world, "xharbor", { n: nF, seed: 5, tod: "am", closureProb: 0.1 });
      return (performance.now() - t) / nF;
    };
    const fCold = await futures(); // reference fields computed
    const fWarm = await futures(); // reference cached
    console.info(
      `xharbor on the real graph, ONE thread in Node:\n` +
        `  fast (64/shore) deterministic: cold ${first.median.toFixed(0)} ms (anchors + baseline + world), warm median ${warm.median.toFixed(0)} ms (min ${warm.min.toFixed(0)}, max ${warm.max.toFixed(0)})\n` +
        `  exact deterministic: first ${exactCold.toFixed(0)} ms (baseline + world), then ${exactWarm.toFixed(0)} ms\n` +
        `  fast futures (32/shore), per future: ${fCold.toFixed(0)} ms cold, ${fWarm.toFixed(0)} ms with the reference cached`,
    );
    expect(warm.median).toBeLessThan(1000);
  }, 300_000);
});

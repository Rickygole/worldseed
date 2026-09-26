/**
 * Stress worlds, paired futures over bundles, and the deterministic many-bundle check (exhaustive search).
 */
import * as Comlink from "comlink";
import { describe, expect, it } from "vitest";
import type { BundleInput, WorldState } from "../../lib/sim/contract";
import { compile, emptyWorld } from "../../lib/sim/compile";
import { SimEngine } from "../../lib/sim/engine";
import { bundleCostTier, bundleWorld, simTod, worldWithStress } from "../../lib/sim/stress";
import { createWorkerApi, type WorkerApi } from "../../lib/workers/api";
import { SimPool, type WorkerFactory } from "../../lib/workers/pool";
import { buildHarbor, harborReader, HARBOR_ID, rec } from "./fixtures";
import { SKIP_REASON, SNAPSHOT_DIR, snapshotExists } from "./snapshotPath";
import { fsReader } from "../../lib/sim/node";

const h = buildHarbor();
const closeBridge = rec("kb", { kind: "close_link", linkId: "L-KEYBRIDGE" });
const w0: WorldState = { snapshotId: HARBOR_ID, mutations: [] };
const w1: WorldState = { snapshotId: HARBOR_ID, mutations: [closeBridge] };
const B = (id: string, ...c: string[]): BundleInput => ({ id, candidateIds: c });

const pools: SimPool[] = [];
async function pool(workers: number, reader: () => ReturnType<typeof harborReader> = () => harborReader(h)): Promise<SimPool> {
  const factory: WorkerFactory = () => {
    const { port1, port2 } = new MessageChannel();
    Comlink.expose(createWorkerApi({ reader }), port1 as unknown as Comlink.Endpoint);
    const api = Comlink.wrap<WorkerApi>(port2 as unknown as Comlink.Endpoint);
    return { api: api as unknown as WorkerApi, local: false, terminate: () => { port1.close(); port2.close(); } };
  };
  const p = await SimPool.create({ baseUrl: "x", workerFactory: factory, hardwareConcurrency: workers + 1 });
  pools.push(p);
  return p;
}
import { afterEach } from "vitest";
afterEach(() => {
  while (pools.length) pools.pop()?.dispose();
});

describe("worldWithStress", () => {
  const stress = { closedLinks: ["L-HARBORTUNNEL", "L-KEYBRIDGE"], tod: "midday", label: "Harbor Tunnel closed during the midday" };
  it("adds one close_link mutation per link, stamped, agent-origin, with provenance; maps midday to mid", () => {
    const { world, tod, applied } = worldWithStress(w1.mutations.length ? { ...w1, mutations: [] } : w1, stress, "2026-09-26T12:00:00.000Z");
    expect(tod).toBe("mid");
    expect(world.mutations.map((m) => m.m)).toEqual([
      { kind: "close_link", linkId: "L-HARBORTUNNEL" },
      { kind: "close_link", linkId: "L-KEYBRIDGE" },
    ]);
    for (const m of world.mutations) {
      expect(m.origin).toBe("agent");
      expect(m.confirmedAt).toBe("2026-09-26T12:00:00.000Z");
      expect(m.provenance).toMatchObject({ quote: stress.label });
      expect(m.provenance?.url).toMatch(/^stress-test:/);
      expect(m.label).toContain("Stress test");
    }
    expect(applied).toEqual({ label: stress.label, closedLinks: ["L-HARBORTUNNEL", "L-KEYBRIDGE"], tod: "mid" });
  });

  it("compiles: the closures take effect; nothing else changes; the input world is not mutated", () => {
    const before = JSON.stringify(w0);
    const { world } = worldWithStress(w0, { closedLinks: ["L-KEYBRIDGE"], label: "x" });
    expect(JSON.stringify(w0)).toBe(before);
    const ctx = { id: h.snap.id, graph: h.snap.graph, facilities: h.snap.facilities, candidates: h.snap.candidates };
    const a = compile(world, ctx);
    const b = compile(w1, ctx);
    expect(Array.from(a.edgeEnabled)).toEqual(Array.from(b.edgeEnabled));
    expect(compile(emptyWorld(HARBOR_ID), ctx).edgeEnabled).not.toEqual(a.edgeEnabled);
  });

  it("no stress: same world, no tod. Time-of-day-only stress: no closures. Unknown tod: RangeError. Duplicates collapse.", () => {
    expect(worldWithStress(w1, undefined)).toEqual({ world: w1, tod: null, applied: null });
    const t = worldWithStress(w0, { closedLinks: [], tod: "night", label: "night" });
    expect(t.world.mutations).toHaveLength(0);
    expect(t.tod).toBe("night");
    expect(() => worldWithStress(w0, { closedLinks: [], tod: "noon", label: "x" })).toThrow(RangeError);
    expect(worldWithStress(w0, { closedLinks: ["L-KEYBRIDGE", "L-KEYBRIDGE"], label: "x" }).world.mutations).toHaveLength(1);
    expect(["am", "midday", "mid", "pm", "night"].map(simTod)).toEqual(["am", "mid", "mid", "pm", "night"]);
  });

  it("stressing a world that already has that stress id is refused (no silent double application)", () => {
    const once = worldWithStress(w0, { closedLinks: ["L-KEYBRIDGE"], label: "x" }).world;
    expect(() => worldWithStress(once, { closedLinks: ["L-KEYBRIDGE"], label: "x" })).toThrow(/already has/);
  });
});

describe("bundleWorld and cost tiers", () => {
  it("adds one apply_candidate per candidate, agent-origin, stamped; tiers are the maximum", () => {
    const bw = bundleWorld(w1, B("B1", "TL-TEMP", "SP-TUNNEL"), "2026-09-26T12:00:00.000Z");
    expect(bw.mutations.slice(1).map((m) => m.m)).toEqual([{ kind: "apply_candidate", candidateId: "TL-TEMP" }, { kind: "apply_candidate", candidateId: "SP-TUNNEL" }]);
    expect(bw.mutations.every((m) => m.confirmedAt.length > 0)).toBe(true);
    expect(w1.mutations).toHaveLength(1);
    const tiers = new Map([["a", "$"], ["b", "$$$"], ["c", "$$"]]);
    expect(bundleCostTier(["a", "c"], tiers)).toBe("$$");
    expect(bundleCostTier(["a", "b", "c"], tiers)).toBe("$$$");
    expect(bundleCostTier(["a", "zzz"], tiers)).toBeNull();
  });
});

describe("runDeterministicMany (fixture)", () => {
  const bundles: BundleInput[] = [B("E1", "TL-TEMP"), B("E2", "SP-TUNNEL"), B("E3", "TL-TEMP", "SP-TUNNEL"), B("E4", "PP-SITE"), B("E5", "IM-TUNNEL", "SP-TUNNEL"), B("E6", "HW-TUNNEL")];

  it("matches one-at-a-time deterministic runs, in input order, and reports the stressed baseline", async () => {
    const eng = await SimEngine.fromReader(harborReader(h)); // the same files (and constants) the workers load
    const p = await pool(2);
    for (const lens of ["ems", "access", "xharbor"] as const) {
      const r = await p.runDeterministicMany(w1, bundles, { lens });
      expect(r.rows.map((x) => x.bundleId)).toEqual(bundles.map((b) => b.id));
      expect(r.evaluated).toBe(6);
      expect(r.errors).toEqual([]);
      const x = lens === "xharbor" ? { mode: "fast" as const, anchorsPerShore: 32 } : {};
      for (const row of r.rows) {
        const want = eng.runDeterministic(bundleWorld(w1, { id: row.bundleId, candidateIds: row.candidateIds }, "2026-01-01T00:00:00Z"), lens, 1, x).metrics;
        if (want.xharbor) delete want.xharbor.worst; // the many-bundle path does not name block groups
        expect(row.metrics).toEqual(want);
        expect(row.p90S).toBe(want.p90S);
        expect(row.isolatedCount).toBe(want.isolatedBg.length);
        expect(row.equityGapS).toBe(want.equityGapS);
      }
      expect(r.baseline.p90S).toBe(eng.runDeterministic(w1, lens, 1, x).metrics.p90S);
      expect(r.rows[0].costTier).toBe("$$");
      expect(r.rows[1].costTier).toBe("$");
      expect(r.stress).toBeNull();
      expect(r.meta).toMatchObject({ runner: "local-node", snapshotId: HARBOR_ID });
    }
  });

  it("is identical for 1 and 3 workers, and byte-for-byte deterministic across runs", async () => {
    const many = Array.from({ length: 40 }, (_, i) => B(`M${i}`, ["TL-TEMP", "SP-TUNNEL", "PP-SITE", "IM-TUNNEL"][i % 4], ...(i % 3 === 0 ? ["HW-TUNNEL"] : [])));
    const a = await (await pool(1)).runDeterministicMany(w1, many, { lens: "access" });
    const b = await (await pool(3)).runDeterministicMany(w1, many, { lens: "access" });
    const strip = (r: typeof a) => JSON.stringify({ ...r, meta: null });
    expect(strip(a)).toBe(strip(b));
    expect(b.meta.workers).toBe(3);
    expect(strip(await (await pool(3)).runDeterministicMany(w1, many, { lens: "access" }))).toBe(strip(b));
  });

  it("bundles the compiler rejects are reported as errors, not scored, and do not stop the rest", async () => {
    const p = await pool(2);
    const r = await p.runDeterministicMany(w1, [B("G1", "TL-TEMP"), B("BAD", "NOPE"), B("DUP", "TL-TEMP", "TL-TEMP"), B("G2", "SP-TUNNEL")], { lens: "ems" });
    expect(r.rows.map((x) => x.bundleId)).toEqual(["G1", "G2"]);
    expect(r.errors.map((x) => x.bundleId)).toEqual(["BAD", "DUP"]);
    expect(r.errors[0].error).toMatch(/unknown candidate/);
    expect(r.errors[1].error).toMatch(/duplicate|twice/);
  });

  it("scores every bundle under the stress: the same stress the baseline row carries", async () => {
    const p = await pool(2);
    const stress = { closedLinks: ["L-HARBORTUNNEL"], label: "Harbor Tunnel closed" };
    const plain = await p.runDeterministicMany(w1, [B("S1", "TL-TEMP")], { lens: "access" });
    const st = await p.runDeterministicMany(w1, [B("S1", "TL-TEMP")], { lens: "access", stress });
    expect(st.stress?.closedLinks).toEqual(["L-HARBORTUNNEL"]);
    expect(st.baseline.p90S).toBeGreaterThan(plain.baseline.p90S);
    expect(st.rows[0].p90S).toBeGreaterThan(plain.rows[0].p90S);
    const manual = worldWithStress(w1, stress).world;
    const eng = await SimEngine.fromReader(harborReader(h));
    expect(st.baseline.p90S).toBe(eng.runDeterministic(manual, "access").metrics.p90S);
  });

  it("progress is the real count of finished bundles, ending at the total", async () => {
    const p = await pool(3);
    const many = Array.from({ length: 30 }, (_, i) => B(`P${i}`, "SP-TUNNEL"));
    const seen: [number, number][] = [];
    await p.runDeterministicMany(w1, many, { lens: "ems", onProgress: (d, t) => seen.push([d, t]) });
    expect(seen[0]).toEqual([0, 30]);
    expect(seen[seen.length - 1]).toEqual([30, 30]);
    for (let i = 1; i < seen.length; i++) expect(seen[i][0]).toBeGreaterThanOrEqual(seen[i - 1][0]);
    expect(Math.max(...seen.map((s) => s[0]))).toBe(30);
  });

  it("cancels: an AbortSignal rejects with AbortError, the workers stop early, and the pool still works", async () => {
    const p = await pool(2);
    const many = Array.from({ length: 4000 }, (_, i) => B(`C${i}`, "TL-TEMP"));
    const ac = new AbortController();
    let last = 0;
    const run = p.runDeterministicMany(w1, many, { lens: "access", signal: ac.signal, onProgress: (d) => { last = d; if (d >= 10) ac.abort(); } });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(last).toBeLessThan(4000);
    const pre = new AbortController();
    pre.abort();
    await expect(p.runDeterministicMany(w1, many, { lens: "ems", signal: pre.signal })).rejects.toMatchObject({ name: "AbortError" });
    const ok = await p.runDeterministicMany(w1, many.slice(0, 5), { lens: "ems" });
    expect(ok.evaluated).toBe(5);
  });
});

describe("runBundlesPaired (fixture)", () => {
  const o = { lens: "access" as const, n: 24, seed: 77, tod: "pm" as const, closureProb: 0 };

  it("counts real futures per row, the sum, and reports progress over baseline + bundles", async () => {
    const p = await pool(2);
    const seen: [number, number][] = [];
    const r = await p.runBundlesPaired(w1, [B("B1", "TL-TEMP"), B("B2", "SP-TUNNEL")], { ...o, onProgress: (d, t) => seen.push([d, t]) });
    expect(r.baseline.futures).toBe(24);
    expect(r.bundles.map((b) => b.futures)).toEqual([24, 24]);
    expect(r.futuresTotal).toBe(72);
    expect(seen[seen.length - 1]).toEqual([72, 72]);
    for (const s of seen) expect(s[1]).toBe(72);
    for (let i = 1; i < seen.length; i++) expect(seen[i][0]).toBeGreaterThanOrEqual(seen[i - 1][0]);
    expect(r.bundles[0].costTier).toBe("$$");
    expect(r.tod).toBe("pm");
    expect(r.headlineMetric).toBe("addedP90S");
    expect(r.bundles[0].headline.p10).toBeLessThanOrEqual(r.bundles[0].headline.p90);
  });

  it("uses the SAME draws for every bundle: a bundle with no effect on the lens differs from the baseline in NO future", async () => {
    const p = await pool(3);
    const r = await p.runBundlesPaired(w1, [B("NOOP", "PP-SITE"), B("HELP", "TL-TEMP")], { ...o, keepSamples: true });
    const noop = r.bundles[0];
    expect(noop.vsBaseline!.headlineDelta).toEqual({ p10: 0, p50: 0, p90: 0 });
    expect(noop.vsBaseline!.pBetter).toBe(0);
    expect(noop.vsBaseline!.pNoWorse).toBe(1);
    expect(JSON.stringify(noop.samples)).toBe(JSON.stringify(r.baseline.samples ?? noop.samples));
    // a real improvement is better in (nearly) every identical future
    const help = r.bundles[1];
    expect(help.vsBaseline!.headlineDelta.p50).toBeLessThan(0);
    expect(help.vsBaseline!.pBetter).toBeGreaterThan(0.9);
  });

  it("equals direct futures runs of the same worlds (same seed): bundles are ordinary worlds, nothing hidden", async () => {
    const eng = await SimEngine.fromReader(harborReader(h));
    const p = await pool(2);
    const r = await p.runBundlesPaired(w1, [B("B1", "TL-TEMP")], { ...o, keepSamples: true });
    const direct = await eng.runFutures(bundleWorld(w1, B("B1", "TL-TEMP")), "access", { n: o.n, seed: o.seed, tod: "pm", closureProb: 0 });
    expect(JSON.stringify(r.bundles[0].samples)).toBe(JSON.stringify(direct.samples));
    expect(r.bundles[0].headline).toEqual(direct.headline);
    const directBase = await eng.runFutures(w1, "access", { n: o.n, seed: o.seed, tod: "pm", closureProb: 0 });
    expect(r.baseline.headline).toEqual(directBase.headline);
  });

  it("same result for 1, 2 and 4 workers", async () => {
    const strip = (r: Awaited<ReturnType<SimPool["runBundlesPaired"]>>) => JSON.stringify({ ...r, meta: null });
    const out: string[] = [];
    for (const n of [1, 2, 4]) out.push(strip(await (await pool(n)).runBundlesPaired(w1, [B("B1", "TL-TEMP"), B("B2", "SP-TUNNEL", "TL-TEMP")], { ...o, closureProb: 0.2 })));
    expect(out[1]).toBe(out[0]);
    expect(out[2]).toBe(out[0]);
  });

  it("stress: closes the links for baseline and bundles alike, maps midday to mid, and the stressed baseline is what benefits are measured against", async () => {
    const p = await pool(2);
    const stress = { closedLinks: ["L-HARBORTUNNEL"], tod: "midday", label: "Harbor Tunnel closed during midday" };
    const plain = await p.runBundlesPaired(w1, [B("B1", "TL-TEMP")], { ...o, tod: "mid" });
    const st = await p.runBundlesPaired(w1, [B("B1", "TL-TEMP")], { ...o, tod: "am", stress });
    expect(st.tod).toBe("mid"); // the stress's time of day wins
    expect(st.stress).toEqual({ label: stress.label, closedLinks: ["L-HARBORTUNNEL"], tod: "mid" });
    expect(st.baseline.headline.p50).toBeGreaterThan(plain.baseline.headline.p50);
    const eng = await SimEngine.fromReader(harborReader(h));
    const direct = await eng.runFutures(bundleWorld(worldWithStress(w1, stress).world, B("B1", "TL-TEMP")), "access", { n: o.n, seed: o.seed, tod: "mid", closureProb: 0 });
    expect(st.bundles[0].headline).toEqual(direct.headline);
    // the help of the temporary link is measured under the stress, against the stressed baseline
    expect(st.bundles[0].vsBaseline!.headlineDelta.p50).toBeLessThan(0);
  });

  it("goal and goalDelta give pGoal per row; pGoal is monotone in the target; rows carry evaluator-shaped numbers", async () => {
    const p = await pool(2);
    const loose = await p.runBundlesPaired(w1, [B("B1", "TL-TEMP")], { ...o, lens: "ems", goal: { metric: "p90S", op: "<=", target: 1e9 } });
    expect(loose.baseline.pGoal).toBe(1);
    expect(loose.bundles[0].pGoal).toBe(1);
    const tight = await p.runBundlesPaired(w1, [B("B1", "TL-TEMP")], { ...o, lens: "ems", goal: { metric: "p90S", op: "<=", target: 0 } });
    expect(tight.bundles[0].pGoal).toBe(0);
    const rel = await p.runBundlesPaired(w1, [B("B1", "SP-TUNNEL")], { ...o, goalDelta: { metric: "addedP90S", targetDelta: 0 } });
    expect(rel.goal).toMatchObject({ metric: "addedP90S", op: "<=" });
    expect(rel.baseline.pGoal).toBeGreaterThanOrEqual(0.5); // the baseline meets "its own median" at least half the time
    const row = rel.bundles[0].row;
    for (const k of ["p50S", "p90S", "pctWithin", "isolatedCount", "equityGapS"] as const) expect(Number.isFinite(row[k])).toBe(true);
    expect(Number.isInteger(row.isolatedCount)).toBe(true);
  });

  it("a bundle the compiler rejects gets an error row with 0 futures; the plan shrinks and the others are unaffected", async () => {
    const p = await pool(2);
    const seen: [number, number][] = [];
    const r = await p.runBundlesPaired(w1, [B("B1", "TL-TEMP"), B("BAD", "NOPE"), B("B3", "SP-TUNNEL")], { ...o, onProgress: (d, t) => seen.push([d, t]) });
    expect(r.bundles.map((b) => [b.bundleId, b.futures])).toEqual([["B1", 24], ["BAD", 0], ["B3", 24]]);
    expect(r.bundles[1].error).toMatch(/unknown candidate/);
    expect(r.futuresTotal).toBe(72);
    expect(seen[seen.length - 1]).toEqual([72, 72]);
  });

  it("cancels: AbortError, and no further bundles are started", async () => {
    const p = await pool(2);
    const ac = new AbortController();
    let done = 0;
    const many = Array.from({ length: 12 }, (_, i) => B(`B${i}`, "SP-TUNNEL"));
    const run = p.runBundlesPaired(w1, many, { ...o, n: 40, signal: ac.signal, onProgress: (d) => { done = d; if (d >= 50) ac.abort(); } });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(done).toBeLessThan(13 * 40);
    const ok = await p.runBundlesPaired(w1, [B("B1", "SP-TUNNEL")], { ...o, n: 5 });
    expect(ok.futuresTotal).toBe(10);
  });

  it("xharbor futures: fast variant, headline people-losing, paired", async () => {
    const p = await pool(2);
    const r = await p.runBundlesPaired(w1, [B("B1", "TL-TEMP")], { ...o, lens: "xharbor", n: 8 });
    expect(r.headlineMetric).toBe("popLossGt10pct");
    expect(r.meta.variant?.approximate).toBe(true);
    expect(r.bundles[0].futures).toBe(8);
  });

  it("rejects bad options up front", async () => {
    const p = await pool(1);
    await expect(p.runBundlesPaired(w1, [], { ...o, n: 0 })).rejects.toThrow(RangeError);
    await expect(p.runBundlesPaired(w1, [], { ...o, tod: "noon" as never })).rejects.toThrow(RangeError);
    await expect(p.runBundlesPaired(w1, [], { ...o, lens: "ems", headline: "addedP90S" })).rejects.toThrow(/not available/);
  });
});

// ---- real snapshot -----------------------------------------------------------------------------------------------------

describe.skipIf(!snapshotExists)(`bundles and stress on the real snapshot${snapshotExists ? "" : ` [SKIPPED: ${SKIP_REASON}]`}`, () => {
  it("all four app stress links resolve: the two tunnels are links, Hanover St and Broening Hwy alias their corridors", async () => {
    const eng = await SimEngine.fromReader(fsReader(SNAPSHOT_DIR));
    const g = eng.snap.graph;
    const info = eng.info.links.map((l) => l.id);
    for (const id of ["L-HARBORTUNNEL", "L-FORTMCHENRY", "L-HANOVER", "L-BROENING"]) expect(info, id).toContain(id);
    expect(eng.info.links.find((l) => l.id === "L-HANOVER")?.alias).toBe(true);
    expect(eng.info.links.find((l) => l.id === "L-HARBORTUNNEL")?.alias).toBeUndefined();
    const ci = g.corridorIndex.get("C-HANOVER") as number;
    const n = [...Array(g.edgeCount).keys()].filter((e) => g.edgeCorridor[e] === ci).length;
    expect(g.links[g.linkIndex.get("L-HANOVER") as number].edges).toHaveLength(n);
    const base = { snapshotId: eng.snap.id, mutations: [] };
    for (const id of ["L-HARBORTUNNEL", "L-FORTMCHENRY", "L-HANOVER", "L-BROENING"]) {
      const { world } = worldWithStress(base, { closedLinks: [id], tod: "midday", label: id });
      const r = eng.runDeterministic(world, "ems");
      expect(r.applied[0].edgesTouched, id).toBeGreaterThan(0);
      expect(r.metrics.p90S, id).toBeGreaterThanOrEqual(eng.runDeterministic(base, "ems").metrics.p90S);
    }
    // random closures now include the corridors too
    expect(eng.info.links.length).toBeGreaterThanOrEqual(5);
  });

  it("exhaustive check on the real catalog: all 696 bundles of 1-3 of 16 candidates, deterministic, pooled == single", async () => {
    const eng = await SimEngine.fromReader(fsReader(SNAPSHOT_DIR));
    const ids = eng.snap.candidates.map((c) => c.id).sort();
    const bundles: BundleInput[] = [];
    for (let i = 0; i < ids.length; i++) bundles.push(B(`E${bundles.length + 1}`, ids[i]));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) bundles.push(B(`E${bundles.length + 1}`, ids[i], ids[j]));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) for (let k = j + 1; k < ids.length; k++) bundles.push(B(`E${bundles.length + 1}`, ids[i], ids[j], ids[k]));
    expect(bundles).toHaveLength(696);
    const kb = { snapshotId: eng.snap.id, mutations: [rec("kb", { kind: "close_link", linkId: "L-KEYBRIDGE" })] };
    const t0 = performance.now();
    const rows = await eng.runDeterministicMany(kb, bundles, "ems");
    const single = performance.now() - t0;
    expect(rows.every((r) => r.metrics)).toBe(true);
    const p = await pool(4, () => fsReader(SNAPSHOT_DIR) as never);
    const t1 = performance.now();
    const many = await p.runDeterministicMany(kb, bundles, { lens: "ems" });
    const pooled = performance.now() - t1;
    expect(many.rows).toHaveLength(696);
    expect(many.rows.map((r) => r.p90S)).toEqual(rows.map((r) => (r.metrics as { p90S: number }).p90S));
    console.info(`exhaustive EMS 696 bundles: engine single ${single.toFixed(0)} ms; pool of 4 (message-channel workers, one process) ${pooled.toFixed(0)} ms`);
  }, 300_000);
});

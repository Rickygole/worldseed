/**
 * Round-5 tests: the two-stage deterministic search (screen every bundle, then run futures on a
 * shortlist), signed equity gap, real-link stress set and the summary-line wording. Synthetic only.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { countBundles, exhaustiveSearch, exhaustiveSummaryLine, type DeterministicEvaluateFn, type ExhaustiveEntry } from "../../lib/agent/exhaustive";
import type { EvaluateFn } from "../../lib/agent/evaluate";
import { greedyFinalists, greedySearch, nearDuplicate, pickDiverse, selectShortlist, shortlistBundles } from "../../lib/agent/greedy";
import { AgentMachine } from "../../lib/agent/machine";
import { setLogSink } from "../../lib/server/log";
import { resetDowngrades } from "../../lib/server/tokenfactory";
import { BASELINE, MISSION, apiFor, blockNetwork, fakeCatalog, makeServer, parseReply, proposeReply, row } from "./fixtures";

beforeEach(() => {
  blockNetwork();
  resetDowngrades();
  setLogSink(() => undefined);
});

/** The eligible access-lens candidates of the fake catalog, and a scoring world with a hidden synergy. */
const OPT = ["IM-CANTON", "SP-EASTERN", "TL-LONG"]; // three weak singles that are excellent together
const score = (ids: readonly string[]): number => {
  const w = ids.reduce((n, id) => n + (id.length % 4), 0); // small per-candidate effect
  const synergy = OPT.every((o) => ids.includes(o)) ? 700 : 0;
  return 1500 - 10 * w - synergy + 5 * ids.length;
};
const screenEval = (calls?: { n: number }): DeterministicEvaluateFn => async (bundles) => {
  if (calls) calls.n += bundles.length;
  return { rows: bundles.map((b) => ({ bundleId: b.id, candidateIds: b.candidateIds, p50S: 600, p90S: score(b.candidateIds), isolatedCount: 2, equityGapS: 100 })) };
};
/** The futures evaluator agrees with the screen; a stress makes everything 100 s worse and the baseline 150 s worse. */
const futuresEval = (log?: { stress: number; normal: number }): EvaluateFn => async (bundles, ctx) => {
  if (log && ctx.stress) log.stress += bundles.length;
  else if (log) log.normal += bundles.length;
  const harm = ctx.stress ? 100 : 0;
  return {
    baseline: { ...BASELINE, p90S: BASELINE.p90S + (ctx.stress ? 150 : 0) },
    rows: bundles.map((b) => {
      const p90S = score(b.candidateIds) + harm;
      return { ...row(b.id, b.candidateIds, { p90S, pGoal: Math.max(0, Math.min(1, (1500 - p90S) / 800)) }), futures: 100 };
    }),
  };
};
const N = 8; // eligible candidates in the fake catalog under MISSION
const TOTAL = countBundles(N);

describe("R5-1: two-stage deterministic search", () => {
  it("premise: the old round-by-round search does NOT find the hidden best bundle (it is off the greedy path)", async () => {
    const res = await greedySearch({ catalog: fakeCatalog(), mission: MISSION, evaluate: futuresEval(), stress: false });
    expect(res.finalists.some((f) => OPT.every((o) => f.candidateIds.includes(o)))).toBe(false);
    expect(res.screened).toBeUndefined();
  });

  it("greedySearch with a screening evaluator finds it, screens every bundle once, and runs futures only on the shortlist", async () => {
    const calls = { n: 0 };
    const log = { stress: 0, normal: 0 };
    const res = await greedySearch({ catalog: fakeCatalog(), mission: MISSION, evaluate: futuresEval(log), screen: screenEval(calls) });
    expect(calls.n).toBe(TOTAL); // every eligible bundle, exactly once
    expect(res.screened?.evaluations).toBe(TOTAL);
    expect(res.finalists[0].candidateIds.sort()).toEqual([...OPT].sort());
    expect(log.normal).toBe(12); // stage 2: the shortlist only, not the 92
    expect(res.bundlesEvaluated).toBe(12);
    expect(res.rounds).toBe(1);
    expect(res.stresses.map((s) => s.spec.kind)).toEqual(["close_link", "close_link"]); // both real links, once each
    expect(new Set(res.stresses.map((s) => JSON.stringify(s.spec))).size).toBe(2);
    expect(res.finalists).toHaveLength(3);
  });

  it("the shortlist size is configurable and capped by the number of bundles screened", async () => {
    const res = await greedySearch({ catalog: fakeCatalog(), mission: MISSION, evaluate: futuresEval(), screen: screenEval(), shortlist: 5, stress: false });
    expect(res.bundlesEvaluated).toBe(5);
    expect(res.finalists[0].candidateIds.sort()).toEqual([...OPT].sort());
  });

  it("without a screening evaluator (or when it scores fewer than three bundles) the current approach runs unchanged", async () => {
    let served = false; // only two rows in total
    const few: DeterministicEvaluateFn = async (bundles) => {
      const out = served ? [] : bundles.slice(0, 2);
      served = true;
      return { rows: out.map((b) => ({ bundleId: b.id, candidateIds: b.candidateIds, p50S: 1, p90S: 1, isolatedCount: 1, equityGapS: 1 })) };
    };
    const a = await greedySearch({ catalog: fakeCatalog(), mission: MISSION, evaluate: futuresEval(), screen: few, stress: false });
    const b = await greedySearch({ catalog: fakeCatalog(), mission: MISSION, evaluate: futuresEval(), stress: false });
    expect(a.rounds).toBe(b.rounds);
    expect(a.finalists.map((f) => f.candidateIds.join("+"))).toEqual(b.finalists.map((f) => f.candidateIds.join("+")));
  });

  it("machine: the deterministic search screens everything, shortlists, stress-tests and finishes with the hidden best bundle first; every line is the application's, from real counts", async () => {
    const server = makeServer([]);
    const calls = { n: 0 };
    const log = { stress: 0, normal: 0 };
    const m = new AgentMachine({ api: apiFor(server), evaluate: futuresEval(log), screen: screenEval(calls), catalog: fakeCatalog(), newMissionId: () => "mission-r5-1" });
    await m.runDeterministic(MISSION);
    const s = m.getState();
    expect(server.provider.calls).toHaveLength(0);
    expect(s.phase).toBe("finalists");
    expect(s.mode).toBe("deterministic");
    expect(s.screened).toEqual({ enumerated: TOTAL, scored: TOTAL, shortlisted: 12 });
    expect(calls.n).toBe(TOTAL);
    expect(log.normal).toBe(12);
    expect(s.rows).toHaveLength(12);
    expect(s.round).toBeLessThanOrEqual(3);
    expect(s.finalists[0].candidateIds.slice().sort()).toEqual([...OPT].sort());
    const lines = s.log.map((l) => l.sentence);
    expect(lines).toContain("Deterministic search (no AI): screening every eligible bundle with one deterministic run each.");
    expect(lines).toContain(`Deterministic search (no AI): screened ${TOTAL} of ${TOTAL} bundles with one deterministic run each, and took the top 12 (the leaders, plus variety) for the full futures run.`);
    expect(lines).toContain("Deterministic search (no AI): screened 92 bundles, then scored the top 12 with 1200 simulated futures (100 per bundle) in total.");
    expect(s.stresses).toHaveLength(2);
    expect(s.stresses.every((x) => x.source === "deterministic")).toBe(true);
    // no model-authored word anywhere
    for (const l of s.log) expect(l.kind).not.toBe("commentary");
    // progress was reported while screening and cleared afterwards
    expect(s.progress).toBeUndefined();
  });

  it("machine: finalists are not near-duplicates when alternatives exist, and the no-AI card says it was ranked by deterministic search", async () => {
    const server = makeServer([]);
    const m = new AgentMachine({ api: apiFor(server), evaluate: futuresEval(), screen: screenEval(), catalog: fakeCatalog(), newMissionId: () => "mission-r5-2" });
    await m.runDeterministic(MISSION);
    const f = m.getState().finalists;
    expect(f).toHaveLength(3);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(nearDuplicate(f[i].candidateIds, f[j].candidateIds), `${i} vs ${j}`).toBe(false);
    expect(f[0].note).toContain("deterministic search (not AI)");
  });

  it("machine: without a screen dependency nothing changes (no 'screened' state, the round-by-round search runs, the hidden bundle is missed)", async () => {
    const server = makeServer([]);
    const m = new AgentMachine({ api: apiFor(server), evaluate: futuresEval(), catalog: fakeCatalog(), newMissionId: () => "mission-r5-3" });
    await m.runDeterministic(MISSION);
    const s = m.getState();
    expect(s.screened).toBeUndefined();
    expect(s.log.some((l) => l.sentence.includes("screened"))).toBe(false);
    expect(s.finalists.some((f) => OPT.every((o) => f.candidateIds.includes(o)))).toBe(false);
  });

  it("machine: a screening evaluator that throws falls back to the round-by-round search with an honest log line", async () => {
    const server = makeServer([]);
    const boom: DeterministicEvaluateFn = async () => {
      throw new Error("worker crashed");
    };
    const m = new AgentMachine({ api: apiFor(server), evaluate: futuresEval(), screen: boom, catalog: fakeCatalog(), newMissionId: () => "mission-r5-4" });
    await m.runDeterministic(MISSION);
    const s = m.getState();
    expect(s.phase).toBe("finalists");
    expect(s.screened).toBeUndefined();
    expect(s.log.some((l) => l.errors?.includes("screen_failed"))).toBe(true);
    expect(s.finalists).toHaveLength(3);
  });

  it("machine: a screen that scores fewer than three bundles falls back to the round-by-round search and says so", async () => {
    const server = makeServer([]);
    let served = false;
    const two: DeterministicEvaluateFn = async (bundles) => {
      const out = served ? [] : bundles.slice(0, 2);
      served = true;
      return { rows: out.map((b) => ({ bundleId: b.id, candidateIds: b.candidateIds, p50S: 1, p90S: 1, isolatedCount: 1, equityGapS: 1 })) };
    };
    const m = new AgentMachine({ api: apiFor(server), evaluate: futuresEval(), screen: two, catalog: fakeCatalog(), newMissionId: () => "mission-r5-8" });
    await m.runDeterministic(MISSION);
    const s = m.getState();
    expect(s.screened).toBeUndefined();
    expect(s.log.map((l) => l.sentence)).toContain("Screening scored only 2 bundles; the round-by-round deterministic search is used instead.");
    expect(s.phase).toBe("finalists");
    expect(s.finalists).toHaveLength(3);
  });

  it("machine: an abort raised by the screening evaluator itself ends the run quietly (it is not reported as a screening failure)", async () => {
    const server = makeServer([]);
    const aborting: DeterministicEvaluateFn = async () => {
      throw new DOMException("aborted", "AbortError");
    };
    const m = new AgentMachine({ api: apiFor(server), evaluate: futuresEval(), screen: aborting, catalog: fakeCatalog(), newMissionId: () => "mission-r5-9" });
    await m.runDeterministic(MISSION);
    expect(m.getState().log.some((l) => l.errors?.includes("screen_failed"))).toBe(false);
    expect(m.getState().finalists).toEqual([]);
  });

  it("machine: cancelling during the screen is silent, stops scoring, and leaves nothing behind", async () => {
    const server = makeServer([]);
    let batches = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: DeterministicEvaluateFn = async (bundles, ctx) => {
      batches++;
      await gate;
      return screenEval()(bundles, ctx);
    };
    const m = new AgentMachine({ api: apiFor(server), evaluate: futuresEval(), screen: slow, catalog: fakeCatalog(), newMissionId: () => "mission-r5-5" });
    const run = m.runDeterministic(MISSION);
    await new Promise((r) => setTimeout(r, 20));
    m.cancel();
    release();
    await run;
    expect(batches).toBe(1); // no batch after the abort
    expect(m.getState().phase).toBe("idle");
    expect(m.getState().rows).toEqual([]);
    expect(m.getState().screened).toBeUndefined();
  });

  it("AI mode never uses the screen (the exhaustive check stays a separate audit)", async () => {
    const server = makeServer([parseReply(), proposeReply([{ candidateIds: ["SP-BROENING"] }, { candidateIds: ["SP-EASTERN"] }, { candidateIds: ["SP-HARBOR"] }])]);
    const calls = { n: 0 };
    const m = new AgentMachine({ api: apiFor(server), evaluate: futuresEval(), screen: screenEval(calls), catalog: fakeCatalog(), newMissionId: () => "mission-r5-6" });
    await m.start("cut access time");
    await m.confirmGoal(MISSION).catch(() => undefined);
    expect(calls.n).toBe(0); // nothing screened while the AI planner was in charge (its later fallback is a different test)
  });

  it("when the AI planner fails before anything was scored the fallback deterministic search screens too", async () => {
    const bad = proposeReply([{ candidateIds: ["SP-BROENING"] }], { rationale: "free text" });
    const server = makeServer([parseReply(), bad, bad]);
    const calls = { n: 0 };
    const m = new AgentMachine({ api: apiFor(server), evaluate: futuresEval(), screen: screenEval(calls), catalog: fakeCatalog(), newMissionId: () => "mission-r5-7" });
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(s.mode).toBe("deterministic");
    expect(calls.n).toBe(TOTAL);
    expect(s.finalists[0].candidateIds.slice().sort()).toEqual([...OPT].sort());
  });
});

describe("R5-1: shortlist and diversity rules", () => {
  const e = (ids: string[], rank: number): ExhaustiveEntry => ({ candidateIds: ids, costTier: "$", value: rank, rank });
  it("nearDuplicate: two shared members is a near-duplicate; one is not; a single option never is", () => {
    expect(nearDuplicate(["A", "B", "C"], ["A", "B", "D"])).toBe(true);
    expect(nearDuplicate(["A", "B"], ["A", "B", "C"])).toBe(true);
    expect(nearDuplicate(["A", "B", "C"], ["A", "D", "E"])).toBe(false);
    expect(nearDuplicate(["A"], ["A", "B", "C"])).toBe(false);
  });
  it("selectShortlist: the top two thirds by rank alone, then variety, then the best of the rest; never a duplicate entry", () => {
    // ranks 1-6 are all A+B+X near-duplicates; 7+ are varied
    const ranked = [e(["A", "B", "C"], 1), e(["A", "B", "D"], 2), e(["A", "B", "E"], 3), e(["A", "B", "F"], 4), e(["A", "B", "G"], 5), e(["A", "B", "H"], 6), e(["C", "D", "E"], 7), e(["F", "G", "H"], 8), e(["A"], 9), e(["B"], 10)];
    const list = selectShortlist(ranked, 6);
    expect(list.slice(0, 4)).toEqual(ranked.slice(0, 4)); // ceil(6 * 2/3) = 4 leaders by rank alone
    expect(list).toHaveLength(6);
    expect(new Set(list).size).toBe(6);
    // the last two slots prefer variety over ranks 5 and 6, which repeat A+B
    expect(list.slice(4).map((x) => x.candidateIds.join(""))).toEqual(["CDE", "FGH"]);
    expect(selectShortlist(ranked, 100)).toHaveLength(10); // capped by what exists
    expect(selectShortlist([], 12)).toEqual([]);
    expect(selectShortlist(ranked, 6)[0]).toBe(ranked[0]); // the true leader is always in
  });
  it("shortlistBundles mints B1..Bk and never exceeds twelve", () => {
    const many = Array.from({ length: 40 }, (_, i) => e([`X${i}`], i + 1));
    const b = shortlistBundles({ ranked: many }, 99 as number);
    expect(b.length).toBeLessThanOrEqual(40);
    const capped = shortlistBundles({ ranked: many });
    expect(capped.map((x) => x.id)).toEqual(Array.from({ length: 12 }, (_, i) => `B${i + 1}`));
  });
  it("pickDiverse and greedyFinalists(diverse): no two picks share two members unless nothing else is left", () => {
    const rows = [row("B1", ["A", "B", "C"]), row("B2", ["A", "B", "D"]), row("B3", ["E", "F", "G"]), row("B4", ["A", "H", "I"]), row("B5", ["A", "B", "J"])].map((r, i) => ({ ...r, pGoal: 0.9 - i * 0.1 }));
    const plain = greedyFinalists(rows, MISSION).map((f) => f.bundleId);
    expect(plain).toEqual(["B1", "B2", "B3"]); // by rank alone: B1 and B2 are near-duplicates
    const diverse = greedyFinalists(rows, MISSION, new Set(), { diverse: true }).map((f) => f.bundleId);
    expect(diverse).toEqual(["B1", "B3", "B4"]);
    // nothing else left: near-duplicates fill the gap
    const dupOnly = [row("B1", ["A", "B", "C"]), row("B2", ["A", "B", "D"]), row("B3", ["A", "B", "E"])];
    expect(pickDiverse(dupOnly, 3)).toHaveLength(3);
    expect(greedyFinalists(dupOnly, MISSION, new Set(), { diverse: true })).toHaveLength(3);
  });
});

describe("R5-2/R5-4: signed equity gap and summary wording", () => {
  it("exhaustive accepts a negative equity gap when the goal is the equity gap, and still refuses a negative time", async () => {
    const cat = fakeCatalog();
    const ev: DeterministicEvaluateFn = async (bundles) => ({
      rows: bundles.map((b, i) => ({ bundleId: b.id, candidateIds: b.candidateIds, p50S: 1, p90S: i === 0 ? -5 : 100, isolatedCount: 1, equityGapS: i === 1 ? -40 : 10 })),
    });
    const gap = await exhaustiveSearch({ catalog: cat, mission: { ...MISSION, goal: { ...MISSION.goal, metric: "equityGap" } }, evaluate: ev, batchSize: 1000 });
    expect(gap.optimum?.value).toBe(-40); // the most negative gap ranks best
    expect(gap.evaluations).toBe(TOTAL);
    const p90 = await exhaustiveSearch({ catalog: cat, mission: MISSION, evaluate: ev, batchSize: 1000 });
    expect(p90.evaluations).toBe(TOTAL - 1); // the row with p90 = -5 was refused
  });
  it("the summary line says whose pick it was", () => {
    expect(exhaustiveSummaryLine({ rank: 93, of: 129 })).toBe("Exhaustive check: the AI's top pick is rank 93 of 129 bundles evaluated.");
    expect(exhaustiveSummaryLine({ rank: 93, of: 129 }, "deterministic")).toBe("Exhaustive check: the deterministic search's top pick is rank 93 of 129 bundles evaluated.");
    expect(exhaustiveSummaryLine({ rank: 1, of: 129 }, "deterministic")).toContain("the deterministic search's top pick is rank 1 of 129 bundles evaluated (it matches");
    expect(exhaustiveSummaryLine({ rank: 2, of: 9 }, "ai")).toContain("the AI's");
  });
});

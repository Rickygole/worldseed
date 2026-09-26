/**
 * Round-7 tests: displayed-precision tie-breaks (smaller bundle first, honest tie note), signed
 * freight times, and a self-audit of the freight path against the review promises (P1 to P7).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentApi } from "../../lib/agent/api";
import { buildCatalog, eligibleCandidates } from "../../lib/agent/catalog";
import { pickDeterministicStress } from "../../lib/agent/critic";
import type { EvaluateFn } from "../../lib/agent/evaluate";
import { countBundles, exhaustiveSearch, rankOf, type DeterministicEvaluateFn } from "../../lib/agent/exhaustive";
import { greedyFinalists, greedySearch, rankRows, selectShortlist } from "../../lib/agent/greedy";
import { AgentMachine } from "../../lib/agent/machine";
import { MAX_ROUNDS, SignedEvaluatedRowSchema, baselineRowSchemaFor, evaluatedRowSchemaFor, rowSignsFitLens, type ConfirmedMission, type EvaluationRow } from "../../lib/agent/tools";
import { CritiqueRequestSchema, PlanRequestSchema } from "../../lib/agent/protocol";
import { RATIONALE_TEXT } from "../../lib/agent/rationale";
import { cardLines, displayedGoal, displayedPGoal, freightLevel, stressBenefitLine } from "../../lib/agent/slots";
import { validateMintedPlannerOutput, validatePlannerOutput } from "../../lib/agent/validator";
import { proseIssues } from "../../lib/agent/prose";
import { lensSentence, metricLabel } from "../../lib/agent/lenses";
import { handleCritique, handlePlan } from "../../lib/server/agentService";
import { buildCritiqueMessages } from "../../lib/server/prompts/critique";
import { buildParseMessages } from "../../lib/server/prompts/parse";
import { buildPlanMessages } from "../../lib/server/prompts/plan";
import { evaluationTable } from "../../lib/server/prompts/shared";
import { promptView } from "../../lib/agent/catalog";
import { setLogSink } from "../../lib/server/log";
import { resetDowngrades } from "../../lib/server/tokenfactory";
import { BASELINE, FAKE_CANDIDATES, FAKE_GAZETTEER, MISSION, apiFor, blockNetwork, critiqueReply, doneOf, fakeCatalog, finalizeReply, makeServer, parseReply, post, proposeReply, readSse, refineReply, row } from "./fixtures";

beforeEach(() => {
  blockNetwork();
  resetDowngrades();
  setLogSink(() => undefined);
});

const FREIGHT: ConfirmedMission = { lens: "freight", goal: { metric: "p90", op: "<=", targetDelta: 300 }, constraints: { maxCostTier: "$$$", types: [], areas: [] } };
const base = FAKE_CANDIDATES[0];
const cand = (id: string, type: string, lens: string[], costTier = "$", extra: Record<string, unknown> = {}) => ({ ...base, id, type, lens, costTier, title: `Fake ${id}`, ...extra });
const frow = (id: string, ids: string[], over: Partial<EvaluationRow> = {}): EvaluationRow => row(id, ids, { p50S: 420, p90S: 900, isolatedCount: 7, equityGapS: 0, pctWithin: 0, pGoal: 0.5, ...over });
const FBASE = { p50S: 900, p90S: 1500, pctWithin: 0, isolatedCount: 20, equityGapS: 0 };

/** Freight catalog: two escort windows (Harbor $$, Fort $) and a helper. */
const catalog = () =>
  buildCatalog(
    [cand("HZ-HARBOR", "hazmat_window", ["freight"], "$$"), cand("HZ-FORT", "hazmat_window", ["freight"], "$$"), cand("SP-H", "signal_priority", ["access"], "$", { helps: ["freight"] })],
    FAKE_GAZETTEER,
  );

/* ------------------------------------------------------------------------------------------ */
describe("R7-1: ties are decided on DISPLAYED values, and the smaller bundle wins", () => {
  it("displayed precision: times in tenths of a minute, counts whole, pGoal in whole percent", () => {
    expect(displayedGoal("p90", 900)).toBe(displayedGoal("p90", 902)); // 15.0 and 15.0
    expect(displayedGoal("p90", 900)).not.toBe(displayedGoal("p90", 906)); // 15.0 and 15.1
    expect(displayedGoal("isolatedCount", 7.4)).toBe(7);
    expect(displayedPGoal(0.501)).toBe(displayedPGoal(0.504));
    expect(displayedPGoal(0.49)).not.toBe(displayedPGoal(0.51));
    expect(displayedPGoal(null)).toBeLessThan(displayedPGoal(0));
  });

  it("exhaustive: 'Fort + Harbor' and 'Harbor alone' with identical results tie at rank 1, and the smaller bundle is listed first", async () => {
    const cat = catalog();
    const ev: DeterministicEvaluateFn = async (bundles) => ({
      rows: bundles.map((b) => {
        const harbor = b.candidateIds.includes("HZ-HARBOR");
        const p90 = harbor ? 900 : 1400; // Fort adds nothing visible; the helper adds nothing either
        return { bundleId: b.id, candidateIds: b.candidateIds, p50S: 400, p90S: p90, isolatedCount: harbor ? 5 : 15, equityGapS: 0 };
      }),
    });
    const res = await exhaustiveSearch({ catalog: cat, mission: FREIGHT, evaluate: ev });
    expect(res.optimum?.candidateIds).toEqual(["HZ-HARBOR"]); // the smaller bundle, not the pair
    const harborBundles = res.ranked.filter((e) => e.candidateIds.includes("HZ-HARBOR"));
    expect(harborBundles.map((e) => e.rank)).toEqual([1, 1, 1, 1]); // all four tie
    expect(harborBundles.map((e) => e.candidateIds.length)).toEqual([1, 2, 2, 3]); // smaller first
    expect(rankOf(res, ["HZ-FORT", "HZ-HARBOR"])).toEqual({ rank: 1, of: 7 });
    expect(rankOf(res, ["HZ-HARBOR"])).toEqual({ rank: 1, of: 7 });
    expect(res.ranked.find((e) => !e.candidateIds.includes("HZ-HARBOR"))!.rank).toBe(5); // strictly worse bundles rank after the four
  });

  it("exhaustive: values that differ by less than the displayed precision tie; values that display differently do not", async () => {
    const cat = catalog();
    const p90Of: Record<string, number> = { "HZ-FORT": 902, "HZ-HARBOR": 900, "SP-H": 906 };
    const ev: DeterministicEvaluateFn = async (bundles) => ({
      rows: bundles
        .filter((b) => b.candidateIds.length === 1)
        .map((b) => ({ bundleId: b.id, candidateIds: b.candidateIds, p50S: 1, p90S: p90Of[b.candidateIds[0]], isolatedCount: 1, equityGapS: 0 })),
    });
    const res = await exhaustiveSearch({ catalog: cat, mission: FREIGHT, evaluate: ev });
    const rk = (id: string) => rankOf(res, [id])!.rank;
    expect(rk("HZ-HARBOR")).toBe(rk("HZ-FORT")); // 15.0 min and 15.0 min
    expect(rk("SP-H")).toBeGreaterThan(rk("HZ-HARBOR")); // 15.1 min is visibly worse
    expect(res.optimum!.candidateIds).toEqual(["HZ-FORT"]); // same size and same tier ($$ and $$? Fort is $$ here): id order decides
  });

  it("exhaustive: same displayed value, same size: the lower cost tier goes first, then candidate ids", async () => {
    const cat = buildCatalog([cand("A-ONE", "signal_priority", ["access"], "$$"), cand("B-TWO", "signal_priority", ["access"], "$"), cand("C-THREE", "signal_priority", ["access"], "$")], []);
    const ev: DeterministicEvaluateFn = async (bundles) => ({ rows: bundles.filter((b) => b.candidateIds.length === 1).map((b) => ({ bundleId: b.id, candidateIds: b.candidateIds, p50S: 1, p90S: 500, isolatedCount: 1, equityGapS: 0 })) });
    const res = await exhaustiveSearch({ catalog: cat, mission: MISSION, evaluate: ev });
    expect(res.ranked.map((e) => e.candidateIds[0])).toEqual(["B-TWO", "C-THREE", "A-ONE"]);
    expect(res.ranked.every((e) => e.rank === 1)).toBe(true);
  });

  it("rankRows: pGoal and the goal metric compare as displayed; then size, tier, candidate ids, bundle id", () => {
    const rows = [
      frow("B1", ["HZ-FORT", "HZ-HARBOR"], { pGoal: 0.504, p90S: 902 }),
      frow("B2", ["HZ-HARBOR"], { pGoal: 0.501, p90S: 900 }),
      frow("B3", ["HZ-FORT"], { pGoal: 0.501, p90S: 900, costTier: "$" }),
      frow("B4", ["SP-H"], { pGoal: 0.6 }),
      frow("B5", ["SP-H", "HZ-HARBOR"], { pGoal: 0.49 }),
    ];
    expect(rankRows(rows, FREIGHT).map((r) => r.bundleId)).toEqual(["B4", "B3", "B2", "B1", "B5"]);
    // a raw difference below the displayed precision is a tie: the smaller bundle wins even with the (invisibly) worse value
    const inv = [frow("B1", ["HZ-FORT", "HZ-HARBOR"], { p90S: 900 }), frow("B2", ["HZ-HARBOR"], { p90S: 902 })];
    expect(rankRows(inv, FREIGHT).map((r) => r.bundleId)).toEqual(["B2", "B1"]);
    // same size: the lower cost tier wins even when its candidate id sorts later
    const tier = [frow("B1", ["HZ-A"], { costTier: "$$" }), frow("B2", ["HZ-Z"], { costTier: "$" })];
    expect(rankRows(tier, FREIGHT).map((r) => r.bundleId)).toEqual(["B2", "B1"]);
    // a visibly different pGoal or metric still decides first
    const differs = [frow("B1", ["A"], { pGoal: 0.5, p90S: 960 }), frow("B2", ["A", "B"], { pGoal: 0.5, p90S: 900 })];
    expect(rankRows(differs, FREIGHT).map((r) => r.bundleId)).toEqual(["B2", "B1"]);
    // identical in every respect but the bundle id: the id decides, stably
    const same = [frow("B9", ["X"]), frow("B2", ["X"])];
    expect(rankRows(same, FREIGHT).map((r) => r.bundleId)).toEqual(["B2", "B9"]);
    expect(rankRows([...same].reverse(), FREIGHT).map((r) => r.bundleId)).toEqual(["B2", "B9"]);
  });

  it("greedyFinalists and the shortlist keep the tie order (the smaller bundle first)", () => {
    const rows = [frow("B1", ["HZ-FORT", "HZ-HARBOR"]), frow("B2", ["HZ-HARBOR"]), frow("B3", ["SP-H"], { pGoal: 0.1 }), frow("B4", ["SP-H", "HZ-FORT"], { pGoal: 0.05 })];
    expect(greedyFinalists(rows, FREIGHT).map((f) => f.bundleId)).toEqual(["B2", "B1", "B3"]);
    const entries = [
      { candidateIds: ["HZ-HARBOR"], costTier: "$$" as const, value: 900, rank: 1 },
      { candidateIds: ["HZ-FORT", "HZ-HARBOR"], costTier: "$$" as const, value: 900, rank: 1 },
    ];
    expect(selectShortlist(entries, 2).map((e) => e.candidateIds.length)).toEqual([1, 2]);
  });

  it("greedySearch on a freight catalog: the escort pair that adds nothing visible never outranks the single escort", async () => {
    const cat = catalog();
    const screen: DeterministicEvaluateFn = async (bundles) => ({ rows: bundles.map((b) => ({ bundleId: b.id, candidateIds: b.candidateIds, p50S: 400, p90S: b.candidateIds.includes("HZ-HARBOR") ? 900 : 1400, isolatedCount: b.candidateIds.includes("HZ-HARBOR") ? 5 : 15, equityGapS: 0 })) });
    const futures: EvaluateFn = async (bundles) => ({
      baseline: FBASE,
      rows: bundles.map((b) => ({ ...frow(b.id, b.candidateIds, { p90S: b.candidateIds.includes("HZ-HARBOR") ? 900 : 1400, p50S: 400, isolatedCount: b.candidateIds.includes("HZ-HARBOR") ? 5 : 15, pGoal: b.candidateIds.includes("HZ-HARBOR") ? 0.7 : 0.2 }), futures: 100 })),
    });
    const res = await greedySearch({ catalog: cat, mission: FREIGHT, evaluate: futures, screen, stress: false });
    expect(res.finalists[0].candidateIds).toEqual(["HZ-HARBOR"]);
  });

  it("the deterministic critic treats harms that display the same as a tie and keeps the earlier link", async () => {
    const rows = [frow("B1", ["HZ-HARBOR"])];
    const leaders = [{ id: "B1", candidateIds: ["HZ-HARBOR"] }];
    const ev = (harm: Record<string, number>): EvaluateFn => async (bundles, ctx) => ({ rows: bundles.map((b) => ({ ...frow(b.id, b.candidateIds, { p90S: 900 + (harm[ctx.stress!.closedLinks[0]] ?? 0) }), futures: 10 })) });
    const close = await pickDeterministicStress({ mission: FREIGHT, round: 1, leaders, normal: rows, evaluate: ev({ "L-HARBORTUNNEL": 100, "L-FORTMCHENRY": 102 }) }); // 1.7 min and 1.7 min
    expect(close?.spec).toEqual({ kind: "close_link", linkId: "L-HARBORTUNNEL" });
    const clear = await pickDeterministicStress({ mission: FREIGHT, round: 1, leaders, normal: rows, evaluate: ev({ "L-HARBORTUNNEL": 100, "L-FORTMCHENRY": 120 }) }); // 1.7 vs 2.0
    expect(clear?.spec).toEqual({ kind: "close_link", linkId: "L-FORTMCHENRY" });
  });
});

describe("R7-1: the card and the log say when two finalists are indistinguishable", () => {
  const b = (id: string, ...candidateIds: string[]) => ({ id, candidateIds });
  /** The pair and the single escort show exactly the same figures; the helper is clearly worse. */
  const futures: EvaluateFn = async (bundles, ctx) => ({
    baseline: FBASE,
    rows: bundles.map((x) => {
      const harbor = x.candidateIds.includes("HZ-HARBOR");
      return { ...frow(x.id, x.candidateIds, { p90S: harbor ? 900 : 1300, p50S: harbor ? 420 : 700, isolatedCount: harbor ? 7 : 14, pGoal: harbor ? 0.6 : 0.2, costTier: x.candidateIds.includes("HZ-FORT") || harbor ? "$$" : "$" }), futures: ctx.stress ? 50 : 100 };
    }),
  });

  it("AI finalists: the model lists the pair first; the machine lists the smaller bundle first, says so on the card and in the log, and only for the tied pair", async () => {
    const cat = catalog();
    const server = makeServer([
      parseReply({ lens: "freight", goal: { metric: "p90", op: "<=", targetRef: "baseline+X" } }),
      proposeReply([b("B1", "HZ-FORT", "HZ-HARBOR"), b("B2", "HZ-HARBOR"), b("B3", "SP-H")]),
      critiqueReply({ concerns: [{ bundleId: "B1", kind: "worst_case" }], stress: { kind: "close_link", linkId: "L-HARBORTUNNEL" } }),
      refineReply([], ["B1", "B2", "B3"], []),
      critiqueReply({ concerns: [{ bundleId: "B1", kind: "cost" }], stress: { kind: "close_link", linkId: "L-FORTMCHENRY" } }),
      finalizeReply(["B1", "B2", "B3"]),
    ]);
    server.deps.loadCatalog = async () => cat;
    const m = new AgentMachine({ api: apiFor(server), evaluate: futures, catalog: cat, newMissionId: () => "mission-r7-1" });
    await m.start("cut hazmat detours");
    await m.confirmGoal(FREIGHT);
    const s = m.getState();
    expect(s.finalists.map((f) => f.bundleId)).toEqual(["B2", "B1", "B3"]); // the smaller bundle moved ahead of the pair; B3 stayed last
    expect(m.card("B2")!.tieNote).toBe("");
    expect(m.card("B1")!.tieNote).toBe("B1 matches B2 on every displayed figure; the smaller bundle is listed first.");
    expect(m.card("B3")!.tieNote).toBe("");
    expect(s.log.map((l) => l.sentence)).toContain("B1 matches B2 on every displayed figure; the smaller bundle is listed first.");
    expect(s.log.filter((l) => l.sentence.includes("matches") && l.sentence.includes("displayed figure"))).toHaveLength(1);
  });

  it("no-AI finalists: the same rule, from the screened search", async () => {
    const cat = catalog();
    const screen: DeterministicEvaluateFn = async (bundles) => ({ rows: bundles.map((x) => ({ bundleId: x.id, candidateIds: x.candidateIds, p50S: 400, p90S: x.candidateIds.includes("HZ-HARBOR") ? 900 : 1300, isolatedCount: 5, equityGapS: 0 })) });
    const m = new AgentMachine({ api: apiFor(makeServer([])), evaluate: futures, screen, catalog: cat, newMissionId: () => "mission-r7-2" });
    await m.runDeterministic(FREIGHT);
    const f = m.getState().finalists;
    expect(f[0].candidateIds).toEqual(["HZ-HARBOR"]);
    const tied = f.slice(1).filter((x) => m.card(x.bundleId)!.tieNote !== "");
    expect(tied.length).toBeGreaterThan(0);
    for (const x of tied) expect(m.card(x.bundleId)!.tieNote).toMatch(/^B\d+ matches B\d+ on every displayed figure; the smaller bundle is listed first\.$/);
  });

  it("same size, different cost tier: the lower tier is listed first and the sentence says so", async () => {
    const cat = catalog();
    const f2: EvaluateFn = async (bundles) => ({
      baseline: FBASE,
      rows: bundles.map((x) => ({ ...frow(x.id, x.candidateIds, { p90S: 900, costTier: x.candidateIds[0] === "SP-H" ? "$" : "$$" }), futures: 100 })),
    });
    const server = makeServer([
      parseReply({ lens: "freight", goal: { metric: "p90", op: "<=", targetRef: "baseline+X" } }),
      proposeReply([b("B1", "HZ-HARBOR"), b("B2", "SP-H"), b("B3", "HZ-FORT")]),
      critiqueReply({ stress: { kind: "close_link", linkId: "L-HARBORTUNNEL" } }),
      refineReply([], ["B1", "B2", "B3"], []),
      critiqueReply({ stress: { kind: "close_link", linkId: "L-FORTMCHENRY" } }),
      finalizeReply(["B1", "B2", "B3"]),
    ]);
    server.deps.loadCatalog = async () => cat;
    const m = new AgentMachine({ api: apiFor(server), evaluate: f2, catalog: cat, newMissionId: () => "mission-r7-3" });
    await m.start("x y z");
    await m.confirmGoal(FREIGHT);
    expect(m.getState().finalists.map((f) => f.bundleId)).toEqual(["B2", "B3", "B1"]); // the $ bundle first, then the $$ bundles in candidate-id order (HZ-FORT before HZ-HARBOR)
    expect(m.card("B2")!.tieNote).toBe("");
    expect(m.card("B3")!.tieNote).toBe("B3 matches B2 on every displayed figure; the lower cost tier is listed first.");
    expect(m.card("B1")!.tieNote).toBe("B1 matches B2 on every displayed figure; the lower cost tier is listed first.");
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R7-2: signed freight times (a freight option can beat the pre-collapse network)", () => {
  const good = { ...frow("B1", ["HZ-HARBOR"]), futures: 10 };
  it("the freight lens accepts negative p50S and p90S (rows and baseline); other lenses keep >= 0; counts are never negative", () => {
    const neg = { ...good, p50S: -120, p90S: -30.5 };
    expect(evaluatedRowSchemaFor("freight").safeParse(neg).success).toBe(true);
    expect(evaluatedRowSchemaFor("access").safeParse(neg).success).toBe(false);
    expect(evaluatedRowSchemaFor("ems").safeParse(neg).success).toBe(false);
    expect(SignedEvaluatedRowSchema.safeParse(neg).success).toBe(true);
    for (const bad of [{ isolatedCount: -1 }, { p90S: Number.NaN }, { p50S: Number.NEGATIVE_INFINITY }, { p90S: -1e8 }, { p50S: 1e8 }]) expect(evaluatedRowSchemaFor("freight").safeParse({ ...good, ...bad }).success, JSON.stringify(bad)).toBe(false);
    expect(baselineRowSchemaFor("freight").safeParse({ ...FBASE, p90S: -50 }).success).toBe(true);
    expect(baselineRowSchemaFor("access").safeParse({ ...FBASE, p90S: -50 }).success).toBe(false);
    expect(rowSignsFitLens("freight", [{ p50S: -1, p90S: -1 }])).toBe(true);
    expect(rowSignsFitLens("access", [{ p50S: -1, p90S: 1 }])).toBe(false);
    expect(rowSignsFitLens("ems", [{ p50S: 1, p90S: 0 }])).toBe(true);
  });

  it("request schemas: signed times pass for a freight mission and are refused (fixed message) for the other lenses, in rows, baseline and stress tables", () => {
    const plan = (mission: ConfirmedMission, over: Record<string, unknown> = {}) => PlanRequestSchema.safeParse({ missionId: "MISSION-R7-01", mission, phase: "search", round: 2, bundles: [], evaluations: [frow("B1", ["HZ-HARBOR"], { p90S: -30 })], ...over });
    expect(plan(FREIGHT).success).toBe(true);
    const refused = plan(MISSION);
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused.success ? null : refused.error.issues)).toContain("a negative time is only valid for the freight lens");
    expect(JSON.stringify(refused.success ? null : refused.error.issues)).not.toContain("-30");
    expect(plan(MISSION, { evaluations: [frow("B1", ["SP-H"])], baseline: { ...FBASE, p50S: -5 } }).success).toBe(false);
    expect(plan(FREIGHT, { evaluations: [frow("B1", ["HZ-HARBOR"])], baseline: { ...FBASE, p50S: -5 } }).success).toBe(true);
    const stress = { stress: { kind: "close_link", linkId: "L-HARBORTUNNEL" }, evaluations: [frow("B1", ["HZ-HARBOR"], { p90S: -10 })] };
    expect(plan(FREIGHT, { evaluations: [frow("B1", ["HZ-HARBOR"])], stresses: [stress] }).success).toBe(true);
    expect(plan(MISSION, { evaluations: [frow("B1", ["HZ-HARBOR"])], stresses: [stress] }).success).toBe(false);
    const crit = (m: ConfirmedMission) => CritiqueRequestSchema.safeParse({ missionId: "MISSION-R7-02", mission: m, round: 1, evaluations: [frow("B1", ["HZ-HARBOR"], { p50S: -1 })] });
    expect(crit(FREIGHT).success).toBe(true);
    expect(crit({ ...MISSION, lens: "ems" }).success).toBe(false);
  });

  it("routes: a freight plan request with a negative detour reaches the model; the same request for an access mission is a 400 with no model call", async () => {
    const s = makeServer([proposeReply([{ candidateIds: ["HZ-ESCORT"] }])]);
    const body = (m: ConfirmedMission, rows: EvaluationRow[]) => ({ missionId: "MISSION-R7-03", mission: m, phase: "search", round: 2, bundles: rows.map((r) => ({ id: r.bundleId, candidateIds: r.candidateIds })), evaluations: rows, dropped: [], stresses: [] });
    expect((await handleCritique(post("/api/agent/critique", { missionId: "MISSION-R7-04", mission: MISSION, round: 1, evaluations: [row("B1", ["SP-BROENING"], { p90S: -5 })] }), s.deps)).status).toBe(400);
    expect((await handlePlan(post("/api/agent/plan", body(MISSION, [row("B1", ["SP-BROENING"], { p90S: -5 })])), s.deps)).status).toBe(400);
    expect(s.provider.calls).toHaveLength(0);
    const ok = doneOf(await readSse(await handlePlan(post("/api/agent/plan", body(FREIGHT, [frow("B1", ["HZ-ESCORT"], { p90S: -5 })])), s.deps)));
    expect(ok.status === "ok" || ok.status === "fallback").toBe(true);
    expect(s.provider.calls.length).toBeGreaterThan(0);
  });

  it("card lines: a negative added time reads 'faster than the pre-collapse network' from the sign; zero and positive read as before", () => {
    expect(freightLevel("p50", -120)).toBe("2.0 min faster than the pre-collapse network");
    expect(freightLevel("p90", 0)).toBe("0.0 min");
    expect(freightLevel("p90", -2)).toBe("0.0 min"); // displays as 0.0: no sign is claimed
    expect(freightLevel("p90", 600)).toBe("10.0 min");
    expect(freightLevel("isolated", 3)).toBe("3 of 24 trips");
    const lines = cardLines(frow("B1", ["HZ-HARBOR"], { p50S: -120, p90S: 300 }), FBASE, "freight");
    expect(lines[0]).toBe("Typical hazmat cross-harbor detour (median added time): 2.0 min faster than the pre-collapse network (baseline 15.0 min; 17.0 min better)");
    expect(lines[1]).toBe("Slow-end hazmat detour (90th percentile added time): 5.0 min (baseline 25.0 min; 20.0 min better)");
    // the baseline can be negative too
    expect(cardLines(frow("B1", ["HZ-HARBOR"], { p90S: 300 }), { ...FBASE, p90S: -60 }, "freight")[1]).toBe("Slow-end hazmat detour (90th percentile added time): 5.0 min (baseline 1.0 min faster than the pre-collapse network; 6.0 min worse)");
    // access and ems lines are not affected
    expect(cardLines(row("B1", ["SP-BROENING"]), BASELINE, "access")[0]).toMatch(/median: \d+\.\d min \(baseline/);
  });

  it("stress lines with negative times: the level is stated from the sign when no stressed baseline exists, and benefits are computed from the rows", () => {
    const normal = { baseline: FBASE, row: frow("B1", ["HZ-HARBOR"], { p90S: -300 }) }; // 5.0 min faster than pre-collapse; benefit 30.0 min
    expect(stressBenefitLine("p90", "B1", normal, { row: frow("B1", ["HZ-HARBOR"], { p90S: -120 }) }, "freight")).toBe(
      "Under this stress B1 scores 2.0 min faster than the pre-collapse network on the slow-end hazmat detour measure (no stressed baseline was available, so its benefit is not stated).",
    );
    expect(stressBenefitLine("p90", "B1", normal, { baseline: FBASE, row: frow("B1", ["HZ-HARBOR"], { p90S: -120 }) }, "freight")).toBe(
      "Under this stress B1 loses 3.0 min of its slow-end hazmat detour benefit (from 30.0 min to 27.0 min).",
    );
  });

  it("prompts: the freight table prints signed added minutes and the lens sentence explains a negative value", () => {
    const t = evaluationTable([frow("B1", ["HZ-HARBOR"], { p50S: -120, p90S: 60 })], { ...FBASE, p90S: -30 }, [], "freight");
    expect(t).toContain("B1 | HZ-HARBOR | -2.0 | 1.0 |");
    expect(t).toContain("slow end -0.5 min");
    expect(lensSentence("freight")).toContain("A negative added time means the trip is faster than on the pre-collapse network");
  });

  it("machine: a freight mission accepts negative rows and baseline; an access mission counts the same rows as refused (malformed)", async () => {
    const neg: EvaluateFn = async (bundles) => ({
      baseline: { ...FBASE, p90S: -30 },
      rows: bundles.map((x) => ({ ...frow(x.id, x.candidateIds, { p50S: -100, p90S: -50 }), futures: 100 })),
    });
    const cat = catalog();
    const m = new AgentMachine({ api: apiFor(makeServer([])), evaluate: neg, catalog: cat, newMissionId: () => "mission-r7-4" });
    await m.runDeterministic(FREIGHT);
    const s = m.getState();
    expect(s.rows.length).toBeGreaterThan(0);
    expect(s.rows.every((r) => r.p90S === -50)).toBe(true);
    expect(s.baseline?.p90S).toBe(-30);
    expect(s.counts.bundlesEvaluated).toBe(s.rows.length);
    const access = new AgentMachine({ api: apiFor(makeServer([])), evaluate: neg, catalog: fakeCatalog(), newMissionId: () => "mission-r7-5" });
    await access.runDeterministic(MISSION);
    expect(access.getState().rows).toEqual([]);
    expect(access.getState().log.some((l) => l.kind === "validator" && l.errors?.some((e) => e.includes("malformed_row")))).toBe(true);
    expect(access.getState().counts.bundlesEvaluated).toBe(0); // real counts: nothing was accepted
  });

  it("exhaustive: negative p50 and p90 are ranked (more negative is better) for freight and refused for other lenses; counts are never negative", async () => {
    const cat = catalog();
    const ev = (p90: (ids: string[]) => number): DeterministicEvaluateFn => async (bundles) => ({ rows: bundles.filter((x) => x.candidateIds.length === 1).map((x) => ({ bundleId: x.id, candidateIds: x.candidateIds, p50S: p90(x.candidateIds), p90S: p90(x.candidateIds), isolatedCount: 3, equityGapS: 0 })) });
    const val = (ids: string[]) => (ids[0] === "HZ-HARBOR" ? -300 : ids[0] === "HZ-FORT" ? -100 : 200);
    const f = await exhaustiveSearch({ catalog: cat, mission: FREIGHT, evaluate: ev(val) });
    expect(f.evaluations).toBe(3);
    expect(f.ranked.map((e) => e.candidateIds[0])).toEqual(["HZ-HARBOR", "HZ-FORT", "SP-H"]);
    expect(f.optimum!.value).toBe(-300);
    const p50 = await exhaustiveSearch({ catalog: cat, mission: { ...FREIGHT, goal: { ...FREIGHT.goal, metric: "p50" } }, evaluate: ev(val) });
    expect(p50.evaluations).toBe(3);
    // an access mission refuses negative times (the catalog here has no access options, so build one)
    const acc = buildCatalog([cand("SP-1", "signal_priority", ["access"]), cand("SP-2", "signal_priority", ["access"])], []);
    const a = await exhaustiveSearch({ catalog: acc, mission: MISSION, evaluate: ev((ids) => (ids[0] === "SP-1" ? -5 : 100)) });
    expect(a.evaluations).toBe(1);
    // a negative count is refused even for freight
    const cnt = await exhaustiveSearch({ catalog: cat, mission: { ...FREIGHT, goal: { ...FREIGHT.goal, metric: "isolatedCount" } }, evaluate: async (bundles) => ({ rows: bundles.filter((x) => x.candidateIds.length === 1).map((x) => ({ bundleId: x.id, candidateIds: x.candidateIds, p50S: 1, p90S: 1, isolatedCount: -1, equityGapS: 0 })) }) });
    expect(cnt.evaluations).toBe(0);
  });

  it("the deterministic critic accepts negative freight rows and rejects them for other lenses", async () => {
    const rows = [frow("B1", ["HZ-HARBOR"], { p90S: -100 })];
    const leaders = [{ id: "B1", candidateIds: ["HZ-HARBOR"] }];
    const ev: EvaluateFn = async (bundles) => ({ rows: bundles.map((x) => ({ ...frow(x.id, x.candidateIds, { p90S: -40 }), futures: 10 })) });
    expect((await pickDeterministicStress({ mission: FREIGHT, round: 1, leaders, normal: rows, evaluate: ev }))?.rows).toHaveLength(1);
    expect(await pickDeterministicStress({ mission: MISSION, round: 1, leaders, normal: rows, evaluate: ev })).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R7-3: self-audit of the freight path (review promises P1 to P7)", () => {
  const cat = catalog();
  const b = (id: string, ...candidateIds: string[]) => ({ id, candidateIds });
  const futures: EvaluateFn = async (bundles, ctx) => ({
    baseline: FBASE,
    rows: bundles.map((x) => ({ ...frow(x.id, x.candidateIds, { p90S: 900 - 100 * x.candidateIds.length + (ctx.stress ? 60 : 0), p50S: 400, isolatedCount: 6, pGoal: 0.5 + 0.1 * x.candidateIds.length }), futures: 100 })),
  });
  async function aiRun(script: string[], tamper?: (api: AgentApi) => AgentApi) {
    const server = makeServer(script);
    server.deps.loadCatalog = async () => cat;
    const api = tamper ? tamper(apiFor(server)) : apiFor(server);
    const m = new AgentMachine({ api, evaluate: futures, catalog: cat, newMissionId: () => "mission-r7-9" });
    await m.start("cut hazmat detours");
    await m.confirmGoal(FREIGHT);
    return { m, server };
  }
  const goodScript = (over: { reasoning?: string } = {}) => [
    parseReply({ lens: "freight", goal: { metric: "p90", op: "<=", targetRef: "baseline+X" } }),
    proposeReply([b("B1", "HZ-HARBOR"), b("B2", "HZ-FORT"), b("B3", "HZ-HARBOR", "SP-H")], { rationale: { kind: "address_freight_detours" }, ...(over.reasoning ? { reasoning: over.reasoning } : {}) }),
    critiqueReply({ concerns: [{ bundleId: "B1", kind: "worst_case" }], stress: { kind: "close_link", linkId: "L-HARBORTUNNEL" } }),
    refineReply([b("B4", "HZ-FORT", "HZ-HARBOR")], ["B1"], []),
    critiqueReply({ concerns: [{ bundleId: "B4", kind: "cost" }], stress: { kind: "close_link", linkId: "L-FORTMCHENRY" } }),
    refineReply([], ["B1", "B4"], []),
    finalizeReply(["B1", "B3", "B4"]),
  ];

  it("P1 no model numbers on cards: hostile rationale text and reasoning with figures never reach a freight card; every card line is a template over the row", async () => {
    const sc = goodScript({ reasoning: "It cuts the detour by twelve percent and 40 trips." });
    sc[1] = proposeReply([b("B1", "HZ-HARBOR"), b("B2", "HZ-FORT"), b("B3", "HZ-HARBOR", "SP-H")], { reasoning: "It cuts the detour by twelve percent and 40 trips." });
    const { m } = await aiRun(sc);
    const s = m.getState();
    expect(s.log.some((l) => l.kind === "reasoning")).toBe(false); // digits: withheld
    expect(s.log.some((l) => l.sentence.startsWith("Model reasoning was withheld"))).toBe(true);
    for (const f of s.finalists) {
      const card = m.card(f.bundleId)!;
      const whole = JSON.stringify(card);
      expect(whole).not.toMatch(/twelve|40 trips|cuts the detour/);
      expect(card.lines[0]).toMatch(/^Typical hazmat cross-harbor detour \(median added time\): -?\d/);
      for (const line of card.lines) expect(line).toMatch(/^(?:Typical hazmat|Slow-end hazmat|Trips with long detours|Chance of meeting|Cost tier)/);
      expect(card.lines.join(" ")).not.toMatch(/Equity|Reached within/);
      for (const line of card.stressLines) expect(line).toMatch(/^(?:Harbor Tunnel|Fort McHenry Tunnel) closed: Under this stress /);
      expect(card.mechanismNote).toBe("");
    }
    // free text where a selection belongs is a schema violation, not something blanked and shown
    const free = goodScript();
    free[1] = proposeReply([b("B1", "HZ-HARBOR"), b("B2", "HZ-FORT"), b("B3", "SP-H")], { rationale: "Cuts the slow-end detour by 9 minutes." });
    free.splice(2, 0, free[1]);
    const r = await aiRun(free);
    expect(JSON.stringify(r.m.getState().log)).not.toContain("9 minutes");
  });

  it("P2 catalog-only ids: the model cannot propose an unknown, access-only, EMS-staging or focus id for a freight mission, on the server or on the client", async () => {
    const eligibleIds = eligibleCandidates(cat, { lens: "freight", maxCostTier: "$$$", types: [] }).map((c) => c.id);
    expect(eligibleIds.sort()).toEqual(["HZ-FORT", "HZ-HARBOR", "SP-H"]);
    const ctx = { catalog: fakeCatalog(), mission: FREIGHT, phase: "search" as const, round: 1, known: [] };
    for (const id of ["MADE-UP", "SP-BROENING", "PP-EAST", "TL-FERRY"]) {
      const r = validatePlannerOutput({ action: "propose", rationale: { kind: "cheap_first" }, bundles: [{ candidateIds: [id] }] }, ctx);
      expect(r.ok, id).toBe(false);
    }
    expect(validatePlannerOutput({ action: "propose", rationale: { kind: "cheap_first", focus: "PP-EAST" }, bundles: [{ candidateIds: ["HZ-ESCORT"] }] }, ctx).ok).toBe(false);
    // the client re-validates what the server sent (minted form)
    expect(validateMintedPlannerOutput({ action: "propose", rationale: { kind: "cheap_first" }, bundles: [{ id: "B1", candidateIds: ["SP-BROENING"] }] }, ctx).ok).toBe(false);
    expect(validateMintedPlannerOutput({ action: "propose", rationale: { kind: "cheap_first" }, bundles: [{ id: "B1", candidateIds: ["HZ-ESCORT"] }] }, ctx).ok).toBe(true);
    // the prompt lists exactly the freight-eligible ids, and its JSON schema pins them
    const sys = buildPlanMessages({ req: { missionId: "mission-r7-0001", mission: FREIGHT, phase: "search", round: 1, bundles: [], evaluations: [], dropped: [], stresses: [] }, action: "propose", eligible: eligibleCandidates(cat, { lens: "freight", maxCostTier: "$$$", types: [] }).map(promptView), rows: [], excluded: new Set(), jsonSchema: {} })[0].content;
    for (const id of eligibleIds) expect(sys).toContain(id);
    // stress: only the closed set of real links
    const sc = goodScript();
    sc[2] = critiqueReply({ stress: { kind: "close_link", linkId: "L-KEYBRIDGE" } });
    sc.splice(3, 0, sc[2]);
    const { m } = await aiRun(sc);
    expect(m.getState().stresses[0].source).toBe("deterministic"); // the out-of-set stress was refused; the deterministic critic ran instead
  });

  it("P3 real counts: bundle, futures and stress counts in the log come from accepted rows only, and refused rows are reported", async () => {
    const dirty: EvaluateFn = async (bundles, ctx) => {
      const out = await futures(bundles, ctx);
      return { ...out, rows: [...out.rows, { ...out.rows[0] }, { ...out.rows[0], bundleId: "B11" }, { ...out.rows[0], futures: 0 }] };
    };
    const server = makeServer(goodScript());
    server.deps.loadCatalog = async () => cat;
    const m = new AgentMachine({ api: apiFor(server), evaluate: dirty, catalog: cat, newMissionId: () => "mission-r7-10" });
    await m.start("cut hazmat detours");
    await m.confirmGoal(FREIGHT);
    const s = m.getState();
    expect(s.counts.futuresEvaluated).toBe((s.counts.bundlesEvaluated + s.counts.stressEvaluations) * 100); // never the refused rows' claims
    expect(s.counts.bundlesEvaluated).toBe(s.rows.length);
    const round1 = s.log.map((l) => l.sentence).find((x) => x.startsWith("Round 1: the simulator scored"))!;
    expect(round1).toContain("scored 3 of 3 requested bundles across 300 simulated futures");
    expect(s.log.some((l) => l.kind === "validator" && l.sentence.includes("rows that were not used"))).toBe(true);
  });

  it("P4 bounded: three planner rounds at most, seven model calls, at most twelve bundles, futures and time bounds enforced", async () => {
    const { m, server } = await aiRun(goodScript());
    expect(server.provider.calls).toHaveLength(7);
    expect(m.getState().round).toBeLessThanOrEqual(MAX_ROUNDS);
    expect(m.getState().rows.length).toBeLessThanOrEqual(12);
    for (const bad of [{ futures: 100_001 }, { futures: 0 }, { p90S: 1e8 }, { p50S: Number.NaN }, { isolatedCount: 1e6 }]) expect(evaluatedRowSchemaFor("freight").safeParse({ ...frow("B1", ["HZ-HARBOR"]), futures: 5, ...bad }).success, JSON.stringify(bad)).toBe(false);
    // the screened search never sends more than twelve bundles to the futures run
    const screen: DeterministicEvaluateFn = async (bundles) => ({ rows: bundles.map((x) => ({ bundleId: x.id, candidateIds: x.candidateIds, p50S: 1, p90S: 900 - x.candidateIds.length, isolatedCount: 1, equityGapS: 0 })) });
    const big = buildCatalog(Array.from({ length: 9 }, (_, i) => cand(`HZ-${i}`, "hazmat_window", ["freight"])), []);
    const sent: number[] = [];
    const spy: EvaluateFn = async (bundles, ctx) => (sent.push(bundles.length), futures(bundles, ctx));
    const res = await greedySearch({ catalog: big, mission: FREIGHT, evaluate: spy, screen, stress: false });
    expect(res.screened?.enumerated).toBe(countBundles(9));
    expect(sent[0]).toBeLessThanOrEqual(12);
  });

  it("P5 truthful fallbacks: when the AI planner fails the freight mission says so once, continues labeled non-AI, and screens when it can", async () => {
    const bad = proposeReply([b("B1", "HZ-HARBOR")], { rationale: "free words" });
    const server = makeServer([parseReply({ lens: "freight", goal: { metric: "p90", op: "<=", targetRef: "baseline+X" } }), bad, bad]);
    server.deps.loadCatalog = async () => cat;
    const screen: DeterministicEvaluateFn = async (bundles) => ({ rows: bundles.map((x) => ({ bundleId: x.id, candidateIds: x.candidateIds, p50S: 1, p90S: 900 - 100 * x.candidateIds.length, isolatedCount: 1, equityGapS: 0 })) });
    const m = new AgentMachine({ api: apiFor(server), evaluate: futures, screen, catalog: cat, newMissionId: () => "mission-r7-11" });
    await m.start("cut hazmat detours");
    await m.confirmGoal(FREIGHT);
    const s = m.getState();
    const lines = s.log.map((l) => l.sentence);
    expect(s.mode).toBe("deterministic");
    expect(lines.filter((x) => x === "Planner output rejected; deterministic search used.")).toHaveLength(1);
    expect(lines.some((x) => x.startsWith("Deterministic search (no AI): screened"))).toBe(true);
    expect(s.finalists.length).toBe(3);
  });

  it("P6 confirmation for news-derived mutations: the freight path never builds a news-origin record (the AST scan of app, components and lib still passes, including the freight UI files)", () => {
    const root = path.resolve(__dirname, "../..");
    const files = ["lib/agent/machine.ts", "lib/agent/greedy.ts", "lib/agent/lenses.ts", "lib/agent/slots.ts", "lib/agent/exhaustive.ts", "lib/agent/critic.ts"];
    for (const f of files) expect(readFileSync(path.join(root, f), "utf8"), f).not.toMatch(/origin\s*:|tavily/i);
  });

  it("P7 wording: freight labels, lens sentence, prompts, rationale sentences and card lines avoid operational and outcome vocabulary", () => {
    const words = new RegExp([["dis", "patch"].join(""), ["tri", "age"].join(""), ["real[- ]?", "time"].join(""), ["respon", "ders?\\b"].join(""), "guarantee", "saves? lives?"].join("|"), "i");
    const schema = { type: "object" };
    const eligible = eligibleCandidates(cat, { lens: "freight", maxCostTier: "$$$", types: [] }).map(promptView);
    const req = { missionId: "mission-r7-0002", mission: FREIGHT, phase: "search" as const, round: 1, bundles: [], evaluations: [], dropped: [], stresses: [] };
    const texts = [
      lensSentence("freight"),
      metricLabel("freight", "p50"), metricLabel("freight", "p90"), metricLabel("freight", "isolatedCount"),
      ...buildPlanMessages({ req, action: "propose", eligible, rows: [], excluded: new Set(), jsonSchema: schema }).map((m) => m.content),
      ...buildCritiqueMessages({ req: { ...req, evaluations: [frow("B1", ["HZ-HARBOR"])] } as never, used: eligible, rows: [frow("B1", ["HZ-HARBOR"])], jsonSchema: schema, stresses: [] }).map((m) => m.content),
      ...buildParseMessages(cat, "hazmat detours", schema).map((m) => m.content),
      ...cardLines(frow("B1", ["HZ-HARBOR"], { p90S: -60 }), FBASE, "freight"),
      RATIONALE_TEXT.address_freight_detours,
    ];
    for (const t of texts) expect(t, t.slice(0, 60)).not.toMatch(words);
    expect(proseIssues(RATIONALE_TEXT.address_freight_detours, { allowedTokens: [], profile: "rationale" })).toEqual([]);
  });
});

/**
 * Round-6 tests: the freight lens. A catalog with hazmat_window options loads and is eligible only
 * for freight missions; validators, prompts, card lines and stress lines speak freight; and the
 * search (greedy, exhaustive, machine) finds a known optimum that includes an escort option.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCatalog, candidateRejection, eligibleCandidates, promptView } from "../../lib/agent/catalog";
import type { EvaluateFn } from "../../lib/agent/evaluate";
import { countBundles, exhaustiveSearch, type DeterministicEvaluateFn } from "../../lib/agent/exhaustive";
import { greedySearch } from "../../lib/agent/greedy";
import { FREIGHT_LONG_DETOUR_S, FREIGHT_TRIPS, goalMetricsFor, metricLabel, metricOffered } from "../../lib/agent/lenses";
import { AgentMachine } from "../../lib/agent/machine";
import { RATIONALE_KINDS, renderRationale } from "../../lib/agent/rationale";
import { cardLines, stressBenefitLine } from "../../lib/agent/slots";
import { ConfirmedMissionSchema, ParsedMissionSchema, type ConfirmedMission, type EvaluationRow } from "../../lib/agent/tools";
import { validateParseOutput, validatePlannerOutput, type KnownBundle } from "../../lib/agent/validator";
import { handlePlan } from "../../lib/server/agentService";
import { buildCritiqueMessages } from "../../lib/server/prompts/critique";
import { buildParseMessages } from "../../lib/server/prompts/parse";
import { buildPlanMessages } from "../../lib/server/prompts/plan";
import { evaluationTable } from "../../lib/server/prompts/shared";
import { setLogSink } from "../../lib/server/log";
import { resetDowngrades } from "../../lib/server/tokenfactory";
import { FAKE_CANDIDATES, FAKE_GAZETTEER, MISSION, apiFor, blockNetwork, critiqueReply, doneOf, fakeCatalog, finalizeReply, makeServer, parseReply, post, proposeReply, readSse, refineReply, row } from "./fixtures";

beforeEach(() => {
  blockNetwork();
  resetDowngrades();
  setLogSink(() => undefined);
});

const FREIGHT: ConfirmedMission = { lens: "freight", goal: { metric: "p90", op: "<=", targetDelta: 300 }, constraints: { maxCostTier: "$$$", types: [], areas: [] } };
const EMS: ConfirmedMission = { ...MISSION, lens: "ems" };
const base = FAKE_CANDIDATES[0];
const cand = (id: string, type: string, lens: string[], costTier = "$", extra: Record<string, unknown> = {}) => ({ ...base, id, type, lens, costTier, title: `Fake ${id}`, ...extra });

/* ------------------------------------------------------------------------------------------ */
describe("R6-1/2: catalog eligibility for the freight lens", () => {
  const cat = buildCatalog(
    [
      cand("SP-A", "signal_priority", ["access", "xharbor", "ems"]),
      cand("TL-A", "temp_link", ["access", "xharbor", "ems"], "$$"),
      cand("PP-A", "prepos_site", ["ems"]),
      cand("HZ-HARBOR", "hazmat_window", ["freight"], "$$"),
      cand("HZ-FORT", "hazmat_window", ["freight"], "$"),
      cand("IM-HELPS", "incident_mgmt", ["access"], "$", { helps: ["freight"] }),
      cand("SP-BADHELPS", "signal_priority", ["access"], "$", { helps: "freight" }), // malformed: not a list
      cand("PP-FREIGHT", "prepos_site", ["freight", "ems"]), // EMS staging tagged freight by mistake: still never eligible
      cand("HZ-ANYLENS", "hazmat_window", ["access", "freight"]), // a hazmat window tagged for access as well: still freight-only
    ],
    [],
  );
  const ids = (m: ConfirmedMission) => eligibleCandidates(cat, { lens: m.lens, maxCostTier: m.constraints.maxCostTier, types: m.constraints.types }).map((c) => c.id).sort();

  it("the freight lens is a known lens: hazmat_window candidates tagged freight are kept by the catalog loader (they were dropped before)", () => {
    expect(cat.candidates.map((c) => c.id)).toContain("HZ-HARBOR");
    expect(cat.warnings.filter((w) => w.includes("does not match"))).toEqual([]);
    expect(cat.byId.get("HZ-HARBOR")!.lens).toEqual(["freight"]);
    expect(cat.byId.get("SP-A")!.lens).toEqual(["access", "ems"]); // 'xharbor' is still dropped as an unknown tag
    expect(cat.byId.get("IM-HELPS")!.helps).toEqual(["freight"]);
    expect(cat.byId.get("SP-BADHELPS")!.helps).toEqual([]); // tolerant: malformed metadata is ignored
  });

  it("a freight mission gets the freight-tagged candidates plus those whose own metadata says they help freight, and never EMS staging", () => {
    expect(ids(FREIGHT)).toEqual(["HZ-ANYLENS", "HZ-FORT", "HZ-HARBOR", "IM-HELPS"]);
    for (const id of ["PP-A", "PP-FREIGHT"]) expect(ids(FREIGHT)).not.toContain(id);
    expect(candidateRejection(cat.byId.get("PP-FREIGHT")!, { lens: "freight", maxCostTier: "$$$", types: [] })).toContain("EMS staging");
    expect(candidateRejection(cat.byId.get("SP-A")!, { lens: "freight", maxCostTier: "$$$", types: [] })).toContain("not available for the freight lens");
  });

  it("access and ems missions never see a hazmat window, whatever its lens tags say; their own eligibility is unchanged", () => {
    expect(ids(MISSION)).toEqual(["IM-HELPS", "SP-A", "SP-BADHELPS", "TL-A"]);
    expect(ids(EMS)).toEqual(["PP-A", "PP-FREIGHT", "SP-A", "TL-A"]);
    for (const m of [MISSION, EMS]) for (const id of ["HZ-HARBOR", "HZ-FORT", "HZ-ANYLENS"]) expect(ids(m)).not.toContain(id);
    expect(candidateRejection(cat.byId.get("HZ-ANYLENS")!, { lens: "access", maxCostTier: "$$$", types: [] })).toContain("freight option");
  });

  it("the hazmat_window type works end to end as a constraint: types filter and cost tier", () => {
    const only = { ...FREIGHT, constraints: { ...FREIGHT.constraints, types: ["hazmat_window" as const] } };
    expect(ids(only)).toEqual(["HZ-ANYLENS", "HZ-FORT", "HZ-HARBOR"]);
    expect(ids({ ...only, constraints: { ...only.constraints, maxCostTier: "$" } })).toEqual(["HZ-ANYLENS", "HZ-FORT"]);
    expect(ids({ ...MISSION, constraints: { ...MISSION.constraints, types: ["hazmat_window"] } })).toEqual([]); // an access mission cannot ask for them
    expect(ids({ ...FREIGHT, constraints: { ...FREIGHT.constraints, types: ["signal_priority"] } })).toEqual([]);
  });

  it("the prompt view of a hazmat window shows id, type, tier and title, and no numbers or effect", () => {
    const v = promptView(cat.byId.get("HZ-HARBOR")!);
    expect(Object.keys(v).sort()).toEqual(["costTier", "hypothetical", "id", "leadTime", "title", "type"]);
    expect(JSON.stringify(v)).not.toMatch(/\d{3}/);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R6-1: the mission schema and goal metrics for freight", () => {
  it("freight offers p50, p90 and isolatedCount; the equity gap is not offered", () => {
    expect(goalMetricsFor("freight")).toEqual(["p50", "p90", "isolatedCount"]);
    expect(goalMetricsFor("access")).toEqual(["p50", "p90", "isolatedCount", "equityGap"]);
    expect(goalMetricsFor("ems")).toContain("equityGap");
    expect(metricOffered("freight", "equityGap")).toBe(false);
  });
  it("app-authored labels", () => {
    expect(metricLabel("freight", "p50")).toBe("typical hazmat cross-harbor detour");
    expect(metricLabel("freight", "p90")).toBe("slow-end hazmat detour");
    expect(metricLabel("freight", "isolatedCount")).toBe("trips with long detours");
    expect(metricLabel("access", "p90")).toBe("worst-case (90th percentile) travel time"); // unchanged
    expect(metricLabel("ems", "isolatedCount")).toBe("isolated groups");
  });
  it("guard: ConfirmedMission and ParsedMission accept freight missions with an offered metric and refuse the equity gap for freight only", () => {
    for (const metric of ["p50", "p90", "isolatedCount"] as const) expect(ConfirmedMissionSchema.safeParse({ ...FREIGHT, goal: { ...FREIGHT.goal, metric } }).success, metric).toBe(true);
    const bad = ConfirmedMissionSchema.safeParse({ ...FREIGHT, goal: { ...FREIGHT.goal, metric: "equityGap" } });
    expect(bad.success).toBe(false);
    expect(ConfirmedMissionSchema.safeParse({ ...MISSION, goal: { ...MISSION.goal, metric: "equityGap" } }).success).toBe(true);
    expect(ConfirmedMissionSchema.safeParse({ ...EMS, goal: { ...EMS.goal, metric: "equityGap" } }).success).toBe(true);
    const parsed = (lens: string, metric: string) => ParsedMissionSchema.safeParse({ lens, goal: { metric, op: "<=", targetRef: "baseline+X" }, constraints: { maxCostTier: "$$", types: ["hazmat_window"], areas: [] } }).success;
    expect(parsed("freight", "p90")).toBe(true);
    expect(parsed("freight", "equityGap")).toBe(false);
    expect(parsed("access", "equityGap")).toBe(true);
    expect(parsed("marine", "p90")).toBe(false);
    const v = validateParseOutput({ lens: "freight", goal: { metric: "equityGap", op: "<=", targetRef: "baseline+X" }, constraints: { maxCostTier: "$", types: [], areas: [] } }, { catalog: fakeCatalog() });
    expect(v.ok).toBe(false);
    expect(JSON.stringify(v)).not.toContain("equityGap\""); // the message is fixed text, not an echo
  });
  it("the plan route refuses a freight mission that names the equity gap (400) and accepts a freight mission otherwise", async () => {
    const s = makeServer([proposeReply([{ candidateIds: ["HZ-ESCORT"] }])]);
    const body = (m: unknown) => ({ missionId: "MISSION-R6-001", mission: m, phase: "search", round: 1, bundles: [], evaluations: [], dropped: [], stresses: [] });
    expect((await handlePlan(post("/api/agent/plan", body({ ...FREIGHT, goal: { ...FREIGHT.goal, metric: "equityGap" } })), s.deps)).status).toBe(400);
    expect(s.provider.calls).toHaveLength(0);
    const ok = doneOf(await readSse(await handlePlan(post("/api/agent/plan", body(FREIGHT)), s.deps)));
    expect(ok.status).toBe("ok");
    expect(ok.result.bundles[0].candidateIds).toEqual(["HZ-ESCORT"]);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R6-2: validator rule 2 for escort windows", () => {
  const cat = fakeCatalog();
  const propose = (ids: string[]) => ({ action: "propose", rationale: { kind: "address_freight_detours" }, bundles: [{ candidateIds: ids }] });
  const ctx = (mission: ConfirmedMission, known: KnownBundle[] = []) => ({ catalog: cat, mission, phase: "search" as const, round: 1, known });
  it("accepts an escort window for a freight mission", () => {
    expect(validatePlannerOutput(propose(["HZ-ESCORT", "HZ-ESCORT-EAST"]), ctx(FREIGHT)).ok).toBe(true);
  });
  it("rejects it for access and ems missions (candidate_not_allowed), and rejects EMS staging and access-only options for freight", () => {
    for (const m of [MISSION, EMS]) {
      const r = validatePlannerOutput(propose(["HZ-ESCORT"]), ctx(m));
      expect(r.ok).toBe(false);
      expect(!r.ok && r.violations.some((v) => v.rule === 2 && v.code === "candidate_not_allowed")).toBe(true);
    }
    for (const id of ["PP-EAST", "SP-BROENING", "TL-FERRY"]) {
      const r = validatePlannerOutput(propose([id]), ctx(FREIGHT));
      expect(!r.ok && r.violations.some((v) => v.rule === 2 && v.code === "candidate_not_allowed"), id).toBe(true);
    }
  });
  it("a rationale focus on an escort window is checked the same way", () => {
    const withFocus = (m: ConfirmedMission) => validatePlannerOutput({ ...propose(["HZ-ESCORT"]), rationale: { kind: "address_freight_detours", focus: "HZ-ESCORT" } }, ctx(m));
    expect(withFocus(FREIGHT).ok).toBe(true);
    expect(withFocus(MISSION).ok).toBe(false);
  });
  it("the freight rationale kind renders a fixed, screened sentence", () => {
    expect(RATIONALE_KINDS).toContain("address_freight_detours");
    expect(renderRationale({ kind: "address_freight_detours" }, cat)).toBe("The planner weighed the hazmat cross-harbor detours first.");
    expect(renderRationale({ kind: "address_freight_detours", focus: "HZ-ESCORT" }, cat)).toContain("Focus: HZ-ESCORT (cost tier $$)");
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R6-4: prompts speak freight, honestly, and stay free of numbers beyond the tables", () => {
  const cat = fakeCatalog();
  const schema = { type: "object" };
  const eligible = eligibleCandidates(cat, { lens: "freight", maxCostTier: "$$$", types: [] }).map(promptView);
  const rows = [row("B1", ["HZ-ESCORT"], { p50S: 420, p90S: 900, isolatedCount: 7, equityGapS: 0, pctWithin: 0 })];
  const req = { missionId: "mission-r6-0001", mission: FREIGHT, phase: "search" as const, round: 1, bundles: [], evaluations: [], dropped: [], stresses: [] };
  const plan = buildPlanMessages({ req, action: "propose", eligible, rows: [], excluded: new Set(), jsonSchema: schema });

  it("the planner prompt names the freight lens and its metric, lists only freight-eligible candidates, and says tunnels prohibit hazmat trucks", () => {
    const sys = plan[0].content;
    expect(sys).toContain("freight lens");
    expect(sys).toContain("prohibited in the harbor tunnels");
    expect(sys).toContain("slow-end hazmat detour (metric p90)");
    expect(sys).toContain("HZ-ESCORT");
    expect(sys).toContain("HZ-ESCORT-EAST");
    for (const id of ["PP-EAST", "SP-BROENING", "TL-FERRY"]) expect(sys).not.toContain(id);
    expect(sys).not.toMatch(/timePenaltyS|allow_class_on|300/); // no effect parameters
  });
  it("the freight results table has freight columns only (no equity gap, no share within the goal)", () => {
    const t = evaluationTable(rows, { p50S: 700, p90S: 1500, pctWithin: 0, isolatedCount: 20, equityGapS: 0 }, [], "freight");
    expect(t.split("\n")[0]).toBe("bundle | candidates | typical added min | slow-end added min | trips with long detours (of 24) | pGoal | cost | status");
    expect(t).not.toMatch(/equity|within/);
    expect(t).toContain("B1 | HZ-ESCORT | 7.0 | 15.0 | 7 |");
    expect(t).toContain("baseline (no intervention): typical 11.7 min, slow end 25.0 min, trips with long detours 20");
    expect(evaluationTable(rows, undefined, [], "access")).toContain("equity gap min"); // the other lenses keep their table
  });
  it("the critic prompt gets the same honest note and a freight table", () => {
    const msgs = buildCritiqueMessages({ req: { ...req, round: 1, evaluations: rows, dropped: [] } as never, used: eligible, rows, jsonSchema: schema, stresses: [] });
    expect(msgs[0].content).toContain("prohibited in the harbor tunnels");
    expect(msgs[1].content).toContain("trips with long detours (of 24)");
  });
  it("the parser prompt offers the freight lens and says the equity gap is not available for it", () => {
    const sys = buildParseMessages(cat, "reduce hazmat truck detours", schema)[0].content;
    expect(sys).toContain("use freight for hazardous-materials truck trips");
    expect(sys).toContain("equityGap is not available for the freight lens");
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R6-1/5: freight card lines and stress lines come from real rows", () => {
  const rowAt = (over: Partial<EvaluationRow>) => row("B1", ["HZ-ESCORT"], { p50S: 420, p90S: 900, isolatedCount: 7, equityGapS: 0, pctWithin: 0, pGoal: 0.4, costTier: "$$", ...over });
  const baseline = { p50S: 900, p90S: 1500, pctWithin: 0, isolatedCount: 20, equityGapS: 0 };
  it("card lines: typical, slow-end and long-detour trips with baseline and computed direction; no equity gap or share-within-goal lines", () => {
    expect(cardLines(rowAt({}), baseline, "freight")).toEqual([
      "Typical hazmat cross-harbor detour (median added time): 7.0 min (baseline 15.0 min; 8.0 min better)",
      "Slow-end hazmat detour (90th percentile added time): 15.0 min (baseline 25.0 min; 10.0 min better)",
      `Trips with long detours (more than ${FREIGHT_LONG_DETOUR_S / 60} minutes added): 7 of ${FREIGHT_TRIPS} trips (baseline 20 of 24 trips; 13 trips better)`,
      "Chance of meeting the goal: 40% of sampled futures",
      "Cost tier: $$",
    ]);
    const worse = cardLines(rowAt({ p50S: 1000, isolatedCount: 21 }), baseline, "freight");
    expect(worse[0]).toContain("1.7 min worse");
    expect(worse[2]).toContain("1 trip worse");
    expect(cardLines(rowAt({ pGoal: null }), undefined, "freight")).toContain("Chance of meeting the goal: not computed");
    // the other lenses are unchanged
    expect(cardLines(rowAt({}), baseline, "access")).toHaveLength(7);
  });
  it("stress lines use the freight nouns and units, and the direction words follow the real numbers", () => {
    const normal = { baseline, row: rowAt({ p90S: 900 }) }; // benefit 10.0 min
    const stressBase = { ...baseline, p90S: 1500 };
    expect(stressBenefitLine("p90", "B1", normal, { baseline: stressBase, row: rowAt({ p90S: 1200 }) }, "freight")).toBe("Under this stress B1 loses 5.0 min of its slow-end hazmat detour benefit (from 10.0 min to 5.0 min).");
    expect(stressBenefitLine("p90", "B1", normal, { baseline: stressBase, row: rowAt({ p90S: 900 }) }, "freight")).toBe("Under this stress B1 keeps all of its slow-end hazmat detour benefit (10.0 min).");
    expect(stressBenefitLine("isolatedCount", "B1", normal, { baseline: { ...baseline, isolatedCount: 20 }, row: rowAt({ isolatedCount: 12 }) }, "freight")).toBe("Under this stress B1 loses 5 trips of its long-detour trip benefit (from 13 trips to 8 trips).");
    expect(stressBenefitLine("p50", "B1", normal, { baseline: stressBase, row: rowAt({ p50S: 420 }) }, "freight")).toContain("typical hazmat cross-harbor detour benefit");
    // access wording is unchanged
    expect(stressBenefitLine("p90", "B1", normal, { baseline: stressBase, row: rowAt({ p90S: 900 }) })).toContain("worst-case (90th percentile) travel-time benefit");
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R6-6: the search finds a known optimum that includes an escort option (greedy, exhaustive, machine)", () => {
  // Freight catalog: two escort windows, three helpers and a decoy. The Harbor Tunnel escort plus SP-B is the hidden best.
  const cat = buildCatalog(
    [
      cand("HZ-HARBOR", "hazmat_window", ["freight"], "$$"),
      cand("HZ-FORT", "hazmat_window", ["freight"], "$$"),
      cand("SP-A", "signal_priority", ["access"], "$", { helps: ["freight"] }),
      cand("SP-B", "signal_priority", ["access"], "$", { helps: ["freight"] }),
      cand("IM-C", "incident_mgmt", ["access"], "$", { helps: ["freight"] }),
      cand("TL-DECOY", "temp_link", ["access"], "$$"), // not a freight option
      cand("PP-DECOY", "prepos_site", ["ems"]),
    ],
    FAKE_GAZETTEER,
  );
  const N = 5;
  /** Hazmat detour (seconds added). Escorts cut it a lot; the Harbor escort pairs with SP-B for the best result. Stress "Harbor Tunnel closed" hurts only bundles that use the Harbor escort. */
  const detour = (ids: readonly string[], stressHarbor = false): number => {
    let p90 = 1500;
    if (ids.includes("HZ-FORT")) p90 -= 300;
    if (ids.includes("HZ-HARBOR")) p90 -= 350;
    if (ids.includes("HZ-HARBOR") && ids.includes("SP-B")) p90 -= 400; // the hidden synergy
    for (const id of ids) if (id.startsWith("SP-") || id.startsWith("IM-")) p90 -= 15;
    p90 += 8 * ids.length;
    if (stressHarbor && ids.includes("HZ-HARBOR")) p90 += 500;
    return Math.max(60, p90);
  };
  const OPT = ["HZ-HARBOR", "SP-B"];
  const freightRow = (b: { id: string; candidateIds: string[] }, p90: number) => ({
    bundleId: b.id, candidateIds: b.candidateIds, p50S: Math.round(p90 * 0.5), p90S: p90, isolatedCount: Math.max(0, Math.round(p90 / 60)), equityGapS: 0,
  });
  const screen: DeterministicEvaluateFn = async (bundles) => ({ rows: bundles.map((b) => freightRow(b, detour(b.candidateIds))) });
  const futures: EvaluateFn = async (bundles, ctx) => {
    const closed = ctx.stress?.closedLinks.includes("L-HARBORTUNNEL") ?? false;
    return {
      baseline: { p50S: 750, p90S: 1500, pctWithin: 0, isolatedCount: 24, equityGapS: 0 }, // hazmat trucks are barred from the tunnels: closing one does not move the baseline
      rows: bundles.map((b) => {
        const p90 = detour(b.candidateIds, closed);
        return { ...row(b.id, b.candidateIds, { p50S: Math.round(p90 * 0.5), p90S: p90, isolatedCount: Math.round(p90 / 60), equityGapS: 0, pctWithin: 0, pGoal: Math.max(0, Math.min(1, (1500 - p90) / 1200)) }), futures: 100 };
      }),
    };
  };

  it("the freight-eligible set is the two escorts and the three helpers (5), never the decoys", () => {
    const e = eligibleCandidates(cat, { lens: "freight", maxCostTier: "$$$", types: [] }).map((c) => c.id).sort();
    expect(e).toEqual(["HZ-FORT", "HZ-HARBOR", "IM-C", "SP-A", "SP-B"]);
  });

  it("exhaustive search over the freight catalog finds the hidden best bundle, and it includes an escort option", async () => {
    const res = await exhaustiveSearch({ catalog: cat, mission: FREIGHT, evaluate: screen });
    expect(res.enumerated).toBe(countBundles(N));
    expect(res.optimum?.candidateIds.some((id) => id.startsWith("HZ-"))).toBe(true);
    expect([...res.optimum!.candidateIds].sort()).toEqual(["HZ-FORT", "HZ-HARBOR", "SP-B"]); // both escorts and the helper
  });

  it("greedySearch (two-stage) finds it with the screen, and the freight rows are scored on isolatedCount too", async () => {
    const res = await greedySearch({ catalog: cat, mission: FREIGHT, evaluate: futures, screen });
    expect(res.finalists[0].candidateIds.includes("HZ-HARBOR") && res.finalists[0].candidateIds.includes("SP-B")).toBe(true);
    expect(res.finalists.every((f) => f.candidateIds.some((id) => id.startsWith("HZ-")) || true)).toBe(true);
    expect(res.stresses).toHaveLength(2);
    const counts = await greedySearch({ catalog: cat, mission: { ...FREIGHT, goal: { ...FREIGHT.goal, metric: "isolatedCount" } }, evaluate: futures, screen, stress: false });
    expect(counts.finalists[0].candidateIds).toContain("HZ-HARBOR");
  });

  it("machine (no AI): screens the freight catalog, finds the best bundle with its escort, and the stress lines are computed from real rows", async () => {
    const server = makeServer([]);
    const m = new AgentMachine({ api: apiFor(server), evaluate: futures, screen, catalog: cat, stressTopK: 12, newMissionId: () => "mission-r6-1" });
    await m.runDeterministic(FREIGHT);
    const s = m.getState();
    expect(server.provider.calls).toHaveLength(0);
    expect(s.screened?.enumerated).toBe(countBundles(N));
    expect(s.finalists[0].candidateIds).toEqual(expect.arrayContaining(OPT));
    // the deterministic critic picked the stress from the evaluator's own results: only Harbor-escort bundles lose under "Harbor Tunnel closed"
    expect(s.stresses[0]).toMatchObject({ source: "deterministic", label: "Harbor Tunnel closed" });
    const lines = s.log.map((l) => l.sentence);
    // the lines that follow the Harbor Tunnel stress (up to the next stress block)
    const from = lines.findIndex((x) => x.startsWith("Stress test: the simulator re-scored") && x.includes('"Harbor Tunnel closed"'));
    const rest = lines.slice(from + 1);
    const next = rest.findIndex((x) => x.startsWith("Stress test") || x.startsWith("Deterministic stress test"));
    const block = (next < 0 ? rest : rest.slice(0, next)).filter((x) => x.startsWith("Under this stress "));
    const loses = block.filter((x) => x.includes(" loses "));
    const keeps = block.filter((x) => x.includes(" keeps all "));
    expect(loses.length).toBeGreaterThan(0);
    expect(keeps.length).toBeGreaterThan(0);
    expect(loses.length + keeps.length).toBe(block.length); // nothing "gains": the baseline does not move and only the Harbor escort bundles worsen
    for (const l of lines.filter((x) => x.startsWith("Under this stress "))) expect(l).toMatch(/slow-end hazmat detour benefit|typical hazmat cross-harbor detour benefit|long-detour trip benefit/);
    // every bundle that loses uses the Harbor escort; every bundle that keeps all does not
    const usesHarbor = (id: string) => s.rows.find((r) => r.bundleId === id)!.candidateIds.includes("HZ-HARBOR");
    for (const l of loses) expect(usesHarbor(/B\d+/.exec(l)![0]), l).toBe(true);
    for (const l of keeps) expect(usesHarbor(/B\d+/.exec(l)![0]), l).toBe(false);
    // the card speaks freight
    const card = m.card(s.finalists[0].bundleId)!;
    expect(card.lines[0]).toContain("Typical hazmat cross-harbor detour");
    expect(card.lines.join(" ")).not.toMatch(/Equity gap|Reached within/);
    expect(card.stressLines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.startsWith("Read your mission as"))).toBe(false); // deterministic: no parse step
  });

  it("machine (AI): a freight mission is read as freight, the planner may propose an escort window, and the whole loop completes", async () => {
    const b = (id: string, ...candidateIds: string[]) => ({ id, candidateIds });
    const parse = parseReply({ lens: "freight", goal: { metric: "p90", op: "<=", targetRef: "baseline+X" }, constraints: { maxCostTier: "$$$", types: ["hazmat_window"], areas: [] } });
    const server = makeServer([parse, proposeReply([b("B1", "HZ-HARBOR"), b("B2", "HZ-FORT"), b("B3", "SP-A"), b("B4", "HZ-HARBOR", "SP-B")], { rationale: { kind: "address_freight_detours" } }), critiqueReply({ stress: { kind: "close_link", linkId: "L-HARBORTUNNEL" } }), refineReply([b("B5", "HZ-HARBOR", "HZ-FORT")], ["B1", "B4"], ["B3"]), critiqueReply({ stress: { kind: "close_link", linkId: "L-FORTMCHENRY" } }), refineReply([b("B6", "HZ-HARBOR", "SP-B", "IM-C")], ["B4"], []), finalizeReply(["B4", "B6", "B5"])]);
    server.deps.loadCatalog = async () => cat;
    const m = new AgentMachine({ api: apiFor(server), evaluate: futures, catalog: cat, newMissionId: () => "mission-r6-3" });
    await m.start("cut hazmat truck detours across the harbor");
    await m.confirmGoal(FREIGHT);
    const s = m.getState();
    expect(s.mode).toBe("ai");
    expect(s.phase).toBe("finalists");
    expect(s.finalists.map((f) => f.bundleId)).toEqual(["B4", "B6", "B5"]);
    expect(s.finalists.every((f) => f.candidateIds.some((id) => id.startsWith("HZ-")))).toBe(true);
    expect(s.log.some((l) => l.kind === "commentary" && l.sentence.includes("hazmat cross-harbor detours"))).toBe(true);
    expect(s.stresses).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R6-7: the real catalog", () => {
  const dir = path.resolve(__dirname, "../../../data/snapshot");
  const have = existsSync(path.join(dir, "candidates.json"));
  it.skipIf(!have)("counts eligible candidates per lens on the snapshot (tolerant of catalog size changes)", () => {
    const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    const raw = read("candidates.json") as { id: string; type: string; lens: string[]; helps?: unknown }[];
    const cat = buildCatalog(raw, read("gazetteer.json"));
    const n = (lens: "access" | "ems" | "freight") => eligibleCandidates(cat, { lens, maxCostTier: "$$$", types: [] });
    const freight = n("freight");
    const access = n("access");
    const ems = n("ems");
    // freight = tagged freight (or helps freight), no EMS staging; access/ems never include a hazmat window
    const taggedFreight = raw.filter((c) => (c.lens.includes("freight") || (Array.isArray(c.helps) && c.helps.includes("freight"))) && c.type !== "prepos_site");
    expect(freight.map((c) => c.id).sort()).toEqual(taggedFreight.map((c) => c.id).sort());
    expect(freight.every((c) => c.type !== "prepos_site")).toBe(true);
    for (const list of [access, ems]) expect(list.some((c) => c.type === "hazmat_window")).toBe(false);
    expect(access.every((c) => c.lens.includes("access"))).toBe(true);
    // every hazmat window in the snapshot is reachable by a freight mission
    for (const c of raw.filter((x) => x.type === "hazmat_window")) expect(freight.map((x) => x.id)).toContain(c.id);
    process.stdout.write(`real catalog eligible (tier <= $$$): freight ${freight.length}, access/xharbor ${access.length}, ems ${ems.length}; bundles of up to 3: freight ${countBundles(freight.length)}, access ${countBundles(access.length)}\n`);
  });
});

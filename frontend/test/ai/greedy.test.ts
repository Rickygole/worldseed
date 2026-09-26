import { describe, expect, it } from "vitest";
import { greedyFinalists, greedyPlanRound, greedySearch, orderedCandidates, rankRows } from "../../lib/agent/greedy";
import { validateMintedPlannerOutput } from "../../lib/agent/validator";
import { MISSION, fakeCatalog, fakeEvaluator, row } from "./fixtures";

const catalog = fakeCatalog();

describe("greedy deterministic search", () => {
  it("orders candidates round-robin across types, cheapest first, and respects mission filters", () => {
    const ids = orderedCandidates(catalog, MISSION).map((c) => c.id);
    expect(ids.slice(0, 4)).toEqual(["HZ-ESCORT", "IM-I895", "SP-BROENING", "TL-DUNDALK"]);
    expect(ids).not.toContain("PP-EAST"); // ems-only
    const cheap = orderedCandidates(catalog, { ...MISSION, constraints: { ...MISSION.constraints, maxCostTier: "$" } }).map((c) => c.id);
    expect(cheap.every((id) => catalog.byId.get(id)!.costTier === "$")).toBe(true);
    const typed = orderedCandidates(catalog, { ...MISSION, constraints: { ...MISSION.constraints, types: ["temp_link"] } });
    expect(typed.every((c) => c.type === "temp_link")).toBe(true);
  });
  it("is deterministic: same inputs give identical bundles and finalists", async () => {
    const a = await greedySearch({ catalog, mission: MISSION, evaluate: fakeEvaluator() });
    const b = await greedySearch({ catalog, mission: MISSION, evaluate: fakeEvaluator() });
    expect(a).toEqual(b);
  });
  it("evaluates at most 12 bundles in at most 3 rounds and returns 3 distinct finalists", async () => {
    const calls: string[][] = [];
    const r = await greedySearch({ catalog, mission: MISSION, evaluate: fakeEvaluator({ calls }) });
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(calls.flat().length).toBeLessThanOrEqual(12);
    expect(new Set(calls.flat()).size).toBe(calls.flat().length);
    expect(r.finalists).toHaveLength(3);
    expect(new Set(r.finalists.map((f) => f.bundleId)).size).toBe(3);
    expect(r.futuresEvaluated).toBeGreaterThan(0);
  });
  it("its own bundles pass the same validator the planner is held to", () => {
    const round1 = greedyPlanRound({ catalog, mission: MISSION, round: 1, rows: [], known: [] });
    const r = validateMintedPlannerOutput(
      { action: "propose", rationale: { kind: "cheap_first" }, bundles: round1 },
      { catalog, mission: MISSION, phase: "search", round: 1, known: [] },
    );
    expect(r.ok).toBe(true);
    expect(round1.map((b) => b.id)).toEqual(round1.map((_, i) => `B${i + 1}`)); // the same minted ids as the AI path
  });
  it("mints ids after the known ones, never reusing one", () => {
    const r1 = greedyPlanRound({ catalog, mission: MISSION, round: 1, rows: [], known: [] });
    const rows = r1.map((b, i) => row(b.id, b.candidateIds, { pGoal: i === 0 ? 0.9 : 0.1 }));
    const r2 = greedyPlanRound({ catalog, mission: MISSION, round: 2, rows, known: r1 });
    const used = new Set(r1.map((b) => b.id));
    expect(r2.every((b) => /^B(1[0-2]|[1-9])$/.test(b.id) && !used.has(b.id))).toBe(true);
  });
  it("never proposes a duplicate set and grows the best bundle in later rounds", () => {
    const r1 = greedyPlanRound({ catalog, mission: MISSION, round: 1, rows: [], known: [] });
    const rows = r1.map((b, i) => row(b.id, b.candidateIds, { pGoal: i === 2 ? 0.9 : 0.1 }));
    const r2 = greedyPlanRound({ catalog, mission: MISSION, round: 2, rows, known: r1 });
    expect(r2.length).toBeGreaterThan(0);
    expect(r2.every((b) => b.candidateIds.includes(r1[2].candidateIds[0]) && b.candidateIds.length === 2)).toBe(true);
  });
  it("ranks by pGoal, then the goal metric, then cost, then id", () => {
    const ranked = rankRows([row("B3", ["SP-HARBOR"], { pGoal: 0.5, p90S: 900 }), row("B1", ["SP-BROENING"], { pGoal: 0.5, p90S: 800 }), row("B2", ["SP-EASTERN"], { pGoal: 0.7, p90S: 2000 })], MISSION);
    expect(ranked.map((r) => r.bundleId)).toEqual(["B2", "B1", "B3"]);
  });
  it("skips excluded bundles as finalists only while three others remain", () => {
    const rows = ["B1", "B2", "B3", "B4"].map((id, i) => row(id, [[`SP-BROENING`], ["SP-EASTERN"], ["SP-HARBOR"], ["TL-DUNDALK"]][i], { pGoal: 0.9 - i * 0.1 }));
    expect(greedyFinalists(rows, MISSION, new Set(["B1"])).map((f) => f.bundleId)).toEqual(["B2", "B3", "B4"]);
    expect(greedyFinalists(rows.slice(0, 3), MISSION, new Set(["B1"])).map((f) => f.bundleId)).toEqual(["B1", "B2", "B3"]);
  });
  it("finalist note is application-authored (labeled non-AI), number-free and short", () => {
    const f = greedyFinalists([row("B1", ["SP-BROENING"])], MISSION);
    expect(f[0].note).toContain("not AI");
    expect(f[0].note).not.toMatch(/[0-9]/);
    expect(f[0].note.length).toBeLessThanOrEqual(100);
  });
});

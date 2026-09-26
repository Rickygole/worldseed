import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCatalog, eligibleCandidates, promptView } from "../../lib/agent/catalog";
import { greedyPlanRound } from "../../lib/agent/greedy";
import { buildPlanMessages } from "../../lib/server/prompts/plan";
import { MISSION } from "./fixtures";

const dir = path.resolve(__dirname, "../../../data/snapshot");
const have = existsSync(path.join(dir, "candidates.json"));

describe.skipIf(!have)("committed snapshot catalog matches the contract (2.3)", () => {
  const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  it("parses candidates.json and gazetteer.json with the agent's schemas", () => {
    const catalog = buildCatalog(read("candidates.json"), existsSync(path.join(dir, "gazetteer.json")) ? read("gazetteer.json") : []);
    // The pipeline may still ship an empty placeholder; the contract only requires it to parse.
    expect(Array.isArray(catalog.candidates)).toBe(true);
    for (const c of catalog.candidates) expect(c.id).toMatch(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
  });
  it("gives the planner a non-empty, effect-free view and the greedy search something to try", () => {
    const catalog = buildCatalog(read("candidates.json"), read("gazetteer.json"));
    const eligible = eligibleCandidates(catalog, { lens: "access", maxCostTier: "$$$", types: [] });
    if (eligible.length === 0) return; // placeholder catalog: nothing to check yet
    expect(Object.keys(promptView(eligible[0]))).not.toContain("effect");
    const round1 = greedyPlanRound({ catalog, mission: MISSION, round: 1, rows: [], known: [] });
    expect(round1.length).toBeGreaterThan(0);
    const msgs = buildPlanMessages({ req: { missionId: "mission-real-01", mission: MISSION, phase: "search", round: 1, bundles: [], evaluations: [], dropped: [] }, action: "propose", eligible: eligible.map(promptView), rows: [], excluded: new Set(), jsonSchema: {} });
    expect(msgs[0].content).toContain(eligible[0].id);
  });
});

import { describe, expect, it } from "vitest";
import {
  computeExcluded,
  validateCritiqueOutput,
  validateNarrationOutput,
  validateParseOutput,
  validatePlannerOutput,
  type KnownBundle,
  type PlannerContext,
  type Violation,
} from "../../lib/agent/validator";
import { fakeCatalog, MISSION } from "./fixtures";

const catalog = fakeCatalog();
const known = (ids: string[], evaluated = true): KnownBundle[] => ids.map((id, i) => ({ id, candidateIds: [["SP-BROENING", "SP-EASTERN", "SP-HARBOR", "TL-DUNDALK"][i % 4]], evaluated }));

function ctx(over: Partial<PlannerContext> = {}): PlannerContext {
  return { catalog, mission: MISSION, phase: "search", round: 1, known: [], ...over };
}
const propose = (over: Record<string, unknown> = {}) => ({
  action: "propose", log_sentence: "Trying two mixes.", hypothesis: "Retiming and a link help.",
  bundles: [{ id: "B1", candidateIds: ["SP-BROENING"] }, { id: "B2", candidateIds: ["SP-EASTERN", "TL-DUNDALK"] }], ...over,
});
const fails = (r: { ok: boolean; violations?: Violation[] }) => (r.ok ? [] : (r.violations as Violation[]));
const has = (r: { ok: boolean; violations?: Violation[] }, rule: number, code?: string) =>
  fails(r).some((v) => v.rule === rule && (!code || v.code === code));

describe("validator rule 1: schema, unknown keys rejected", () => {
  it("accepts a valid propose", () => {
    expect(validatePlannerOutput(propose(), ctx()).ok).toBe(true);
  });
  it("rejects unknown keys", () => {
    const r = validatePlannerOutput(propose({ score: 0.9 }), ctx());
    expect(has(r, 1, "unknown_keys")).toBe(true);
  });
  it("rejects wrong shapes and over-long sentences", () => {
    expect(has(validatePlannerOutput({ action: "propose" }, ctx()), 1)).toBe(true);
    expect(has(validatePlannerOutput(propose({ log_sentence: "x".repeat(161) }), ctx()), 1)).toBe(true);
    expect(has(validatePlannerOutput("not an object", ctx()), 1)).toBe(true);
    expect(has(validatePlannerOutput(propose({ bundles: [] }), ctx()), 1)).toBe(true);
  });
  it("rejects parser and critic output with unknown keys", () => {
    const bad = { lens: "access", goal: { metric: "p90", op: "<=", targetRef: "baseline+X" }, constraints: { maxCostTier: "$", types: [], areas: [] }, log_sentence: "ok", extra: 1 };
    expect(has(validateParseOutput(bad, { catalog }), 1, "unknown_keys")).toBe(true);
    expect(has(validateCritiqueOutput({ action: "critique", log_sentence: "ok", concerns: [], wat: 1 }, { catalog, known: [] }), 1)).toBe(true);
  });
  it("rejects a numeric target in the parser output (target comes from a chip picker)", () => {
    const bad = { lens: "access", goal: { metric: "p90", op: "<=", targetRef: "baseline+8" }, constraints: { maxCostTier: "$", types: [], areas: [] }, log_sentence: "ok" };
    expect(validateParseOutput(bad, { catalog }).ok).toBe(false);
  });
});

describe("validator rule 2: IDs, lens, cost tier, types, gazetteer", () => {
  it("rejects unknown candidate IDs", () => {
    const r = validatePlannerOutput(propose({ bundles: [{ id: "B1", candidateIds: ["NOPE-1"] }] }), ctx());
    expect(has(r, 2, "unknown_candidate")).toBe(true);
  });
  it("rejects a candidate that is not for the mission lens", () => {
    const r = validatePlannerOutput(propose({ bundles: [{ id: "B1", candidateIds: ["PP-EAST"] }] }), ctx());
    expect(has(r, 2, "candidate_not_allowed")).toBe(true);
  });
  it("rejects a candidate above maxCostTier", () => {
    const m = { ...MISSION, constraints: { ...MISSION.constraints, maxCostTier: "$$" as const } };
    const r = validatePlannerOutput(propose({ bundles: [{ id: "B1", candidateIds: ["TL-FERRY"] }] }), ctx({ mission: m }));
    expect(has(r, 2, "candidate_not_allowed")).toBe(true);
  });
  it("rejects a candidate whose type is not allowed", () => {
    const m = { ...MISSION, constraints: { ...MISSION.constraints, types: ["signal_priority" as const] } };
    const r = validatePlannerOutput(propose({ bundles: [{ id: "B1", candidateIds: ["TL-DUNDALK"] }] }), ctx({ mission: m }));
    expect(has(r, 2, "candidate_not_allowed")).toBe(true);
    expect(validatePlannerOutput(propose({ bundles: [{ id: "B1", candidateIds: ["SP-EASTERN"] }] }), ctx({ mission: m })).ok).toBe(true);
  });
  it("rejects gazetteer IDs that do not exist", () => {
    const bad = { lens: "access", goal: { metric: "p90", op: "<=", targetRef: "baseline+X" }, constraints: { maxCostTier: "$", types: [], areas: ["G-ATLANTIS"] }, log_sentence: "ok" };
    expect(has(validateParseOutput(bad, { catalog }), 2, "unknown_gazetteer")).toBe(true);
    expect(validateParseOutput({ ...bad, constraints: { ...bad.constraints, areas: ["G-DUNDALK"] } }, { catalog }).ok).toBe(true);
  });
});

describe("validator rule 3: bundle structure and the evaluated cap", () => {
  it("rejects more than 3 candidates in a bundle (schema) and repeated candidates", () => {
    const four = propose({ bundles: [{ id: "B1", candidateIds: ["SP-BROENING", "SP-EASTERN", "SP-HARBOR", "TL-DUNDALK"] }] });
    expect(validatePlannerOutput(four, ctx()).ok).toBe(false);
    const rep = propose({ bundles: [{ id: "B1", candidateIds: ["SP-BROENING", "SP-BROENING"] }] });
    expect(has(validatePlannerOutput(rep, ctx()), 3, "duplicate_candidate")).toBe(true);
  });
  it("rejects duplicate bundles regardless of candidate order, and duplicate IDs", () => {
    const dup = propose({ bundles: [{ id: "B1", candidateIds: ["SP-BROENING", "SP-EASTERN"] }, { id: "B2", candidateIds: ["SP-EASTERN", "SP-BROENING"] }] });
    expect(has(validatePlannerOutput(dup, ctx()), 3, "duplicate_bundle")).toBe(true);
    const sameId = propose({ bundles: [{ id: "B1", candidateIds: ["SP-BROENING"] }, { id: "B1", candidateIds: ["SP-EASTERN"] }] });
    expect(has(validatePlannerOutput(sameId, ctx()), 3, "duplicate_bundle_id")).toBe(true);
  });
  it("rejects a refine that duplicates an already evaluated bundle", () => {
    const k: KnownBundle[] = [{ id: "B1", candidateIds: ["SP-BROENING"], evaluated: true }];
    const r = validatePlannerOutput({ action: "refine", log_sentence: "More.", keep: ["B1"], drop: [], add: [{ id: "B2", candidateIds: ["SP-BROENING"] }] }, ctx({ round: 2, known: k }));
    expect(has(r, 3, "duplicate_bundle")).toBe(true);
  });
  it("rejects keep/drop of unknown bundles and keep+drop overlap", () => {
    const k: KnownBundle[] = [{ id: "B1", candidateIds: ["SP-BROENING"], evaluated: true }];
    const a = validatePlannerOutput({ action: "refine", log_sentence: "More.", keep: ["B9"], drop: [], add: [] }, ctx({ round: 2, known: k }));
    expect(has(a, 3, "unknown_bundle")).toBe(true);
    const b = validatePlannerOutput({ action: "refine", log_sentence: "More.", keep: ["B1"], drop: ["B1"], add: [] }, ctx({ round: 2, known: k }));
    expect(has(b, 3, "keep_and_drop")).toBe(true);
  });
  it("enforces at most 12 evaluated bundles per mission", () => {
    const k: KnownBundle[] = Array.from({ length: 11 }, (_, i) => ({ id: `K${i}`, candidateIds: [`X${i}`], evaluated: true }));
    const r = validatePlannerOutput(
      { action: "refine", log_sentence: "More.", keep: [], drop: [], add: [{ id: "B1", candidateIds: ["SP-BROENING"] }, { id: "B2", candidateIds: ["SP-EASTERN"] }] },
      ctx({ round: 2, known: k }),
    );
    expect(has(r, 3, "too_many_bundles")).toBe(true);
  });
});

describe("validator rule 4: rounds and token budget", () => {
  it("rejects round above 3", () => {
    expect(has(validatePlannerOutput(propose(), ctx({ round: 4 })), 4, "round_limit")).toBe(true);
  });
  it("rejects an action that does not match the phase and round", () => {
    const r = validatePlannerOutput(propose(), ctx({ round: 2, known: known(["B1"]) }));
    expect(has(r, 4, "wrong_action")).toBe(true);
    const f = validatePlannerOutput(propose(), ctx({ phase: "finalize" }));
    expect(has(f, 4, "wrong_action")).toBe(true);
  });
  it("rejects when the per-mission token budget is exceeded", () => {
    const over = { inputUsed: 61_000, outputUsed: 100, inputLimit: 60_000, outputLimit: 12_000 };
    expect(has(validatePlannerOutput(propose(), ctx({ budget: over })), 4, "token_budget")).toBe(true);
    const ok = { inputUsed: 10_000, outputUsed: 100, inputLimit: 60_000, outputLimit: 12_000 };
    expect(validatePlannerOutput(propose(), ctx({ budget: ok })).ok).toBe(true);
  });
});

describe("validator rule 5: no numbers in prose fields", () => {
  it("rejects digits in log_sentence, hypothesis, tradeoff and critic notes", () => {
    expect(has(validatePlannerOutput(propose({ log_sentence: "Cuts delay by 12 minutes" }), ctx()), 5, "digits")).toBe(true);
    expect(has(validatePlannerOutput(propose({ hypothesis: "Gains 8 percent" }), ctx()), 5, "digits")).toBe(true);
    const k = known(["B1", "B2", "B3"]);
    const fin = { action: "finalize", log_sentence: "Done.", finalists: ["B1", "B2", "B3"].map((bundleId, i) => ({ bundleId, tradeoff: i === 1 ? "Saves 5 min" : "Cheaper." })) };
    expect(has(validatePlannerOutput(fin, ctx({ phase: "finalize", known: k })), 5, "digits")).toBe(true);
    const crit = { action: "critique", log_sentence: "ok", concerns: [{ bundleId: "B1", kind: "cost", note: "costs 3 times more" }] };
    expect(has(validateCritiqueOutput(crit, { catalog, known: known(["B1"]) }), 5)).toBe(true);
  });
  it("accepts slot placeholders and rejects malformed ones", () => {
    expect(validatePlannerOutput(propose({ hypothesis: "Expect {{p90.delta}} to shrink." }), ctx()).ok).toBe(true);
    expect(has(validatePlannerOutput(propose({ hypothesis: "Expect {{7}} to shrink." }), ctx()), 5, "bad_slot")).toBe(true);
  });
  it("checks narration prose too", () => {
    const n = { action: "narrate", items: [{ bundleId: "B1", headline: "Option", body: "Adds 4 minutes" }] };
    expect(has(validateNarrationOutput(n, { catalog, finalistIds: ["B1"] }), 5, "digits")).toBe(true);
  });
});

describe("validator rule 6: finalize names exactly 3 distinct evaluated bundles", () => {
  const fin = (ids: string[]) => ({ action: "finalize", log_sentence: "Done.", finalists: ids.map((bundleId) => ({ bundleId, tradeoff: "A tradeoff." })) });
  const k = known(["B1", "B2", "B3", "B4"]);
  const c = (over: Partial<PlannerContext> = {}) => ctx({ phase: "finalize", round: 2, known: k, ...over });
  it("accepts three distinct evaluated bundles", () => {
    expect(validatePlannerOutput(fin(["B1", "B2", "B3"]), c()).ok).toBe(true);
  });
  it("rejects fewer or more than three (schema)", () => {
    expect(validatePlannerOutput(fin(["B1", "B2"]), c()).ok).toBe(false);
    expect(validatePlannerOutput(fin(["B1", "B2", "B3", "B4"]), c()).ok).toBe(false);
  });
  it("rejects duplicates, unknown and unevaluated bundles", () => {
    expect(has(validatePlannerOutput(fin(["B1", "B1", "B2"]), c()), 6, "duplicate_finalist")).toBe(true);
    expect(has(validatePlannerOutput(fin(["B1", "B2", "B9"]), c()), 6, "unknown_finalist")).toBe(true);
    const pending = [...known(["B1", "B2", "B3"]), { id: "B4", candidateIds: ["TL-LONG"], evaluated: false }];
    expect(has(validatePlannerOutput(fin(["B1", "B2", "B4"]), c({ known: pending })), 6, "unevaluated_finalist")).toBe(true);
  });
  it("rejects dropped or vetoed bundles when enough others remain", () => {
    const ex = computeExcluded(["B1", "B2", "B3", "B4"], ["B4"], []);
    expect(has(validatePlannerOutput(fin(["B1", "B2", "B4"]), c({ excludedBundleIds: ex })), 6, "excluded_finalist")).toBe(true);
    // Exclusion is ignored when it would leave fewer than three.
    expect(computeExcluded(["B1", "B2", "B3"], ["B3"], []).size).toBe(0);
  });
});

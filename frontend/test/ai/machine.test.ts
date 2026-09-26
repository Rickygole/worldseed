import { beforeEach, describe, expect, it } from "vitest";
import type { AgentApi } from "../../lib/agent/api";
import { AgentMachine, type MachineState, type Phase } from "../../lib/agent/machine";
import { ProviderError, resetDowngrades } from "../../lib/server/tokenfactory";
import type { EvaluateFn } from "../../lib/agent/evaluate";
import {
  MISSION, apiFor, blockNetwork, critiqueReply, fakeCatalog, fakeEvaluator, finalizeReply, makeServer,
  narrateReply, parseReply, proposeReply, refineReply, type Scripted,
} from "./fixtures";

beforeEach(() => {
  blockNetwork();
  resetDowngrades();
});

const b = (id: string, ...candidateIds: string[]) => ({ id, candidateIds });
const B1234 = [b("B1", "SP-BROENING"), b("B2", "SP-EASTERN"), b("B3", "SP-HARBOR"), b("B4", "TL-DUNDALK")];
const happyScript = (): Scripted[] => [
  parseReply(),
  proposeReply(B1234),
  refineReply([b("B5", "SP-BROENING", "SP-EASTERN")], ["B1", "B2"], ["B4"]),
  refineReply([b("B6", "HZ-ESCORT", "IM-I895")], ["B5"], []),
  critiqueReply({ concerns: [{ bundleId: "B5", kind: "equity", note: "Helps the east side more than the west." }], veto: [] }),
  finalizeReply(["B5", "B6", "B3"]),
  narrateReply(["B5", "B6", "B3"]),
];

function harness(script: Scripted[], evaluate: EvaluateFn = fakeEvaluator(), cfg = {}) {
  const server = makeServer(script, cfg);
  const applied: unknown[] = [];
  const m = new AgentMachine({ api: apiFor(server), evaluate, catalog: fakeCatalog(), newMissionId: () => "mission-machine-1", onApply: (x) => void applied.push(x) });
  const phases: Phase[] = [];
  m.subscribe(() => {
    const p = m.getState().phase;
    if (phases.at(-1) !== p) phases.push(p);
  });
  return { server, m, phases, applied };
}
const sentences = (s: MachineState) => s.log.map((l) => l.sentence);

describe("state machine: full AI mission through the real server handlers", () => {
  it("walks idle -> parsing -> confirmGoal -> planning/evaluating x3 -> critiquing -> finalizing -> finalists -> applied", async () => {
    const { m, phases, applied, server } = harness(happyScript());
    await m.start("cut cross-harbor access time near Dundalk");
    expect(m.getState().phase).toBe("confirmGoal");
    expect(m.getState().parsed?.constraints.areas).toEqual(["G-DUNDALK"]);
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(phases).toEqual(["parsing", "confirmGoal", "planning", "evaluating", "planning", "evaluating", "planning", "evaluating", "critiquing", "finalizing", "finalists"]);
    expect(s.mode).toBe("ai");
    expect(s.finalists.map((f) => f.bundleId)).toEqual(["B5", "B6", "B3"]);
    expect(s.critique?.concerns[0].bundleId).toBe("B5");
    expect(Object.keys(s.narration)).toEqual(["B5", "B6", "B3"]);
    expect(s.models).toMatchObject({ planner: "nvidia/Nemotron-3-Ultra-550b-a55b", parser: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", critic: "nvidia/Nemotron-3-Ultra-550b-a55b", narrator: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" });
    expect(server.provider.calls).toHaveLength(7);

    await m.apply("B5");
    expect(m.getState().phase).toBe("applied");
    expect(applied).toEqual([{ bundleId: "B5", candidateIds: ["SP-BROENING", "SP-EASTERN"] }]);
  });

  it("logs the REAL counts the evaluator reports, including partial scoring", async () => {
    const calls: string[][] = [];
    // The evaluator silently fails to score B2 and reports what it really did.
    const { m } = harness(happyScript(), fakeEvaluator({ futures: 50, dropIds: ["B2"], calls }));
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    // round 1: 4 requested, 3 scored, 3*50+50 futures; round 2: 1 scored, 100 futures; round 3: 1 scored, 100 futures
    expect(sentences(s)).toContain("Round 1: the simulator scored 3 of 4 requested bundles across 200 simulated futures, computed locally in your browser.");
    expect(sentences(s)).toContain("Round 2: the simulator scored 1 of 1 requested bundles across 100 simulated futures, computed locally in your browser.");
    expect(s.counts).toEqual({ bundlesEvaluated: 5, futuresEvaluated: 400 });
    expect(s.rows.map((r) => r.bundleId)).not.toContain("B2");
    expect(calls).toEqual([["B1", "B2", "B3", "B4"], ["B5"], ["B6"]]);
  });

  it("shows the budget meter from server usage events and fills narration slots from simulator results", async () => {
    const { m } = harness(happyScript());
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(s.budget.inputTokens).toBe(7 * 1200);
    expect(s.budget.outputTokens).toBe(7 * 300);
    expect(s.budget.fraction).toBeCloseTo(Math.max((7 * 1200) / 60000, (7 * 300) / 12000));
    const filled = m.fill(s.narration.B5.body, "B5");
    expect(filled).not.toContain("{{");
    expect(filled).toMatch(/min/);
    expect(m.fill("Unknown {{p90.delta}} here")).toContain("n/a"); // no focus bundle, so unresolved, never a raw brace
  });

  it("puts raw tool JSON and model names in the decision log", async () => {
    const { m } = harness(happyScript());
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const d = m.getState().log.find((l) => l.kind === "decision" && (l.raw as { action?: string } | undefined)?.action === "propose");
    expect(d?.model).toBe("nvidia/Nemotron-3-Ultra-550b-a55b");
    expect(d?.sentence).toBe("Trying signal and link mixes across types.");
  });

  it("cancel aborts in-flight work and returns to idle without applying anything", async () => {
    let seenSignal: AbortSignal | undefined;
    const hang: EvaluateFn = (_b, ctx) => new Promise((_res, rej) => { seenSignal = ctx.signal; ctx.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))); });
    const { m, applied } = harness(happyScript(), hang);
    await m.start("cut access time");
    const run = m.confirmGoal(MISSION);
    await new Promise((r) => setTimeout(r, 30));
    expect(m.getState().phase).toBe("evaluating");
    m.cancel();
    await run;
    expect(seenSignal?.aborted).toBe(true);
    expect(m.getState().phase).toBe("idle");
    expect(m.getState().log.at(-1)?.sentence).toContain("cancelled");
    expect(applied).toEqual([]);
  });

  it("refuses to confirm or apply out of order", async () => {
    const { m } = harness(happyScript());
    await expect(m.confirmGoal(MISSION)).rejects.toThrow();
    await expect(m.apply("B1")).rejects.toThrow();
  });
});

describe("state machine: fallbacks", () => {
  it("planner unavailable at parse returns to idle with the manual-mode message", async () => {
    const server = makeServer([]);
    server.deps.provider = null;
    const m = new AgentMachine({ api: apiFor(server), evaluate: fakeEvaluator(), catalog: fakeCatalog() });
    await m.start("cut access time");
    expect(m.getState()).toMatchObject({ phase: "idle", degraded: { reason: "planner_unavailable", message: "AI planner unavailable. Explore manually.", next: "deterministic_search" } });
  });

  it("global budget exhausted at parse shows the recorded-run message", async () => {
    const { m } = harness([parseReply()], fakeEvaluator(), { dailyBudgetUsd: 0.00001 });
    await m.start("cut access time");
    expect(m.getState().degraded).toMatchObject({ reason: "budget_exhausted", next: "recorded_tour", message: "Daily AI budget reached; try the recorded run." });
  });

  it("two rejected planner outputs switch the mission to deterministic search, labeled, and it still finishes", async () => {
    const digits = proposeReply(B1234, { log_sentence: "Saves 9 minutes" });
    const { m, server } = harness([parseReply(), digits, digits]);
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(s.phase).toBe("finalists");
    expect(s.mode).toBe("deterministic");
    expect(s.degraded?.reason).toBe("output_rejected");
    const text = sentences(s);
    expect(text.filter((x) => x === "Planner output rejected; deterministic search used.")).toHaveLength(1); // logged once, not duplicated
    expect(s.log.some((l) => l.kind === "validator" && l.errors?.some((e) => e.includes("digits")))).toBe(true);
    expect(s.finalists).toHaveLength(3);
    expect(s.finalists.every((f) => f.bundleId.startsWith("S"))).toBe(true);
    expect(server.provider.calls).toHaveLength(3); // parse + planner + ONE repair, then no more model calls
    expect(Object.keys(s.narration)).toHaveLength(0); // no AI narration in deterministic mode
  });

  it("a mid-mission timeout or 429 continues deterministically", async () => {
    const { m } = harness([parseReply(), new ProviderError("timeout", "slow"), new ProviderError("timeout", "slow")]);
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    expect(m.getState()).toMatchObject({ phase: "finalists", mode: "deterministic", degraded: { reason: "upstream_error" } });
    const h2 = harness([parseReply(), new ProviderError("rate_limited", "x", 429, 5), new ProviderError("rate_limited", "x", 429, 5)]);
    await h2.m.start("cut access time");
    await h2.m.confirmGoal(MISSION);
    expect(h2.m.getState()).toMatchObject({ phase: "finalists", mode: "deterministic" });
  });

  it("a mid-mission per-mission token budget hit continues deterministically", async () => {
    const { m } = harness([parseReply(), proposeReply(B1234)], fakeEvaluator(), { missionOutputTokens: 500 });
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    expect(m.getState()).toMatchObject({ phase: "finalists", mode: "deterministic", degraded: { reason: "mission_budget_exhausted" } });
  });

  it("client-side validator rejects a tampered server response (defense in depth)", async () => {
    const api: AgentApi = {
      parse: async () => ({ status: "ok", model: "m", usage: { inputTokens: 0, outputTokens: 0 }, repaired: false, result: JSON.parse(parseReply()) }),
      plan: async () => ({ status: "ok", model: "m", usage: { inputTokens: 0, outputTokens: 0 }, repaired: false, result: JSON.parse(proposeReply([b("B1", "NOT-IN-CATALOG")])) }),
      critique: async () => { throw new Error("unexpected"); },
      narrate: async () => { throw new Error("unexpected"); },
    };
    const m = new AgentMachine({ api, evaluate: fakeEvaluator(), catalog: fakeCatalog() });
    await m.start("x y z");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(s.mode).toBe("deterministic");
    expect(s.log.some((l) => l.kind === "validator" && l.errors?.some((e) => e.includes("unknown_candidate")))).toBe(true);
    expect(s.phase).toBe("finalists");
  });

  it("a rejected critic is skipped but the mission continues in AI mode", async () => {
    const script = happyScript();
    script[4] = "not json";
    script.splice(5, 0, "still not json"); // critic repair also bad; then finalize, narrate follow
    const { m } = harness(script);
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(s.mode).toBe("ai");
    expect(s.critique).toBeUndefined();
    expect(sentences(s).some((x) => x.includes("continuing without a critique") || x.includes("Continuing without a critique"))).toBe(true);
    expect(s.finalists.map((f) => f.bundleId)).toEqual(["B5", "B6", "B3"]);
  });

  it("tops up with deterministic singles when the planner scores fewer than three bundles", async () => {
    const { m } = harness([parseReply(), proposeReply([b("B1", "SP-BROENING")]), refineReply([]), finalizeReply(["B1", "S2", "S3"]), narrateReply(["B1", "S2", "S3"])]);
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(s.rows.length).toBeGreaterThanOrEqual(3);
    expect(sentences(s).some((x) => x.includes("deterministic search (not AI) added some"))).toBe(true);
    expect(s.finalists).toHaveLength(3);
  });
});

describe("state machine: empty catalog", () => {
  it("ends honestly in idle instead of showing empty finalists", async () => {
    const server = makeServer([]);
    const { buildCatalog } = await import("../../lib/agent/catalog");
    const m = new AgentMachine({ api: apiFor(server), evaluate: fakeEvaluator(), catalog: buildCatalog([], []) });
    await m.runDeterministic(MISSION);
    expect(m.getState()).toMatchObject({ phase: "idle", degraded: { reason: "catalog_unavailable" } });
    expect(m.getState().finalists).toEqual([]);
  });
});

describe("state machine: deterministic search button", () => {
  it("makes no model calls at all and labels itself non-AI", async () => {
    const server = makeServer([]);
    const m = new AgentMachine({ api: apiFor(server), evaluate: fakeEvaluator(), catalog: fakeCatalog() });
    await m.runDeterministic(MISSION);
    const s = m.getState();
    expect(server.provider.calls).toHaveLength(0);
    expect(s.phase).toBe("finalists");
    expect(s.mode).toBe("deterministic");
    expect(s.log[0].sentence).toContain("not AI");
    expect(s.finalists).toHaveLength(3);
    expect(s.counts.bundlesEvaluated).toBeLessThanOrEqual(12);
  });
});

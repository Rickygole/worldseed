import { beforeEach, describe, expect, it } from "vitest";
import type { AgentApi } from "../../lib/agent/api";
import { AgentMachine, CARD_TEXT_LABEL, type MachineState, type Phase } from "../../lib/agent/machine";
import { ProviderError, resetDowngrades } from "../../lib/server/tokenfactory";
import type { EvaluateFn } from "../../lib/agent/evaluate";
import { UI_MESSAGES } from "../../lib/agent/protocol";
import {
  BASELINE, MISSION, apiFor, blockNetwork, critiqueReply, fakeCatalog, fakeEvaluator, finalizeReply, makeServer,
 parseReply, proposeReply, refineReply, row, type Scripted,
} from "./fixtures";

beforeEach(() => {
  blockNetwork();
  resetDowngrades();
});

const b = (id: string, ...candidateIds: string[]) => ({ id, candidateIds });
const B1234 = [b("B1", "SP-BROENING"), b("B2", "SP-EASTERN"), b("B3", "SP-HARBOR"), b("B4", "TL-DUNDALK")];
const HARBOR = { kind: "close_link", linkId: "L-HARBORTUNNEL" };
const FORT = { kind: "close_link", linkId: "L-FORTMCHENRY" };
/** parse, propose, critic (stress 1), refine, critic (stress 2), refine, finalize: seven model calls. */
const happyScript = (): Scripted[] => [
  parseReply(),
  proposeReply(B1234),
  critiqueReply({ concerns: [{ bundleId: "B1", kind: "worst_case" }], stress: HARBOR }),
  refineReply([b("B5", "SP-BROENING", "SP-EASTERN")], ["B1", "B2"], ["B4"]),
  critiqueReply({ concerns: [{ bundleId: "B5", kind: "equity" }], veto: [], stress: FORT }),
  refineReply([b("B6", "HZ-ESCORT", "IM-I895")], ["B5"], []),
  finalizeReply(["B5", "B6", "B3"]),
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
    expect(phases).toEqual(["parsing", "confirmGoal", "planning", "evaluating", "critiquing", "evaluating", "planning", "evaluating", "critiquing", "evaluating", "planning", "evaluating", "finalizing", "finalists"]);
    expect(s.mode).toBe("ai");
    expect(s.finalists.map((f) => f.bundleId)).toEqual(["B5", "B6", "B3"]);
    expect(s.critique?.concerns[0].bundleId).toBe("B5");
    expect(s.narration).toEqual({}); // cards carry no model text; the narrator is off by default
    expect(s.models).toMatchObject({ planner: "nvidia/Nemotron-3-Ultra-550b-a55b", parser: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", critic: "nvidia/Nemotron-3-Ultra-550b-a55b" });
    expect(s.models.narrator).toBeUndefined();
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
    // each accepted row carries its own futures count (50 here): round 1 has 3 rows, rounds 2 and 3 one each
    expect(sentences(s)).toContain("Round 1: the simulator scored 3 of 4 requested bundles across 150 simulated futures, computed locally in your browser.");
    expect(sentences(s)).toContain("Round 2: the simulator scored 1 of 1 requested bundles across 50 simulated futures, computed locally in your browser.");
    // 250 futures for the five scored bundles, plus 300 for the two stress tests (three leaders each, 50 futures per row)
    expect(s.counts).toEqual({ bundlesEvaluated: 5, futuresEvaluated: 550, stressEvaluations: 6 });
    expect(s.rows.map((r) => r.bundleId)).not.toContain("B2");
    expect(calls).toEqual([["B1", "B2", "B3", "B4"], ["B5"], ["B6"]]);
  });

  it("shows the budget meter from server usage events and builds cards from application and catalog text only", async () => {
    const { m } = harness(happyScript());
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(s.budget.inputTokens).toBe(7 * 1200);
    expect(s.budget.outputTokens).toBe(7 * 300);
    expect(s.budget.fraction).toBeCloseTo(Math.max((7 * 1200) / 48000, (7 * 300) / 9000));
    // the card: application headline and result lines from the bundle's own row, plus the catalog's own description
    const card = m.card("B5")!;
    expect(card.headline).toContain("B5:");
    expect(card.lines.join("\n")).toMatch(/\d+\.\d min \(baseline \d+\.\d min; [\d.]+ min (better|worse)\)/);
    expect(card.lines.at(-1)).toBe("Cost tier: $");
    expect(card.commentaryLabel).toBe(CARD_TEXT_LABEL);
    expect(card.commentary).toBe(fakeCatalog().byId.get("SP-BROENING")!.mechanism + " " + fakeCatalog().byId.get("SP-EASTERN")!.mechanism); // B5 = SP-BROENING + SP-EASTERN
    expect(card.mechanismNote).toBe("");
    expect(card.lines.join(" ")).not.toContain("{{");
    expect(m.fill("Unknown {{p90.delta}} here")).toContain("n/a"); // no focus bundle, so unresolved, never a raw brace
  });

  it("logs what the planner did in application words, then its rationale selection under the unverified-rationale label", async () => {
    const { m } = harness(happyScript());
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const log = m.getState().log;
    const d = log.find((l) => l.kind === "decision" && (l.raw as { action?: string } | undefined)?.action === "propose");
    expect(d?.model).toBe("nvidia/Nemotron-3-Ultra-550b-a55b");
    expect(d?.sentence).toBe("Round 1: the planner proposed 4 bundles (B1, B2, B3, B4).");
    const c = log.filter((l) => l.kind === "commentary").map((l) => l.sentence);
    expect(c).toContain("AI rationale (unverified; not a result) (planner): The planner chose options that work through different kinds of intervention.");
    expect(c.every((x) => x.startsWith("AI rationale (unverified; not a result)"))).toBe(true);
    // the parse line is an application template, not model text
    expect(sentences(m.getState())).toContain("Read your mission as: access lens, lower worst-case (90th percentile) travel time (you set the target next), cost tier up to $$, areas Dundalk.");
  });

  it("finding NEW-7: the decision log's raw JSON is the client-validated value, not the server-supplied tool_call args", async () => {
    const server = makeServer(happyScript());
    const api = apiFor(server);
    // a hostile or buggy server sends tool_call args that differ from the result it returns
    const lying: AgentApi = {
      ...api,
      plan: async (req, opts) => {
        opts?.onEvent?.({ event: "tool_call", data: { name: "propose", args: { action: "propose", rationale: "Saves twelve minutes. Nobody is isolated." }, model: "m", repaired: false } });
        return api.plan(req, opts);
      },
    };
    const m = new AgentMachine({ api: lying, evaluate: fakeEvaluator(), catalog: fakeCatalog(), newMissionId: () => "mission-raw-1" });
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const raws = m.getState().log.filter((l) => l.raw !== undefined).map((l) => JSON.stringify(l.raw));
    expect(raws.join("\n")).not.toContain("Nobody is isolated");
    expect(raws.join("\n")).not.toContain("twelve");
    const propose = m.getState().log.find((l) => (l.raw as { action?: string } | undefined)?.action === "propose");
    expect((propose?.raw as { bundles: { id: string }[] }).bundles.map((b) => b.id)).toEqual(["B1", "B2", "B3", "B4"]); // minted, validated
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
    const digits = proposeReply(B1234, { rationale: "Saves 9 minutes" });
    const { m, server } = harness([parseReply(), digits, digits]);
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(s.phase).toBe("finalists");
    expect(s.mode).toBe("deterministic");
    expect(s.degraded?.reason).toBe("output_rejected");
    const text = sentences(s);
    expect(text.filter((x) => x === "Planner output rejected; deterministic search used.")).toHaveLength(1); // logged once, not duplicated
    expect(s.log.some((l) => l.kind === "validator" && l.errors?.some((e) => e.includes("rule 1")))).toBe(true);
    expect(s.finalists).toHaveLength(3);
    expect(s.finalists.every((f) => /^B(1[0-2]|[1-9])$/.test(f.bundleId))).toBe(true); // minted ids, same scheme as the AI path
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
      plan: async () => ({ status: "ok", model: "m", usage: { inputTokens: 0, outputTokens: 0 }, repaired: false, result: { action: "propose", rationale: { kind: "cheap_first" }, bundles: [{ id: "B1", candidateIds: ["NOT-IN-CATALOG"] }] } }),
      critique: async () => { throw new Error("unexpected"); },
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
    script[2] = "not json";
    script.splice(3, 0, "still not json"); // the first critic's repair is also bad; the deterministic critic runs the stress test
    const { m } = harness(script);
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(s.mode).toBe("ai");
    expect(sentences(s)).toContain(UI_MESSAGES.criticRejected);
    expect(sentences(s).some((x) => x.startsWith("Deterministic stress test (no AI):"))).toBe(true); // the stress step still ran, labeled non-AI
    expect(s.stresses[0]).toMatchObject({ source: "deterministic" });
    expect(s.finalists.map((f) => f.bundleId)).toEqual(["B5", "B6", "B3"]);
  });

  it("tops up with deterministic singles when the planner scores fewer than three bundles", async () => {
    const { m } = harness([parseReply(), proposeReply([b("B1", "SP-BROENING")]), critiqueReply(), refineReply([]), finalizeReply(["B1", "B2", "B3"])]);
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

/* ------------------------------------------------------------------------------------------ */
/* integrity review: apply, stale runs, counts, labels                                         */
/* ------------------------------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("P2: apply is atomic, and cancel is truthful while applying", () => {
  const withApply = (onApply: () => Promise<unknown>) => {
    const applied: string[] = [];
    const server = makeServer(happyScript());
    const m = new AgentMachine({
      api: apiFor(server), evaluate: fakeEvaluator(), catalog: fakeCatalog(), newMissionId: () => "mission-apply-1",
      onApply: async (x) => { applied.push(x.bundleId); await onApply(); },
    });
    return { m, applied };
  };
  it("guard: apply() outside the finalists phase is refused", async () => {
    const { m } = harness(happyScript());
    await expect(m.apply("B5")).rejects.toThrow("no finalists");
  });
  it("sets the phase to 'applying' synchronously, so a second apply cannot call onApply again", async () => {
    const { m, applied } = withApply(() => sleep(10));
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const first = m.apply("B5");
    expect(m.getState().phase).toBe("applying"); // before any await
    const second = m.apply("B6");
    await expect(second).rejects.toThrow();
    await first;
    expect(applied).toEqual(["B5"]);
    expect(m.getState()).toMatchObject({ phase: "applied", appliedBundleId: "B5" });
    await expect(m.apply("B5")).rejects.toThrow(); // and not after it is applied either
    expect(applied).toEqual(["B5"]);
  });
  it("cancel while applying is refused and never claims 'nothing was applied'", async () => {
    const { m, applied } = withApply(() => sleep(10));
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const p = m.apply("B5");
    m.cancel();
    m.reset();
    await p;
    const text = sentences(m.getState());
    expect(text.some((x) => x.includes("cannot be cancelled"))).toBe(true);
    expect(text.filter((x) => x.includes("Nothing was applied"))).toEqual([]);
    expect(applied).toEqual(["B5"]);
    expect(m.getState().phase).toBe("applied");
  });
  it("a failed onApply returns to finalists with a truthful message and rethrows", async () => {
    const server = makeServer(happyScript());
    const m = new AgentMachine({
      api: apiFor(server), evaluate: fakeEvaluator(), catalog: fakeCatalog(), newMissionId: () => "mission-apply-2",
      onApply: async () => { throw new Error("host failure"); },
    });
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    await expect(m.apply("B5")).rejects.toThrow("host failure");
    expect(m.getState().phase).toBe("finalists");
    expect(sentences(m.getState()).at(-1)).toContain("did not complete");
    expect(sentences(m.getState()).join(" ")).not.toContain("host failure");
  });
});

describe("P2: a cancelled run cannot write into the next mission", () => {
  it("drops the stale evaluator result, log lines and progress of a cancelled run", async () => {
    const gates: (() => void)[] = [];
    const base = fakeEvaluator();
    const slow: EvaluateFn = async (bundles, ctx) => {
      await new Promise<void>((r) => gates.push(r));
      ctx.onProgress?.(1, 1); // a late progress tick from the old run
      return base(bundles, ctx);
    };
    const ids = ["mission-aaaa-1", "mission-bbbb-2"];
    const server = makeServer(happyScript());
    const m = new AgentMachine({ api: apiFor(server), evaluate: slow, catalog: fakeCatalog(), newMissionId: () => ids.shift()! });
    await m.start("cut access time");
    const oldRun = m.confirmGoal(MISSION);
    await sleep(20);
    expect(m.getState().phase).toBe("evaluating");
    m.cancel();
    const newRun = m.runDeterministic({ ...MISSION, goal: { ...MISSION.goal, metric: "p50" } });
    await sleep(5);
    const oldGate = gates.shift()!; // the OLD mission's evaluation, still pending
    const lengthBefore = m.getState().log.length;
    oldGate(); // release it while the new mission is in flight
    await sleep(30);
    while (gates.length) { gates.shift()!(); await sleep(30); }
    await Promise.allSettled([oldRun, newRun]);
    const s = m.getState();
    expect(s.missionId).toBe("mission-bbbb-2");
    expect(s.mission?.goal.metric).toBe("p50");
    expect(s.mode).toBe("deterministic");
    expect(s.phase).toBe("finalists");
    // only deterministic bundles (round-1 singles) from the new run, none of the old run's B1..B4
    expect(s.bundles.every((x) => x.candidateIds.length >= 1)).toBe(true);
    // nothing from the old run (4 requested bundles, planner decisions) was written after the cancel
    expect(s.log.slice(lengthBefore).every((l) => !l.sentence.includes("of 4 requested") && l.kind !== "validator" && !l.model)).toBe(true);
    expect(s.models).toEqual({});
    expect(s.counts.bundlesEvaluated).toBe(s.rows.length);
  });
  it("guard: after cancel() a mission that was waiting on the network stays cancelled", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const server = makeServer([parseReply()]);
    const api = apiFor(server);
    const slowApi: AgentApi = { ...api, parse: async (req, opts) => { await gate; return api.parse(req, opts); } };
    const m = new AgentMachine({ api: slowApi, evaluate: fakeEvaluator(), catalog: fakeCatalog(), newMissionId: () => "mission-net-1" });
    const started = m.start("cut access time");
    m.cancel();
    release();
    await started;
    expect(m.getState().phase).toBe("idle");
    expect(m.getState().parsed).toBeUndefined();
  });
});

describe("finding NEW-7 (client side, R2-1): what the server sends is validated again, and no model text can be shown", () => {
  it("a server that slips free text into the rationale is refused by the client: the mission switches to deterministic search and the text is nowhere in the log", async () => {
    const server = makeServer(happyScript());
    const api = apiFor(server);
    const permissive: AgentApi = {
      ...api,
      plan: async (req, opts) => {
        const out = await api.plan(req, opts);
        if (out.status === "ok" && out.result.action === "propose") return { ...out, result: { ...out.result, rationale: "Nobody is left isolated and it is cheaper." } as never };
        return out;
      },
    };
    const m = new AgentMachine({ api: permissive, evaluate: fakeEvaluator(), catalog: fakeCatalog(), newMissionId: () => "mission-raw-2" });
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const log = m.getState().log;
    expect(JSON.stringify(log)).not.toContain("Nobody");
    expect(m.getState().mode).toBe("deterministic");
    expect(log.some((l) => l.kind === "validator" && l.errors?.some((e) => e.includes("rule 1")))).toBe(true);
  });
  it("extra fields a server adds are refused too (unknown keys), so text cannot ride along", async () => {
    const server = makeServer(happyScript());
    const api = apiFor(server);
    const noisy: AgentApi = {
      ...api,
      plan: async (req, opts) => {
        const out = await api.plan(req, opts);
        if (out.status === "ok" && out.result.action === "propose") return { ...out, result: { ...out.result, extra: "Nobody is left isolated" } as never };
        return out;
      },
    };
    const m = new AgentMachine({ api: noisy, evaluate: fakeEvaluator(), catalog: fakeCatalog(), newMissionId: () => "mission-raw-3" });
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    expect(JSON.stringify(m.getState().log)).not.toContain("Nobody");
  });
});

describe("P3: counts come from accepted rows, and refused rows are reported with their own reason", () => {
  const dupEvaluator: EvaluateFn = async (bundles) => {
    const rows = bundles.flatMap((x) => [{ ...row(x.id, x.candidateIds, { p90S: 1000 }), futures: 40 }, { ...row(x.id, x.candidateIds, { p90S: 100 }), futures: 40 }]);
    return { rows, baseline: BASELINE, bundlesEvaluated: 999, futuresEvaluated: 123456 } as never; // aggregate claims are not part of the contract and are ignored
  };
  it("accepts only the first row per bundle and does not inflate the counts", async () => {
    const { m } = harness(happyScript(), dupEvaluator);
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(new Set(s.rows.map((r) => r.bundleId)).size).toBe(s.rows.length);
    expect(s.rows.find((r) => r.bundleId === "B1")?.p90S).toBe(1000); // first row wins
    expect(s.counts.bundlesEvaluated).toBe(s.rows.length);
    expect(s.counts.futuresEvaluated).toBe((s.rows.length + s.counts.stressEvaluations) * 40); // the SUM of accepted rows' own futures, never the aggregate claim
    expect(sentences(s).some((x) => x.includes("rows that were not used"))).toBe(true);
    expect(s.log.find((l) => l.errors?.some((e) => e.startsWith("duplicate_row")))).toBeDefined();
  });
  it("refuses rows for unknown bundles, with candidates that differ, or that are malformed - each with its code", async () => {
    let first = true;
    const mixed: EvaluateFn = async (bundles, ctx) => {
      if (!first) return fakeEvaluator()(bundles, ctx);
      first = false;
      return {
        rows: [
          { ...row("B1", ["SP-BROENING"]), futures: 10 },
          { ...row("B12", ["SP-EASTERN"]), futures: 10 }, // a valid id, but not requested
          { ...row(bundles[1].id, ["SP-HARBOR"]), futures: 10 }, // wrong candidates for that bundle
          { ...row(bundles[2].id, bundles[2].candidateIds), p90S: Number.NaN, futures: 10 }, // malformed
          { ...row(bundles[3].id, bundles[3].candidateIds) } as never, // no futures count: malformed
        ],
        baseline: BASELINE,
      };
    };
    const { m } = harness(happyScript(), mixed);
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const codes = m.getState().log.flatMap((l) => l.errors ?? []).join(" ");
    expect(codes).toContain("unknown_bundle: 1");
    expect(codes).toContain("candidate_mismatch: 1");
    expect(codes).toContain("malformed_row: 2"); // one is NaN, one has no futures count
    expect(sentences(m.getState()).some((x) => x.startsWith("Round 1: the simulator scored 1 of 4 requested bundles"))).toBe(true);
  });
  it("when nothing is accepted it says so with its own reason, not 'no catalog intervention could be evaluated'", async () => {
    const bad: EvaluateFn = async (bundles) => ({ rows: bundles.map((x) => ({ ...row("B12", x.candidateIds), futures: 100 })), baseline: BASELINE });
    const { m } = harness(happyScript(), bad);
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(s.phase).toBe("idle");
    expect(s.degraded).toMatchObject({ reason: "evaluation_failed", message: "The simulator returned no usable rows for the requested bundles." });
    expect(sentences(s).join(" ")).not.toContain("No catalog intervention");
    expect(s.counts.bundlesEvaluated).toBe(0);
    expect(s.counts.futuresEvaluated).toBe(0);
  });
  it("guard: a row already accepted in an earlier round cannot be replaced by a later duplicate", async () => {
    let n = 0;
    const later: EvaluateFn = async (bundles, ctx) => {
      const base = await fakeEvaluator()(bundles, ctx);
      if (n++ === 1) return { ...base, rows: [...base.rows, { ...row("B1", ["SP-BROENING"], { p90S: 1 }), futures: 100 }] };
      return base;
    };
    const { m } = harness(happyScript(), later);
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    expect(m.getState().rows.filter((r) => r.bundleId === "B1")).toHaveLength(1);
    expect(m.getState().rows.find((r) => r.bundleId === "B1")?.p90S).not.toBe(1);
  });
});

describe("P5: fallback labels say what actually happened, per role", () => {
  const bad = { extra: "field" };
  it("a rejected parse returns to idle with a parser-specific message and no deterministic-switch claim", async () => {
    const { m } = harness([parseReply(bad), parseReply(bad)]);
    await m.start("cut access time");
    const s = m.getState();
    expect(s.phase).toBe("idle");
    expect(s.degraded).toMatchObject({ reason: "output_rejected", message: UI_MESSAGES.parserRejected });
    expect(s.mode).toBe("ai");
    expect(sentences(s).join(" ")).not.toContain("deterministic search used");
  });
  it("a rejected critic keeps the mission in AI mode and does not claim a deterministic switch", async () => {
    const badCrit = critiqueReply({ score: 3 });
    const script = happyScript();
    script[4] = badCrit;
    script.splice(5, 0, badCrit);
    const { m } = harness(script);
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(s.mode).toBe("ai");
    expect(s.degraded).toBeUndefined();
    expect(sentences(s)).toContain(UI_MESSAGES.criticRejected);
    expect(sentences(s).filter((x) => x === UI_MESSAGES.criticRejected)).toHaveLength(1); // once, not twice
    expect(sentences(s).join(" ")).not.toContain("deterministic search used");
    expect(s.finalists).toHaveLength(3); // the rest of the AI path still ran
  });
  it("a rejected planner really does switch, and only then says so", async () => {
    const digits = proposeReply(B1234, { rationale: "Saves 9 minutes" });
    const { m } = harness([parseReply(), digits, digits]);
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    expect(m.getState().mode).toBe("deterministic");
    expect(sentences(m.getState())).toContain(UI_MESSAGES.outputRejected);
  });
  it("a finalist carries no model text: mechanismNote is empty on the finalist and the card", async () => {
    const { m } = harness(happyScript());
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const st = m.getState();
    expect(st.finalists.every((f) => f.mechanismNote === "")).toBe(true);
    expect(st.narration).toEqual({});
    for (const id of ["B5", "B6", "B3"]) {
      const card = m.card(id)!;
      expect(card.mechanismNote).toBe("");
      expect(card.commentaryLabel).toBe(CARD_TEXT_LABEL);
    }
  });
});

describe("test debt: stale run gates (a cancelled run cannot write through any channel)", () => {
  it("guard: late server events (log and usage) from a cancelled run's API call are dropped", async () => {
    const server = makeServer(happyScript());
    const api = apiFor(server);
    let late: ((e: never) => void) | undefined;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowApi: AgentApi = {
      ...api,
      plan: async (req, opts) => {
        late = opts?.onEvent as (e: never) => void;
        await gate;
        return api.plan(req, opts);
      },
    };
    const ids = ["mission-late-1", "mission-late-2"];
    const m = new AgentMachine({ api: slowApi, evaluate: fakeEvaluator(), catalog: fakeCatalog(), newMissionId: () => ids.shift()! });
    await m.start("cut access time");
    const oldRun = m.confirmGoal(MISSION);
    await sleep(20);
    expect(late).toBeDefined();
    m.cancel();
    const newRun = m.runDeterministic(MISSION);
    await sleep(5);
    const before = m.getState().log.length;
    const budgetBefore = m.getState().budget;
    late!({ event: "log", data: { kind: "info", sentence: "STALE EVENT FROM THE OLD RUN" } } as never);
    late!({ event: "usage", data: { role: "planner", model: "m", inputTokens: 1, outputTokens: 1, mission: { inputTokens: 29_999, outputTokens: 5_999, limitIn: 30_000, limitOut: 6_000 } } } as never);
    expect(m.getState().log.length).toBe(before);
    expect(sentences(m.getState()).join(" ")).not.toContain("STALE EVENT");
    expect(m.getState().budget).toEqual(budgetBefore);
    release();
    await Promise.allSettled([oldRun, newRun]);
    expect(sentences(m.getState()).join(" ")).not.toContain("STALE EVENT");
  });
  it("guard: a late progress tick from a cancelled run's evaluator does not set progress", async () => {
    let tick: ((done: number, total: number) => void) | undefined;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: EvaluateFn = async (b, ctx) => {
      tick = ctx.onProgress;
      await gate;
      return fakeEvaluator()(b, ctx);
    };
    const server = makeServer(happyScript());
    const ids = ["mission-tick-1", "mission-tick-2"];
    const m = new AgentMachine({ api: apiFor(server), evaluate: slow, catalog: fakeCatalog(), newMissionId: () => ids.shift() as string });
    await m.start("cut access time");
    const oldRun = m.confirmGoal(MISSION);
    await sleep(20);
    expect(m.getState().phase).toBe("evaluating");
    m.cancel();
    expect(m.getState().progress).toBeUndefined();
    tick!(7, 9); // the old evaluator ticks after the cancel
    expect(m.getState().progress).toBeUndefined();
    release();
    await oldRun;
    expect(m.getState().phase).toBe("idle");
    expect(m.getState().progress).toBeUndefined();
  });
});

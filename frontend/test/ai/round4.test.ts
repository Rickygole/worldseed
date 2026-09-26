/**
 * Round-4 tests: the adversarial stress loop (AI critic and deterministic critic), the optional
 * model reasoning field, and the removal of the narrator. Everything is synthetic.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentApi } from "../../lib/agent/api";
import { pickDeterministicStress } from "../../lib/agent/critic";
import type { EvaluateFn } from "../../lib/agent/evaluate";
import { AgentMachine, type MachineState } from "../../lib/agent/machine";
import { REASONING_LABEL, REASONING_MAX_CHARS, screenReasoning } from "../../lib/agent/reasoning";
import { STRESS_LINKS, linkStresses, stressContext } from "../../lib/agent/stress";
import { benefitLoss, stressBenefitLine } from "../../lib/agent/slots";
import { handleCritique, handlePlan } from "../../lib/server/agentService";
import { ROLES } from "../../lib/server/models";
import { setLogSink } from "../../lib/server/log";
import { resetDowngrades } from "../../lib/server/tokenfactory";
import {
  BASELINE, FAKE_CANDIDATES, MISSION, apiFor, blockNetwork, critiqueReply, doneOf, fakeCatalog, fakeEvaluator, finalizeReply, makeServer, parseReply, post, proposeReply, readSse, refineReply, row, type Scripted,
} from "./fixtures";

beforeEach(() => {
  blockNetwork();
  resetDowngrades();
  setLogSink(() => undefined);
});

const b = (id: string, ...candidateIds: string[]) => ({ id, candidateIds });
const B1234 = [b("B1", "SP-BROENING"), b("B2", "SP-EASTERN"), b("B3", "SP-HARBOR"), b("B4", "TL-DUNDALK")];
const HARBOR = { kind: "close_link", linkId: "L-HARBORTUNNEL" };
const FORT = { kind: "close_link", linkId: "L-FORTMCHENRY" };
const script = (): Scripted[] => [
  parseReply(),
  proposeReply(B1234),
  critiqueReply({ concerns: [{ bundleId: "B1", kind: "worst_case" }], stress: HARBOR }),
  refineReply([b("B5", "SP-BROENING", "SP-EASTERN")], ["B1", "B2"], ["B4"]),
  critiqueReply({ concerns: [{ bundleId: "B5", kind: "equity" }], veto: [], stress: FORT }),
  refineReply([b("B6", "HZ-ESCORT", "IM-I895")], ["B5"], []),
  finalizeReply(["B5", "B6", "B3"]),
];
const sentences = (s: MachineState) => s.log.map((l) => l.sentence);

async function aiMission(sc: Scripted[] = script(), evaluate: EvaluateFn = fakeEvaluator(), wrap?: (api: AgentApi) => AgentApi) {
  const server = makeServer(sc);
  const api = wrap ? wrap(apiFor(server)) : apiFor(server);
  const m = new AgentMachine({ api, evaluate, catalog: fakeCatalog(), newMissionId: () => "mission-r4-1" });
  await m.start("cut access time");
  await m.confirmGoal(MISSION);
  return { m, server };
}

/* ------------------------------------------------------------------------------------------ */
describe("R4-1: the adversarial stress loop (propose, simulate, attack, re-simulate, refine, finalize)", () => {
  it("the critic's chosen stress reaches the evaluator as a closed-set context, on the leading bundles", async () => {
    const stressCalls: { label: string; closedLinks: string[]; tod?: string; ids: string[] }[] = [];
    const { m } = await aiMission(script(), fakeEvaluator({ stressCalls }));
    expect(stressCalls.map((c) => c.label)).toEqual(["Harbor Tunnel closed", "Fort McHenry Tunnel closed"]);
    expect(stressCalls[0]).toMatchObject({ closedLinks: ["L-HARBORTUNNEL"], tod: undefined });
    expect(stressCalls[0].ids.length).toBeLessThanOrEqual(4); // the leaders only, not every bundle
    expect(stressCalls[1].ids).not.toContain("B4"); // dropped by the planner: no longer a leader
    expect(m.getState().stresses.map((s) => [s.label, s.source])).toEqual([["Harbor Tunnel closed", "ai"], ["Fort McHenry Tunnel closed", "ai"]]);
  });

  it("time-of-day and combined stresses reach the evaluator as such", async () => {
    const stressCalls: { label: string; closedLinks: string[]; tod?: string; ids: string[] }[] = [];
    const sc = script();
    sc[2] = critiqueReply({ concerns: [{ bundleId: "B1", kind: "worst_case" }], stress: { kind: "time_of_day", tod: "pm" } });
    sc[4] = critiqueReply({ concerns: [{ bundleId: "B5", kind: "equity" }], stress: { kind: "combined", linkId: "L-FORTMCHENRY", tod: "am" } });
    await aiMission(sc, fakeEvaluator({ stressCalls }));
    expect(stressCalls[0]).toMatchObject({ closedLinks: [], tod: "pm", label: "Evening peak conditions" });
    expect(stressCalls[1]).toMatchObject({ closedLinks: ["L-FORTMCHENRY"], tod: "am" });
  });

  it("the log lines are the application's, computed from real rows: 'loses' for a bundle that depends on the closed link, 'gains' where the baseline suffered more", async () => {
    // Every bundle containing SP-BROENING is fragile to the Harbor Tunnel closure.
    const { m } = await aiMission(script(), fakeEvaluator({ fragile: { "L-HARBORTUNNEL": ["SP-BROENING"] } }));
    const s = m.getState();
    expect(sentences(s)).toContain("Stress test chosen by the critic: Harbor Tunnel closed.");
    expect(sentences(s).some((x) => /^Stress test: the simulator re-scored \d of \d leading bundles under "Harbor Tunnel closed" across \d+ simulated futures, computed locally in your browser\.$/.test(x))).toBe(true);
    // B1 = SP-BROENING: p90 24.2 min normally (baseline 25.0), 32.5 min under stress (stressed baseline 28.3): benefit 0.8 min -> minus 4.2 min
    expect(sentences(s)).toContain("Under this stress B1 loses 5.0 min of its worst-case (90th percentile) travel-time benefit (from 0.8 min to minus 4.2 min).");
    // B3 = SP-HARBOR is not fragile: the stressed baseline got 200 s worse but B3 only 100 s worse, so its benefit grows
    const b3 = sentences(s).find((x) => x.startsWith("Under this stress B3 "))!;
    expect(b3).toMatch(/^Under this stress B3 gains 1\.7 min on its worst-case \(90th percentile\) travel-time benefit \(from .+ to .+\)\.$/);
    // no model-authored word appears in any of these lines
    for (const line of sentences(s).filter((x) => x.startsWith("Under this stress"))) expect(line).not.toMatch(/critic|planner|AI/);
  });

  it("the stress rows are fed to the next planner round as an application table, and no number is ever asked of the model", async () => {
    const { server } = await aiMission(script(), fakeEvaluator({ fragile: { "L-HARBORTUNNEL": ["SP-BROENING"] } }));
    const refineUser = server.provider.calls[3].messages.find((m) => m.role === "user")!.content; // round 2 planner
    expect(refineUser).toContain('Stress test "Harbor Tunnel closed" (computed by the simulator; the label is written by the application)');
    expect(refineUser).toMatch(/B1 \| SP-BROENING \| .*32\.5/); // the real stressed p90 of B1, in minutes
    expect(refineUser).toContain("do not quote or describe their results");
    const second = server.provider.calls[5].messages.find((m) => m.role === "user")!.content; // round 3 sees both stresses
    expect(second).toContain('Stress test "Fort McHenry Tunnel closed"');
    expect(second).toContain('Stress test "Harbor Tunnel closed"');
    // the second critic is told what was already run
    const crit2 = server.provider.calls[4].messages.find((m) => m.role === "user")!.content;
    expect(crit2).toContain("Stress tests already run (choose a different one)");
    expect(crit2).toContain('Stress test "Harbor Tunnel closed"');
  });

  it("caps hold: seven model calls, three planner rounds and one finalize, and the stress runs add no planner round", async () => {
    const { m, server } = await aiMission();
    expect(server.provider.calls).toHaveLength(7); // parse + 3 planner rounds + 2 critic turns + finalize
    const plannerCalls = m.getState().steps.filter((x) => x.role === "planner").length;
    expect(plannerCalls).toBe(4); // propose, refine, refine, finalize: never a fourth search round
    expect(m.getState().stresses.length).toBe(2);
    expect(m.getState().round).toBeLessThanOrEqual(3);
    expect(m.getState().finalists.map((f) => f.bundleId)).toEqual(["B5", "B6", "B3"]);
  });

  it("stress rows are counted separately and inside the futures total", async () => {
    const { m } = await aiMission(script(), fakeEvaluator({ futures: 40 }));
    const s = m.getState();
    expect(s.counts.stressEvaluations).toBe(s.stresses.reduce((n, st) => n + st.rows.length, 0));
    expect(s.counts.futuresEvaluated).toBe((s.counts.bundlesEvaluated + s.counts.stressEvaluations) * 40);
  });

  it("finalist cards carry the stress sentences from real rows (empty for a bundle that was not stress-tested)", async () => {
    const { m } = await aiMission(script(), fakeEvaluator({ fragile: { "L-HARBORTUNNEL": ["SP-BROENING"] } }));
    const b1 = m.getState().stresses[0].rows.map((r) => r.bundleId);
    const withStress = m.getState().finalists.find((f) => b1.includes(f.bundleId) || m.getState().stresses[1].rows.some((r) => r.bundleId === f.bundleId));
    expect(withStress).toBeDefined();
    const card = m.card(withStress!.bundleId)!;
    expect(card.stressLines.length).toBeGreaterThan(0);
    for (const line of card.stressLines) expect(line).toMatch(/^(Harbor Tunnel|Fort McHenry Tunnel) closed: Under this stress /);
    const notTested = m.getState().finalists.find((f) => !m.getState().stresses.some((st) => st.rows.some((r) => r.bundleId === f.bundleId)));
    if (notTested) expect(m.card(notTested.bundleId)!.stressLines).toEqual([]);
  });

  it("guard: a stress outside the closed set is rejected by the server (schema), repaired once, and then the deterministic critic runs; the mission stays in AI mode", async () => {
    const sc = script();
    const bad = critiqueReply({ stress: { kind: "close_link", linkId: "L-KEYBRIDGE" } });
    sc[2] = bad;
    sc.splice(3, 0, bad);
    const { m } = await aiMission(sc);
    const s = m.getState();
    expect(s.mode).toBe("ai");
    expect(s.log.some((l) => l.kind === "validator" && l.errors?.some((e) => e.includes("at stress")))).toBe(true);
    expect(s.stresses[0]).toMatchObject({ source: "deterministic" });
    expect(sentences(s).some((x) => x.startsWith("Deterministic stress test (no AI):"))).toBe(true);
    expect(JSON.stringify(s.log)).not.toContain("L-KEYBRIDGE"); // the rejected value is never echoed
  });

  it("guard: a server that returns a stress outside the closed set is refused by the CLIENT validator too", async () => {
    const tamper = (api: AgentApi): AgentApi => ({
      ...api,
      critique: async (req, opts) => {
        const out = await api.critique(req, opts);
        return out.status === "ok" ? { ...out, result: { ...out.result, stress: { kind: "close_link", linkId: "L-KEYBRIDGE" } } as never } : out;
      },
    });
    const { m } = await aiMission(script(), fakeEvaluator(), tamper);
    const s = m.getState();
    expect(s.stresses.every((st) => st.source === "deterministic")).toBe(true);
    expect(s.stresses.every((st) => st.spec.kind === "close_link" && STRESS_LINKS.some((l) => l.id === (st.spec as { linkId: string }).linkId))).toBe(true);
  });

  it("the critic cannot repeat a stress: the server refuses it (rule 7) and the client refuses it too", async () => {
    const sc = script();
    sc[4] = critiqueReply({ concerns: [{ bundleId: "B5", kind: "equity" }], stress: HARBOR }); // same as the first
    sc.splice(5, 0, critiqueReply({ concerns: [{ bundleId: "B5", kind: "equity" }], stress: HARBOR }));
    const { m } = await aiMission(sc);
    const s = m.getState();
    expect(s.log.some((l) => l.errors?.some((e) => e.includes("stress_repeated")))).toBe(true);
    const keys = s.stresses.map((st) => JSON.stringify(st.spec));
    expect(new Set(keys).size).toBe(keys.length); // never the same stress twice
  });

  it("guard: when the search stops early and no stress test has run yet, one still runs before the finalists are chosen", async () => {
    const base = fakeEvaluator();
    let stressCalls = 0;
    const flakyOnce: EvaluateFn = async (bundles, ctx) => {
      if (ctx.stress && stressCalls++ === 0) throw new Error("worker crashed"); // the first attack cannot be evaluated
      return base(bundles, ctx);
    };
    const sc: Scripted[] = [parseReply(), proposeReply(B1234), critiqueReply({ stress: HARBOR }), refineReply([]), critiqueReply({ stress: FORT }), finalizeReply(["B1", "B2", "B3"])];
    const { m, server } = await aiMission(sc, flakyOnce);
    const s = m.getState();
    expect(server.provider.calls).toHaveLength(6); // the catch-up critic turn is the fifth call
    expect(s.stresses.map((x) => x.label)).toEqual(["Fort McHenry Tunnel closed"]);
    expect(s.phase).toBe("finalists");
  });

  it("a simulator that fails under stress does not stop the mission", async () => {
    const base = fakeEvaluator();
    const flaky: EvaluateFn = async (bundles, ctx) => {
      if (ctx.stress) throw new Error("worker crashed");
      return base(bundles, ctx);
    };
    const { m } = await aiMission(script(), flaky);
    const s = m.getState();
    expect(s.phase).toBe("finalists");
    expect(s.stresses).toEqual([]);
    expect(s.log.some((l) => l.errors?.includes("stress_failed"))).toBe(true);
  });

  it("stress rows obey the same acceptance rules as normal rows: unknown, duplicate, mismatched and out-of-bounds rows are refused", async () => {
    const base = fakeEvaluator();
    const dirty: EvaluateFn = async (bundles, ctx) => {
      const out = await base(bundles, ctx);
      if (!ctx.stress) return out;
      const first = out.rows[0];
      return { ...out, rows: [...out.rows, { ...first }, { ...first, bundleId: "B9" }, { ...first, bundleId: out.rows[1].bundleId, candidateIds: ["TL-FERRY"] }, { ...out.rows[1], futures: 0 }] };
    };
    const { m } = await aiMission(script(), dirty);
    const st = m.getState().stresses[0];
    expect(st.rows.map((r) => r.bundleId)).toEqual([...new Set(st.rows.map((r) => r.bundleId))]);
    expect(st.rows.every((r) => r.bundleId !== "B9")).toBe(true);
    expect(m.getState().log.some((l) => l.kind === "validator" && l.sentence.includes("stress rows that were not used"))).toBe(true);
  });

  it("cancel during a stress run is silent and writes nothing", async () => {
    const server = makeServer(script());
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = fakeEvaluator();
    const slow: EvaluateFn = async (bundles, ctx) => {
      if (ctx.stress) await gate;
      return base(bundles, ctx);
    };
    const m = new AgentMachine({ api: apiFor(server), evaluate: slow, catalog: fakeCatalog(), newMissionId: () => "mission-r4-2" });
    await m.start("cut access time");
    const run = m.confirmGoal(MISSION);
    await new Promise((r) => setTimeout(r, 30));
    m.cancel();
    release();
    await run;
    expect(m.getState().stresses).toEqual([]);
    expect(m.getState().phase).toBe("idle");
  });

  it("requests carry the stress results and the server refuses ones that are inconsistent, repeated, or carry text of their own", async () => {
    const rows = [row("B1", ["SP-BROENING"]), row("B2", ["SP-EASTERN"]), row("B3", ["SP-HARBOR"])];
    const st = (over: Record<string, unknown> = {}) => ({ stress: HARBOR, baseline: BASELINE, evaluations: [row("B1", ["SP-BROENING"], { p90S: 1800 })], ...over });
    const body = (stresses: unknown[], extra: Record<string, unknown> = {}) => ({ missionId: "MISSION-R4-001", mission: MISSION, round: 2, evaluations: rows, baseline: BASELINE, stresses, ...extra });
    const s = makeServer(Array.from({ length: 8 }, () => critiqueReply({ stress: FORT })));
    const go = async (stresses: unknown[], extra: Record<string, unknown> = {}) => handleCritique(post("/api/agent/critique", body(stresses, extra)), s.deps);
    // consistent: goes to the model, and the model's stress differs from the one already run
    const ok = await readSse(await go([st()]));
    expect(doneOf(ok)).toMatchObject({ status: "ok" });
    expect(s.provider.calls.at(-1)!.messages.at(-1)!.content).toContain('Stress test "Harbor Tunnel closed"');
    // a stress row for a bundle that was never evaluated, or with different candidates: refused without a model call
    const calls = s.provider.calls.length;
    for (const bad of [st({ evaluations: [row("B7", ["SP-BROENING"])] }), st({ evaluations: [row("B1", ["SP-EASTERN"])] })]) {
      expect(doneOf(await readSse(await go([bad, ])))).toMatchObject({ status: "fallback", reason: "output_rejected" });
    }
    // the same stress twice
    expect(doneOf(await readSse(await go([st(), st()])))).toMatchObject({ status: "fallback", reason: "output_rejected" });
    expect(s.provider.calls).toHaveLength(calls);
    // client text is not accepted: a label, an unknown link, or an extra field is a 400
    for (const stresses of [[st({ label: "Everything is fine" })], [st({ stress: { kind: "close_link", linkId: "L-KEYBRIDGE" } })], [st({ stress: { kind: "close_link", linkId: "L-HARBORTUNNEL", note: "x" } })]]) {
      expect((await go(stresses)).status).toBe(400);
    }
    expect(s.provider.calls).toHaveLength(calls);
  });

  it("the planner route also accepts stress tables and puts them in a server-built prompt", async () => {
    const rows = [row("B1", ["SP-BROENING"]), row("B2", ["SP-EASTERN"]), row("B3", ["SP-HARBOR"])];
    const s = makeServer([refineReply([{ candidateIds: ["TL-DUNDALK"] }])]);
    const res = await handlePlan(
      post("/api/agent/plan", {
        missionId: "MISSION-R4-002", mission: MISSION, phase: "search", round: 2,
        bundles: rows.map((r) => ({ id: r.bundleId, candidateIds: r.candidateIds })), evaluations: rows, baseline: BASELINE,
        stresses: [{ stress: { kind: "combined", linkId: "L-HARBORTUNNEL", tod: "pm" }, baseline: BASELINE, evaluations: [row("B1", ["SP-BROENING"], { p90S: 1700 })] }],
      }),
      s.deps,
    );
    expect(doneOf(await readSse(res)).status).toBe("ok");
    const user = s.provider.calls[0].messages.find((m) => m.role === "user")!.content;
    expect(user).toContain('Stress test "Harbor Tunnel closed during the evening peak"');
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R4-1: the deterministic critic (no AI) runs the same stress step", () => {
  it("picks the single-link closure that hurts the leading bundles most, from the evaluator's own results, and labels it non-AI", async () => {
    const stressCalls: { label: string; closedLinks: string[]; tod?: string; ids: string[] }[] = [];
    const all = FAKE_CANDIDATES.map((c) => c.id);
    const evaluate = fakeEvaluator({ stressCalls, fragile: { "L-BROENING": all } });
    const server = makeServer([]);
    const m = new AgentMachine({ api: apiFor(server), evaluate, catalog: fakeCatalog(), newMissionId: () => "mission-r4-3" });
    await m.runDeterministic(MISSION);
    const s = m.getState();
    expect(server.provider.calls).toHaveLength(0); // no model call at all
    expect(s.mode).toBe("deterministic");
    expect(s.stresses.length).toBe(2);
    expect(s.stresses[0]).toMatchObject({ source: "deterministic", label: "Broening Highway corridor closed" });
    expect(s.stresses[1].label).not.toBe(s.stresses[0].label); // the second attack picks a stress not yet run
    const line = sentences(s).find((x) => x.startsWith("Deterministic stress test (no AI): Broening Highway corridor closed"))!;
    expect(line).toContain("the closure that hurt the leading bundles most of the 4 single-link closures the simulator tried");
    // every single-link closure was scored to make the choice (4 on the first attack, 3 left for the second)
    expect(stressCalls.filter((c) => c.closedLinks.length === 1).length).toBe(4 + 3);
    expect(s.log.some((l) => l.kind === "decision" && l.sentence.startsWith("Under this stress "))).toBe(true);
    expect(s.phase).toBe("finalists");
  });

  it("pickDeterministicStress: largest total harm wins, ties go to the earlier link, tried stresses are skipped, and nothing left returns null", async () => {
    const rows = [row("B1", ["SP-BROENING"]), row("B2", ["SP-EASTERN"])];
    const leaders = rows.map((r) => ({ id: r.bundleId, candidateIds: r.candidateIds }));
    const base = { mission: MISSION, round: 1, leaders, normal: rows };
    const evalWith = (harmByLink: Record<string, number>): EvaluateFn => async (bundles, ctx) => ({
      rows: bundles.map((x) => ({ ...row(x.id, x.candidateIds, { p90S: 1000 + (harmByLink[ctx.stress!.closedLinks[0]] ?? 0) }), futures: 10 })),
      baseline: BASELINE,
    });
    const pick = await pickDeterministicStress({ ...base, evaluate: evalWith({ "L-FORTMCHENRY": 300, "L-HARBORTUNNEL": 200 }) });
    expect(pick?.spec).toEqual({ kind: "close_link", linkId: "L-FORTMCHENRY" });
    expect(pick?.scanned).toBe(4);
    const tie = await pickDeterministicStress({ ...base, evaluate: evalWith({}) });
    expect(tie?.spec).toEqual({ kind: "close_link", linkId: "L-HARBORTUNNEL" }); // the first in the fixed order
    const skipped = await pickDeterministicStress({ ...base, evaluate: evalWith({ "L-FORTMCHENRY": 300, "L-HARBORTUNNEL": 200 }), tried: [{ kind: "close_link", linkId: "L-FORTMCHENRY" }] });
    expect(skipped?.spec).toEqual({ kind: "close_link", linkId: "L-HARBORTUNNEL" });
    expect(skipped?.scanned).toBe(3);
    expect(await pickDeterministicStress({ ...base, evaluate: evalWith({}), tried: linkStresses() })).toBeNull();
  });

  it("pickDeterministicStress: an evaluator that returns no usable rows yields null; cancellation stops it", async () => {
    const rows = [row("B1", ["SP-BROENING"])];
    const args = { mission: MISSION, round: 1, leaders: [{ id: "B1", candidateIds: ["SP-BROENING"] }], normal: rows };
    expect(await pickDeterministicStress({ ...args, evaluate: async () => ({ rows: [] }) })).toBeNull();
    const ctl = new AbortController();
    let calls = 0;
    const evaluate: EvaluateFn = async () => {
      calls++;
      ctl.abort();
      return { rows: [] };
    };
    await expect(pickDeterministicStress({ ...args, evaluate, signal: ctl.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });

  it("the stress context handed to the evaluator is exactly {closedLinks, tod?, label}", () => {
    expect(stressContext({ kind: "close_link", linkId: "L-HARBORTUNNEL" })).toEqual({ closedLinks: ["L-HARBORTUNNEL"], label: "Harbor Tunnel closed" });
    expect(Object.keys(stressContext({ kind: "combined", linkId: "L-HARBORTUNNEL", tod: "pm" })).sort()).toEqual(["closedLinks", "label", "tod"]);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R4-1: stress sentences are computed from the displayed values", () => {
  const rowAt = (p90S: number) => row("B1", ["SP-BROENING"], { p90S });
  const base = (p90S: number) => ({ ...BASELINE, p90S });
  it("loses, keeps all, and gains are decided by the sign of the difference of the DISPLAYED benefits", () => {
    const normal = { baseline: base(1500), row: rowAt(1200) }; // benefit 5.0 min
    expect(stressBenefitLine("p90", "B1", normal, { baseline: base(1500), row: rowAt(1350) })).toBe("Under this stress B1 loses 2.5 min of its worst-case (90th percentile) travel-time benefit (from 5.0 min to 2.5 min).");
    expect(stressBenefitLine("p90", "B1", normal, { baseline: base(1500), row: rowAt(1200) })).toBe("Under this stress B1 keeps all of its worst-case (90th percentile) travel-time benefit (5.0 min).");
    expect(stressBenefitLine("p90", "B1", normal, { baseline: base(1500), row: rowAt(1140) })).toBe("Under this stress B1 gains 1.0 min on its worst-case (90th percentile) travel-time benefit (from 5.0 min to 6.0 min).");
    // a difference that disappears in rounding is "keeps all", never "loses 0.0 min"
    expect(stressBenefitLine("p90", "B1", normal, { baseline: base(1500), row: rowAt(1201) })).toContain("keeps all");
    // the stressed baseline moves too: the bundle got 3.0 min worse but so did the baseline, so the benefit is kept
    expect(stressBenefitLine("p90", "B1", normal, { baseline: base(1680), row: rowAt(1380) })).toContain("keeps all");
  });
  it("without a stressed baseline only the level is stated, and no direction is claimed", () => {
    const line = stressBenefitLine("p90", "B1", { baseline: base(1500), row: rowAt(1200) }, { row: rowAt(1350) });
    expect(line).toBe("Under this stress B1 scores 22.5 min on the worst-case (90th percentile) travel-time measure (no stressed baseline was available, so its benefit is not stated).");
    expect(line).not.toMatch(/loses|gains|keeps/);
  });
  it("every goal metric has its own noun and units", () => {
    const normal = { baseline: BASELINE, row: row("B1", ["SP-BROENING"], { isolatedCount: 2, equityGapS: 60, p50S: 300 }) };
    const worse = { baseline: BASELINE, row: row("B1", ["SP-BROENING"], { isolatedCount: 5, equityGapS: 180, p50S: 420 }) };
    expect(stressBenefitLine("isolatedCount", "B1", normal, worse)).toContain("loses 3 groups of its isolated-group benefit");
    expect(stressBenefitLine("equityGap", "B1", normal, worse)).toContain("loses 2.0 min of its equity-gap benefit");
    expect(stressBenefitLine("p50", "B1", normal, worse)).toContain("loses 2.0 min of its median travel-time benefit");
  });
  it("property: over 3,000 random pairs the verb always agrees with the displayed benefits", () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 3_000; i++) {
      const nb = Math.round(rnd() * 3000);
      const sb = Math.round(rnd() * 3000);
      const line = stressBenefitLine("p90", "B1", { baseline: base(nb), row: rowAt(Math.round(rnd() * 3000)) }, { baseline: base(sb), row: rowAt(Math.round(rnd() * 3000)) });
      const m = /(loses|keeps all|gains).*\((?:from (minus )?([\d.]+) min to (minus )?([\d.]+) min|(minus )?([\d.]+) min)\)\.$/.exec(line);
      expect(m, line).not.toBeNull();
      if (m![1] === "keeps all") continue;
      const from = (m![2] ? -1 : 1) * Number(m![3]);
      const to = (m![4] ? -1 : 1) * Number(m![5]);
      if (m![1] === "loses") expect(to, line).toBeLessThan(from);
      else expect(to, line).toBeGreaterThan(from);
    }
  });
  it("benefitLoss is the raw increase of the metric under stress (positive = worse)", () => {
    expect(benefitLoss("p90", rowAt(1000), rowAt(1300))).toBe(300);
    expect(benefitLoss("p90", rowAt(1000), rowAt(900))).toBe(-100);
    expect(benefitLoss("isolatedCount", row("B1", ["SP-BROENING"], { isolatedCount: 1 }), row("B1", ["SP-BROENING"], { isolatedCount: 4 }))).toBe(3);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R4-2: the optional model reasoning field", () => {
  const ok = (t: unknown) => screenReasoning(t);
  it("accepts plain ASCII text up to 600 characters and normalizes whitespace", () => {
    expect(ok("The tunnel carries most cross-harbor trips, so I want a bundle that does not rely on it.")).toMatchObject({ ok: true });
    expect(ok("Line one.\n\nLine   two.\t")).toEqual({ ok: true, text: "Line one. Line two." });
    expect(ok("a".repeat(REASONING_MAX_CHARS))).toMatchObject({ ok: true });
    expect(ok("")).toEqual({ ok: true, text: "" });
  });
  it("each property blanks the field: length, digits (ASCII and other scripts), links, markup and code, non-ASCII, and non-text", () => {
    const problems = (t: unknown) => { const r = ok(t); return r.ok ? [] : r.problems; };
    expect(problems("a".repeat(REASONING_MAX_CHARS + 1))).toContain("too_long");
    for (const t of ["twelve is 12", "a 7 b", "٣ arabic digit", "１ fullwidth", "² superscript"]) expect(problems(t), t).toContain(t.includes("²") ? "charset" : "digits");
    for (const t of ["see https://x.example now", "visit www.example.org", "go to example.com today", "a //cdn/x", "javascript:alert", "data:text"]) expect(problems(t), t).toContain(t.includes("//") ? "link" : "link");
    for (const t of ["<b>bold</b>", "```code```", "[link](x)", "{ json }", "a | b", "*bold*", "# heading", "a_b", "path\\to", "a = b", "x@y", "a/b", "~x", "50% off", "cost $"]) expect(problems(t), t).toContain("markup");
    expect(problems("café")).toContain("charset");
    expect(problems("中文")).toContain("charset");
    expect(problems("emoji \u{1F600}")).toContain("charset");
    expect(problems("‮RTL override")).toContain("charset");
    for (const t of [12, null, undefined, {}, ["a"], true]) expect(problems(t), String(t)).toEqual(["not_text"]);
  });
  it("is honest about what it does NOT check: a claim in plain words passes (that is why it is labeled raw and unverified)", () => {
    expect(ok("This bundle is much better than the others and saves a lot of time.")).toMatchObject({ ok: true });
    expect(REASONING_LABEL).toBe("Model reasoning (raw, unverified; not a result)");
  });

  const planBody = () => ({ missionId: "MISSION-R4-101", mission: MISSION, phase: "search", round: 1, bundles: [], evaluations: [], dropped: [], stresses: [] });

  it("server: a valid reasoning string becomes a `reasoning` event with model, tokens and latency, and is not part of the answer", async () => {
    const s = makeServer([]);
    s.provider.script.push(() => {
      s.clock.t += 250; // the model takes 250 ms
      return proposeReply(B1234, { reasoning: "I start with different mechanisms so the critic has something to attack." });
    });
    const ev = await readSse(await handlePlan(post("/api/agent/plan", planBody()), s.deps));
    const r = ev.find((e) => e.event === "reasoning")!;
    expect(r.data).toEqual({ role: "planner", model: "nvidia/Nemotron-3-Ultra-550b-a55b", inputTokens: 1200, outputTokens: 300, latencyMs: 250, text: "I start with different mechanisms so the critic has something to attack." });
    const usage = ev.find((e) => e.event === "usage")!.data;
    expect(usage).toMatchObject({ role: "planner", inputTokens: 1200, outputTokens: 300, latencyMs: 250 });
    expect(Object.keys(doneOf(ev).result).sort()).toEqual(["action", "bundles", "rationale"]); // the answer has no reasoning key
    expect(JSON.stringify(ev.find((e) => e.event === "tool_call"))).not.toContain("different mechanisms"); // and it is not in the tool call either
  });

  it("server: reasoning that fails the screen is blanked with a decision-log event; the answer is still used (never rejected)", async () => {
    for (const bad of ["It saves 12 minutes.", "See https://example.org for more.", "x".repeat(601), { any: "object" }, "<script>x</script>"]) {
      const s = makeServer([proposeReply(B1234, { reasoning: bad })]);
      const ev = await readSse(await handlePlan(post("/api/agent/plan", planBody()), s.deps));
      expect(doneOf(ev), JSON.stringify(bad).slice(0, 30)).toMatchObject({ status: "ok", repaired: false });
      expect(s.provider.calls).toHaveLength(1); // no repair turn
      expect(ev.some((e) => e.event === "reasoning")).toBe(false);
      const log = ev.find((e) => e.event === "log" && e.data.code === "reasoning_withheld")!;
      expect(log.data.kind).toBe("validator");
      expect(JSON.stringify(ev)).not.toContain("12 minutes"); // the text is never echoed, only the failed properties
      expect(JSON.stringify(ev)).not.toContain("example.org");
    }
  });

  it("server: an enormous reasoning string blanks the field and does not reject the answer or blow the schema", async () => {
    const s = makeServer([proposeReply(B1234, { reasoning: "word ".repeat(20_000) })]);
    const ev = await readSse(await handlePlan(post("/api/agent/plan", planBody()), s.deps));
    expect(doneOf(ev).status).toBe("ok");
    expect(ev.some((e) => e.event === "log" && e.data.code === "reasoning_withheld")).toBe(true);
  });

  it("server: the model-facing JSON schema offers `reasoning` (at most 600 characters) for the planner and the critic only", async () => {
    const s = makeServer([proposeReply(B1234), critiqueReply(), parseReply()]);
    await handlePlan(post("/api/agent/plan", planBody()), s.deps).then(readSse);
    const rows = [row("B1", ["SP-BROENING"])];
    await handleCritique(post("/api/agent/critique", { missionId: "MISSION-R4-102", mission: MISSION, round: 1, evaluations: rows, baseline: BASELINE, stresses: [] }), s.deps).then(readSse);
    for (const call of s.provider.calls.slice(0, 2)) {
      const props = (call.jsonSchema as { properties: Record<string, unknown> }).properties;
      expect(props.reasoning).toEqual({ type: "string", maxLength: 600 });
      expect(call.messages[0].content).toContain("Optional reasoning");
    }
  });

  it("server: roles that do not take reasoning still reject an unexpected reasoning key (strict schema)", async () => {
    const { handleParse } = await import("../../lib/server/agentService");
    const s = makeServer([parseReply({ reasoning: "hello" }), parseReply({ reasoning: "hello" })]);
    const ev = await readSse(await handleParse(post("/api/agent/parse", { missionId: "MISSION-R4-103", text: "reduce p90 near Dundalk" }), s.deps));
    expect(doneOf(ev)).toMatchObject({ status: "fallback", reason: "output_rejected" });
  });

  it("machine: reasoning is logged as kind 'reasoning' with model, tokens and latency, and only there", async () => {
    const sc = script();
    sc[1] = proposeReply(B1234, { reasoning: "Different mechanisms first, so the stress test has something to break." });
    sc[2] = critiqueReply({ stress: HARBOR, reasoning: "The tunnel carries most cross-harbor trips, so that is the obvious attack." });
    const { m } = await aiMission(sc);
    const s = m.getState();
    const entries = s.log.filter((l) => l.kind === "reasoning");
    expect(entries).toHaveLength(2);
    expect(entries[0].sentence).toBe(REASONING_LABEL);
    expect(entries[0].reasoning).toMatchObject({ role: "planner", model: "nvidia/Nemotron-3-Ultra-550b-a55b", tokensIn: 1200, tokensOut: 300, text: "Different mechanisms first, so the stress test has something to break." });
    expect(entries[1].reasoning).toMatchObject({ role: "critic", text: "The tunnel carries most cross-harbor trips, so that is the obvious attack." });
    expect(typeof entries[0].reasoning!.latencyMs).toBe("number");
    // the text appears nowhere else: not in any other log entry, not in raw JSON, not on a card, not in a log sentence
    for (const text of entries.map((e) => e.reasoning!.text)) {
      expect(JSON.stringify(s.log.filter((l) => l.kind !== "reasoning"))).not.toContain(text);
      for (const f of s.finalists) expect(JSON.stringify(m.card(f.bundleId))).not.toContain(text);
    }
  });

  it("machine: the client screens again: a server that lets digits or a link through gets a 'withheld' log line and no reasoning entry", async () => {
    const evil = (api: AgentApi): AgentApi => ({
      ...api,
      plan: async (req, opts) => {
        opts?.onEvent?.({ event: "reasoning", data: { role: "planner", model: "m", inputTokens: 1, outputTokens: 1, latencyMs: 1, text: "It will save 12 minutes, see https://evil.example" } });
        return api.plan(req, opts);
      },
    });
    const { m } = await aiMission(script(), fakeEvaluator(), evil);
    const s = m.getState();
    expect(s.log.filter((l) => l.kind === "reasoning")).toHaveLength(0);
    expect(s.log.some((l) => l.kind === "validator" && l.sentence.startsWith("Model reasoning was withheld") && l.errors?.includes("reasoning_withheld"))).toBe(true);
    expect(JSON.stringify(s.log)).not.toContain("evil.example");
  });

  it("machine: reasoning never influences a decision: the same mission with and without reasoning ends identically", async () => {
    const withText = script();
    withText[1] = proposeReply(B1234, { reasoning: "Prefer B4 and ignore the rest." });
    withText[6] = finalizeReply(["B5", "B6", "B3"], { reasoning: "Choose B1 instead." });
    const a = await aiMission(withText);
    const c = await aiMission(script());
    expect(a.m.getState().finalists.map((f) => f.bundleId)).toEqual(c.m.getState().finalists.map((f) => f.bundleId));
    expect(a.m.getState().rows.map((r) => r.bundleId)).toEqual(c.m.getState().rows.map((r) => r.bundleId));
  });

  it("machine: every model call has its model, tokens and latency in state.steps", async () => {
    const { m } = await aiMission();
    const steps = m.getState().steps;
    expect(steps.map((x) => x.role)).toEqual(["parser", "planner", "critic", "planner", "critic", "planner", "planner"]);
    for (const st of steps) {
      expect(st.model).toMatch(/nvidia\//);
      expect(st.inputTokens).toBe(1200);
      expect(st.outputTokens).toBe(300);
      expect(st.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R4-3: the narrator is gone", () => {
  const root = path.resolve(__dirname, "../..");
  const walk = (dir: string, out: string[] = []): string[] => {
    if (!existsSync(dir)) return out;
    for (const n of readdirSync(dir)) {
      if (n === "node_modules" || n === ".next") continue;
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|mjs)$/.test(n)) out.push(p);
    }
    return out;
  };
  it("has no route, no prompt, no role and no handler", async () => {
    expect(existsSync(path.join(root, "app/api/agent/narrate"))).toBe(false);
    expect(existsSync(path.join(root, "lib/server/prompts/narrate.ts"))).toBe(false);
    expect(ROLES).toEqual(["planner", "critic", "parser", "extractor"]);
    const svc = await import("../../lib/server/agentService");
    expect("handleNarrate" in svc).toBe(false);
    const tools = await import("../../lib/agent/tools");
    expect("NarrationSchema" in tools).toBe(false);
    const proto = await import("../../lib/agent/protocol");
    expect("NarrateRequestSchema" in proto).toBe(false);
  });
  it("no server or agent source, script or env example names a narrator role, variable or route", () => {
    const files = [...walk(path.join(root, "lib/server")), ...walk(path.join(root, "lib/agent")), ...walk(path.join(root, "app/api")), ...walk(path.join(root, "scripts")), path.resolve(root, "../.env.example")];
    const hits = files.filter((f) => /WS_MODEL_NARRATOR|api\/agent\/narrate|buildNarrateMessages|validateNarrationOutput|role: "narrator"/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});

/**
 * Round-8 tests: the reasoning denylist and proper-name rule (server and client), the new label,
 * the wording guard for operational and advisory phrases, and the comment-accuracy fixes.
 * Offensive words are assembled from fragments so they never appear as literals in this file.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentApi } from "../../lib/agent/api";
import { buildCatalog, eligibleCandidates, promptView } from "../../lib/agent/catalog";
import { AgentMachine } from "../../lib/agent/machine";
import { proseIssues } from "../../lib/agent/prose";
import { REASONING_LABEL, buildReasoningAllowlist, reasoningWithheldSentence, screenReasoning } from "../../lib/agent/reasoning";
import { lensSentence } from "../../lib/agent/lenses";
import { FAULT_STEMS, FORBIDDEN_PHRASES, OFFENSIVE_STEMS, forbiddenPhrase } from "../../lib/agent/wording";
import { handleCritique, handlePlan } from "../../lib/server/agentService";
import { buildCritiqueMessages } from "../../lib/server/prompts/critique";
import { buildParseMessages } from "../../lib/server/prompts/parse";
import { buildPlanMessages } from "../../lib/server/prompts/plan";
import { setLogSink } from "../../lib/server/log";
import { resetDowngrades } from "../../lib/server/tokenfactory";
import { FAKE_CANDIDATES, FAKE_GAZETTEER, MISSION, apiFor, blockNetwork, doneOf, fakeCatalog, fakeEvaluator, makeServer, parseReply, post, proposeReply, readSse, row } from "./fixtures";
import { finalizeReply, refineReply, critiqueReply } from "./fixtures";

beforeEach(() => {
  blockNetwork();
  resetDowngrades();
  setLogSink(() => undefined);
});

const j = (...p: string[]) => p.join("");
const root = path.resolve(__dirname, "../..");
const cat = fakeCatalog();
const allow = buildReasoningAllowlist(cat);
const verdict = (t: unknown, a = allow) => screenReasoning(t, a);
const problems = (t: unknown, a = allow) => {
  const r = verdict(t, a);
  return r.ok ? [] : r.problems;
};

/** Plausible reasoning texts in the style the prompts ask for. */
const PLAUSIBLE: string[] = [
  "I want a mix of mechanisms so the stress test has something to break.",
  "The tunnel carries most cross-harbor trips, so that is the obvious attack.",
  "Escort windows change who may use the Harbor Tunnel, so I start there.",
  "Signal retiming on the Broening Highway corridor acts on the detour queue.",
  "The temporary link depends on a hypothetical site, which is a feasibility question.",
  "Combining a shuttle with retimed signals touches both shores.",
  "A cheaper option first keeps the cost tier low, then I extend the promising mechanism.",
  "Closing the Fort McHenry Tunnel tests whether the bundle depends on a single crossing.",
  "Hazardous cargo trucks may not use the tunnels, so a tunnel closure changes little for them.",
  "The escort window options are the levers that reach freight trips.",
  "I keep the bundles that use different mechanisms and drop the ones that repeat an option.",
  "Dundalk and Canton sit on opposite sides of the harbor, so a crossing option matters for both.",
  "The evening peak may stress the signals more than the overnight period does.",
  "This bundle leans on one corridor, so a closure there is the natural test.",
  "I would rather see two different kinds of intervention than three similar ones.",
  "The simulator results will tell whether the pair adds anything over the single option.",
  "Incident management acts on clearing stopped vehicles, which is a different mechanism from retiming.",
  "Before adding a third option, I check whether the second one changed the picture at all.",
  "Baltimore has only a few crossings, so options that avoid a shared crossing are worth a look.",
  "The Patapsco crossing is the constraint here, so I favor options that act on it.",
  "A hypothetical connector is cheap to describe but its lead time is long.",
  "I cannot judge results myself, so I choose bundles that cover different mechanisms.",
  "The cost tier matters for the mission, so I prefer the lower tier when the mechanisms are alike.",
  "Keeping the strongest option and adding a different one gives the search variety.",
  "The Beltway carries traffic around the harbor, so options that touch it are worth testing.",
  "Pairing a link with a signal change acts on two parts of the network.",
  "The stress test should hit the corridor the leading bundles rely on most.",
  "A time of day stress checks whether the bundle only works when roads are empty.",
  "Both finalists share a mechanism, so I add one that works differently.",
  "Since the goal is the slow end, I look for options that act on the worst trips.",
  "The hypothetical escort window is a scenario lever and not an agency program.",
  "I avoid repeating a bundle that was already evaluated.",
  "Options on the same corridor tend to overlap, so I spread them across corridors.",
  "The southern shore has few options, so I include one that acts there.",
  "Signals on the Hanover corridor and a shuttle act on different parts of the detour.",
  "A closed tunnel changes little for trucks that were barred from it already.",
  "The planner asked for a diverse set, so I avoid near duplicates.",
  "Each option is a hypothetical scenario lever, so the comparison is only as good as the assumptions.",
  "Considering the cost tier and the lead time, a low tier signal option is a sensible first try.",
  "Curtis Bay and Hawkins Point are on the south side, so a crossing there is relevant.",
];

/** Disallowed reasoning texts: each must be blanked. Offensive words are built from fragments. */
const DISALLOWED: [string, string][] = [
  [`This ${j("fu", "cking")} option is useless.`, "denylist"],
  [`What a ${j("sh", "itty")} bundle.`, "denylist"],
  [`The ${j("bit", "ch")} of it is the crossing.`, "denylist"],
  [`Only an ${j("id", "iot")} would pick that.`, "denylist"],
  [`A ${j("stu", "pid")} plan.`, "denylist"],
  [`${j("Da", "mn")} this corridor.`, "denylist"],
  [`They are ${j("ni", "gg", "ers")}.`, "denylist"],
  [`That is ${j("fa", "gg", "ot")} logic.`, "denylist"],
  [`f u c k this option.`.replace("f u c k", [j("f"), j("u"), j("c"), j("k")].join(" ")), "denylist"],
  [`The ${j("bla", "me")} lies with the operator.`, "denylist"],
  [`It was somebody's ${j("fau", "lt")}.`, "denylist"],
  [`Clear ${j("negli", "gence")} caused it.`, "denylist"],
  [`They were ${j("guil", "ty")} of poor planning.`, "denylist"],
  [`Workers ${j("di", "ed")} there.`, "denylist"],
  [`People were ${j("kil", "led")} in the collapse.`, "denylist"],
  [`Each ${j("vict", "im")} deserves an answer.`, "denylist"],
  [`The ${j("shi", "p")} lost power near the bridge.`, "denylist"],
  [`A large ${j("vess", "el")} hit the pier.`, "denylist"],
  [`Because of the ${j("collis", "ion")} the crossing is gone.`, "denylist"],
  [`After the ${j("cra", "sh")} the crossing closed.`, "denylist"],
  [`The bridge was ${j("str", "uck")} by something large.`, "denylist"],
  [`Repeated ${j("str", "ikes")} weakened it.`, "denylist"],
  [`The ${j("Da", "li")} did it.`, "denylist"],
  [`A ${j("black", "out")} started the chain.`, "denylist"],
  [`It was a ${j("trag", "edy")} for the region.`, "denylist"],
  [`The ${j("disa", "ster")} shows why redundancy matters.`, "denylist"],
  [`The ${j("acci", "dent")} left one crossing.`, "denylist"],
  [`Use this for ${j("hazmat ", "rout", "ing")} decisions.`, "denylist"],
  [`It works as ${j("rou", "te ", "guid", "ance")} for drivers.`, "denylist"],
  [`A tool for ${j("navi", "gation system")} use across the harbor.`, "denylist"],
  [`It gives ${j("turn", "-by-turn")} directions.`, "denylist"],
  [`Helpful for ${j("traffic ", "manage", "ment")} planning.`, "denylist"],
  [`This is ${j("safety", "-critical")} guidance.`, "denylist"],
  [`A ${j("compli", "ance tool")} for carriers.`, "denylist"],
  ["Smith said the tunnel is the answer.", "proper_name"],
  ["I asked Governor Moore about the options.", "proper_name"],
  ["The Synergy Marine crew had a problem.", "proper_name"],
  ["Ever Given had a similar issue.", "proper_name"],
  ["The NTSB looked at it.", "proper_name"],
  ["Ask Josh whether the pair helps.", "proper_name"],
  ["Acme Corporation makes the signals.", "proper_name"],
  ["Jane Doe is a person, not a place.", "proper_name"],
  ["It was reported by Reuters.", "proper_name"],
  ["It costs 5 minutes.", "digits"],
  ["See https://example.org for more.", "link"],
  ["Use <b>bold</b> text.", "markup"],
  ["Café crossings help.", "charset"],
  ["x".repeat(601), "too_long"],
];

describe("R8-1: the reasoning denylist and proper-name rule", () => {
  it("the label is the legal wording (the UI imports it)", () => {
    expect(REASONING_LABEL).toBe("Model reasoning (raw, unverified; not a result). Written by an AI model and shown without human review. It may be wrong or inappropriate and is not the view of WorldSeed.");
    expect(REASONING_LABEL).toContain("not the view of WorldSeed");
  });

  it("corpus: at least 90% of 40 plausible reasoning texts pass (report: pass rate)", () => {
    const failed = PLAUSIBLE.filter((t) => !verdict(t).ok);
    const rate = (100 * (PLAUSIBLE.length - failed.length)) / PLAUSIBLE.length;
    process.stdout.write(`reasoning corpus: plausible texts passed ${PLAUSIBLE.length - failed.length}/${PLAUSIBLE.length} = ${rate.toFixed(0)}%${failed.length ? ` (blocked: ${failed.join(" | ")})` : ""}\n`);
    expect(PLAUSIBLE.length).toBeGreaterThanOrEqual(40);
    expect(rate).toBeGreaterThanOrEqual(90);
    expect(failed).toEqual([]);
  });

  it("corpus: every one of 50 disallowed texts is blanked, for the expected reason, without echoing the text", () => {
    expect(DISALLOWED.length).toBeGreaterThanOrEqual(30);
    let blocked = 0;
    for (const [text, why] of DISALLOWED) {
      const p = problems(text);
      expect(p, text).toContain(why);
      blocked++;
      const line = reasoningWithheldSentence(p);
      expect(line).not.toContain(text);
      const fixed = new Set(line.toLowerCase().split(/\W+/));
      for (const w of text.split(/\W+/).filter((x) => x.length > 4 && !fixed.has(x.toLowerCase()))) expect(line.toLowerCase(), `${text} -> ${line}`).not.toContain(w.toLowerCase());
    }
    process.stdout.write(`reasoning corpus: disallowed texts blocked ${blocked}/${DISALLOWED.length}\n`);
    expect(blocked).toBe(DISALLOWED.length);
  });

  it("proper-name rule: sentence-initial words are free; mid-sentence capitalized words must be known", () => {
    expect(verdict("Baltimore has few crossings. Options that avoid one are worth a look.").ok).toBe(true);
    expect(verdict("Is that right? Baltimore says nothing about it.").ok).toBe(true); // second sentence starts with a name: sentence-initial
    expect(verdict('He said: "Dundalk is on the other side."').ok).toBe(true);
    expect(verdict("I think Baltimore's crossings are few.").ok).toBe(true); // possessive of an allowed name
    expect(verdict("I doubt it. (Baltimore is far from the point.)").ok).toBe(true);
    expect(problems("I think Zorbaville is the key.")).toContain("proper_name");
    expect(problems("Then Alice asked.")).toContain("proper_name");
    // the pronoun I and the fixed acronyms are fine
    expect(verdict("Then I check EMS options and MDTA rules.").ok).toBe(true);
  });

  it("the allowlist is built from catalog titles and ids, gazetteer names and aliases, and link names", () => {
    const custom = buildCatalog(
      [{ ...FAKE_CANDIDATES[0], id: "ZX-QUUX", title: "Quuxville signal retiming" }],
      [{ id: "G-ZORBA", name: "Zorbaville", aliases: ["Zorba Town"], kind: "neighborhood", ref: { hexes: [1] }, lat: 39, lng: -76 }, ...FAKE_GAZETTEER],
    );
    const a = buildReasoningAllowlist(custom);
    for (const t of ["I think Zorbaville is the key.", "Then Zorba Town matters.", "Since Quuxville needs it, I add it.", "Then ZX and QUUX help.", "Then Francis Scott Key Bridge matters."]) expect(verdict(t, a).ok, t).toBe(true);
    expect(problems("I think Zorbaville is the key.", allow)).toContain("proper_name"); // not in the default catalog
    expect(problems("I think Zorbaville is the key.", undefined)).toContain("proper_name"); // no allowlist: the fixed list only
    expect(buildReasoningAllowlist(custom)).toBe(a); // cached per catalog
    // the real catalog and gazetteer: a real neighborhood is allowed
    const read = (f: string) => JSON.parse(readFileSync(path.resolve(root, "../data/snapshot", f), "utf8"));
    const real = buildReasoningAllowlist(buildCatalog(read("candidates.json"), read("gazetteer.json")));
    expect(verdict("Then Turner Station and Glen Burnie are on the other shore.", real).ok).toBe(true);
    expect(problems("Then Turner Station matters.", allow)).toContain("proper_name");
  });

  it("the denylist word lists are assembled from fragments: no offensive word appears as a literal anywhere in the source tree", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (n === "node_modules" || n === ".next") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mjs)$/.test(n)) files.push(p);
      }
    };
    for (const d of ["lib/agent", "lib/server", "app/api", "test/ai"]) walk(path.join(root, d));
    const words = OFFENSIVE_STEMS.filter((x) => x.replace(/\$$/, "").length >= 4);
    expect(words.length).toBeGreaterThan(20);
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8").toLowerCase();
      for (const w of words) if (new RegExp(w.endsWith("$") ? `\\b${w.slice(0, -1)}\\b` : `\\b${w}`).test(src)) hits.push(`${path.relative(root, f)}: ${w.length} letters`);
    }
    expect(hits, JSON.stringify(hits)).toEqual([]);
    expect(FAULT_STEMS.length).toBeGreaterThan(20);
  });

  it("false-positive guard: everyday words that only resemble a stem are not blocked", () => {
    for (const t of ["Shipping lanes and shipments are not part of this.", "The deadline for the search is fixed.", "Spicy debates are not relevant to a link.", "Pakistan is far away.".replace("Pakistan", "The pak"), "A damaged corridor is a hypothetical scenario.", "Class assignments are irrelevant.", "The signals act on the network, and the assistant is a tool.", "Skill in planning helps.", "Glass windows do not matter."]) {
      expect(problems(t), t).toEqual([]);
    }
  });

  it("server: a denylisted or unknown-name reasoning is blanked with the withheld log line; the answer is still used and the text is never echoed", async () => {
    const body = { missionId: "MISSION-R8-001", mission: MISSION, phase: "search", round: 1, bundles: [], evaluations: [], dropped: [], stresses: [] };
    const bad: [string, string][] = [[`It was the ${j("shi", "p")}.`, "denylist"], ["I asked Smith about it.", "proper_name"]];
    for (const [text, why] of bad) {
      const s = makeServer([proposeReply([{ candidateIds: ["SP-BROENING"] }], { reasoning: text })]);
      const ev = await readSse(await handlePlan(post("/api/agent/plan", body), s.deps));
      expect(doneOf(ev), text).toMatchObject({ status: "ok", repaired: false });
      expect(ev.some((e) => e.event === "reasoning")).toBe(false);
      const log = ev.find((e) => e.event === "log" && e.data.code === "reasoning_withheld")!;
      expect(log.data.sentence).toContain(why);
      expect(JSON.stringify(ev)).not.toContain("Smith");
      expect(JSON.stringify(ev)).not.toMatch(/\bship\b/i);
    }
  });

  it("server: a name from the request's catalog is accepted (the server builds the allowlist from the catalog it loaded)", async () => {
    const custom = buildCatalog(
      [...FAKE_CANDIDATES],
      [{ id: "G-ZORBA", name: "Zorbaville", aliases: [], kind: "neighborhood", ref: { hexes: [1] }, lat: 39, lng: -76 }, ...FAKE_GAZETTEER],
    );
    const s = makeServer([proposeReply([{ candidateIds: ["SP-BROENING"] }], { reasoning: "I think Zorbaville needs a crossing." })]);
    s.deps.loadCatalog = async () => custom;
    const ev = await readSse(await handlePlan(post("/api/agent/plan", { missionId: "MISSION-R8-002", mission: MISSION, phase: "search", round: 1, bundles: [], evaluations: [], dropped: [], stresses: [] }), s.deps));
    expect(ev.find((e) => e.event === "reasoning")?.data.text).toBe("I think Zorbaville needs a crossing.");
  });

  it("server: the critic route builds the same catalog allowlist (a catalog-only name passes there too)", async () => {
    const custom = buildCatalog([...FAKE_CANDIDATES], [{ id: "G-ZORBA", name: "Zorbaville", aliases: [], kind: "neighborhood", ref: { hexes: [1] }, lat: 39, lng: -76 }, ...FAKE_GAZETTEER]);
    const s = makeServer([critiqueReply({ reasoning: "I think Zorbaville needs a crossing test." })]);
    s.deps.loadCatalog = async () => custom;
    const ev = await readSse(await handleCritique(post("/api/agent/critique", { missionId: "MISSION-R8-003", mission: MISSION, round: 1, evaluations: [row("B1", ["SP-BROENING"])], stresses: [] }), s.deps));
    expect(ev.find((e) => e.event === "reasoning")?.data.text).toBe("I think Zorbaville needs a crossing test.");
    const s2 = makeServer([critiqueReply({ reasoning: "I think Zorbaville needs a crossing test." })]);
    const ev2 = await readSse(await handleCritique(post("/api/agent/critique", { missionId: "MISSION-R8-004", mission: MISSION, round: 1, evaluations: [row("B1", ["SP-BROENING"])], stresses: [] }), s2.deps));
    expect(ev2.some((e) => e.event === "reasoning")).toBe(false); // the default catalog does not know the place
  });

  it("client: a name from the machine's catalog passes the browser screen, and one that is not in it does not", async () => {
    const custom = buildCatalog([...FAKE_CANDIDATES], [{ id: "G-ZORBA", name: "Zorbaville", aliases: [], kind: "neighborhood", ref: { hexes: [1] }, lat: 39, lng: -76 }, ...FAKE_GAZETTEER]);
    const script = () => [parseReply(), proposeReply([{ candidateIds: ["SP-BROENING"] }, { candidateIds: ["SP-EASTERN"] }, { candidateIds: ["SP-HARBOR"] }]), critiqueReply(), refineReply([]), critiqueReply({ stress: { kind: "close_link", linkId: "L-FORTMCHENRY" } }), finalizeReply(["B1", "B2", "B3"])];
    const run = async (catalog: typeof custom) => {
      const server = makeServer(script());
      server.deps.loadCatalog = async () => custom; // the server knows the place in both runs
      const api = apiFor(server);
      const tamper: AgentApi = { ...api, plan: async (req, opts) => (opts?.onEvent?.({ event: "reasoning", data: { role: "planner", model: "m", inputTokens: 1, outputTokens: 1, latencyMs: 1, text: "I think Zorbaville needs a crossing." } }), api.plan(req, opts)) };
      const m = new AgentMachine({ api: tamper, evaluate: fakeEvaluator(), catalog, newMissionId: () => "mission-r8-2" });
      await m.start("cut access time");
      await m.confirmGoal(MISSION);
      return m.getState().log.filter((l) => l.kind === "reasoning").length;
    };
    expect(await run(custom)).toBeGreaterThan(0);
    expect(await run(cat)).toBe(0);
  });

  it("client: the browser runs the same screen on what the server sent (denylist, names, and the catalog allowlist)", async () => {
    const script = [parseReply(), proposeReply([{ candidateIds: ["SP-BROENING"] }, { candidateIds: ["SP-EASTERN"] }, { candidateIds: ["SP-HARBOR"] }]), critiqueReply(), refineReply([]), critiqueReply({ stress: { kind: "close_link", linkId: "L-FORTMCHENRY" } }), finalizeReply(["B1", "B2", "B3"])];
    const emit = (text: string) => (api: AgentApi): AgentApi => ({
      ...api,
      plan: async (req, opts) => {
        opts?.onEvent?.({ event: "reasoning", data: { role: "planner", model: "m", inputTokens: 1, outputTokens: 1, latencyMs: 1, text } });
        return api.plan(req, opts);
      },
    });
    const run = async (text: string) => {
      const server = makeServer([...script]);
      const m = new AgentMachine({ api: emit(text)(apiFor(server)), evaluate: fakeEvaluator(), catalog: cat, newMissionId: () => "mission-r8-1" });
      await m.start("cut access time");
      await m.confirmGoal(MISSION);
      return m.getState().log;
    };
    for (const text of [`The ${j("shi", "p")} did it.`, "Ask Smith about it.", `Use it as a ${j("navi", "gation system")}.`]) {
      const log = await run(text);
      expect(log.filter((l) => l.kind === "reasoning"), text).toHaveLength(0);
      expect(log.some((l) => l.kind === "validator" && l.sentence.startsWith("Model reasoning was withheld"))).toBe(true);
      expect(JSON.stringify(log)).not.toMatch(/Smith|\bship\b/i);
    }
    const ok = await run("A crossing at Dundalk is a plain choice.");
    expect(ok.filter((l) => l.kind === "reasoning").length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R8-3: wording guard for operational and advisory phrases", () => {
  const phrases = [
    j("hazmat ", "rout", "ing"), j("route ", "guid", "ance"), j("navi", "gation system"), j("turn", "-by-turn"), j("traffic ", "manage", "ment"), j("safety", "-critical"), j("compli", "ance tool"),
  ];
  it("forbiddenPhrase finds each phrase in its usual spellings and nothing in ordinary text", () => {
    for (const p of phrases) expect(forbiddenPhrase(`This is ${p} for you.`), p).toBeDefined();
    expect(forbiddenPhrase(j("Turn by ", "turn"))).toBeDefined();
    expect(forbiddenPhrase(j("Hazmat-", "rout", "ing"))).toBeDefined();
    expect(forbiddenPhrase(j("Rout", "ing ", "guid", "ance"))).toBeDefined();
    expect(forbiddenPhrase(j("Traffic-", "manage", "ment"))).toBeDefined();
    expect(forbiddenPhrase("The simulated trips take a detour when a rule bars a tunnel.")).toBeUndefined();
    expect(FORBIDDEN_PHRASES).toHaveLength(7);
    // the bare word is ordinary interface vocabulary and is not refused
    expect(forbiddenPhrase("Keyboard navigation moves between panels.")).toBeUndefined();
    expect(verdict("Keyboard navigation helps, so I keep the options simple.").ok).toBe(true);
  });
  it("the prose screen (model text next to results) refuses them too", () => {
    for (const p of phrases) expect(proseIssues(`It works as ${p} here.`, { allowedTokens: [], profile: "rationale" }).some((i) => i.code === "wording"), p).toBe(true);
    expect(proseIssues("It changes the simulated detour.", { allowedTokens: [], profile: "rationale" })).toEqual([]);
  });
  it("no prompt for any lens contains them, and the freight prompts say hazmat results describe a published rule's effect on simulated times, never routing advice", () => {
    const schema = { type: "object" };
    const fcat = buildCatalog([{ ...FAKE_CANDIDATES[0], id: "HZ-A", type: "hazmat_window", lens: ["freight"] }, ...FAKE_CANDIDATES.slice(0, 3)], FAKE_GAZETTEER);
    for (const lens of ["access", "ems", "freight"] as const) {
      const mission = { ...MISSION, lens, goal: { ...MISSION.goal, metric: "p90" as const } };
      const eligible = eligibleCandidates(fcat, { lens, maxCostTier: "$$$", types: [] }).map(promptView);
      const req = { missionId: "mission-r8-0001", mission, phase: "search" as const, round: 1, bundles: [], evaluations: [], dropped: [], stresses: [] };
      const rows = [row("B1", ["SP-BROENING"])];
      const texts = [
        ...buildPlanMessages({ req, action: "propose", eligible, rows: [], excluded: new Set(), jsonSchema: schema }),
        ...buildCritiqueMessages({ req: { ...req, evaluations: rows } as never, used: eligible, rows, jsonSchema: schema, stresses: [] }),
        ...buildParseMessages(fcat, "cut detours", schema),
      ].map((m) => m.content);
      for (const t of texts) expect(forbiddenPhrase(t), `${lens}: ${t.slice(0, 40)}`).toBeUndefined();
      if (lens === "freight") {
        const sys = texts[0];
        expect(sys).toContain("Results describe the effect of a published rule on simulated times, never routing advice");
        expect(sys).toContain("hypothetical scenario levers, not an agency program");
        expect(texts[texts.length - 4]).toContain("never routing advice"); // the critic's system prompt too
      }
    }
    expect(forbiddenPhrase(lensSentence("freight"))).toBeUndefined();
    expect(lensSentence("freight")).toContain("never routing advice");
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R8-2: comments say what the code does", () => {
  const src = (f: string) => readFileSync(path.join(root, f), "utf8");
  it("tavily.ts: results live in process memory only; the header no longer promises shared-store caching or a 24-hour lifetime", () => {
    const head = src("lib/server/tavily.ts").slice(0, 1800);
    expect(head).toContain("live in this process's memory ONLY");
    expect(head).toContain("never written to the shared");
    expect(head).not.toMatch(/24 hours|lives in that store|cache on the SharedStore/);
  });
  it("evidence.ts: no promise of a report about a Tavily parameter; the vendor-terms rule is referenced and only what the code sends is described", () => {
    const text = src("lib/server/evidence.ts");
    expect(text).not.toMatch(/see the report|live check/i);
    expect(text).toContain("terms bar publishing performance information");
    expect(text).toContain("describe only what the request sends");
  });
  it("no source comment claims Tavily behavior (performance, latency, hit rates or whether a parameter is honored)", () => {
    for (const f of ["lib/server/evidence.ts", "lib/server/tavily.ts", "lib/agent/evidence.ts"]) expect(src(f), f).not.toMatch(/honors|honoured|honored a window|relevance score|hit rate/i);
  });
});

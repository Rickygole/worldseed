/**
 * Round-4 tests: the evidence route (Tavily "reality check", sources only, no model) and the
 * exhaustive-search check. All fixtures are hand-written and labeled FAKE; no network call is made.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCatalog } from "../../lib/agent/catalog";
import { countBundles, enumerateBundles, exhaustiveSearch, exhaustiveSummaryLine, rankOf, type DeterministicEvaluateFn, type DeterministicRow } from "../../lib/agent/exhaustive";
import { EvidenceRequestSchema, EVIDENCE_TOPICS } from "../../lib/agent/protocol";
import { handleEvidence, handleHealth } from "../../lib/server/handlers";
import { EVIDENCE_PARAMS, EVIDENCE_QUERIES, cleanPublished, plainText, toEvidenceSources } from "../../lib/server/evidence";
import { setLogSink } from "../../lib/server/log";
import type { Runtime } from "../../lib/server/runtime";
import type { QueryParams, SearchClient, TavilyResult } from "../../lib/server/tavily";
import { resetDowngrades } from "../../lib/server/tokenfactory";
import * as evidenceRoute from "../../app/api/evidence/route";
import { FAKE_CANDIDATES, MISSION, blockNetwork, fakeCatalog, makeRuntime, makeServer, post } from "./fixtures";

beforeEach(() => {
  blockNetwork();
  resetDowngrades();
  setLogSink(() => undefined);
});

/* ------------------------------------------------------------------------------------------ */
const FAKE: TavilyResult[] = [
  { title: "FAKE: Harbor Tunnel traffic climbs", url: "https://www.news.example.test/a", content: "FAKE SAMPLE TEXT. Drivers detoured through the Harbor Tunnel after the collapse, and lines grew at rush hour.", publishedDate: "Tue, 26 Mar 2024 12:00:00 GMT" },
  { title: "FAKE: Freight reroutes", url: "http://freight.example.test/b", content: "FAKE SAMPLE TEXT. Trucks carrying hazardous cargo were sent around the harbor.", publishedDate: "2024-04-02" },
];

function search(results: TavilyResult[] | Error | (() => Promise<TavilyResult[]>) = FAKE) {
  const c = {
    calls: [] as { query: string; params: QueryParams }[],
    closureCalls: 0,
    async search() {
      c.closureCalls++;
      return [];
    },
    async query(query: string, params: QueryParams) {
      c.calls.push({ query, params });
      if (results instanceof Error) throw results;
      return typeof results === "function" ? results() : results;
    },
  };
  return c satisfies SearchClient & Record<string, unknown>;
}

function rt(opts: { search?: ReturnType<typeof search> | null; cfg?: Record<string, number | boolean> } = {}) {
  const server = makeServer([], opts.cfg as never);
  const s = opts.search === undefined ? search() : opts.search;
  const runtime: Runtime = makeRuntime(server, s);
  return { server, runtime, s: s as ReturnType<typeof search> };
}
const ask = async (runtime: Runtime, body: unknown = { topic: "detours" }, ip = "203.0.113.7") => {
  const res = await handleEvidence(post("/api/evidence", body, ip), runtime);
  return { status: res.status, body: await res.json(), headers: res.headers };
};

describe("R4-4: /api/evidence returns sources only", () => {
  it("returns sanitized sources with domain, date and an 'unverified' marker, and makes no model call", async () => {
    const { runtime, server } = rt();
    const { status, body } = await ask(runtime);
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ok", topic: "detours", cached: false });
    expect(body.sources).toEqual([
      { title: "FAKE: Harbor Tunnel traffic climbs", url: "https://www.news.example.test/a", domain: "news.example.test", publishedDate: "2024-03-26", snippet: "FAKE SAMPLE TEXT. Drivers detoured through the Harbor Tunnel after the collapse, and lines grew at rush hour.", confidence: "unverified" },
      { title: "FAKE: Freight reroutes", url: "http://freight.example.test/b", domain: "freight.example.test", publishedDate: "2024-04-02", snippet: "FAKE SAMPLE TEXT. Trucks carrying hazardous cargo were sent around the harbor.", confidence: "unverified" },
    ]);
    expect(Object.keys(body.sources[0]).sort()).toEqual(["confidence", "domain", "publishedDate", "snippet", "title", "url"]);
    expect(body.message).toContain("None has been verified");
    expect(server.provider.calls).toHaveLength(0); // no model, no extraction
    expect(body.proposals).toBeUndefined();
    expect(body.cachedNotice).toBeUndefined();
  });

  it("the payload is an enum and nothing else; the query and parameters are fixed on the server per topic", async () => {
    expect(EVIDENCE_TOPICS).toEqual(["detours", "traffic", "freight"]);
    for (const bad of [{}, { topic: "weather" }, { topic: "detours", query: "anything" }, { topic: ["detours"] }, { topic: "DETOURS" }, "detours", null]) {
      expect(EvidenceRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    const { runtime, s } = rt();
    for (const topic of EVIDENCE_TOPICS) expect((await ask(runtime, { topic }, `10.0.0.${EVIDENCE_TOPICS.indexOf(topic)}`)).status).toBe(200);
    expect(s.calls.map((c) => c.query)).toEqual(EVIDENCE_TOPICS.map((t) => EVIDENCE_QUERIES[t]));
    for (const c of s.calls) {
      expect(c.params).toEqual(EVIDENCE_PARAMS);
      expect(c.params).toMatchObject({ topic: "news", search_depth: "basic", max_results: 6, include_answer: false, include_raw_content: false });
    }
    for (const t of EVIDENCE_TOPICS) expect(EVIDENCE_QUERIES[t]).toMatch(/Baltimore/);
    expect((await ask(runtime, { topic: "weather" })).status).toBe(400);
    expect((await ask(runtime, { topic: "detours", query: "x" })).status).toBe(400);
    expect(s.calls).toHaveLength(3); // a bad payload never reaches the search
  });

  it("sanitizes titles and snippets to plain characters, caps the snippet at 240, and drops results without a usable http(s) URL", () => {
    const evil: TavilyResult[] = [
      { title: "<b>Bold</b> [x](http://evil.example) `code` ‮", url: "https://ok.example.test/1", content: `Text with <script>alert(1)</script> and https://evil.example/x plus ${"long ".repeat(200)}`, publishedDate: "not a date" },
      { title: "javascript", url: "javascript:alert(1)", content: "x" },
      { title: "no host", url: "https:///", content: "x" },
      { title: "ftp", url: "ftp://files.example.test/a", content: "x" },
      { title: "data", url: "data://x.example.test/a", content: "x" },
      { title: "dup", url: "https://ok.example.test/1", content: "second copy" },
      { title: "", url: "https://untitled.example.test/2", content: "Café résumé naïve" },
    ];
    const out = toEvidenceSources(evil);
    expect(out.map((s) => s.url)).toEqual(["https://ok.example.test/1", "https://untitled.example.test/2"]);
    for (const s of out) {
      expect(s.snippet.length).toBeLessThanOrEqual(240);
      expect(s.title.length).toBeLessThanOrEqual(160);
      expect(`${s.title} ${s.snippet}`).toMatch(/^[A-Za-z0-9 .,;:'"()&%$!?-]*$/);
      expect(`${s.title} ${s.snippet}`).not.toMatch(/https?:|<|>|\[|\]|`|evil/i);
      expect(s.confidence).toBe("unverified");
    }
    expect(out[0].publishedDate).toBeUndefined();
    expect(out[0].snippet.endsWith("...")).toBe(true);
    expect(out[1].title).toBe("untitled.example.test"); // an empty title falls back to the domain
    expect(out[1].snippet).toBe("Cafe resume naive"); // diacritics folded
  });

  it("plainText and cleanPublished edge cases", () => {
    expect(plainText("a  b\n\tc", 50)).toBe("a b c");
    expect(plainText("x".repeat(300), 240).length).toBe(240);
    expect(plainText("one two three four five six seven", 20)).toBe("one two three...");
    expect(cleanPublished("2024-03-26T10:00:00Z")).toBe("2024-03-26");
    expect(cleanPublished("1999-01-01")).toBeUndefined();
    expect(cleanPublished(undefined)).toBeUndefined();
    expect(cleanPublished("soon")).toBeUndefined();
  });
});

describe("R4-4: caching, single flight and caps", () => {
  it("a good result is served from process memory for six hours (no second search), with a cached notice; then it is refreshed", async () => {
    const { runtime, server, s } = rt();
    await ask(runtime);
    const again = await ask(runtime);
    expect(s.calls).toHaveLength(1);
    expect(again.body).toMatchObject({ status: "ok", cached: true });
    expect(again.body.cachedNotice).toMatch(/^Cached result from /);
    server.clock.t += 5 * 3600_000;
    expect((await ask(runtime)).body.cached).toBe(true);
    server.clock.t += 2 * 3600_000;
    expect((await ask(runtime)).body.cached).toBe(false);
    expect(s.calls).toHaveLength(2);
  });

  it("topics are cached separately", async () => {
    const { runtime, s } = rt();
    await ask(runtime, { topic: "detours" });
    await ask(runtime, { topic: "traffic" });
    await ask(runtime, { topic: "detours" });
    expect(s.calls).toHaveLength(2);
  });

  it("an empty answer is degraded: cached for two minutes only", async () => {
    const empty = search([]);
    const { runtime, server } = rt({ search: empty });
    const first = await ask(runtime);
    expect(first.body).toMatchObject({ status: "ok", sources: [] });
    expect(first.body.message).toContain("No news sources were found");
    await ask(runtime);
    expect(empty.calls).toHaveLength(1);
    server.clock.t += 121_000;
    await ask(runtime);
    expect(empty.calls).toHaveLength(2);
  });

  it("an upstream failure says so, is remembered for two minutes (no hammering), and never replaces a good older answer", async () => {
    const failing = search(new Error("boom"));
    const { runtime, server } = rt({ search: failing });
    expect((await ask(runtime)).body).toMatchObject({ status: "unavailable", reason: "upstream_error" });
    await ask(runtime);
    expect(failing.calls).toHaveLength(1);
    server.clock.t += 121_000;
    await ask(runtime);
    expect(failing.calls).toHaveLength(2);
    // a good answer that has gone stale is served (labeled cached) when the refresh fails
    const flaky = search(FAKE);
    const b = rt({ search: flaky });
    await ask(b.runtime);
    b.server.clock.t += 7 * 3600_000;
    flaky.query = async (query: string, params: QueryParams) => {
      flaky.calls.push({ query, params });
      throw new Error("down");
    };
    const stale = await ask(b.runtime);
    expect(stale.body).toMatchObject({ status: "ok", cached: true });
    expect(stale.body.sources).toHaveLength(2);
  });

  it("single flight: five concurrent callers share one search", async () => {
    let release!: (r: TavilyResult[]) => void;
    const gate = new Promise<TavilyResult[]>((r) => (release = r));
    const slow = search(() => gate);
    const { runtime } = rt({ search: slow, cfg: { ipClosuresPerHour: 100 } });
    const calls = Array.from({ length: 5 }, (_, i) => ask(runtime, { topic: "freight" }, `10.1.0.${i}`));
    await new Promise((r) => setTimeout(r, 20));
    release(FAKE);
    const out = await Promise.all(calls);
    expect(slow.calls).toHaveLength(1);
    for (const o of out) expect(o.body).toMatchObject({ status: "ok", topic: "freight" });
  });

  it("the global daily Tavily cap is shared with the closure search: one credit used elsewhere leaves none here", async () => {
    const { runtime, server, s } = rt({ cfg: { tavilyDailyCap: 1 } });
    await server.store.incrLite(`tavily:${new Date(server.clock.t - 8 * 3600_000).toISOString().slice(0, 10)}`, 1, 86_400_000); // the closure search's counter
    const out = await ask(runtime);
    expect(out.body).toMatchObject({ status: "unavailable", reason: "cap_reached" });
    expect(s.calls).toHaveLength(0);
    // and the refused attempt gave its unit back, so the counter did not creep upward
    expect(await server.store.get(`tavily:${new Date(server.clock.t - 8 * 3600_000).toISOString().slice(0, 10)}`)).toBe("1");
  });

  it("per-client limits: the hourly allowance is shared with closure searches, and the in-memory front door answers 429 with retry-after", async () => {
    const { runtime, server } = rt({ cfg: { ipClosuresPerHour: 2 } });
    for (const topic of ["detours", "traffic"] as const) expect((await ask(runtime, { topic })).status).toBe(200);
    const third = await ask(runtime, { topic: "freight" });
    expect(third.body).toMatchObject({ status: "unavailable", reason: "rate_limited" });
    expect(third.status).toBe(429);
    // an address flood is stopped by the front door before any store command or body read
    const { FrontDoor } = await import("../../lib/server/ratelimit");
    server.deps.frontDoor = new FrontDoor({ perIpPerMin: 1000, globalPerMin: 1000, closuresPerIpPerHour: 1, missionsPerIpPerDay: 10, now: server.deps.now });
    expect((await handleEvidence(post("/api/evidence", { topic: "detours" }, "9.9.9.9"), runtime)).status).toBe(200);
    const blocked = await handleEvidence(post("/api/evidence", "not json", "9.9.9.9"), runtime);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("honest states: no key, kill switch, and store trouble", async () => {
    expect((await ask(rt({ search: null }).runtime)).body).toMatchObject({ status: "unavailable", reason: "no_key" });
    const noQuery = { async search() { return []; } } as SearchClient;
    const server = makeServer([]);
    expect((await ask(makeRuntime(server, noQuery))).body).toMatchObject({ status: "unavailable", reason: "no_key" });
    const off = rt({ cfg: { liveAi: false } });
    expect((await ask(off.runtime)).body).toMatchObject({ status: "unavailable", reason: "disabled" });
    expect(off.s.calls).toHaveLength(0);
    const { brokenStore } = await import("./fixtures");
    const broken = rt();
    broken.runtime.store = brokenStore();
    broken.runtime.agent.limiter = new (await import("../../lib/server/ratelimit")).StoreRateLimiter(broken.runtime.store);
    expect((await ask(broken.runtime)).body).toMatchObject({ status: "unavailable", reason: "protection_unavailable" });
    expect(broken.s.calls).toHaveLength(0);
  });

  it("guards: cross-site and non-JSON requests are refused", async () => {
    const { runtime } = rt();
    const foreign = new Request("http://localhost/api/evidence", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", "x-forwarded-for": "5.5.5.5" }, body: JSON.stringify({ topic: "detours" }) });
    expect((await handleEvidence(foreign, runtime)).status).toBe(403);
    const plain = new Request("http://localhost/api/evidence", { method: "POST", headers: { "content-type": "text/plain", "x-forwarded-for": "5.5.5.5" }, body: JSON.stringify({ topic: "detours" }) });
    expect((await handleEvidence(plain, runtime)).status).toBe(415);
  });

  it("Tavily content is never written to the shared store: only counters and rate-limit keys exist afterwards", async () => {
    const { runtime, server } = rt();
    for (const topic of EVIDENCE_TOPICS) await ask(runtime, { topic }, `10.2.0.${EVIDENCE_TOPICS.indexOf(topic)}`);
    const entries = server.store.entries();
    const dump = JSON.stringify(entries);
    for (const needle of ["Harbor Tunnel", "detoured", "hazardous", "news.example.test", "FAKE"]) expect(dump).not.toContain(needle);
    for (const key of Object.keys(entries)) expect(key).toMatch(/^(?:rl:|tavily:|spend:|mission|ip:)/);
  });

  it("health reports whether the evidence lookup is available, and the route module is a node POST handler", async () => {
    const on = rt();
    expect((await (await handleHealth(on.runtime)).json()).evidence).toEqual({ available: true });
    const off = rt({ search: null });
    expect((await (await handleHealth(off.runtime)).json()).evidence).toEqual({ available: false });
    expect(typeof evidenceRoute.POST).toBe("function");
    expect(evidenceRoute.runtime).toBe("nodejs");
    expect(evidenceRoute.maxDuration).toBe(60);
    expect(evidenceRoute.dynamic).toBe("force-dynamic");
  });

  it("no evidence content is committed: the fixtures are hand-written and no snapshot of search results exists in the repository tree", () => {
    const root = path.resolve(__dirname, "../..");
    const src = readFileSync(path.join(root, "lib/server/evidence.ts"), "utf8");
    expect(src).not.toMatch(/writeFile|appendFile|createWriteStream/);
    expect(FAKE.every((r) => r.content.startsWith("FAKE SAMPLE TEXT"))).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R4-5: the exhaustive-search check", () => {
  const cand = (id: string, costTier: string, lens: string[] = ["access"], type = "signal_priority") => ({ ...FAKE_CANDIDATES[0], id, costTier, lens, type });
  const catalogOf = (n: number, tier = "$") => buildCatalog(Array.from({ length: n }, (_, i) => cand(`C-${String.fromCharCode(65 + i)}`, tier)), []);

  /** A deterministic fake simulator: p90 falls by 100 s for every candidate id "C-A".."C-Z" by letter weight, plus a pairing penalty. */
  const evaluator = (opts: { calls?: number[]; abortAfter?: { ctl: AbortController; batches: number } } = {}): DeterministicEvaluateFn => async (bundles, ctx) => {
    opts.calls?.push(bundles.length);
    if (opts.abortAfter && (opts.calls?.length ?? 0) >= opts.abortAfter.batches) opts.abortAfter.ctl.abort();
    void ctx;
    const rows: DeterministicRow[] = bundles.map((b) => {
      const weight = b.candidateIds.reduce((n, id) => n + (id.charCodeAt(2) - 64), 0);
      return { bundleId: b.id, candidateIds: b.candidateIds, p50S: 700 - weight, p90S: 2000 - 100 * weight + 30 * b.candidateIds.length, isolatedCount: Math.max(0, 9 - weight), equityGapS: 300 - weight };
    });
    return { rows };
  };

  it("enumerates every bundle of one to three candidates: n + C(n,2) + C(n,3)", () => {
    for (const n of [0, 1, 2, 3, 5, 12, 16]) {
      const cat = catalogOf(n);
      expect(enumerateBundles(cat, MISSION).length, `n=${n}`).toBe(countBundles(n));
    }
    expect(countBundles(5)).toBe(25);
    expect(countBundles(16)).toBe(696);
    expect(countBundles(12)).toBe(298);
    const all = enumerateBundles(catalogOf(6), MISSION);
    expect(new Set(all.map((b) => [...b.candidateIds].sort().join("+"))).size).toBe(all.length); // no duplicates
    expect(all.every((b) => b.candidateIds.length >= 1 && b.candidateIds.length <= 3 && new Set(b.candidateIds).size === b.candidateIds.length)).toBe(true);
  });

  it("respects the mission's constraints: lens, cost tier and types", () => {
    const cat = buildCatalog([cand("C-A", "$"), cand("C-B", "$$"), cand("C-C", "$$$"), cand("C-D", "$", ["ems"]), cand("C-E", "$", ["access"], "temp_link")], []);
    const ids = (m: typeof MISSION) => new Set(enumerateBundles(cat, m).flatMap((b) => b.candidateIds));
    expect([...ids(MISSION)].sort()).toEqual(["C-A", "C-B", "C-C", "C-E"]); // the ems-only candidate is out for the access lens
    expect([...ids({ ...MISSION, constraints: { ...MISSION.constraints, maxCostTier: "$$" } })].sort()).toEqual(["C-A", "C-B", "C-E"]);
    expect([...ids({ ...MISSION, constraints: { ...MISSION.constraints, maxCostTier: "$" } })].sort()).toEqual(["C-A", "C-E"]);
    expect([...ids({ ...MISSION, constraints: { ...MISSION.constraints, types: ["temp_link"] } })]).toEqual(["C-E"]);
  });

  it("finds the true optimum on the goal metric and the rank of any bundle, in any candidate order, with the evaluation count", async () => {
    const cat = catalogOf(6);
    const calls: number[] = [];
    const res = await exhaustiveSearch({ catalog: cat, mission: MISSION, evaluate: evaluator({ calls }), batchSize: 10 });
    expect(res.evaluations).toBe(countBundles(6));
    expect(res.enumerated).toBe(countBundles(6));
    expect(calls.reduce((a, c) => a + c, 0)).toBe(countBundles(6));
    expect(calls.every((c) => c <= 10)).toBe(true);
    expect(res.optimum?.candidateIds.sort()).toEqual(["C-D", "C-E", "C-F"]); // the three heaviest
    expect(res.optimum?.rank).toBe(1);
    expect(rankOf(res, ["C-F", "C-E", "C-D"])).toEqual({ rank: 1, of: 41 });
    expect(rankOf(res, ["C-A"])?.rank).toBe(res.ranked.length); // the weakest single is last
    expect(rankOf(res, ["C-NOPE"])).toBeNull();
    // ranked is sorted best first by the goal metric (lower p90)
    for (let i = 1; i < res.ranked.length; i++) expect(res.ranked[i].value).toBeGreaterThanOrEqual(res.ranked[i - 1].value);
  });

  it("ranks by whichever goal metric the mission names, and ties share the better rank", async () => {
    const cat = catalogOf(4);
    const flat: DeterministicEvaluateFn = async (bundles) => ({
      rows: bundles.map((b) => ({ bundleId: b.id, candidateIds: b.candidateIds, p50S: 100, p90S: 500, isolatedCount: b.candidateIds.length === 3 ? 0 : 4, equityGapS: 50 })),
    });
    const res = await exhaustiveSearch({ catalog: cat, mission: { ...MISSION, goal: { ...MISSION.goal, metric: "isolatedCount" } }, evaluate: flat });
    expect(res.ranked.filter((e) => e.rank === 1).length).toBe(4); // all four 3-bundles tie at zero isolated groups
    expect(res.ranked.find((e) => e.value === 4)!.rank).toBe(5); // the next value ranks after the four that beat it
    const p50 = await exhaustiveSearch({ catalog: cat, mission: { ...MISSION, goal: { ...MISSION.goal, metric: "p50" } }, evaluate: evaluator() });
    expect(p50.optimum?.value).toBe(700 - (3 + 4 + 2)); // C-B, C-C, C-D
  });

  it("ignores rows it did not ask for, duplicates, mismatched candidates and unusable numbers (same acceptance rules as the machine)", async () => {
    const cat = catalogOf(3);
    const dirty: DeterministicEvaluateFn = async (bundles) => {
      const rows: DeterministicRow[] = bundles.map((b) => ({ bundleId: b.id, candidateIds: b.candidateIds, p50S: 1, p90S: 100 + b.candidateIds.length, isolatedCount: 1, equityGapS: 1 }));
      return {
        rows: [{ ...rows[0] }, { ...rows[0], bundleId: "E999" }, { ...rows[1], candidateIds: ["C-A", "C-C"] }, { ...rows[2], p90S: Number.NaN }, { ...rows[3], p90S: -5 }, { ...rows[4] }, { ...rows[4] }],
      };
    };
    const res = await exhaustiveSearch({ catalog: cat, mission: MISSION, evaluate: dirty });
    // 3 singles + 3 pairs + 1 triple = 7 enumerated. Accepted: E1 and E5 only (the duplicate E5 is refused;
    // E2 has mismatched candidates, E3 is NaN, E4 is negative, E999 was never asked for, and E6 and E7 were not returned).
    expect(res.enumerated).toBe(7);
    expect(res.ranked.map((e) => e.candidateIds.join("+")).sort()).toEqual(["C-A", "C-A+C-C"].sort());
    expect(res.evaluations).toBe(2);
    expect(res.ranked.every((e) => Number.isFinite(e.value) && e.value >= 0)).toBe(true);
    expect(new Set(res.ranked.map((e) => e.candidateIds.join("+"))).size).toBe(res.ranked.length);
  });

  it("is cancellable: an aborted signal rejects with AbortError between batches and no further batch is scored", async () => {
    const cat = catalogOf(8);
    const ctl = new AbortController();
    const calls: number[] = [];
    await expect(exhaustiveSearch({ catalog: cat, mission: MISSION, evaluate: evaluator({ calls, abortAfter: { ctl, batches: 2 } }), signal: ctl.signal, batchSize: 5 })).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(2);
    const before = new AbortController();
    before.abort();
    const none: number[] = [];
    await expect(exhaustiveSearch({ catalog: cat, mission: MISSION, evaluate: evaluator({ calls: none }), signal: before.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(none).toHaveLength(0);
  });

  it("reports progress and passes the signal to the evaluator", async () => {
    const cat = catalogOf(4);
    const progress: [number, number][] = [];
    let seen: AbortSignal | undefined;
    const ctl = new AbortController();
    const ev: DeterministicEvaluateFn = async (bundles, ctx) => {
      seen = ctx.signal;
      return evaluator()(bundles, ctx);
    };
    await exhaustiveSearch({ catalog: cat, mission: MISSION, evaluate: ev, signal: ctl.signal, batchSize: 6, onProgress: (d, t) => progress.push([d, t]) });
    expect(seen).toBe(ctl.signal);
    expect(progress.at(-1)).toEqual([countBundles(4), countBundles(4)]);
    expect(progress[0]).toEqual([6, 14]);
  });

  it("an empty eligible set scores nothing and has no optimum", async () => {
    const cat = catalogOf(3, "$$$");
    const res = await exhaustiveSearch({ catalog: cat, mission: { ...MISSION, constraints: { ...MISSION.constraints, maxCostTier: "$" } }, evaluate: evaluator() });
    expect(res).toMatchObject({ ranked: [], optimum: null, evaluations: 0, enumerated: 0 });
  });

  it("the summary line names the rank and the number of bundles evaluated", () => {
    expect(exhaustiveSummaryLine({ rank: 3, of: 341 })).toBe("Exhaustive check: the AI's top pick is rank 3 of 341 bundles evaluated.");
    expect(exhaustiveSummaryLine({ rank: 1, of: 341 })).toBe("Exhaustive check: the AI's top pick is rank 1 of 341 bundles evaluated (it matches the best bundle on the goal metric).");
  });

  it("works on the real catalog at whatever size it currently has (the pipeline is pruning it)", async () => {
    const read = (f: string) => JSON.parse(readFileSync(path.resolve(__dirname, "../../../data/snapshot", f), "utf8"));
    const cat = buildCatalog(read("candidates.json"), read("gazetteer.json"));
    const n = enumerateBundles(cat, MISSION).filter((b) => b.candidateIds.length === 1).length;
    const all = enumerateBundles(cat, MISSION);
    expect(all.length).toBe(countBundles(n));
    if (n === 0) return;
    const res = await exhaustiveSearch({
      catalog: cat,
      mission: MISSION,
      evaluate: async (bundles) => ({ rows: bundles.map((b, i) => ({ bundleId: b.id, candidateIds: b.candidateIds, p50S: 1, p90S: 1000 - b.candidateIds.length * 10 - (i % 7), isolatedCount: 1, equityGapS: 1 })) }),
    });
    expect(res.evaluations).toBe(all.length);
    expect(res.optimum!.candidateIds.length).toBe(Math.min(3, n));
    const fc = fakeCatalog();
    expect(enumerateBundles(fc, MISSION).length).toBe(countBundles(enumerateBundles(fc, MISSION).filter((b) => b.candidateIds.length === 1).length));
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R4-1/R4-4: client helpers and the standalone deterministic search", () => {
  it("fetchEvidence posts only the enum topic and turns any failure into an honest 'unavailable'", async () => {
    const { fetchEvidence } = await import("../../lib/agent/evidence");
    let sent: { url: string; body: string } | undefined;
    const ok = (async (url: string, init: RequestInit) => {
      sent = { url, body: String(init.body) };
      return new Response(JSON.stringify({ status: "ok", topic: "traffic", retrievedAt: "x", cached: false, sources: [], message: "m" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect((await fetchEvidence("traffic", { fetchImpl: ok })).status).toBe("ok");
    expect(sent).toEqual({ url: "/api/evidence", body: JSON.stringify({ topic: "traffic" }) });
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await fetchEvidence("traffic", { fetchImpl: down })).toMatchObject({ status: "unavailable", reason: "upstream_error" });
    const html = (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch;
    expect((await fetchEvidence("traffic", { fetchImpl: html })).status).toBe("unavailable");
  });

  it("greedySearch (the standalone deterministic search) also runs the deterministic stress step after rounds 1 and 2", async () => {
    const { greedySearch } = await import("../../lib/agent/greedy");
    const { fakeEvaluator } = await import("./fixtures");
    const stressCalls: { label: string; closedLinks: string[]; ids: string[] }[] = [];
    const res = await greedySearch({ catalog: fakeCatalog(), mission: MISSION, evaluate: fakeEvaluator({ stressCalls, fragile: { "L-FORTMCHENRY": FAKE_CANDIDATES.map((c) => c.id) } }) });
    expect(res.stresses).toHaveLength(2);
    expect(res.stresses[0].spec).toEqual({ kind: "close_link", linkId: "L-FORTMCHENRY" });
    expect(res.stresses[1].spec).not.toEqual(res.stresses[0].spec);
    expect(res.finalists).toHaveLength(3);
    const off = await greedySearch({ catalog: fakeCatalog(), mission: MISSION, evaluate: fakeEvaluator(), stress: false });
    expect(off.stresses).toEqual([]);
  });
});

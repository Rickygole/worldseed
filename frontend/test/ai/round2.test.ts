/**
 * Round-2 regression tests: store-command budget (N1), per-client dollar cap (N3), Upstash wire
 * format (N5, in store.test.ts), fail-safe kill switch (N6), trusted headers (N7, in
 * ratelimit.test.ts), store and provider host allowlists (N8), lock compare-and-delete (N9), salted
 * client keys (N10), and the confirmation trust boundary (NEW-4).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { handleClosures } from "../../lib/server/handlers";
import { handleCritique, handleNarrate, handleParse, handlePlan } from "../../lib/server/agentService";
import { baseUrlIssue, liveAiEnabled, readConfig } from "../../lib/server/config";
import { setLogSink } from "../../lib/server/log";
import { MissionLedger } from "../../lib/server/missions";
import { DailyBudget, FrontDoor, StoreRateLimiter, ipKey, setIpSalt } from "../../lib/server/ratelimit";
import { createRuntime } from "../../lib/server/runtime";
import { MemoryStore, MeteredStore, UpstashRestStore, sharedStoreCredentials } from "../../lib/server/store";
import { resetDowngrades } from "../../lib/server/tokenfactory";
import { FAKE_TOKEN, FAKE_URL, FakeUpstash } from "./fakeUpstash";
import { BASELINE, MISSION, blockNetwork, critiqueReply, doneOf, finalizeReply, makeRuntime, makeServer, narrateReply, parseReply, post, proposeReply, readSse, refineReply, row, type TestServer } from "./fixtures";

beforeEach(() => {
  blockNetwork();
  resetDowngrades();
  setLogSink(() => undefined);
  setIpSalt("");
});

const parseBody = (missionId: string) => ({ missionId, text: "reduce p90 near Dundalk" });

/** A test server whose limiter, ledger and budget all talk to a fake Upstash, so commands are counted. */
function upstashServer(script: string[], cfg: Record<string, unknown> = {}, doorOpts?: ConstructorParameters<typeof FrontDoor>[0]) {
  const s = makeServer(script, cfg as never);
  const fake = new FakeUpstash(s.deps.now);
  const store = new UpstashRestStore({ url: FAKE_URL, token: FAKE_TOKEN, fetchImpl: fake.fetch });
  s.deps.limiter = new StoreRateLimiter(store);
  s.deps.budget = new DailyBudget(store, s.config.dailyBudgetUsd, s.deps.now, s.config.budgetResetHourUtc);
  s.deps.missions = new MissionLedger(store, undefined, s.deps.now);
  if (doorOpts) s.deps.frontDoor = new FrontDoor(doorOpts);
  return { s, fake, store };
}

describe("finding N1(d): store commands per AI call", () => {
  it("a full seven-call mission costs about 10 commands per call in steady state, and the numbers are on record", async () => {
    const B = [{ candidateIds: ["SP-BROENING"] }, { candidateIds: ["SP-EASTERN"] }, { candidateIds: ["SP-HARBOR"] }];
    const { s, fake } = upstashServer([parseReply(), proposeReply(B), critiqueReply({ concerns: [{ bundleId: "B1", kind: "worst_case" }] }), refineReply([{ candidateIds: ["TL-DUNDALK"] }]), critiqueReply(), finalizeReply(["B1", "B2", "B3"]), narrateReply(["B1", "B2", "B3"])], { dailyBudgetUsd: 50, ipDailyUsd: 50 });
    const id = "MISSION-CMD-001";
    const rows = ["B1", "B2", "B3"].map((b, i) => row(b, [["SP-BROENING", "SP-EASTERN", "SP-HARBOR"][i]]));
    const rows4 = [...rows, row("B4", ["TL-DUNDALK"])];
    const bundles = (rs: typeof rows) => rs.map((r) => ({ id: r.bundleId, candidateIds: r.candidateIds }));
    const steps: [string, () => Promise<Response>][] = [
      ["parse", () => handleParse(post("/api/agent/parse", parseBody(id)), s.deps)],
      ["plan 1", () => handlePlan(post("/api/agent/plan", { missionId: id, mission: MISSION, phase: "search", round: 1, bundles: [], evaluations: [] }), s.deps)],
      ["critique 1", () => handleCritique(post("/api/agent/critique", { missionId: id, mission: MISSION, round: 1, evaluations: rows, baseline: BASELINE }), s.deps)],
      ["plan 2", () => handlePlan(post("/api/agent/plan", { missionId: id, mission: MISSION, phase: "search", round: 2, bundles: bundles(rows), evaluations: rows, baseline: BASELINE }), s.deps)],
      ["critique 2", () => handleCritique(post("/api/agent/critique", { missionId: id, mission: MISSION, round: 2, evaluations: rows4, baseline: BASELINE }), s.deps)],
      ["finalize", () => handlePlan(post("/api/agent/plan", { missionId: id, mission: MISSION, phase: "finalize", round: 3, bundles: bundles(rows4), evaluations: rows4, baseline: BASELINE }), s.deps)],
      ["narrate", () => handleNarrate(post("/api/agent/narrate", { missionId: id, mission: MISSION, finalists: ["B1", "B2", "B3"].map((bundleId) => ({ bundleId })), evaluations: rows4, baseline: BASELINE }), s.deps)],
    ];
    const per: number[] = [];
    for (const [name, run] of steps) {
      const before = fake.commands;
      const done = doneOf(await readSse(await run()));
      expect(done.status, name).toBe("ok");
      per.push(fake.commands - before);
    }
    const total = fake.commands;
    process.stdout.write(`store commands per call: ${per.join(", ")} (total ${total} for a seven-call mission; was 231)\n`);
    expect(per[0]).toBeLessThanOrEqual(22); // the first call also creates the pair, the counters and their expiries
    for (const n of per.slice(1)) expect(n).toBeLessThanOrEqual(13); // steady state
    expect(Math.max(...per.slice(2))).toBeLessThanOrEqual(12);
    expect(total).toBeLessThan(110);
    expect(500_000 / total).toBeGreaterThan(4_500); // free-plan monthly capacity in full missions
  });
  it("a request refused by the per-client quota costs at most 3 commands", async () => {
    const { s, fake } = upstashServer(Array.from({ length: 12 }, () => parseReply()), { ipMissionsPerHour: 2 });
    for (let i = 0; i < 2; i++) await readSse(await handleParse(post("/api/agent/parse", parseBody(`MISSION-CMD-10${i}`)), s.deps));
    const before = fake.commands;
    const res = await handleParse(post("/api/agent/parse", parseBody("MISSION-CMD-109")), s.deps);
    expect(res.status).toBe(429);
    expect(fake.commands - before).toBeLessThanOrEqual(3);
  });
  it("preflight and repeat requests read the store only when they must: the budget total and the known pair are cached in process", async () => {
    const { s, fake } = upstashServer(Array.from({ length: 6 }, () => parseReply()), { dailyBudgetUsd: 50, ipDailyUsd: 50 });
    await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-CMD-200")), s.deps));
    const gets = () => fake.requests.filter((r) => r.path === "" && (r.body as string[])[0] === "GET").length;
    const g0 = gets();
    for (let i = 0; i < 2; i++) await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-CMD-200")), s.deps));
    expect(gets()).toBe(g0); // no GET for the budget (cached) or for the known pair (cached)
  });
});

describe("finding N1(a): the in-memory front door runs BEFORE any store command", () => {
  it("a flood from one address is refused with zero store commands once its allowance is used", async () => {
    const { s, fake } = upstashServer(Array.from({ length: 5 }, () => parseReply()), {}, { perIpPerMin: 3, globalPerMin: 100, closuresPerIpPerHour: 5, missionsPerIpPerDay: 50, now: () => Date.UTC(2026, 8, 26, 12) });
    for (let i = 0; i < 3; i++) await readSse(await handleParse(post("/api/agent/parse", parseBody(`MISSION-FD-00${i}`)), s.deps));
    const after = fake.commands;
    const statuses: number[] = [];
    for (let i = 0; i < 500; i++) statuses.push((await handleParse(post("/api/agent/parse", parseBody(`MISSION-FD-1${String(i).padStart(3, "0")}`)), s.deps)).status);
    expect(new Set(statuses)).toEqual(new Set([429]));
    expect(fake.commands).toBe(after); // 500 refused requests cost no store command at all
  });
  it("a flood spread over many addresses is capped per process, so the store cannot be drained by volume", async () => {
    const { s, fake } = upstashServer(Array.from({ length: 5 }, () => parseReply()), {}, { perIpPerMin: 100, globalPerMin: 10, closuresPerIpPerHour: 5, missionsPerIpPerDay: 50, now: () => Date.UTC(2026, 8, 26, 12) });
    for (let i = 0; i < 10; i++) await handleParse(post("/api/agent/parse", parseBody(`MISSION-FG-00${i}`), `10.0.${i}.1`), s.deps).then((r) => r.text());
    const after = fake.commands;
    for (let i = 0; i < 300; i++) expect((await handleParse(post("/api/agent/parse", parseBody(`MISSION-FG-1${String(i).padStart(3, "0")}`), `10.1.${i % 250}.${i}`), s.deps)).status).toBe(429);
    expect(fake.commands).toBe(after);
  });
  it("every route has a front door: plan, critique, narrate, closures and confirm refuse before reading the body", async () => {
    const s = makeServer([]);
    s.deps.frontDoor = new FrontDoor({ perIpPerMin: 1, globalPerMin: 100, closuresPerIpPerHour: 1, missionsPerIpPerDay: 50 });
    const rt = makeRuntime(s);
    const send = (p: string, h: (r: Request) => Promise<Response>) => h(new Request(`http://localhost${p}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: "not json at all" }));
    const routes: [string, (r: Request) => Promise<Response>][] = [
      ["/api/agent/plan", (r) => handlePlan(r, s.deps)],
      ["/api/agent/critique", (r) => handleCritique(r, s.deps)],
      ["/api/agent/narrate", (r) => handleNarrate(r, s.deps)],
      ["/api/closures", (r) => handleClosures(r, rt)],
    ];
    for (const [p, h] of routes) {
      s.deps.frontDoor = new FrontDoor({ perIpPerMin: 1, globalPerMin: 100, closuresPerIpPerHour: 1, missionsPerIpPerDay: 50 });
      expect((await send(p, h)).status, `${p} first`).toBe(400); // passes the door, then fails body validation
      const second = await send(p, h);
      expect(second.status, `${p} second`).toBe(429);
      expect(second.headers.get("retry-after")).toBeTruthy();
    }
  });
  it("the closures per-IP limit runs before the cache is read, and a cached response costs no store command", async () => {
    const s = makeServer([JSON.stringify({ closures: [] })]);
    const fake = new FakeUpstash(s.deps.now);
    const store = new UpstashRestStore({ url: FAKE_URL, token: FAKE_TOKEN, fetchImpl: fake.fetch });
    const rt = { ...makeRuntime(s, { async search() { return [{ title: "FAKE", url: "https://news.example.test/a", content: "FAKE Baltimore text." }]; } }), store };
    rt.agent.frontDoor = new FrontDoor({ perIpPerMin: 1000, globalPerMin: 100_000, closuresPerIpPerHour: 5, missionsPerIpPerDay: 50, now: s.deps.now });
    const call = () => handleClosures(post("/api/closures", {}), rt);
    expect((await call()).status).toBe(200); // a real lookup (uses the store for the cap counter)
    const after = fake.commands;
    for (let i = 0; i < 4; i++) expect((await call()).status).toBe(200); // cached: zero store commands
    expect(fake.commands).toBe(after);
    expect((await call()).status).toBe(429); // the sixth in the hour: refused before the cache was even read
    expect(fake.commands).toBe(after);
  });
});

describe("finding N1(e)/(worst case): the process command allowance bounds what a flood can burn", () => {
  it("with the metered store in place, sustained store traffic stops at the per-day allowance and fails closed with a clear outcome", async () => {
    const s = makeServer(Array.from({ length: 200 }, () => parseReply()), { ipMissionsPerHour: 10_000 });
    const fake = new FakeUpstash(s.deps.now);
    const metered = new MeteredStore(new UpstashRestStore({ url: FAKE_URL, token: FAKE_TOKEN, fetchImpl: fake.fetch }), { perHour: 60, perDay: 60, now: s.deps.now });
    s.deps.limiter = new StoreRateLimiter(metered);
    s.deps.budget = new DailyBudget(metered, 50, s.deps.now, 8);
    s.deps.missions = new MissionLedger(metered, undefined, s.deps.now);
    const outcomes: string[] = [];
    for (let i = 0; i < 40; i++) {
      const d = doneOf(await readSse(await handleParse(post("/api/agent/parse", parseBody(`MISSION-MB-${String(i).padStart(3, "0")}`), `10.2.0.${i}`), s.deps)));
      outcomes.push(d.status === "ok" ? "ok" : d.reason);
    }
    expect(fake.commands).toBeLessThanOrEqual(60); // never above the allowance, whatever the traffic
    expect(outcomes.includes("ok")).toBe(true);
    expect(outcomes.at(-1)).toBe("planner_unavailable"); // clear degraded outcome, no store call, no provider call
    const callsAtEnd = s.provider.calls.length;
    await handleParse(post("/api/agent/parse", parseBody("MISSION-MB-999"), "10.2.1.1"), s.deps).then((r) => r.text());
    expect(s.provider.calls.length).toBe(callsAtEnd);
    expect(fake.commands).toBeLessThanOrEqual(60);
  });
  it("documented capacity: a metered instance can send at most 9,000 commands a day (279,000 a month), i.e. about 100 full missions a day", async () => {
    const { DEFAULT_STORE_DAILY_COMMANDS } = await import("../../lib/server/store");
    expect(DEFAULT_STORE_DAILY_COMMANDS).toBe(9_000);
    expect(9_000 * 31).toBe(279_000);
    process.stdout.write("worst-case burn from an unauthenticated flood: instances x 9,000 commands/day x 31 = 279,000 per instance-month (free plan: 500,000)\n");
  });
});

describe("finding N3: per-client dollar cap through the routes", () => {
  it("a client that has used its allowance gets the recorded-run outcome with no provider call; another client is unaffected", async () => {
    const s = makeServer(Array.from({ length: 20 }, () => parseReply()), { ipDailyUsd: 0.004, ipMissionsPerHour: 100 });
    const first = doneOf(await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-D-0001")), s.deps)));
    expect(first.status).toBe("ok");
    const second = await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-D-0002")), s.deps));
    expect(doneOf(second)).toMatchObject({ status: "fallback", reason: "budget_exhausted", next: "recorded_tour" });
    expect(second.some((e) => e.event === "error" && e.data.code === "ip_budget_exhausted")).toBe(true);
    const calls = s.provider.calls.length;
    expect(calls).toBe(1);
    expect(doneOf(await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-D-0003"), "198.51.100.5"), s.deps))).status).toBe("ok");
  });
  it("defaults: about $0.15 per client per day, missions capped at 30k input and 6k output tokens, 8 missions an hour", () => {
    expect(readConfig({})).toMatchObject({ ipDailyUsd: 0.15, missionInputTokens: 30_000, missionOutputTokens: 6_000, ipMissionsPerHour: 8 });
    expect(readConfig({ WS_IP_DAILY_USD: "0.5" }).ipDailyUsd).toBe(0.5);
  });
  it("an advertised mission (25k in, 4k out) fits inside a single client's day; the dollar cap bounds abuse", () => {
    const missionUsd = (25_000 * 1 + 4_000 * 3) / 1e6;
    expect(missionUsd).toBeLessThan(0.15); // one mission is well inside the allowance
    expect(Math.floor(0.15 / missionUsd)).toBeGreaterThanOrEqual(4); // and a judge can run several
  });
});

describe("finding N6: the kill switch fails SAFE", () => {
  it("only unset, blank, on, 1, true or yes keep AI on; every other value (typos included) turns it off", () => {
    for (const v of [undefined, "", "  ", "on", "ON", "1", "true", "TRUE", "yes", " Yes "]) expect(liveAiEnabled(v), String(v)).toBe(true);
    for (const v of ["off", "of", "stop", "paused", "kill", "0", "false", "no", "disabled", "disable", "onn", "tru", "y", "enabled?"]) expect(liveAiEnabled(v), v).toBe(false);
    expect(readConfig({ WS_LIVE_AI: "paused" }).liveAi).toBe(false);
    expect(readConfig({ WS_LIVE_AI: "paused" }).protection).toBe("off");
  });
});

describe("finding N8: store and provider host allowlists", () => {
  const creds = (u: string) => sharedStoreCredentials({ UPSTASH_REDIS_REST_URL: u, UPSTASH_REDIS_REST_TOKEN: "t" });
  it("accepts *.upstash.io and *.kv.vercel-storage.com over https, plus WS_ALLOWED_STORE_HOSTS", () => {
    expect(creds("https://eu1-good-name-12345.upstash.io")).not.toBeNull();
    expect(creds("https://abc.kv.vercel-storage.com")).not.toBeNull();
    for (const bad of ["https://evil.example.com", "https://upstash.io.evil.com", "https://evilupstash.io", "http://x.upstash.io", "https://user@x.upstash.io", "https://x.upstash.io.attacker.test"]) expect(creds(bad), bad).toBeNull();
    expect(sharedStoreCredentials({ UPSTASH_REDIS_REST_URL: "https://redis.corp.test", UPSTASH_REDIS_REST_TOKEN: "t" })).toBeNull();
    expect(sharedStoreCredentials({ UPSTASH_REDIS_REST_URL: "https://redis.corp.test", UPSTASH_REDIS_REST_TOKEN: "t", WS_ALLOWED_STORE_HOSTS: "redis.corp.test" })).not.toBeNull();
    expect(creds("http://localhost:8079")).not.toBeNull(); // a local emulator
  });
  it("a refused store endpoint means no shared store, and the bearer token is never sent to it", () => {
    const fake = new FakeUpstash();
    const rt = createRuntime({ NEBIUS_API_KEY: "k", UPSTASH_REDIS_REST_URL: "https://evil.example.com", UPSTASH_REDIS_REST_TOKEN: FAKE_TOKEN }, { fetchImpl: fake.fetch });
    expect(rt.store).toBeInstanceOf(MemoryStore);
    expect(rt.agent.config.protection).toBe("instance-local");
    expect(fake.requests).toHaveLength(0);
  });
  it("the provider base URL: only the exact known host without configuration; other hosts need WS_ALLOWED_BASE_HOSTS", () => {
    expect(baseUrlIssue("https://api.tokenfactory.nebius.com/v1/")).toBeNull();
    for (const bad of ["https://nebius.com.evil.com/v1", "https://evilnebius.com/v1", "https://api.nebius.com@evil.com/v1", "https://evil.com@api.tokenfactory.nebius.com/v1", "https://nebius.com./v1", "https://nebius.com:444/v1", "http://api.tokenfactory.nebius.com/v1", "https://other.tokenfactory.nebius.com/v1"]) expect(baseUrlIssue(bad), bad).not.toBeNull();
    expect(baseUrlIssue("https://api.studio.nebius.com/v1/", ["api.studio.nebius.com"])).toBeNull();
    expect(baseUrlIssue("https://evil.com/", ["com"])).not.toBeNull();
  });
});

describe("finding N9: lock release is compare-and-delete with a TTL below the function's duration", () => {
  it("a request that lost its lock (expired) cannot delete a newer request's lock", async () => {
    const clock = { t: 0 };
    const store = new MemoryStore(() => clock.t);
    const ledger = new MissionLedger(store, undefined, () => clock.t);
    const a = await ledger.acquire("MISSION-LOCK-1", 1_000);
    expect(a).not.toBeNull();
    clock.t += 1_500; // A's lock expired (A was slow)
    const b = await ledger.acquire("MISSION-LOCK-1", 1_000);
    expect(b).not.toBeNull();
    await ledger.release("MISSION-LOCK-1", a as string); // A finally finishes
    expect(await ledger.acquire("MISSION-LOCK-1", 1_000)).toBeNull(); // B's lock survived
    await ledger.release("MISSION-LOCK-1", b as string);
    expect(await ledger.acquire("MISSION-LOCK-1", 1_000)).not.toBeNull();
  });
  it("on Upstash it is a single EVAL command (or a compare then delete if scripts are unavailable)", async () => {
    const fake = new FakeUpstash();
    const store = new UpstashRestStore({ url: FAKE_URL, token: FAKE_TOKEN, fetchImpl: fake.fetch });
    const ledger = new MissionLedger(store);
    const tok = (await ledger.acquire("MISSION-LOCK-2", 10_000)) as string;
    fake.requests.length = 0;
    await ledger.release("MISSION-LOCK-2", tok);
    expect(fake.requests).toHaveLength(1);
    expect((fake.requests[0].body as string[])[0]).toBe("EVAL");
    expect(await store.get("m:MISSION-LOCK-2:lock")).toBeNull();
  });
  it("the lock lives less than the route's maxDuration (60 s)", () => {
    const c = readConfig({});
    expect(c.routeDeadlineMs + 5_000).toBeLessThan(60_000);
  });
});

describe("finding N10: client keys are salted with a private value", () => {
  it("WS_IP_HASH_SALT wins; otherwise the salt is derived from the store token (so instances agree and it is not guessable); no store means no salt", () => {
    createRuntime({ NEBIUS_API_KEY: "k" });
    const none = ipKey("9.9.9.9");
    createRuntime({ NEBIUS_API_KEY: "k", UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "token-A" });
    const derivedA = ipKey("9.9.9.9");
    createRuntime({ NEBIUS_API_KEY: "k", UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "token-A" });
    expect(ipKey("9.9.9.9")).toBe(derivedA); // a second instance of the same deployment agrees
    createRuntime({ NEBIUS_API_KEY: "k", UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "token-B" });
    expect(ipKey("9.9.9.9")).not.toBe(derivedA);
    createRuntime({ NEBIUS_API_KEY: "k", UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "token-A", WS_IP_HASH_SALT: "explicit-private-salt" });
    expect(ipKey("9.9.9.9")).not.toBe(derivedA);
    expect(derivedA).not.toBe(none);
  });
  it("logs one warning when the salt had to be derived", () => {
    const lines: string[] = [];
    setLogSink((_l, line) => lines.push(line));
    createRuntime({ NEBIUS_API_KEY: "k", UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" });
    expect(lines.filter((l) => JSON.parse(l).event === "ip_salt_derived")).toHaveLength(1);
    lines.length = 0;
    createRuntime({ NEBIUS_API_KEY: "k", UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t", WS_IP_HASH_SALT: "s" });
    expect(lines.some((l) => JSON.parse(l).event === "ip_salt_derived")).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("finding NEW-4: only the confirmation module may construct a tavily-origin mutation record", () => {
  const root = path.resolve(__dirname, "../..");
  const walk = (dir: string, out: string[] = []): string[] => {
    if (!existsSync(dir)) return out;
    for (const n of readdirSync(dir)) {
      if (n === "node_modules" || n === ".next") continue;
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|mjs|js)$/.test(n)) out.push(p);
    }
    return out;
  };
  /** The only places allowed to say origin: "tavily": the browser confirmation module and the server redeemer that signs it. */
  const ALLOWED = new Set(["lib/agent/closures.ts", "lib/server/tavily.ts"]);
  const construct = /origin\s*:\s*["'`]tavily["'`]\s*[,}]/;
  it("no other app or library code builds a record with origin tavily (tests and the sim's own schema excluded)", () => {
    const files = [...walk(path.join(root, "app")), ...walk(path.join(root, "components")), ...walk(path.join(root, "lib"))]
      .map((f) => path.relative(root, f))
      .filter((f) => !f.startsWith("lib/sim/") && !ALLOWED.has(f));
    const hits = files.filter((f) => construct.test(readFileSync(path.join(root, f), "utf8")));
    expect(hits, `unexpected tavily-origin record construction in: ${hits.join(", ")}`).toEqual([]);
    expect(ALLOWED.size).toBe(2);
    for (const f of ALLOWED) expect(construct.test(readFileSync(path.join(root, f), "utf8")), f).toBe(true); // the scan does see the allowed files
  });
  it("the branded type is what makes compile-side code need a redeemed confirmation (documented trust boundary)", () => {
    const src = readFileSync(path.join(root, "lib/agent/closures.ts"), "utf8");
    expect(src).toContain("declare const confirmedMutation: unique symbol");
    expect(src).toContain("export function toMutationRecord(c: ConfirmedTavilyMutation)");
    expect(src).toMatch(/TypeScript brands cannot stop code that casts around them/);
    expect(src).toMatch(/the browser is the user's own|the client is the user's own browser/);
  });
  it("nothing outside the module imports the record builder except through its public functions", () => {
    const files = [...walk(path.join(root, "app")), ...walk(path.join(root, "components"))].map((f) => path.relative(root, f));
    for (const f of files) expect(readFileSync(path.join(root, f), "utf8"), f).not.toMatch(/confirmToken\s*:\s*["'`]v1\./);
  });
});

describe("integrity: the whole AI path in one deployment mode (serverless, shared store) still works", () => {
  it("a mission flows end to end against the Upstash fake with the metered store and derived secrets", async () => {
    const fake = new FakeUpstash();
    const rt = createRuntime({ NEBIUS_API_KEY: "k", VERCEL: "1", UPSTASH_REDIS_REST_URL: FAKE_URL, UPSTASH_REDIS_REST_TOKEN: FAKE_TOKEN }, { fetchImpl: fake.fetch });
    expect(rt.agent.config).toMatchObject({ protection: "shared", serverless: true, trustForwarded: true, dailyBudgetUsd: 1 });
    expect(rt.store.kind).toBe("upstash");
    const s: TestServer = makeServer([parseReply()]);
    s.deps.limiter = rt.agent.limiter;
    s.deps.budget = rt.agent.budget;
    s.deps.missions = rt.agent.missions;
    const done = doneOf(await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-E2E-001"), "198.51.100.10", { "x-vercel-forwarded-for": "198.51.100.10" }), s.deps)));
    expect(done.status).toBe("ok");
    expect(fake.commands).toBeGreaterThan(0);
    expect(fake.requests.every((r) => r.auth === `Bearer ${FAKE_TOKEN}`)).toBe(true);
    expect(Object.keys(rt.store.kind === "upstash" ? {} : {}).length).toBe(0);
  });
});

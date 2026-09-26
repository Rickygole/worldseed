import { describe, expect, it } from "vitest";
import { handleParse } from "../../lib/server/agentService";
import { readConfig } from "../../lib/server/config";
import { setLogSink } from "../../lib/server/log";
import { DailyBudget, StoreRateLimiter, missionRules } from "../../lib/server/ratelimit";
import { createRuntime } from "../../lib/server/runtime";
import { MemoryStore, StoreError, UpstashRestStore, createSharedStore, sharedStoreCredentials } from "../../lib/server/store";
import { FAKE_TOKEN, FAKE_URL, FakeUpstash } from "./fakeUpstash";
import { blockNetwork, doneOf, makeServer, parseReply, post, readSse } from "./fixtures";
import { beforeEach } from "vitest";

beforeEach(() => {
  blockNetwork();
  setLogSink(null);
});

const mk = (fake: FakeUpstash) => new UpstashRestStore({ url: FAKE_URL, token: FAKE_TOKEN, fetchImpl: fake.fetch });

describe("finding 2: Upstash REST store sends the exact commands (plain fetch, no package)", () => {
  it("incr is one MULTI/EXEC: INCRBY, PEXPIRE NX, PTTL, with the bearer token", async () => {
    const fake = new FakeUpstash();
    const r = await mk(fake).incr("k1", 2, 60_000);
    expect(r).toEqual({ value: 2, ttlMs: 60_000 });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      path: "/multi-exec",
      auth: `Bearer ${FAKE_TOKEN}`,
      body: [["INCRBY", "k1", 2], ["PEXPIRE", "k1", 60_000, "NX"], ["PTTL", "k1"]],
    });
  });
  it("the TTL starts at the first hit and later hits never extend it", async () => {
    let t = 0;
    const fake = new FakeUpstash(() => t);
    const s = mk(fake);
    await s.incr("k", 1, 10_000);
    t = 4_000;
    const r = await s.incr("k", 1, 10_000);
    expect(r).toEqual({ value: 2, ttlMs: 6_000 });
    t = 10_001;
    expect((await s.incr("k", 1, 10_000)).value).toBe(1); // expired, new window
  });
  it("get, set, setIfAbsent, take and del map to GET, SET PX, SET PX NX, GETDEL and DEL", async () => {
    const fake = new FakeUpstash();
    const s = mk(fake);
    await s.set("a", "v", 5000);
    expect(await s.get("a")).toBe("v");
    expect(await s.setIfAbsent("a", "w", 5000)).toBe(false);
    expect(await s.setIfAbsent("b", "w", 5000)).toBe(true);
    expect(await s.take("b")).toBe("w");
    expect(await s.take("b")).toBeNull(); // single use
    await s.del("a");
    expect(await s.get("a")).toBeNull();
    expect(fake.requests.map((r) => r.body)).toEqual([
      ["SET", "a", "v", "PX", 5000],
      ["GET", "a"],
      ["SET", "a", "w", "PX", 5000, "NX"],
      ["SET", "b", "w", "PX", 5000, "NX"],
      ["GETDEL", "b"],
      ["GETDEL", "b"],
      ["DEL", "a"],
      ["GET", "a"],
    ]);
    expect(fake.requests.every((r) => r.path === "" && r.auth === `Bearer ${FAKE_TOKEN}`)).toBe(true);
  });
  it("a server without PEXPIRE NX (Redis before 7) falls back to a two-step form with the same first-hit TTL", async () => {
    let t = 0;
    const fake = new FakeUpstash(() => t);
    fake.mode = "no-nx";
    const s = mk(fake);
    expect(await s.incr("k", 1, 10_000)).toEqual({ value: 1, ttlMs: 10_000 });
    t = 4_000;
    expect(await s.incr("k", 1, 10_000)).toEqual({ value: 2, ttlMs: 6_000 });
    t = 10_001;
    expect((await s.incr("k", 1, 10_000)).value).toBe(1);
    const bodies = fake.requests.map((r) => JSON.stringify(r.body));
    expect(bodies[0]).toContain('"NX"'); // tried once
    expect(bodies.slice(1).filter((b) => b.includes('"NX"'))).toEqual([]); // then remembered
  });
  it("every failure mode throws StoreError, never a partial answer", async () => {
    for (const mode of ["down", "500", "error-item"] as const) {
      const fake = new FakeUpstash();
      fake.mode = mode;
      const s = mk(fake);
      await expect(s.get("k"), mode).rejects.toBeInstanceOf(StoreError);
      await expect(s.incr("k", 1, 1000), mode).rejects.toBeInstanceOf(StoreError);
    }
  });
  it("never leaks the token in an error message", async () => {
    const fake = new FakeUpstash();
    fake.mode = "500";
    try {
      await mk(fake).get("k");
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(FAKE_TOKEN);
    }
  });
});

describe("finding 2: store selection", () => {
  it("uses the Upstash names, then the Vercel marketplace names, else memory", () => {
    expect(sharedStoreCredentials({ UPSTASH_REDIS_REST_URL: FAKE_URL, UPSTASH_REDIS_REST_TOKEN: "t" })).toEqual({ url: FAKE_URL, token: "t" });
    expect(sharedStoreCredentials({ KV_REST_API_URL: FAKE_URL, KV_REST_API_TOKEN: "k" })).toEqual({ url: FAKE_URL, token: "k" });
    expect(sharedStoreCredentials({ UPSTASH_REDIS_REST_URL: FAKE_URL, UPSTASH_REDIS_REST_TOKEN: "t", KV_REST_API_URL: "https://other.example.test", KV_REST_API_TOKEN: "k" })?.token).toBe("t");
    expect(sharedStoreCredentials({})).toBeNull();
    expect(sharedStoreCredentials({ KV_REST_API_URL: FAKE_URL })).toBeNull(); // token missing
    expect(createSharedStore({}).kind).toBe("memory");
    expect(createSharedStore({ KV_REST_API_URL: FAKE_URL, KV_REST_API_TOKEN: "k" }).kind).toBe("upstash");
  });
  it("refuses a plain-http remote endpoint (the token would travel in clear)", () => {
    expect(sharedStoreCredentials({ UPSTASH_REDIS_REST_URL: "http://store.example.test", UPSTASH_REDIS_REST_TOKEN: "t" })).toBeNull();
    expect(sharedStoreCredentials({ UPSTASH_REDIS_REST_URL: "http://127.0.0.1:8079", UPSTASH_REDIS_REST_TOKEN: "t" })).not.toBeNull();
  });
});

describe("finding 2: protection modes", () => {
  it("shared when a store is configured; instance-local otherwise, with a small per-instance budget on a serverless host", () => {
    const shared = readConfig({ VERCEL: "1", KV_REST_API_URL: FAKE_URL, KV_REST_API_TOKEN: "k" });
    expect(shared).toMatchObject({ protection: "shared", dailyBudgetUsd: 1, serverless: true, sharedStore: true });
    const local = readConfig({ VERCEL: "1" });
    expect(local).toMatchObject({ protection: "instance-local", dailyBudgetUsd: 0.25, serverless: true });
    expect(readConfig({ VERCEL: "1", WS_INSTANCE_LOCAL_BUDGET_USD: "0.1" }).dailyBudgetUsd).toBe(0.1);
    expect(readConfig({ VERCEL: "1", WS_DAILY_BUDGET_USD: "0.05" }).dailyBudgetUsd).toBe(0.05); // an explicit lower value wins
    expect(readConfig({ VERCEL: "1", WS_DAILY_BUDGET_USD: "5" }).dailyBudgetUsd).toBe(0.25); // never above the per-instance cap
    expect(readConfig({}).dailyBudgetUsd).toBe(1); // a single local process keeps the normal ceiling
    expect(readConfig({ WS_LIVE_AI: "off" }).protection).toBe("off");
  });
  it("logs exactly one structured warning when running instance-local on a serverless host", () => {
    const lines: string[] = [];
    setLogSink((_l, line) => lines.push(line));
    createRuntime({ VERCEL: "1", NEBIUS_API_KEY: "k" });
    const warns = lines.map((l) => JSON.parse(l)).filter((l) => l.event === "instance_local_protection");
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ level: "warn", svc: "worldseed-ai" });
    lines.length = 0;
    createRuntime({ VERCEL: "1", NEBIUS_API_KEY: "k", KV_REST_API_URL: FAKE_URL, KV_REST_API_TOKEN: "k" });
    expect(lines.map((l) => JSON.parse(l)).some((l) => l.event === "instance_local_protection")).toBe(false);
  });
  it("wires the Upstash store into the runtime when configured", () => {
    const rt = createRuntime({ NEBIUS_API_KEY: "k", UPSTASH_REDIS_REST_URL: FAKE_URL, UPSTASH_REDIS_REST_TOKEN: "t" }, { fetchImpl: new FakeUpstash().fetch });
    expect(rt.store.kind).toBe("upstash");
  });
});

describe("finding 2: limits and the spend ledger live in the shared store, so instances share them", () => {
  it("two instances on one fake Upstash share the daily ceiling and the per-IP limit", async () => {
    const fake = new FakeUpstash();
    const store = () => new UpstashRestStore({ url: FAKE_URL, token: FAKE_TOKEN, fetchImpl: fake.fetch });
    const a = new DailyBudget(store(), 1, Date.now, 8);
    const b = new DailyBudget(store(), 1, Date.now, 8);
    const granted = (await Promise.all([...Array.from({ length: 12 }, () => a.reserve(0.1)), ...Array.from({ length: 12 }, () => b.reserve(0.1))])).filter(Boolean);
    expect(granted).toHaveLength(10);
    const la = new StoreRateLimiter(store());
    const lb = new StoreRateLimiter(store());
    const rules = missionRules(5, 15);
    const allowed = (await Promise.all([...Array.from({ length: 5 }, () => la.consume("ip:x", rules)), ...Array.from({ length: 5 }, () => lb.consume("ip:x", rules))])).filter((r) => r.allowed);
    expect(allowed).toHaveLength(5);
    expect(fake.keys.some((k) => k.startsWith("spend:"))).toBe(true);
    expect(fake.keys.some((k) => k.startsWith("rl:ip:x:"))).toBe(true);
  });
  it("fails CLOSED: with the store down the route answers 'planner unavailable' and calls no provider", async () => {
    const fake = new FakeUpstash();
    const server = makeServer([parseReply()]);
    const store = mk(fake);
    server.deps.budget = new DailyBudget(store, 1, server.deps.now, 8);
    server.deps.limiter = new StoreRateLimiter(store);
    fake.mode = "down";
    const res = await handleParse(post("/api/agent/parse", { missionId: "mission-down-1", text: "cut access time near Dundalk" }), server.deps);
    const ev = await readSse(res);
    expect(doneOf(ev)).toMatchObject({ status: "fallback", reason: "planner_unavailable", message: "AI planner unavailable. Explore manually." });
    expect(ev.some((e) => e.event === "error" && e.data.code === "protection_unavailable")).toBe(true);
    expect(server.provider.calls).toHaveLength(0);
  });
  it("fails closed when only the limiter or the mission ledger is down, and the visitor's quota is not charged", async () => {
    const fake = new FakeUpstash();
    const server = makeServer([parseReply(), parseReply()]);
    const store = mk(fake);
    server.deps.limiter = new StoreRateLimiter(store);
    server.deps.missions = new (await import("../../lib/server/missions")).MissionLedger(store);
    fake.mode = "500";
    const ev = await readSse(await handleParse(post("/api/agent/parse", { missionId: "mission-down-2", text: "cut access time near Dundalk" }), server.deps));
    expect(doneOf(ev)).toMatchObject({ reason: "planner_unavailable" });
    expect(server.provider.calls).toHaveLength(0);
    fake.mode = "ok";
    const ok = await readSse(await handleParse(post("/api/agent/parse", { missionId: "mission-down-2", text: "cut access time near Dundalk" }), server.deps));
    expect(doneOf(ok).status).toBe("ok");
  });
  it("MemoryStore behaves like the REST store for the operations the limits rely on", async () => {
    const s = new MemoryStore(() => 0);
    expect((await s.incr("c", 1, 1000)).value).toBe(1);
    expect((await s.incr("c", 1, 1000)).value).toBe(2);
    expect(await s.setIfAbsent("x", "1", 1000)).toBe(true);
    expect(await s.setIfAbsent("x", "2", 1000)).toBe(false);
    expect(await s.take("x")).toBe("1");
    expect(await s.take("x")).toBeNull();
  });
});

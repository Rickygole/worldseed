import { describe, expect, it } from "vitest";
import { handleParse } from "../../lib/server/agentService";
import { readConfig } from "../../lib/server/config";
import { setLogSink } from "../../lib/server/log";
import { DailyBudget, StoreRateLimiter, missionRules } from "../../lib/server/ratelimit";
import { createRuntime } from "../../lib/server/runtime";
import { DEFAULT_STORE_DAILY_COMMANDS, DEFAULT_STORE_HOURLY_COMMANDS, DEL_IF_EQUALS_LUA, MemoryStore, MeteredStore, StoreBudgetError, StoreError, UpstashRestStore, createSharedStore, sharedStoreCredentials } from "../../lib/server/store";
import { FAKE_TOKEN, FAKE_URL, FakeUpstash } from "./fakeUpstash";
import { blockNetwork, doneOf, makeServer, parseReply, post, readSse } from "./fixtures";
import { beforeEach } from "vitest";

beforeEach(() => {
  blockNetwork();
  setLogSink(null);
});

const mk = (fake: FakeUpstash) => new UpstashRestStore({ url: FAKE_URL, token: FAKE_TOKEN, fetchImpl: fake.fetch });

describe("finding 2: Upstash REST store sends the exact commands (plain fetch, no package, every argument a string)", () => {
  it("incr is one MULTI/EXEC: INCRBY then PEXPIRE NX (2 commands), with the bearer token", async () => {
    const fake = new FakeUpstash();
    const r = await mk(fake).incr("k1", 2, 60_000);
    expect(r).toEqual({ value: 2, ttlMs: 60_000 });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      path: "/multi-exec",
      auth: `Bearer ${FAKE_TOKEN}`,
      body: [["INCRBY", "k1", "2"], ["PEXPIRE", "k1", "60000", "NX"]],
    });
    expect(fake.commands).toBe(2);
  });
  it("finding N5: every argument in every request body is a string", async () => {
    const fake = new FakeUpstash();
    const s = mk(fake);
    await s.incr("a", 1, 1000);
    await s.incrLite("b", 3, 1000);
    await s.peek("a");
    await s.set("c", "v", 500);
    await s.setIfAbsent("d", "v", 500);
    await s.take("c");
    await s.delIfEquals("d", "v");
    await s.del("a");
    const flat = fake.requests.flatMap((r) => (r.path === "" ? [r.body as unknown[]] : (r.body as unknown[][]))).flat();
    expect(flat.length).toBeGreaterThan(10);
    expect(flat.every((x) => typeof x === "string")).toBe(true);
  });
  it("the TTL starts at the first hit and later hits never extend it", async () => {
    let t = 0;
    const fake = new FakeUpstash(() => t);
    const s = mk(fake);
    await s.incr("k", 1, 10_000);
    t = 4_000;
    expect(await s.incr("k", 1, 10_000)).toEqual({ value: 2, ttlMs: 0 }); // ttl is only reported when this call set it
    expect((await s.peek("k")).ttlMs).toBe(6_000); // ...and it did not move
    t = 10_001;
    expect((await s.incr("k", 1, 10_000)).value).toBe(1); // expired, new window
  });
  it("incrLite is 1 command; the expiry command follows only when the result shows the key was just created", async () => {
    const fake = new FakeUpstash(() => 0);
    const s = mk(fake);
    expect(await s.incrLite("m", 5, 7_000)).toBe(5);
    expect(fake.requests.map((r) => r.body)).toEqual([["INCRBY", "m", "5"], ["PEXPIRE", "m", "7000", "NX"]]);
    fake.requests.length = 0;
    expect(await s.incrLite("m", 2, 7_000)).toBe(7);
    expect(fake.requests.map((r) => r.body)).toEqual([["INCRBY", "m", "2"]]);
    expect(fake.commands).toBe(1);
    expect((await s.peek("m")).ttlMs).toBe(7_000);
  });
  it("get, set, setIfAbsent, take, del and delIfEquals map to GET, SET PX, SET PX NX, GETDEL, DEL and one EVAL", async () => {
    const fake = new FakeUpstash();
    const s = mk(fake);
    await s.set("a", "v", 5000);
    expect(await s.get("a")).toBe("v");
    expect(await s.setIfAbsent("a", "w", 5000)).toBe(false);
    expect(await s.setIfAbsent("b", "w", 5000)).toBe(true);
    expect(await s.take("b")).toBe("w");
    expect(await s.take("b")).toBeNull(); // single use
    expect(await s.delIfEquals("a", "not-the-value")).toBe(false); // compare-and-delete
    expect(await s.get("a")).toBe("v");
    expect(await s.delIfEquals("a", "v")).toBe(true);
    expect(await s.get("a")).toBeNull();
    await s.del("zzz");
    expect(fake.requests.map((r) => r.body)).toEqual([
      ["SET", "a", "v", "PX", "5000"],
      ["GET", "a"],
      ["SET", "a", "w", "PX", "5000", "NX"],
      ["SET", "b", "w", "PX", "5000", "NX"],
      ["GETDEL", "b"],
      ["GETDEL", "b"],
      ["EVAL", DEL_IF_EQUALS_LUA, "1", "a", "not-the-value"],
      ["GET", "a"],
      ["EVAL", DEL_IF_EQUALS_LUA, "1", "a", "v"],
      ["GET", "a"],
      ["DEL", "zzz"],
    ]);
    expect(fake.requests.every((r) => r.path === "" && r.auth === `Bearer ${FAKE_TOKEN}`)).toBe(true);
  });
  it("peek is one pipeline of GET and PTTL (2 commands)", async () => {
    const fake = new FakeUpstash();
    const s = mk(fake);
    await s.set("p", "42", 9_000);
    fake.requests.length = 0;
    expect(await s.peek("p")).toEqual({ value: 42, ttlMs: 9_000 });
    expect(fake.requests[0]).toMatchObject({ path: "/pipeline", body: [["GET", "p"], ["PTTL", "p"]] });
    expect(await s.peek("missing")).toEqual({ value: null, ttlMs: 0 });
  });
  it("finding N5: the older-server fallback triggers on ANY 4xx, non-array or error-item answer, not on message text", async () => {
    for (const mode of ["no-nx", "txn-404", "txn-not-array"] as const) {
      let t = 0;
      const fake = new FakeUpstash(() => t);
      fake.mode = mode;
      const s = mk(fake);
      expect(await s.incr("k", 1, 10_000), mode).toMatchObject({ value: 1 });
      t = 4_000;
      expect((await s.incr("k", 1, 10_000)).value, mode).toBe(2);
      expect((await s.peek("k")).ttlMs, mode).toBe(6_000); // the first-hit TTL was set by the fallback path
      const bodies = fake.requests.map((r) => JSON.stringify(r.body));
      expect(bodies[0], mode).toContain('"NX"'); // tried once
      expect(bodies.slice(1).filter((b) => b.includes('"NX"')), mode).toEqual([]); // then remembered
    }
  });
  it("auth and quota failures do NOT trigger the fallback: they fail closed", async () => {
    const fake = new FakeUpstash();
    fake.mode = "unauthorized";
    await expect(mk(fake).incr("k", 1, 1000)).rejects.toBeInstanceOf(StoreError);
    expect(fake.requests).toHaveLength(1);
  });
  it("every failure mode throws StoreError, never a partial answer", async () => {
    for (const mode of ["down", "500", "error-item", "unauthorized"] as const) {
      const fake = new FakeUpstash();
      fake.mode = mode;
      const s = mk(fake);
      await expect(s.get("k"), mode).rejects.toBeInstanceOf(StoreError);
      await expect(s.incrLite("k", 1, 1000), mode).rejects.toBeInstanceOf(StoreError);
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

describe("finding N1: MeteredStore caps the commands this process may send, without any network call", () => {
  it("counts commands by their documented cost and refuses once the hourly or daily allowance is used", async () => {
    const clock = { t: 0 };
    const fake = new FakeUpstash(() => clock.t);
    const m = new MeteredStore(mk(fake), { perHour: 10, perDay: 25, now: () => clock.t });
    for (let i = 0; i < 5; i++) await m.incr(`k${i}`, 1, 1000); // 5 x 2 = 10 commands
    expect(m.usage()).toEqual({ hour: 10, day: 10 });
    const sent = fake.requests.length;
    await expect(m.get("x")).rejects.toBeInstanceOf(StoreBudgetError);
    expect(fake.requests.length).toBe(sent); // refused before the network
    clock.t += 3600_000; // next hour: allowed again, day total carries over
    for (let i = 0; i < 5; i++) await m.incr(`j${i}`, 1, 1000); // this hour: 10; day total 20
    expect(m.usage()).toEqual({ hour: 10, day: 20 });
    await expect(m.get("x")).rejects.toBeInstanceOf(StoreBudgetError); // hour used up again
  });
  it("guard: the meter trues itself up to the commands really sent (1 for a steady incrLite, 2 when the key was created)", async () => {
    const fake = new FakeUpstash(() => 0);
    const m = new MeteredStore(mk(fake), { perHour: 1000, perDay: 1000, now: () => 0 });
    await m.incrLite("c", 1, 1000); // created: INCRBY + PEXPIRE NX
    expect(m.usage().day).toBe(2);
    await m.incrLite("c", 1, 1000); // steady state: one command
    expect(m.usage().day).toBe(3);
    expect(fake.commands).toBe(3);
  });
  it("the daily cap holds even when the hourly one would allow more", async () => {
    const clock = { t: 0 };
    const m = new MeteredStore(new MemoryStore(() => clock.t), { perHour: 100, perDay: 6, now: () => clock.t });
    for (let i = 0; i < 6; i++) await m.get("k");
    await expect(m.get("k")).rejects.toBeInstanceOf(StoreBudgetError);
    clock.t += 24 * 3600_000;
    await expect(m.get("k")).resolves.toBeNull();
  });
  it("is what createSharedStore returns for a configured store, and MemoryStore stays unmetered", () => {
    const s = createSharedStore({ UPSTASH_REDIS_REST_URL: FAKE_URL, UPSTASH_REDIS_REST_TOKEN: "t" }, { fetchImpl: new FakeUpstash().fetch });
    expect(s).toBeInstanceOf(MeteredStore);
    expect(s.kind).toBe("upstash");
    expect(createSharedStore({})).toBeInstanceOf(MemoryStore);
  });
  it("worst case per instance-month is documented as perDay x 31 and stays under the free plan's 500K for one instance", () => {
    expect(DEFAULT_STORE_DAILY_COMMANDS * 31).toBeLessThan(500_000);
    expect(DEFAULT_STORE_HOURLY_COMMANDS * 24).toBeGreaterThan(DEFAULT_STORE_DAILY_COMMANDS);
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

/**
 * Round-3 regression tests: per-operation command metering (no shared-counter true-up), the
 * front door (known missions exempt, per-process new-mission caps, eviction, local bucket), the
 * optional Turnstile check, health reflecting the meter and the budget, and the new defaults.
 * Everything here is synthetic; no network call is made.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { handleCritique, handleParse, handlePlan } from "../../lib/server/agentService";
import { readConfig } from "../../lib/server/config";
import { handleHealth } from "../../lib/server/handlers";
import { setLogSink } from "../../lib/server/log";
import { MissionLedger } from "../../lib/server/missions";
import { DailyBudget, FrontDoor, LOCAL_IP, StoreRateLimiter, setIpSalt } from "../../lib/server/ratelimit";
import { createRuntime } from "../../lib/server/runtime";
import { COMMAND_COST, DEFAULT_STORE_DAILY_COMMANDS, DEFAULT_STORE_HOURLY_COMMANDS, MemoryStore, MeteredStore, StoreBudgetError, UpstashRestStore, createSharedStore } from "../../lib/server/store";
import { SITEVERIFY_URL, createTurnstileVerifier } from "../../lib/server/turnstile";
import { resetDowngrades } from "../../lib/server/tokenfactory";
import { isBudgetExhausted } from "../../lib/agent/protocol";
import { FAKE_TOKEN, FAKE_URL, FakeUpstash } from "./fakeUpstash";
import { BASELINE, MISSION, blockNetwork, critiqueReply, doneOf, makeRuntime, makeServer, parseReply, post, proposeReply, readSse, row } from "./fixtures";

beforeEach(() => {
  blockNetwork();
  resetDowngrades();
  setLogSink(() => undefined);
  setIpSalt("");
});

const parseBody = (missionId: string, extra: Record<string, unknown> = {}) => ({ missionId, text: "reduce p90 near Dundalk", ...extra });

/** A test server whose limiter, ledger and budget talk to a metered fake Upstash, so commands are counted twice: by the fake and by the meter. */
function meteredServer(script: string[], cfg: Record<string, unknown> = {}, meter = { perHour: 2_400, perDay: 6_000 }, latencyMs = 0) {
  const s = makeServer(script, cfg as never);
  const fake = new FakeUpstash(s.deps.now);
  fake.latencyMs = latencyMs;
  const store = new MeteredStore(new UpstashRestStore({ url: FAKE_URL, token: FAKE_TOKEN, fetchImpl: fake.fetch }), { ...meter, now: s.deps.now });
  s.deps.limiter = new StoreRateLimiter(store);
  s.deps.budget = new DailyBudget(store, s.config.dailyBudgetUsd, s.deps.now, s.config.budgetResetHourUtc);
  s.deps.missions = new MissionLedger(store, undefined, s.deps.now);
  return { s, fake, store };
}

/* ------------------------------------------------------------------------------------------ */
describe("R2-1 (security): the command meter charges each operation its own cost, never a shared-counter delta", () => {
  it("the meter equals the real command count when 5, 10, 20 and 40 requests are in flight at once", async () => {
    const table: string[] = [];
    for (const n of [5, 10, 20, 40]) {
      const fake = new FakeUpstash(() => 1_000_000);
      fake.latencyMs = 5; // every request stays in flight while the others start
      const store = new MeteredStore(new UpstashRestStore({ url: FAKE_URL, token: FAKE_TOKEN, fetchImpl: fake.fetch }), { perHour: 100_000, perDay: 100_000, now: () => 1_000_000 });
      await Promise.all(
        Array.from({ length: n }, (_, i) => {
          const k = `k${i % 7}`;
          return i % 4 === 0 ? store.incr(k, 1, 60_000) : i % 4 === 1 ? store.incrLite(k, 1, 60_000) : i % 4 === 2 ? store.peek(k) : store.setIfAbsent(`lock${i}`, "x", 5_000);
        }),
      );
      const metered = store.usage().hour;
      table.push(`${n} parallel: real ${fake.commands}, metered ${metered}`);
      // Exactly equal: each request reports its own command count; there is nothing to over-count.
      expect(metered, `${n} parallel`).toBe(fake.commands);
    }
    process.stdout.write(`meter under concurrency: ${table.join(" | ")}\n`);
  });

  it("reproduction of the reviewer's case: 20 concurrent missions are metered at their real cost and do not trip the meter (was 234 real commands metered as 2,913)", async () => {
    const { s, fake, store } = meteredServer(Array.from({ length: 40 }, () => parseReply()), { ipMissionsPerHour: 1000, ipDailyUsd: 50, dailyBudgetUsd: 50 }, { perHour: 2_400, perDay: 6_000 }, 3);
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => handleParse(post("/api/agent/parse", parseBody(`MISSION-C20-${String(i).padStart(3, "0")}`), `10.20.0.${i}`), s.deps).then(readSse)));
    for (const ev of rs) expect(doneOf(ev).status).toBe("ok");
    expect(store.usage().hour).toBe(fake.commands);
    expect(store.exhausted()).toBe(false);
    process.stdout.write(`20 concurrent missions: real ${fake.commands}, metered ${store.usage().hour}\n`);
  });

  it("a legitimate burst of 30 concurrent missions does not trip the meter, and every one gets an answer", async () => {
    const { s, fake, store } = meteredServer(Array.from({ length: 60 }, () => parseReply()), { ipMissionsPerHour: 1000, ipDailyUsd: 50, dailyBudgetUsd: 50 }, { perHour: 2_400, perDay: 6_000 }, 3);
    s.deps.frontDoor = new FrontDoor({ perIpPerMin: 1000, globalPerMin: 1000, closuresPerIpPerHour: 100, missionsPerIpPerDay: 100, newMissionsPerHour: 100, newMissionsPerDay: 1000, now: s.deps.now });
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => handleParse(post("/api/agent/parse", parseBody(`MISSION-C30-${String(i).padStart(3, "0")}`), `10.30.0.${i}`), s.deps).then(readSse)));
    expect(rs.map((ev) => doneOf(ev).status)).toEqual(Array(30).fill("ok"));
    expect(store.exhausted()).toBe(false);
    expect(store.usage().hour).toBe(fake.commands);
    expect(fake.commands).toBeLessThan(2_400);
    process.stdout.write(`30 concurrent missions: ${fake.commands} store commands, meter ${store.usage().hour}/2400 per hour\n`);
  });

  it("an inner store that does not report its own commands is charged the documented constant per operation", async () => {
    const meter = new MeteredStore(new MemoryStore(), { perHour: 100, perDay: 100 });
    await meter.incr("a", 1, 1000);
    await meter.get("a");
    await meter.setIfAbsent("b", "1", 1000);
    expect(meter.usage().hour).toBe(COMMAND_COST.incr + COMMAND_COST.get + COMMAND_COST.setIfAbsent);
  });

  it("refuses without sending anything once the allowance cannot cover an operation; the window rolls with the clock", async () => {
    const clock = { t: Date.UTC(2026, 8, 26, 12, 0, 0) };
    const fake = new FakeUpstash(() => clock.t);
    const meter = new MeteredStore(new UpstashRestStore({ url: FAKE_URL, token: FAKE_TOKEN, fetchImpl: fake.fetch }), { perHour: 6, perDay: 100, now: () => clock.t });
    for (let i = 0; i < 3; i++) await meter.incr(`k${i}`, 1, 1000); // 3 x 2 commands
    const sent = fake.commands;
    expect(meter.exhausted()).toBe(true);
    await expect(meter.get("x")).rejects.toBeInstanceOf(StoreBudgetError);
    expect(fake.commands).toBe(sent); // nothing was sent
    clock.t += 3_600_001;
    expect(meter.exhausted()).toBe(false);
    await meter.get("x");
    expect(fake.commands).toBe(sent + 1);
  });

  it("the shipped allowance is 2,400 commands an hour and 6,000 a day per process", () => {
    expect(DEFAULT_STORE_HOURLY_COMMANDS).toBe(2_400);
    expect(DEFAULT_STORE_DAILY_COMMANDS).toBe(6_000);
    const s = createSharedStore({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" });
    expect(s).toBeInstanceOf(MeteredStore);
    const custom = createSharedStore({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t", WS_STORE_HOURLY_COMMANDS: "10", WS_STORE_DAILY_COMMANDS: "20" }) as MeteredStore;
    expect(custom.exhausted()).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R2-2 (security): known missions are exempt from the process-wide cap; new missions are admitted before any store command", () => {
  const door = (over: Partial<ConstructorParameters<typeof FrontDoor>[0]> = {}, now = () => Date.UTC(2026, 8, 26, 12)) =>
    new FrontDoor({ perIpPerMin: 1000, globalPerMin: 1000, closuresPerIpPerHour: 100, missionsPerIpPerDay: 100, newMissionsPerHour: 3, newMissionsPerDay: 120, now, ...over });

  it("new missions past the per-process hourly cap are refused with ZERO store commands, while the missions already running keep working", async () => {
    const { s, fake } = meteredServer([parseReply(), parseReply(), parseReply(), proposeReply([{ candidateIds: ["SP-BROENING"] }]), proposeReply([{ candidateIds: ["SP-BROENING"] }])], { ipMissionsPerHour: 1000, ipDailyUsd: 50, dailyBudgetUsd: 50 });
    s.deps.frontDoor = door();
    const ids = ["MISSION-KN-0001", "MISSION-KN-0002", "MISSION-KN-0003"];
    for (const [i, id] of ids.entries()) expect(doneOf(await readSse(await handleParse(post("/api/agent/parse", parseBody(id), `10.7.0.${i}`), s.deps))).status).toBe("ok");
    const after = fake.commands;
    // a flood of new missions from many addresses: all refused, none costs a store command
    for (let i = 0; i < 200; i++) {
      const res = await handleParse(post("/api/agent/parse", parseBody(`MISSION-NEW-${String(i).padStart(4, "0")}`), `10.8.${i % 250}.${i}`), s.deps);
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body).toMatchObject({ status: "fallback", reason: "rate_limited", next: "recorded_tour" });
    }
    expect(fake.commands).toBe(after);
    // the missions that are already running continue (known: exempt from the process-wide cap)
    const plan = (id: string, ip: string) => handlePlan(post("/api/agent/plan", { missionId: id, mission: MISSION, phase: "search", round: 1, bundles: [], evaluations: [] }, ip), s.deps);
    expect(doneOf(await readSse(await plan(ids[0], "10.7.0.0"))).status).toBe("ok");
    expect(doneOf(await readSse(await plan(ids[1], "10.7.0.1"))).status).toBe("ok");
  });

  it("the daily process cap and the per-client daily count apply too, and a refused admission records nothing", () => {
    const clock = { t: Date.UTC(2026, 8, 26, 12) };
    const d = door({ newMissionsPerHour: 100, newMissionsPerDay: 5, missionsPerIpPerDay: 2 }, () => clock.t);
    expect(d.admitNewMission("1.1.1.1").ok).toBe(true);
    expect(d.admitNewMission("1.1.1.1").ok).toBe(true);
    expect(d.admitNewMission("1.1.1.1")).toMatchObject({ ok: false, reason: "ip_day" });
    for (const ip of ["2.2.2.2", "3.3.3.3", "4.4.4.4"]) expect(d.admitNewMission(ip).ok).toBe(true);
    expect(d.admitNewMission("5.5.5.5")).toMatchObject({ ok: false, reason: "global_day" });
    clock.t += 86_400_001;
    expect(d.admitNewMission("5.5.5.5").ok).toBe(true);
  });

  it("a mission that already exists in the shared record (created on another instance) is not counted as new", async () => {
    const { s, fake } = meteredServer([parseReply(), parseReply(), parseReply()], { ipMissionsPerHour: 1000, ipDailyUsd: 50, dailyBudgetUsd: 50 });
    s.deps.frontDoor = door({ newMissionsPerHour: 1 });
    const ip = "10.9.0.1";
    await s.deps.missions.bind("MISSION-ELSE-001", ip); // another instance made it
    expect(doneOf(await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-ELSE-001"), ip), s.deps))).status).toBe("ok");
    // the admission was given back, so a genuinely new mission still fits under the cap of 1
    expect(doneOf(await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-ELSE-002"), "10.9.0.2"), s.deps))).status).toBe("ok");
    expect((await handleParse(post("/api/agent/parse", parseBody("MISSION-ELSE-003"), "10.9.0.3"), s.deps)).status).toBe(429);
    expect(fake.commands).toBeGreaterThan(0);
  });

  it("the per-IP front door stays at 20 a minute by default and the process-wide window is not applied to AI routes", () => {
    expect(readConfig({}).frontDoorPerIpPerMin).toBe(20);
    const d = door({ perIpPerMin: 20 });
    let ok = 0;
    for (let i = 0; i < 30; i++) if (d.check("ai", "9.9.9.9").ok) ok++;
    expect(ok).toBe(20);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R2-7 (security): front-door map eviction, the shared local bucket and sweep cost", () => {
  it("evicting per-client keys never resets a process-wide window", () => {
    const clock = { t: Date.UTC(2026, 8, 26, 12) };
    const d = new FrontDoor({ perIpPerMin: 100, globalPerMin: 5, closuresPerIpPerHour: 1000, missionsPerIpPerDay: 1000, newMissionsPerHour: 2, newMissionsPerDay: 100, now: () => clock.t });
    expect(d.admitNewMission("1.0.0.1").ok).toBe(true);
    expect(d.admitNewMission("1.0.0.2").ok).toBe(true);
    for (let i = 0; i < 5; i++) expect(d.check("closures", `20.0.${i}.1`).ok).toBe(true);
    expect(d.check("closures", "20.1.0.1").ok).toBe(false);
    // 60,000 distinct clients overflow the per-client map several times over
    for (let i = 0; i < 60_000; i++) d.check("ai", `30.${i >> 8}.${i & 255}.1`);
    expect(d.clientCount()).toBeLessThanOrEqual(20_000);
    expect(d.admitNewMission("1.0.0.3")).toMatchObject({ ok: false, reason: "global_hour" }); // still capped
    expect(d.check("closures", "20.2.0.1").ok).toBe(false); // the global window survived too
  });

  it("the sweep is amortized: a million-key flood costs a bounded number of operations per request", () => {
    const d = new FrontDoor({ perIpPerMin: 100, globalPerMin: 1000, closuresPerIpPerHour: 1000, missionsPerIpPerDay: 1000, now: () => 1_000_000 });
    const t0 = performance.now();
    for (let i = 0; i < 200_000; i++) d.check("ai", `40.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
    const ms = performance.now() - t0;
    expect(d.clientCount()).toBeLessThanOrEqual(20_000);
    expect(ms).toBeLessThan(3_000); // an O(n)-per-insert sweep would take minutes
  });

  it("without a trusted proxy the one shared 'local' bucket is 10x wider, so a whole self-hosted site is not held to one client's 20 a minute", () => {
    const d = new FrontDoor({ perIpPerMin: 20, globalPerMin: 1000, closuresPerIpPerHour: 10, missionsPerIpPerDay: 10, newMissionsPerHour: 1000, newMissionsPerDay: 1000, now: () => 1_000_000 });
    let ok = 0;
    for (let i = 0; i < 300; i++) if (d.check("ai", LOCAL_IP).ok) ok++;
    expect(ok).toBe(200);
    let missions = 0;
    for (let i = 0; i < 300; i++) if (d.admitNewMission(LOCAL_IP).ok) missions++;
    expect(missions).toBe(100);
    let unknown = 0;
    for (let i = 0; i < 30; i++) if (d.check("ai", "unknown").ok) unknown++;
    expect(unknown).toBe(4); // the tight bucket for unidentifiable clients is unchanged
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R2-2 (security): optional Cloudflare Turnstile at the mission start", () => {
  const fakeVerify = (answers: Array<{ success: boolean } | number | Error>) => {
    const calls: { url: string; body: URLSearchParams }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: new URLSearchParams(String(init.body)) });
      const a = answers.shift();
      if (a instanceof Error) throw a;
      if (typeof a === "number") return new Response("x", { status: a });
      return new Response(JSON.stringify(a ?? { success: false }), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };

  it("the verifier posts secret, token and a real client address to siteverify, and never sends the token anywhere else", async () => {
    const f = fakeVerify([{ success: true }]);
    const v = createTurnstileVerifier({ secret: "secret-not-real", fetchImpl: f.fetchImpl });
    expect(await v("token-abc", "203.0.113.7")).toBe("ok");
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe(SITEVERIFY_URL);
    expect(Object.fromEntries(f.calls[0].body)).toEqual({ secret: "secret-not-real", response: "token-abc", remoteip: "203.0.113.7" });
    // the shared local/unknown buckets are not addresses and are not forwarded
    const g = fakeVerify([{ success: true }]);
    await createTurnstileVerifier({ secret: "s", fetchImpl: g.fetchImpl })("t", "local");
    expect(g.calls[0].body.has("remoteip")).toBe(false);
  });

  it("failure modes: rejected token, missing token, oversized token, HTTP error, network error", async () => {
    const f = fakeVerify([{ success: false }, 500, new Error("down")]);
    const v = createTurnstileVerifier({ secret: "s", fetchImpl: f.fetchImpl });
    expect(await v("t1", "1.1.1.1")).toBe("failed");
    expect(await v("t2", "1.1.1.1")).toBe("unavailable");
    expect(await v("t3", "1.1.1.1")).toBe("unavailable");
    expect(await v(undefined, "1.1.1.1")).toBe("failed");
    expect(await v("x".repeat(3000), "1.1.1.1")).toBe("failed");
    expect(f.calls).toHaveLength(3); // a missing or oversized token costs no outbound call
  });

  it("enforced only when configured: every new mission needs a valid token; the token is single use; known missions do not need one again", async () => {
    const s = makeServer([parseReply(), parseReply(), parseReply()]);
    const f = fakeVerify([{ success: true }, { success: false }, { success: true }]);
    s.deps.verifyHuman = createTurnstileVerifier({ secret: "s", fetchImpl: f.fetchImpl });
    // no token: refused, a fixed protocol reason, no model call, and no outbound call
    const none = await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-TS-0001")), s.deps));
    expect(doneOf(none)).toMatchObject({ status: "fallback", reason: "verification_failed", next: "retry_later" });
    expect(s.provider.calls).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
    // a valid token: the mission starts
    const ok = await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-TS-0001", { turnstileToken: "tok-1" })), s.deps));
    expect(doneOf(ok).status).toBe("ok");
    // the same mission again: known, no second verification (a Turnstile token cannot be reused)
    const again = await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-TS-0001")), s.deps));
    expect(doneOf(again).status).toBe("ok");
    expect(f.calls).toHaveLength(1);
    // a replayed or forged token for a new mission is refused
    const replay = await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-TS-0002", { turnstileToken: "tok-1" })), s.deps));
    expect(doneOf(replay)).toMatchObject({ status: "fallback", reason: "verification_failed" });
    expect(f.calls).toHaveLength(2);
    // plan/critique/narrate cannot start a mission: they carry no token, so an unbound mission is refused
    const plan = await readSse(await handlePlan(post("/api/agent/plan", { missionId: "MISSION-TS-0003", mission: MISSION, phase: "search", round: 1, bundles: [], evaluations: [] }), s.deps));
    expect(doneOf(plan)).toMatchObject({ status: "fallback", reason: "verification_failed" });
    expect(f.calls).toHaveLength(2);
  });

  it("an unreachable verifier fails closed with its own message and retry hint", async () => {
    const s = makeServer([parseReply()]);
    s.deps.verifyHuman = createTurnstileVerifier({ secret: "s", fetchImpl: fakeVerify([new Error("down")]).fetchImpl });
    const ev = await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-TS-0009", { turnstileToken: "t" })), s.deps));
    expect(doneOf(ev)).toMatchObject({ status: "fallback", reason: "verification_failed", retryAfterS: 10 });
    expect(doneOf(ev).message).toContain("unavailable");
  });

  it("the caps run BEFORE the verification: a flood costs no outbound verification call", async () => {
    const s = makeServer([]);
    const f = fakeVerify([]);
    s.deps.verifyHuman = createTurnstileVerifier({ secret: "s", fetchImpl: f.fetchImpl });
    s.deps.frontDoor = new FrontDoor({ perIpPerMin: 1000, globalPerMin: 1000, closuresPerIpPerHour: 100, missionsPerIpPerDay: 100, newMissionsPerHour: 0, newMissionsPerDay: 0, now: s.deps.now });
    for (let i = 0; i < 20; i++) expect((await handleParse(post("/api/agent/parse", parseBody(`MISSION-TS-1${String(i).padStart(3, "0")}`, { turnstileToken: "t" }), `10.5.0.${i}`), s.deps)).status).toBe(429);
    expect(f.calls).toHaveLength(0);
  });

  it("is wired only when WS_TURNSTILE_SECRET is set", () => {
    const off = createRuntime({ NEBIUS_API_KEY: "k" }, { store: new MemoryStore() });
    expect(off.agent.verifyHuman).toBeUndefined();
    const on = createRuntime({ NEBIUS_API_KEY: "k", WS_TURNSTILE_SECRET: "s" }, { store: new MemoryStore() });
    expect(typeof on.agent.verifyHuman).toBe("function");
    expect(readConfig({ WS_TURNSTILE_SECRET: " s " }).turnstileSecret).toBe("s");
    // the secret is never part of a public body
    expect(JSON.stringify(readConfig({ WS_TURNSTILE_SECRET: "topsecret" }).frontDoorPerIpPerMin)).not.toContain("topsecret");
  });

  it("the request schema accepts an optional token and nothing else new", async () => {
    const { ParseRequestSchema } = await import("../../lib/agent/protocol");
    expect(ParseRequestSchema.safeParse({ missionId: "MISSION-00001", text: "abc def", turnstileToken: "t" }).success).toBe(true);
    expect(ParseRequestSchema.safeParse({ missionId: "MISSION-00001", text: "abc def", turnstileToken: "" }).success).toBe(false);
    expect(ParseRequestSchema.safeParse({ missionId: "MISSION-00001", text: "abc def", turnstileToken: "x".repeat(2049) }).success).toBe(false);
    expect(ParseRequestSchema.safeParse({ missionId: "MISSION-00001", text: "abc def", other: 1 }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R2-4 (security): health reflects a tripped meter and an exhausted budget, however long ago, without touching the store", () => {
  const health = async (rt: ReturnType<typeof makeRuntime>) => (await handleHealth(rt)).json();

  it("a tripped meter degrades health with protection_unavailable minutes after the last failure, and recovers when the window rolls", async () => {
    const s = makeServer([]);
    const fake = new FakeUpstash(s.deps.now);
    const meter = new MeteredStore(new UpstashRestStore({ url: FAKE_URL, token: FAKE_TOKEN, fetchImpl: fake.fetch }), { perHour: 4, perDay: 100, now: s.deps.now });
    const rt = { ...makeRuntime(s), store: meter, meter };
    expect((await health(rt)).degraded).toBe(false);
    await meter.incr("a", 1, 1000);
    await meter.incr("b", 1, 1000);
    expect(meter.exhausted()).toBe(true);
    // a failed request records a store-down signal once; ten minutes later that signal is long gone, the state is not
    s.clock.t += 10 * 60_000;
    rt.healthCache = undefined;
    const body = await health(rt);
    expect(body).toMatchObject({ degraded: true, degradedReason: "protection_unavailable", planner: { available: false } });
    s.clock.t += 51 * 60_000; // the hourly window rolled
    rt.healthCache = undefined;
    expect((await health(rt)).degraded).toBe(false);
  });

  it("an exhausted daily budget shows as budget_exhausted long after it was observed; health never sends a store command", async () => {
    const s = makeServer([]);
    const fake = new FakeUpstash(s.deps.now);
    const store = new UpstashRestStore({ url: FAKE_URL, token: FAKE_TOKEN, fetchImpl: fake.fetch });
    s.deps.budget = new DailyBudget(store, 0.01, s.deps.now, 8);
    const rt = { ...makeRuntime(s), store };
    await s.deps.budget.reserve(0.01); // exactly the ceiling: the day is spent
    const before = fake.commands;
    for (const minutes of [0, 4, 30, 180]) {
      s.clock.t += minutes * 60_000;
      rt.healthCache = undefined;
      expect(await health(rt), `${minutes} min`).toMatchObject({ degraded: true, degradedReason: "budget_exhausted" });
    }
    expect(fake.commands).toBe(before);
  });

  it("a cold instance has seen nothing, so health cannot know; the first mission learns it and answers with the graceful recorded-run outcome", async () => {
    const { s } = meteredServer([], { dailyBudgetUsd: 0.00001 });
    const ev = await readSse(await handleParse(post("/api/agent/parse", parseBody("MISSION-COLD-001")), s.deps));
    const done = doneOf(ev);
    expect(done).toMatchObject({ status: "fallback", reason: "budget_exhausted", next: "recorded_tour", message: "Daily AI budget reached; try the recorded run." });
    expect(isBudgetExhausted(done)).toBe(true);
    expect(isBudgetExhausted({ status: "fallback", reason: "rate_limited", message: "x", next: "retry_later" })).toBe(false);
    expect(s.deps.budget.cached()?.exhausted).toBe(true); // and now health reports it too
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R2-5 (security): the numbers table", () => {
  it("config defaults", () => {
    expect(readConfig({})).toMatchObject({
      dailyBudgetUsd: 1,
      ipDailyUsd: 0.2,
      missionInputTokens: 36_000,
      missionOutputTokens: 7_000,
      missionMaxCalls: 12,
      ipMissionsPerHour: 8,
      ipMissionsPerDay: 10,
      newMissionsPerHour: 30,
      newMissionsPerDay: 120,
      frontDoorPerIpPerMin: 20,
    });
    expect(readConfig({ WS_DAILY_BUDGET_USD: "2.5", WS_IP_DAILY_USD: "0.4" })).toMatchObject({ dailyBudgetUsd: 2.5, ipDailyUsd: 0.4 });
  });

  it("five typical missions fit one client's $0.20 day and the per-IP check does not over-reserve (a 5th mission just fits; the 6th is refused)", async () => {
    // A typical mission is 3 model calls of about 6k tokens in and 2k out (the 36k/7k mission caps allow more).
    const usage = { inputTokens: 6_000, outputTokens: 2_000 };
    const perCall = (6_000 * 1 + 2_000 * 3) / 1e6; // $0.012 at the default $1 / $3 per million tokens
    const script: string[] = [];
    for (let i = 0; i < 6; i++) script.push(parseReply(), proposeReply([{ candidateIds: ["SP-BROENING"] }]), critiqueReply());
    const { s, fake } = meteredServer(script, { ipMissionsPerHour: 100, dailyBudgetUsd: 50 });
    s.provider.usage = usage;
    s.deps.frontDoor = new FrontDoor({ perIpPerMin: 1000, globalPerMin: 1000, closuresPerIpPerHour: 100, missionsPerIpPerDay: 100, newMissionsPerHour: 100, newMissionsPerDay: 1000, now: s.deps.now });
    const ip = "198.51.100.77";
    const rows = [row("B1", ["SP-BROENING"])];
    const statuses: string[] = [];
    for (let m = 0; m < 6; m++) {
      const id = `MISSION-DOLLAR-${m}`;
      const a = doneOf(await readSse(await handleParse(post("/api/agent/parse", parseBody(id), ip), s.deps)));
      const b = a.status === "ok" ? doneOf(await readSse(await handlePlan(post("/api/agent/plan", { missionId: id, mission: MISSION, phase: "search", round: 1, bundles: [], evaluations: [] }, ip), s.deps))) : a;
      const c = b.status === "ok" ? doneOf(await readSse(await handleCritique(post("/api/agent/critique", { missionId: id, mission: MISSION, round: 1, evaluations: rows, baseline: BASELINE }, ip), s.deps))) : b;
      statuses.push([a, b, c].every((x) => x.status === "ok") ? "complete" : c.status === "fallback" ? `stopped:${c.reason}` : "partial");
    }
    process.stdout.write(`five-mission day: ${statuses.join(", ")} (each mission ${(3 * perCall).toFixed(3)} USD, cap 0.20, commands ${fake.commands})\n`);
    expect(statuses.slice(0, 5)).toEqual(Array(5).fill("complete")); // the 5th just fits
    expect(statuses[5]).toBe("stopped:budget_exhausted");
    // the settled ledger equals what was actually billed: reservations were trued up, none left over
    const st = await s.deps.budget.status();
    expect(st.spentUsd).toBeCloseTo(s.provider.calls.length * perCall, 6);
  });

  it("flood arithmetic: a distributed flood is bounded by the per-process new-mission caps times the commands one new mission costs", () => {
    const c = readConfig({});
    const commandsPerNewMission = 18; // measured: the first call of a mission (round2.test.ts records it)
    const perDayPerProcess = c.newMissionsPerDay * commandsPerNewMission;
    process.stdout.write(`flood: ${c.newMissionsPerHour}/hour and ${c.newMissionsPerDay}/day new missions per process x ${commandsPerNewMission} commands = ${c.newMissionsPerHour * commandsPerNewMission} per hour, ${perDayPerProcess} per day per process (meter: ${DEFAULT_STORE_HOURLY_COMMANDS}/hour, ${DEFAULT_STORE_DAILY_COMMANDS}/day)\n`);
    expect(perDayPerProcess).toBeLessThan(DEFAULT_STORE_DAILY_COMMANDS);
    expect(c.newMissionsPerHour * commandsPerNewMission).toBeLessThan(DEFAULT_STORE_HOURLY_COMMANDS);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R2-8 (security): the smoke scripts say what they spend and where they may point", () => {
  const script = (name: string, ...args: string[]) => {
    try {
      const out = execFileSync(process.execPath, [path.join(__dirname, "../../scripts", name), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" } });
      return { code: 0, out, err: "" };
    } catch (e) {
      const x = e as { status?: number; stdout?: string; stderr?: string };
      return { code: x.status ?? 1, out: x.stdout ?? "", err: x.stderr ?? "" };
    }
  };
  it("--help of the token factory script states that --measure-screen spends real credit and must target a LOCAL app started WITHOUT store credentials", () => {
    const r = script("smoke-token-factory.mjs", "--help");
    expect(r.code).toBe(0);
    expect(r.out).toContain("--measure-screen SPENDS REAL MODEL CREDIT");
    expect(r.out).toContain("LOCAL app");
    expect(r.out).toContain("WITHOUT store credentials");
  });
  it("--measure-screen refuses a non-local base before doing anything (no key needed, no network)", () => {
    for (const base of ["https://example.com", "http://192.0.2.1:3000", "not a url"]) {
      const r = script("smoke-token-factory.mjs", "--measure-screen", "--base", base);
      expect(r.code, base).toBe(2);
      expect(r.err).toContain("must target a LOCAL app");
    }
  });
  it("the store script's --help says it talks to the real store and never calls a model", () => {
    const r = script("smoke-store.mjs", "--help");
    expect(r.code).toBe(0);
    expect(r.out).toContain("REAL store");
    expect(r.out).toContain("never calls a model");
  });
});

describe("test debt (round 3): the mission ledger remembers a bound pair in process", () => {
  it("guard: after a pair is bound, asking again costs no store command", async () => {
    const fake = new FakeUpstash(() => 1_000_000);
    const store = new UpstashRestStore({ url: FAKE_URL, token: FAKE_TOKEN, fetchImpl: fake.fetch });
    const ledger = new MissionLedger(store, undefined, () => 1_000_000);
    expect(await ledger.bind("MISSION-LEDGER-1", "1.1.1.1")).toBe(true);
    const before = fake.commands;
    expect(await ledger.isBound("MISSION-LEDGER-1", "1.1.1.1")).toBe(true);
    expect(await ledger.isBound("MISSION-LEDGER-1", "1.1.1.1")).toBe(true);
    expect(fake.commands).toBe(before);
    expect(await ledger.isBound("MISSION-LEDGER-1", "2.2.2.2")).toBe(false); // another client is a different pair
  });
});

import { describe, expect, it } from "vitest";
import { DailyBudget, StoreRateLimiter, bucketIp, budgetWindow, clientIp, ipKey, missionRules } from "../../lib/server/ratelimit";
import { MemoryStore, StoreError, type SharedStore } from "../../lib/server/store";

describe("per-IP mission limits (5/hour, 15/day)", () => {
  it("blocks the 6th mission within an hour and reports when to retry", async () => {
    const clock = { t: 1_000_000 };
    const l = new StoreRateLimiter(new MemoryStore(() => clock.t));
    const rules = missionRules(5, 15);
    for (let i = 0; i < 5; i++) expect((await l.consume("ip:1.1.1.1", rules)).allowed).toBe(true);
    const blocked = await l.consume("ip:1.1.1.1", rules);
    expect(blocked).toMatchObject({ allowed: false, blockedBy: "missions_per_hour" });
    expect(blocked.retryAfterS).toBeGreaterThan(0);
    expect((await l.consume("ip:2.2.2.2", rules)).allowed).toBe(true);
  });
  it("frees the hourly window after an hour but keeps the daily cap of 15", async () => {
    const clock = { t: 0 };
    const l = new StoreRateLimiter(new MemoryStore(() => clock.t));
    const rules = missionRules(5, 15);
    let allowed = 0;
    for (let h = 0; h < 5; h++) {
      for (let i = 0; i < 5; i++) if ((await l.consume("ip:x", rules)).allowed) allowed++;
      clock.t += 3600_000 + 1;
    }
    expect(allowed).toBe(15);
    expect((await l.consume("ip:x", rules)).blockedBy).toBe("missions_per_day");
    clock.t += 24 * 3600_000;
    expect((await l.consume("ip:x", rules)).allowed).toBe(true);
  });
  it("a refused request is not recorded (it refunds its own increment)", async () => {
    const store = new MemoryStore(() => 0);
    const l = new StoreRateLimiter(store);
    const rules = [{ name: "r", limit: 1, windowMs: 1000 }];
    await l.consume("k", rules);
    for (let i = 0; i < 3; i++) await l.consume("k", rules);
    expect(await store.get("rl:k:r")).toBe("1");
  });
  it("finding 2: increment-then-compare is atomic, so 50 parallel requests admit exactly the limit", async () => {
    const l = new StoreRateLimiter(new MemoryStore());
    const rs = await Promise.all(Array.from({ length: 50 }, () => l.consume("ip:burst", [{ name: "r", limit: 5, windowMs: 60_000 }])));
    expect(rs.filter((r) => r.allowed)).toHaveLength(5);
  });
  it("finding 2: a store failure fails closed with error=true (not a fake rate limit)", async () => {
    const broken: SharedStore = { ...new MemoryStore(), kind: "memory", incr: async () => { throw new StoreError("down"); } } as unknown as SharedStore;
    const r = await new StoreRateLimiter(broken).consume("k", missionRules(5, 15));
    expect(r).toMatchObject({ allowed: false, error: true, blockedBy: "store_error" });
  });
});

describe("finding 8: client IP", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("prefers the platform headers over anything a client can set", () => {
    expect(clientIp(h({ "x-vercel-forwarded-for": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2", "x-real-ip": "3.3.3.3" }))).toBe("9.9.9.9");
    expect(clientIp(h({ "x-real-ip": "3.3.3.3", "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("3.3.3.3");
  });
  it("falls back to x-forwarded-for by trusted hop from the RIGHT, so a spoofed first entry is ignored", () => {
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 9.9.9.9, 10.0.0.1" }), { trustedHops: 2 })).toBe("9.9.9.9");
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9" }), { trustedHops: 5 })).toBe("9.9.9.9");
    // rotating the spoofable left side does not change the identity
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }))).toBe(clientIp(h({ "x-forwarded-for": "5.6.7.8, 9.9.9.9" })));
  });
  it("buckets IPv6 by /64 and unwraps IPv4-mapped addresses", () => {
    const a = clientIp(h({ "x-real-ip": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" }));
    const b = clientIp(h({ "x-real-ip": "2001:db8:1:2:1:2:3:4" }));
    const c = clientIp(h({ "x-real-ip": "2001:db8:1:3::1" }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBe("v6:2001:0db8:0001:0002/64");
    expect(bucketIp("::ffff:9.9.9.9")).toBe("9.9.9.9");
    expect(bucketIp("2001:db8::1")).toBe("v6:2001:0db8:0000:0000/64");
    expect(bucketIp("[2001:db8::1]")).toBe("v6:2001:0db8:0000:0000/64");
  });
  it("treats a missing or garbage address as its own 'unknown' bucket, with tighter limits", () => {
    expect(clientIp(h({}))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "not-an-ip" }))).toBe("unknown");
    expect(clientIp(h({ "x-real-ip": "x".repeat(200) }))).toBe("unknown");
    const normal = missionRules(5, 15, "9.9.9.9");
    const tight = missionRules(5, 15, "unknown");
    expect(normal.map((r) => r.limit)).toEqual([5, 15]);
    expect(tight.map((r) => r.limit)).toEqual([1, 3]);
    expect(missionRules(1, 2, "unknown").map((r) => r.limit)).toEqual([1, 1]);
  });
  it("store keys never contain a raw address", () => {
    expect(ipKey("9.9.9.9")).toMatch(/^[a-f0-9]{16}$/);
    expect(ipKey("9.9.9.9")).not.toContain("9.9.9.9");
  });
});

describe("global daily spend ceiling", () => {
  const mk = (t = Date.UTC(2026, 8, 26, 10), ceiling = 1) => {
    const clock = { t };
    const store = new MemoryStore(() => clock.t);
    return { clock, store, b: new DailyBudget(store, ceiling, () => clock.t, 8) };
  };
  it("reserves, settles, and refuses once the ceiling would be crossed", async () => {
    const { b } = mk();
    const r1 = await b.reserve(0.6);
    expect(r1).not.toBeNull();
    expect(await b.reserve(0.6)).toBeNull(); // 0.6 reserved + 0.6 > 1
    await b.settle(r1!, 0.3);
    expect((await b.status()).spentUsd).toBeCloseTo(0.3);
    const r2 = await b.reserve(0.6);
    expect(r2).not.toBeNull();
    await b.settle(r2!, 0.7);
    expect(await b.status()).toMatchObject({ exhausted: true });
    expect(await b.reserve(0.01)).toBeNull();
  });
  it("finding 2: counts integer micro-dollars in the shared store", async () => {
    const { b, store } = mk();
    const r = await b.reserve(0.123456);
    expect(await store.get("spend:2026-09-26")).toBe("123456");
    await b.settle(r!, 0.1);
    expect(await store.get("spend:2026-09-26")).toBe("100000");
  });
  it("finding 2: concurrent reservations cannot overshoot the ceiling", async () => {
    const { b } = mk();
    const rs = await Promise.all(Array.from({ length: 100 }, () => b.reserve(0.05)));
    expect(rs.filter(Boolean)).toHaveLength(20); // exactly 1 / 0.05
  });
  it("finding 2: two instances sharing one store share one ceiling (per-process memory did not)", async () => {
    const store = new MemoryStore();
    const a = new DailyBudget(store, 1, Date.now, 8);
    const c = new DailyBudget(store, 1, Date.now, 8);
    const granted = (await Promise.all([...Array.from({ length: 15 }, () => a.reserve(0.1)), ...Array.from({ length: 15 }, () => c.reserve(0.1))])).filter(Boolean);
    expect(granted).toHaveLength(10);
  });
  it("finding 2: the window resets at the configured hour (default 08:00 UTC), not at 00:00 UTC (5 pm Pacific)", async () => {
    expect(budgetWindow(Date.UTC(2026, 8, 26, 7, 59), 8)).toBe("2026-09-25");
    expect(budgetWindow(Date.UTC(2026, 8, 26, 8, 0), 8)).toBe("2026-09-26");
    const { b, clock } = mk(Date.UTC(2026, 8, 26, 23, 30));
    const r = await b.reserve(0.9);
    await b.settle(r!, 1);
    expect((await b.status()).exhausted).toBe(true);
    clock.t = Date.UTC(2026, 8, 27, 0, 30); // just after 00:00 UTC: NOT refilled
    expect((await b.status()).exhausted).toBe(true);
    clock.t = Date.UTC(2026, 8, 27, 8, 30); // after the 08:00 UTC reset
    expect((await b.status()).exhausted).toBe(false);
  });
  it("a failed call releases its reservation", async () => {
    const { b } = mk();
    const r = await b.reserve(0.9);
    await b.settle(r!, 0);
    expect(await b.reserve(0.9)).not.toBeNull();
  });
  it("finding 2: a store failure is thrown (callers fail closed) and settle never throws", async () => {
    const broken = { incr: async () => { throw new StoreError("down"); }, get: async () => { throw new StoreError("down"); } } as unknown as SharedStore;
    const b = new DailyBudget(broken, 1);
    await expect(b.reserve(0.1)).rejects.toBeInstanceOf(StoreError);
    await expect(b.status()).rejects.toBeInstanceOf(StoreError);
    await expect(b.settle({ key: "k", micros: 1 }, 0.5)).resolves.toBeUndefined();
  });
});

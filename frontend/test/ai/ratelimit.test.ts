import { describe, expect, it } from "vitest";
import { DailyBudget, MemoryCounters, MemoryRateLimiter, MissionStore, clientIp, missionRules } from "../../lib/server/ratelimit";

describe("per-IP mission limits (5/hour, 15/day)", () => {
  it("blocks the 6th mission within an hour and reports when to retry", async () => {
    const clock = { t: 1_000_000 };
    const l = new MemoryRateLimiter(() => clock.t);
    const rules = missionRules(5, 15);
    for (let i = 0; i < 5; i++) expect((await l.consume("ip:1.1.1.1", rules)).allowed).toBe(true);
    const blocked = await l.consume("ip:1.1.1.1", rules);
    expect(blocked).toMatchObject({ allowed: false, blockedBy: "missions_per_hour" });
    expect(blocked.retryAfterS).toBeGreaterThan(0);
    expect((await l.consume("ip:2.2.2.2", rules)).allowed).toBe(true);
  });
  it("frees the hourly window after an hour but keeps the daily cap of 15", async () => {
    const clock = { t: 0 };
    const l = new MemoryRateLimiter(() => clock.t);
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
  it("a refused request is not recorded", async () => {
    const l = new MemoryRateLimiter(() => 0);
    const rules = [{ name: "r", limit: 1, windowMs: 1000 }];
    await l.consume("k", rules);
    for (let i = 0; i < 3; i++) await l.consume("k", rules);
    expect((await l.consume("k", [{ name: "r", limit: 2, windowMs: 1000 }])).allowed).toBe(true);
  });
  it("reads the client IP from the forwarding header", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("global daily spend ceiling", () => {
  it("reserves, settles, and refuses once the ceiling would be crossed", async () => {
    const clock = { t: Date.UTC(2026, 8, 26, 10) };
    const b = new DailyBudget(new MemoryCounters(() => clock.t), 1, () => clock.t);
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
  it("resets at the next UTC day", async () => {
    const clock = { t: Date.UTC(2026, 8, 26, 23, 59) };
    const b = new DailyBudget(new MemoryCounters(() => clock.t), 1, () => clock.t);
    const r = await b.reserve(0.9);
    await b.settle(r!, 1);
    expect((await b.status()).exhausted).toBe(true);
    clock.t += 2 * 60_000;
    expect((await b.status()).exhausted).toBe(false);
  });
  it("a failed call releases its reservation", async () => {
    const b = new DailyBudget(new MemoryCounters(), 1);
    const r = await b.reserve(0.9);
    await b.settle(r!, 0);
    expect(await b.reserve(0.9)).not.toBeNull();
  });
});

describe("mission store", () => {
  it("expires records", () => {
    const clock = { t: 0 };
    const s = new MissionStore(() => clock.t);
    s.create("m1", "ip");
    expect(s.get("m1")).toBeDefined();
    clock.t = 3 * 3600_000;
    expect(s.get("m1")).toBeUndefined();
  });
});

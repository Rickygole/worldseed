import { beforeEach, describe, expect, it } from "vitest";
import { GET as healthGET } from "../../app/api/health/route";
import * as parseRoute from "../../app/api/agent/parse/route";
import * as planRoute from "../../app/api/agent/plan/route";
import * as critiqueRoute from "../../app/api/agent/critique/route";
import * as narrateRoute from "../../app/api/agent/narrate/route";
import * as closuresRoute from "../../app/api/closures/route";
import * as confirmRoute from "../../app/api/closures/confirm/route";
import { handleHealth } from "../../lib/server/handlers";
import type { Runtime } from "../../lib/server/runtime";
import { FakeProvider, blockNetwork, makeRuntime, makeServer } from "./fixtures";

beforeEach(blockNetwork);

function runtimeFor(provider: FakeProvider, cfg = {}): { rt: Runtime; server: ReturnType<typeof makeServer> } {
  const server = makeServer([], cfg, provider);
  return { server, rt: makeRuntime(server) };
}

describe("/api/health", () => {
  it("reports the resolved model per role and the fallbacks", async () => {
    const { rt } = runtimeFor(new FakeProvider([]));
    const out = await (await handleHealth(rt)).json();
    expect(out.roles).toEqual({
      planner: "nvidia/Nemotron-3-Ultra-550b-a55b",
      critic: "nvidia/Nemotron-3-Ultra-550b-a55b",
      parser: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
      narrator: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
      extractor: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
    });
    expect(out.fallbacks.planner).toEqual(["nvidia/nemotron-3-super-120b-a12b"]);
    expect(out).toMatchObject({ ok: true, degraded: false, degradedReason: null, planner: { available: true }, provider: { configured: true, reachable: true }, protection: "instance-local" });
    expect(out.tavily).toEqual({ configured: false });
  });
  it("reports 'unavailable' and degraded when the planner model is not listed", async () => {
    const { rt } = runtimeFor(new FakeProvider([], ["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"]));
    const out = await (await handleHealth(rt)).json();
    expect(out.roles.planner).toBe("unavailable");
    expect(out.roles.parser).toBe("nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B");
    expect(out).toMatchObject({ degraded: true, degradedReason: "planner_unavailable" });
  });
  it("falls back to Super when Ultra is not on the account", async () => {
    const { rt } = runtimeFor(new FakeProvider([], ["nvidia/nemotron-3-super-120b-a12b"]));
    expect((await (await handleHealth(rt)).json()).roles.planner).toBe("nvidia/nemotron-3-super-120b-a12b");
  });
  it("lists {base}/models at most once per 10 minutes", async () => {
    const p = new FakeProvider([]);
    const { rt, server } = runtimeFor(p);
    await handleHealth(rt);
    await handleHealth(rt);
    server.clock.t += 9 * 60_000;
    await handleHealth(rt);
    expect(p.listCalls).toBe(1);
    server.clock.t += 2 * 60_000;
    await handleHealth(rt);
    expect(p.listCalls).toBe(2);
  });
  it("flags budget exhaustion as degraded", async () => {
    const { rt } = runtimeFor(new FakeProvider([]), { dailyBudgetUsd: 0.5 });
    const r = await rt.agent.budget.reserve(0.4);
    await rt.agent.budget.settle(r!, 0.5);
    expect(await (await handleHealth(rt)).json()).toMatchObject({ degraded: true, degradedReason: "budget_exhausted", planner: { available: false } });
  });
  it("never includes a key or the base URL", async () => {
    const { rt } = runtimeFor(new FakeProvider([]));
    const text = await (await handleHealth(rt)).text();
    expect(text).not.toContain("test-key-not-real");
    expect(text).not.toContain("tokenfactory");
  });
  it("the real route works with no env at all: unavailable, no network", async () => {
    const out = await (await healthGET()).json();
    expect(out).toMatchObject({ ok: true, degraded: true, provider: { configured: false } });
    expect(out.roles.planner).toBe("unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("finding 11: /api/health exposes booleans, enums and model names only", () => {
  const scan = (v: unknown, path = ""): string[] => {
    if (typeof v === "number") return [path];
    if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => scan(x, `${path}.${k}`));
    return [];
  };
  it("has no counters, spend, ceiling, timestamps or call counts anywhere", async () => {
    const { rt } = runtimeFor(new FakeProvider([]));
    const r = await rt.agent.budget.reserve(0.2);
    await rt.agent.budget.settle(r!, 0.2);
    const out = await (await handleHealth(rt)).json();
    expect(scan(out)).toEqual([]);
    expect(Object.keys(out).sort()).toEqual(["degraded", "degradedReason", "fallbacks", "ok", "planner", "protection", "provider", "roles", "tavily"]);
    const text = JSON.stringify(out);
    for (const word of ["spent", "ceiling", "callsToday", "dailyCap", "checkedAt", "budget"]) expect(text).not.toContain(word);
  });
  it("finding N1: health polling costs zero store commands, and its body is cached for a minute per process", async () => {
    const p = new FakeProvider([]);
    const { rt, server } = runtimeFor(p);
    let reads = 0;
    for (const m of ["get", "peek", "incr", "incrLite", "set", "setIfAbsent", "take", "del", "delIfEquals"] as const) {
      const real = (server.store[m] as (...a: unknown[]) => unknown).bind(server.store);
      (server.store as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => (reads++, real(...a));
    }
    for (let i = 0; i < 100; i++) await handleHealth(rt);
    expect(reads).toBe(0);
    expect(p.listCalls).toBe(1);
    server.clock.t += 59_000;
    await handleHealth(rt);
    expect(p.listCalls).toBe(1); // still the cached body
    server.clock.t += 2_000; // past a minute: rebuilt, but still no store read
    await handleHealth(rt);
    expect(reads).toBe(0);
  });
  it("reports budget exhaustion from the process's last observed total, and a recent store failure as protection_unavailable", async () => {
    const { rt, server } = runtimeFor(new FakeProvider([]), { dailyBudgetUsd: 0.5 });
    const r = await rt.agent.budget.reserve(0.4);
    await rt.agent.budget.settle(r!, 0.5);
    expect((await (await handleHealth(rt)).json()).degradedReason).toBe("budget_exhausted");
    server.clock.t += 61_000;
    server.deps.signals!.storeDownAt = server.clock.t - 1_000;
    expect((await (await handleHealth(rt)).json()).degradedReason).toBe("protection_unavailable");
    server.clock.t += 200_000; // the failure is old news and the budget cache is from the same window
    server.deps.signals!.storeDownAt = 0;
    expect((await (await handleHealth(rt)).json()).degradedReason).toBe("budget_exhausted");
  });
  it("reports the protection mode as an enum", async () => {
    const shared = runtimeFor(new FakeProvider([]), { protection: "shared" });
    expect((await (await handleHealth(shared.rt)).json()).protection).toBe("shared");
    const off = runtimeFor(new FakeProvider([]), { protection: "off", liveAi: false });
    expect((await (await handleHealth(off.rt)).json()).protection).toBe("off");
  });
  it("finding 2: with the kill switch on it reports degraded and makes no provider call, not even a model listing", async () => {
    const p = new FakeProvider([]);
    const { rt } = runtimeFor(p, { liveAi: false, protection: "off" });
    const out = await (await handleHealth(rt)).json();
    expect(out).toMatchObject({ degraded: true, degradedReason: "planner_unavailable", planner: { available: false } });
    expect(out.roles.planner).toBe("unavailable");
    expect(p.listCalls).toBe(0);
  });
});

describe("route modules", () => {
  it("export POST handlers on the node runtime with a 60 s duration", () => {
    for (const r of [parseRoute, planRoute, critiqueRoute, narrateRoute, closuresRoute, confirmRoute]) {
      expect(typeof r.POST).toBe("function");
      expect(r.runtime).toBe("nodejs");
      expect(r.maxDuration).toBe(60);
      expect(r.dynamic).toBe("force-dynamic");
    }
  });
});

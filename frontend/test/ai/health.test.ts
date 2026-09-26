import { beforeEach, describe, expect, it } from "vitest";
import { GET as healthGET } from "../../app/api/health/route";
import * as parseRoute from "../../app/api/agent/parse/route";
import * as planRoute from "../../app/api/agent/plan/route";
import * as critiqueRoute from "../../app/api/agent/critique/route";
import * as narrateRoute from "../../app/api/agent/narrate/route";
import * as closuresRoute from "../../app/api/closures/route";
import { handleHealth } from "../../lib/server/handlers";
import { MemoryCounters } from "../../lib/server/ratelimit";
import type { Runtime } from "../../lib/server/runtime";
import { FakeProvider, blockNetwork, makeServer } from "./fixtures";

beforeEach(blockNetwork);

function runtimeFor(provider: FakeProvider, cfg = {}): { rt: Runtime; server: ReturnType<typeof makeServer> } {
  const server = makeServer([], cfg, provider);
  return { server, rt: { agent: server.deps, counters: new MemoryCounters(server.deps.now), search: null, closures: { cache: null } } };
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
    expect(out).toMatchObject({ ok: true, degraded: false, provider: { configured: true, reachable: true }, budget: { ceilingUsd: 1, exhausted: false } });
    expect(out.tavily).toEqual({ configured: false, callsToday: 0, dailyCap: 30 });
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
    expect(await (await handleHealth(rt)).json()).toMatchObject({ degraded: true, degradedReason: "budget_exhausted", budget: { exhausted: true } });
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

describe("route modules", () => {
  it("export POST handlers on the node runtime with a 60 s duration", () => {
    for (const r of [parseRoute, planRoute, critiqueRoute, narrateRoute, closuresRoute]) {
      expect(typeof r.POST).toBe("function");
      expect(r.runtime).toBe("nodejs");
      expect(r.maxDuration).toBe(60);
      expect(r.dynamic).toBe("force-dynamic");
    }
  });
});

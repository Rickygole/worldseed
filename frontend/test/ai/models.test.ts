import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ROLE_MODELS, ModelResolver, buildRoleChains, costUsd } from "../../lib/server/models";
import { readConfig } from "../../lib/server/config";
import { FakeProvider, blockNetwork } from "./fixtures";

beforeEach(blockNetwork);

describe("model registry", () => {
  it("has the documented default chains", () => {
    const c = buildRoleChains({});
    expect(c.planner).toEqual(["nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b"]);
    expect(c.critic).toEqual(c.planner);
    expect(c.parser).toEqual(["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "nvidia/Nemotron-3_5-Lightning", "nvidia/nemotron-3-super-120b-a12b"]);
    expect(c.narrator).toEqual(["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "nvidia/nemotron-3-super-120b-a12b"]);
    expect(c.extractor).toEqual(c.parser);
  });
  it("a single env ID becomes the primary and defaults follow as fallbacks", () => {
    const c = buildRoleChains({ WS_MODEL_PLANNER: "acme/planner-x" });
    expect(c.planner).toEqual(["acme/planner-x", ...DEFAULT_ROLE_MODELS.planner]);
    expect(buildRoleChains({ WS_MODEL_PLANNER: DEFAULT_ROLE_MODELS.planner[1] }).planner[0]).toBe(DEFAULT_ROLE_MODELS.planner[1]);
  });
  it("a comma list replaces the chain", () => {
    expect(buildRoleChains({ WS_MODEL_NARRATOR: "a/b, c/d" }).narrator).toEqual(["a/b", "c/d"]);
  });
  it("prices calls conservatively", () => {
    expect(costUsd("x", 1_000_000, 1_000_000)).toBeCloseTo(4);
  });
  it("config reads only server env and applies the documented defaults", () => {
    const c = readConfig({});
    expect(c).toMatchObject({ dailyBudgetUsd: 1, ipDailyUsd: 0.15, missionInputTokens: 30_000, missionOutputTokens: 6_000, missionMaxCalls: 12, ipMissionsPerHour: 8, ipMissionsPerDay: 15, tavilyDailyCap: 30, baseURL: "https://api.tokenfactory.nebius.com/v1/", trustForwarded: false });
    expect(readConfig({ WS_DAILY_BUDGET_USD: "abc" }).dailyBudgetUsd).toBe(1);
  });
});

describe("ModelResolver", () => {
  const clock = { t: 0 };
  const now = () => clock.t;
  it("resolves roles against the listed models, in fallback order, case-insensitively", async () => {
    const p = new FakeProvider([], ["NVIDIA/nemotron-3-super-120b-a12b", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"]);
    const r = new ModelResolver({ provider: p, chains: buildRoleChains({}), now });
    expect(await r.resolve("planner")).toEqual(["NVIDIA/nemotron-3-super-120b-a12b"]);
    const h = await r.health();
    expect(h.roles.planner.model).toBe("NVIDIA/nemotron-3-super-120b-a12b");
    expect(h.roles.parser.chain).toEqual(["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "NVIDIA/nemotron-3-super-120b-a12b"]);
    expect(h.reachable).toBe(true);
  });
  it("reports unavailable when nothing in the chain is listed", async () => {
    const r = new ModelResolver({ provider: new FakeProvider([], ["other/model"]), now });
    expect((await r.health()).roles.planner.model).toBe("unavailable");
    expect(await r.resolve("planner")).toEqual([]);
  });
  it("caches the model list for 10 minutes, then refreshes", async () => {
    clock.t = 0;
    const p = new FakeProvider([]);
    const r = new ModelResolver({ provider: p, cacheMs: 10 * 60_000, now });
    await r.resolve("planner");
    await r.resolve("critic");
    await r.health();
    expect(p.listCalls).toBe(1);
    clock.t = 9 * 60_000;
    await r.resolve("planner");
    expect(p.listCalls).toBe(1);
    clock.t = 10 * 60_000 + 1;
    await r.resolve("planner");
    expect(p.listCalls).toBe(2);
  });
  it("without a key everything is unavailable and nothing is listed", async () => {
    const r = new ModelResolver({ provider: null, now });
    const h = await r.health();
    expect(h).toMatchObject({ reachable: false, reason: "no_api_key" });
    expect(Object.values(h.roles).every((x) => x.model === "unavailable")).toBe(true);
  });
  it("a failed listing makes roles unavailable and is retried after a short delay", async () => {
    clock.t = 0;
    const p = new FakeProvider([], new Error("down"));
    const r = new ModelResolver({ provider: p, failureCacheMs: 60_000, now });
    expect(await r.resolve("planner")).toEqual([]);
    expect(await r.resolve("planner")).toEqual([]);
    expect(p.listCalls).toBe(1);
    expect((await r.health()).reason).toBe("models_list_failed");
    p.models = ["nvidia/Nemotron-3-Ultra-550b-a55b"];
    clock.t = 61_000;
    expect(await r.resolve("planner")).toEqual(["nvidia/Nemotron-3-Ultra-550b-a55b"]);
  });
});

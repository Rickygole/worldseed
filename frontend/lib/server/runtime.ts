/**
 * Wires the server dependencies from the environment. Kept on globalThis so dev hot reloads and
 * warm serverless instances share one limiter, one budget ledger and one model cache.
 *
 * Protection modes (config.protection, shown as an enum in /api/health):
 *   shared         an Upstash REST store is configured: limits, spend ledger, mission records,
 *                  closure counter and cache are shared by every instance.
 *   instance-local no shared store: the same controls run in this process only. On a serverless
 *                  host the daily budget is cut to a small per-instance amount and one warning is logged.
 *   off            WS_LIVE_AI=off: no provider call can happen, so there is no spend to protect.
 */
import type { AgentDeps } from "./agentService";
import { createCatalogLoader } from "./catalogLoader";
import { readConfig } from "./config";
import { logEvent } from "./log";
import { MissionLedger } from "./missions";
import { ModelResolver, buildRoleChains } from "./models";
import { DailyBudget, StoreRateLimiter } from "./ratelimit";
import { createSharedStore, type SharedStore } from "./store";
import { createTavilyClient, type ClosuresState, type SearchClient } from "./tavily";
import { createOpenAIClient, createTokenFactoryProvider, ProviderBackoff } from "./tokenfactory";

export interface Runtime {
  agent: AgentDeps;
  store: SharedStore;
  search: SearchClient | null;
  closures: ClosuresState;
  /** Short per-process cache of the public health body, so polling cannot turn into store or provider traffic. */
  healthCache?: { at: number; body: string };
}

export function createRuntime(
  env: Record<string, string | undefined> = process.env,
  opts: { store?: SharedStore; fetchImpl?: typeof fetch } = {},
): Runtime {
  const config = readConfig(env);
  const now = () => Date.now();
  const store = opts.store ?? createSharedStore(env, { fetchImpl: opts.fetchImpl, now });

  if (!config.liveAi) {
    logEvent("warn", "live_ai_off", { note: "WS_LIVE_AI=off: every AI route answers planner unavailable" });
  } else if (config.protection === "instance-local" && config.serverless) {
    logEvent("warn", "instance_local_protection", {
      note: "no shared store configured on a serverless host; limits are per instance",
      dailyBudgetUsd: config.dailyBudgetUsd,
    });
  }
  if (config.baseUrlIssue) logEvent("warn", "base_url_rejected", { issue: config.baseUrlIssue });

  const provider =
    config.apiKey && !config.baseUrlIssue
      ? createTokenFactoryProvider(createOpenAIClient({ apiKey: config.apiKey, baseURL: config.baseURL }))
      : null;
  const resolver = new ModelResolver({ provider, chains: buildRoleChains(env), cacheMs: config.modelsCacheMs, now });
  return {
    agent: {
      config,
      provider,
      resolver,
      limiter: new StoreRateLimiter(store),
      budget: new DailyBudget(store, config.dailyBudgetUsd, now, config.budgetResetHourUtc),
      missions: new MissionLedger(store),
      backoff: new ProviderBackoff(now),
      loadCatalog: createCatalogLoader(),
      now,
    },
    store,
    search: config.tavilyKey && config.liveAi ? createTavilyClient({ apiKey: config.tavilyKey }) : null,
    closures: { inflight: null },
  };
}

const KEY = "__worldseed_runtime__";
export function getRuntime(): Runtime {
  const g = globalThis as unknown as Record<string, Runtime | undefined>;
  return (g[KEY] ??= createRuntime());
}

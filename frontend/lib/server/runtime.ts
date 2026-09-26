/**
 * Wires the server dependencies from the environment. Kept on globalThis so dev hot reloads and
 * warm serverless instances share one limiter, one budget ledger and one model cache.
 */
import type { AgentDeps } from "./agentService";
import { createCatalogLoader } from "./catalogLoader";
import { readConfig } from "./config";
import { ModelResolver, buildRoleChains } from "./models";
import { DailyBudget, MemoryCounters, MemoryRateLimiter, MissionStore, type CounterStore } from "./ratelimit";
import { createTavilyClient, type ClosuresCache, type SearchClient } from "./tavily";
import { createOpenAIClient, createTokenFactoryProvider } from "./tokenfactory";

export interface Runtime {
  agent: AgentDeps;
  counters: CounterStore;
  search: SearchClient | null;
  closures: ClosuresCache;
}

export function createRuntime(env: Record<string, string | undefined> = process.env): Runtime {
  const config = readConfig(env);
  const now = () => Date.now();
  const counters = new MemoryCounters(now);
  const provider = config.apiKey ? createTokenFactoryProvider(createOpenAIClient({ apiKey: config.apiKey, baseURL: config.baseURL })) : null;
  const resolver = new ModelResolver({ provider, chains: buildRoleChains(env), cacheMs: config.modelsCacheMs, now });
  return {
    agent: {
      config,
      provider,
      resolver,
      limiter: new MemoryRateLimiter(now),
      budget: new DailyBudget(counters, config.dailyBudgetUsd, now),
      missions: new MissionStore(now),
      loadCatalog: createCatalogLoader(),
      now,
    },
    counters,
    search: config.tavilyKey ? createTavilyClient({ apiKey: config.tavilyKey }) : null,
    closures: { cache: null },
  };
}

const KEY = "__worldseed_runtime__";
export function getRuntime(): Runtime {
  const g = globalThis as unknown as Record<string, Runtime | undefined>;
  return (g[KEY] ??= createRuntime());
}

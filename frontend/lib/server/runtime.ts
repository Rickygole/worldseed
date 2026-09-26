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
import { DailyBudget, FrontDoor, setIpSalt, StoreRateLimiter } from "./ratelimit";
import { createSharedStore, MeteredStore, sharedStoreCredentials, sharedStoreRefusal, type SharedStore } from "./store";
import { createTurnstileVerifier } from "./turnstile";
import { createHmac, randomBytes } from "node:crypto";
import { createTavilyClient, type ClosuresState, type SearchClient } from "./tavily";
import { createOpenAIClient, createTokenFactoryProvider, ProviderBackoff } from "./tokenfactory";

export interface Runtime {
  agent: AgentDeps;
  store: SharedStore;
  search: SearchClient | null;
  closures: ClosuresState;
  /**
   * Signs stateless closure-confirmation tokens. In production (a serverless host or NODE_ENV=production)
   * it MUST be set explicitly in WS_CONFIRM_SECRET: without it the value is "" and closure search
   * answers "disabled". Elsewhere an unset secret is derived from the store token, else random per process.
   */
  confirmSecret: string;
  /** The command meter when the store is metered (health reads its `exhausted()`; never a store call). */
  meter?: MeteredStore;
  /** Short per-process cache of the public health body, so polling cannot turn into store or provider traffic. */
  healthCache?: { at: number; body: string };
}

export function createRuntime(
  env: Record<string, string | undefined> = process.env,
  opts: { store?: SharedStore; fetchImpl?: typeof fetch; turnstileFetch?: typeof fetch } = {},
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
  const refusal = sharedStoreRefusal(env);
  if (refusal) logEvent("warn", "store_refused", { issue: refusal });

  // Secrets that must agree across instances are derived from the store token when not set
  // explicitly, so a shared deployment works without extra configuration and nothing is guessable.
  const creds = sharedStoreCredentials(env);
  const derive = (label: string) => createHmac("sha256", (creds as { token: string }).token).update(label).digest("hex");
  const saltEnv = env.WS_IP_HASH_SALT?.trim();
  if (saltEnv) setIpSalt(saltEnv);
  else if (creds) {
    setIpSalt(derive("ws-ip-salt"));
    logEvent("warn", "ip_salt_derived", { note: "WS_IP_HASH_SALT unset; derived from the store token" });
  } else setIpSalt("");
  let confirmSecret = env.WS_CONFIRM_SECRET?.trim() ?? "";
  const production = config.serverless || env.NODE_ENV === "production";
  if (!confirmSecret) {
    if (production) {
      // No fallback in production: a guessable or per-process secret would either be forgeable or break confirmations across instances.
      logEvent("warn", "confirm_secret_missing", { note: "WS_CONFIRM_SECRET unset in production; closure search is disabled" });
    } else if (creds) confirmSecret = derive("ws-confirm");
    else confirmSecret = randomBytes(32).toString("hex");
  }

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
      missions: new MissionLedger(store, undefined, now),
      backoff: new ProviderBackoff(now),
      frontDoor: new FrontDoor({
        perIpPerMin: config.frontDoorPerIpPerMin,
        globalPerMin: config.frontDoorGlobalPerMin,
        closuresPerIpPerHour: config.ipClosuresPerHour,
        missionsPerIpPerDay: config.ipMissionsPerDay,
        newMissionsPerHour: config.newMissionsPerHour,
        newMissionsPerDay: config.newMissionsPerDay,
        now,
      }),
      verifyHuman: config.turnstileSecret && config.liveAi ? createTurnstileVerifier({ secret: config.turnstileSecret, fetchImpl: opts.turnstileFetch }) : undefined,
      signals: { storeDownAt: 0 },
      loadCatalog: createCatalogLoader(),
      now,
    },
    store,
    search: config.tavilyKey && config.liveAi ? createTavilyClient({ apiKey: config.tavilyKey }) : null,
    closures: { inflight: null, cache: null },
    confirmSecret,
    meter: store instanceof MeteredStore ? store : undefined,
  };
}

const KEY = "__worldseed_runtime__";
export function getRuntime(): Runtime {
  const g = globalThis as unknown as Record<string, Runtime | undefined>;
  return (g[KEY] ??= createRuntime());
}

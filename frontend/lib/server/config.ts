/**
 * Server-side configuration. Reads process.env only on the server; nothing here is exposed to the
 * client. Keys must never be given a browser-visible env prefix.
 */
import { sharedStoreCredentials } from "./store";

/** USD per million tokens. */
export interface Price {
  inPerM: number;
  outPerM: number;
}
export interface PriceTable {
  fallback: Price;
  byModel: Record<string, Price>;
}

/** Which abuse controls are actually protecting spend right now. */
export type ProtectionMode = "shared" | "instance-local" | "off";

export interface ServerConfig {
  apiKey?: string;
  baseURL: string;
  /** Why the configured base URL was refused (the provider is then disabled), if it was. */
  baseUrlIssue?: string;
  tavilyKey?: string;
  /** Kill switch: WS_LIVE_AI=off makes every route answer "planner unavailable" with no provider call. */
  liveAi: boolean;
  /** True on a serverless host (process.env.VERCEL set). */
  serverless: boolean;
  /** True when an Upstash-compatible REST store is configured (limits are shared across instances). */
  sharedStore: boolean;
  protection: ProtectionMode;
  /** Global daily spend ceiling in USD. Much lower when only instance-local protection exists. */
  dailyBudgetUsd: number;
  /** The daily window rolls over at this UTC hour (default 08:00 UTC = 01:00 Pacific). */
  budgetResetHourUtc: number;
  /** Per-IP daily spend cap in USD (reserved and settled like the global ceiling), whatever the mission counts. */
  ipDailyUsd: number;
  missionInputTokens: number;
  missionOutputTokens: number;
  /** Upstream provider calls one mission may make in total (each attempt counts). */
  missionMaxCalls: number;
  /** Upstream provider calls one HTTP request may make in total, repair turn included. */
  maxAttemptsPerRequest: number;
  ipMissionsPerHour: number;
  ipMissionsPerDay: number;
  ipClosuresPerHour: number;
  tavilyDailyCap: number;
  tavilyCacheMs: number;
  /** A closure result without successful extraction is cached only this long. */
  tavilyDegradedCacheMs: number;
  llmTimeoutMs: number;
  /** Total wall-clock allowance for one route call (routes set maxDuration = 60). */
  routeDeadlineMs: number;
  /** Closure lookups (search plus extraction) must finish inside this. */
  closuresDeadlineMs: number;
  modelsCacheMs: number;
  /** How many proxy hops in x-forwarded-for are trusted (the client is that many entries from the right). */
  trustedProxyHops: number;
  /**
   * Client-address headers are believed only behind a known proxy: on a serverless host, or when
   * WS_TRUST_FORWARDED=1 says this deployment sits behind one. Otherwise every client is "local".
   */
  trustForwarded: boolean;
  /** In-memory front-door limits, checked before any store command (per process). */
  frontDoorPerIpPerMin: number;
  frontDoorGlobalPerMin: number;
  /** Extra origins allowed to call the POST routes (comma list in WS_ALLOWED_ORIGINS). */
  allowedOrigins: string[];
  prices: PriceTable;
}

export const DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1/";
/** The one provider host that is accepted without configuration. Anything else needs WS_ALLOWED_BASE_HOSTS (exact hosts). */
export const DEFAULT_BASE_HOSTS: readonly string[] = ["api.tokenfactory.nebius.com"];

/** Conservative default: every model is priced like the planner until real prices are confirmed. */
export const DEFAULT_PRICE: Price = { inPerM: 1, outPerM: 3 };

type Env = Record<string, string | undefined>;

function num(env: Env, key: string, dflt: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/**
 * The kill switch fails SAFE: unset (or blank) means on, and only on / 1 / true / yes keep it on.
 * Any other value, including a typo such as "of" or "paused", turns AI off.
 */
export function liveAiEnabled(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "" || ["on", "1", "true", "yes"].includes(v);
}

/** WS_MODEL_PRICES="model-id=inPerM/outPerM,other-id=inPerM/outPerM" (USD per million tokens). */
export function parsePriceTable(env: Env): PriceTable {
  const fallback: Price = { inPerM: num(env, "WS_PRICE_IN_PER_M", DEFAULT_PRICE.inPerM), outPerM: num(env, "WS_PRICE_OUT_PER_M", DEFAULT_PRICE.outPerM) };
  const byModel: Record<string, Price> = {};
  for (const part of (env.WS_MODEL_PRICES ?? "").split(",")) {
    const m = /^\s*([^=\s]+)\s*=\s*([0-9.]+)\s*\/\s*([0-9.]+)\s*$/.exec(part);
    if (!m) continue;
    const inPerM = Number(m[2]);
    const outPerM = Number(m[3]);
    if (Number.isFinite(inPerM) && Number.isFinite(outPerM) && inPerM >= 0 && outPerM >= 0) byModel[m[1].toLowerCase()] = { inPerM, outPerM };
  }
  return { fallback, byModel };
}

/** Why a provider base URL is refused, or null when it is acceptable (https and an allowed host). */
export function baseUrlIssue(raw: string, extraHosts: readonly string[] = []): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "not a valid URL";
  }
  if (u.protocol !== "https:") return "must use https";
  if (u.username || u.password) return "must not embed credentials";
  if (u.port !== "") return "must use the default https port";
  const host = u.hostname.toLowerCase();
  // Exact hosts only: a suffix rule would accept every subdomain of a shared domain.
  const allowed = [...DEFAULT_BASE_HOSTS, ...extraHosts.map((h) => h.trim().toLowerCase()).filter(Boolean)];
  if (!allowed.includes(host)) return "host is not on the allowlist";
  return null;
}

export function readConfig(env: Env = process.env): ServerConfig {
  const serverless = Boolean(env.VERCEL && env.VERCEL.trim() !== "");
  const sharedStore = sharedStoreCredentials(env) !== null;
  const liveAi = liveAiEnabled(env.WS_LIVE_AI);
  const explicitBudget = num(env, "WS_DAILY_BUDGET_USD", 1);
  const instanceLocalBudget = num(env, "WS_INSTANCE_LOCAL_BUDGET_USD", 0.25);
  // Without a shared store on a serverless host every instance has its own ledger, so the
  // per-instance ceiling is kept small: the worst case is (instances x this), not (instances x $1).
  const dailyBudgetUsd = serverless && !sharedStore ? Math.min(explicitBudget, instanceLocalBudget) : explicitBudget;
  const protection: ProtectionMode = !liveAi ? "off" : sharedStore ? "shared" : "instance-local";

  const rawBase = env.NEBIUS_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const issue = baseUrlIssue(rawBase, (env.WS_ALLOWED_BASE_HOSTS ?? "").split(","));
  const hops = Math.floor(num(env, "WS_TRUSTED_PROXY_HOPS", 1));

  return {
    apiKey: env.NEBIUS_API_KEY?.trim() || undefined,
    baseURL: issue ? DEFAULT_BASE_URL : rawBase,
    baseUrlIssue: issue ?? undefined,
    tavilyKey: env.TAVILY_API_KEY?.trim() || undefined,
    liveAi,
    serverless,
    sharedStore,
    protection,
    dailyBudgetUsd,
    budgetResetHourUtc: Math.min(23, Math.max(0, Math.floor(Number(env.WS_BUDGET_RESET_HOUR_UTC ?? "8")) || 0)),
    ipDailyUsd: num(env, "WS_IP_DAILY_USD", 0.15),
    missionInputTokens: num(env, "WS_MISSION_INPUT_TOKENS", 30_000),
    missionOutputTokens: num(env, "WS_MISSION_OUTPUT_TOKENS", 6_000),
    missionMaxCalls: Math.floor(num(env, "WS_MISSION_MAX_CALLS", 12)),
    maxAttemptsPerRequest: Math.min(3, Math.floor(num(env, "WS_MAX_ATTEMPTS_PER_REQUEST", 3))),
    ipMissionsPerHour: num(env, "WS_IP_MISSIONS_PER_HOUR", 8),
    ipMissionsPerDay: num(env, "WS_IP_MISSIONS_PER_DAY", 15),
    ipClosuresPerHour: num(env, "WS_IP_CLOSURES_PER_HOUR", 10),
    tavilyDailyCap: num(env, "WS_TAVILY_DAILY_CAP", 30),
    tavilyCacheMs: num(env, "WS_TAVILY_CACHE_MS", 6 * 3600_000),
    tavilyDegradedCacheMs: Math.min(num(env, "WS_TAVILY_CACHE_MS", 6 * 3600_000), 120_000),
    llmTimeoutMs: num(env, "WS_LLM_TIMEOUT_MS", 28_000),
    routeDeadlineMs: Math.min(num(env, "WS_ROUTE_DEADLINE_MS", 50_000), 55_000),
    closuresDeadlineMs: Math.min(num(env, "WS_CLOSURES_DEADLINE_MS", 45_000), 45_000),
    modelsCacheMs: num(env, "WS_MODELS_CACHE_MS", 10 * 60_000),
    trustedProxyHops: hops < 1 ? 1 : hops,
    trustForwarded: serverless || ["1", "true", "yes"].includes((env.WS_TRUST_FORWARDED ?? "").trim().toLowerCase()),
    frontDoorPerIpPerMin: Math.floor(num(env, "WS_FRONT_DOOR_PER_IP_PER_MIN", 30)),
    frontDoorGlobalPerMin: Math.floor(num(env, "WS_FRONT_DOOR_GLOBAL_PER_MIN", 240)),
    allowedOrigins: (env.WS_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    prices: parsePriceTable(env),
  };
}

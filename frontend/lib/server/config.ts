/**
 * Server-side configuration. Reads process.env only on the server; nothing here is exposed to the
 * client. Keys must never be given a browser-visible env prefix.
 */
export interface ServerConfig {
  apiKey?: string;
  baseURL: string;
  tavilyKey?: string;
  /** Global daily spend ceiling in USD (default about $1/day on the planner model). */
  dailyBudgetUsd: number;
  missionInputTokens: number;
  missionOutputTokens: number;
  ipMissionsPerHour: number;
  ipMissionsPerDay: number;
  ipClosuresPerHour: number;
  tavilyDailyCap: number;
  tavilyCacheMs: number;
  llmTimeoutMs: number;
  /** Total wall-clock allowance for one route call (routes set maxDuration = 60). */
  routeDeadlineMs: number;
  modelsCacheMs: number;
}

export const DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1/";

function num(env: Record<string, string | undefined>, key: string, dflt: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

export function readConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  return {
    apiKey: env.NEBIUS_API_KEY?.trim() || undefined,
    baseURL: env.NEBIUS_BASE_URL?.trim() || DEFAULT_BASE_URL,
    tavilyKey: env.TAVILY_API_KEY?.trim() || undefined,
    dailyBudgetUsd: num(env, "WS_DAILY_BUDGET_USD", 1),
    missionInputTokens: num(env, "WS_MISSION_INPUT_TOKENS", 60_000),
    missionOutputTokens: num(env, "WS_MISSION_OUTPUT_TOKENS", 12_000),
    ipMissionsPerHour: num(env, "WS_IP_MISSIONS_PER_HOUR", 5),
    ipMissionsPerDay: num(env, "WS_IP_MISSIONS_PER_DAY", 15),
    ipClosuresPerHour: num(env, "WS_IP_CLOSURES_PER_HOUR", 10),
    tavilyDailyCap: num(env, "WS_TAVILY_DAILY_CAP", 30),
    tavilyCacheMs: num(env, "WS_TAVILY_CACHE_MS", 6 * 3600_000),
    llmTimeoutMs: num(env, "WS_LLM_TIMEOUT_MS", 28_000),
    routeDeadlineMs: num(env, "WS_ROUTE_DEADLINE_MS", 55_000),
    modelsCacheMs: num(env, "WS_MODELS_CACHE_MS", 10 * 60_000),
  };
}

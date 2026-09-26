/**
 * Model registry: roles map to an ordered list of model IDs with capability flags.
 * IDs were read from the public Token Factory catalog; access on a given key is unverified, which
 * is why /api/health resolves each role against GET {base}/models (cached 10 min).
 * Override with env: WS_MODEL_PLANNER, WS_MODEL_CRITIC, WS_MODEL_PARSER,
 * WS_MODEL_EXTRACTOR. One ID becomes the primary and the defaults follow as fallbacks; a
 * comma-separated list replaces the whole chain.
 */
import { DEFAULT_PRICE, type PriceTable } from "./config";
import type { LlmProvider } from "./tokenfactory";

export type Role = "planner" | "critic" | "parser" | "extractor";
export const ROLES: readonly Role[] = ["planner", "critic", "parser", "extractor"];

export interface ModelCaps {
  supportsTools: boolean;
  supportsJsonSchema: boolean;
  reasoningToggle: boolean;
}

const ULTRA = "nvidia/Nemotron-3-Ultra-550b-a55b";
const SUPER = "nvidia/nemotron-3-super-120b-a12b";
const NANO = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";
const LIGHTNING = "nvidia/Nemotron-3_5-Lightning";

export const DEFAULT_ROLE_MODELS: Record<Role, string[]> = {
  planner: [ULTRA, SUPER],
  critic: [ULTRA, SUPER],
  parser: [NANO, LIGHTNING, SUPER],
  extractor: [NANO, LIGHTNING, SUPER],
};

/**
 * Capability flags. JSON-schema structured output is the default path for every model; native
 * tool calling is never relied on. Flags are best guesses until the first live smoke test.
 *
 * `reasoningToggle` is declared but deliberately unused: no request parameter that switches a
 * model's reasoning on or off has been verified against Token Factory, so none is sent. Do not
 * guess a parameter name; confirm it with scripts/smoke-token-factory.mjs first.
 */
export function capsFor(modelId: string): ModelCaps {
  void modelId;
  return { supportsTools: false, supportsJsonSchema: true, reasoningToggle: true };
}

/**
 * USD per million tokens. Prices are unverified, so every model defaults to the conservative
 * planner-class price. Override with WS_PRICE_IN_PER_M / WS_PRICE_OUT_PER_M (all models) or
 * WS_MODEL_PRICES="model-id=in/out,other-id=in/out" (per model, USD per million tokens).
 */
export { DEFAULT_PRICE };
export const DEFAULT_PRICES: PriceTable = { fallback: DEFAULT_PRICE, byModel: {} };

export function priceFor(modelId: string, prices: PriceTable = DEFAULT_PRICES) {
  return prices.byModel[modelId.toLowerCase()] ?? prices.fallback;
}

export function costUsd(modelId: string, inputTokens: number, outputTokens: number, prices: PriceTable = DEFAULT_PRICES): number {
  const p = priceFor(modelId, prices);
  return (inputTokens * p.inPerM + outputTokens * p.outPerM) / 1_000_000;
}

const ENV_KEY: Record<Role, string> = {
  planner: "WS_MODEL_PLANNER",
  critic: "WS_MODEL_CRITIC",
  parser: "WS_MODEL_PARSER",
  extractor: "WS_MODEL_EXTRACTOR",
};

export function buildRoleChains(env: Record<string, string | undefined> = process.env): Record<Role, string[]> {
  const out = {} as Record<Role, string[]>;
  for (const role of ROLES) {
    const raw = env[ENV_KEY[role]]?.trim();
    const ids = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (ids.length === 0) out[role] = [...DEFAULT_ROLE_MODELS[role]];
    else if (ids.length === 1) out[role] = [ids[0], ...DEFAULT_ROLE_MODELS[role].filter((m) => m !== ids[0])];
    else out[role] = ids;
  }
  return out;
}

export interface RoleHealth {
  /** The first model in the chain that the account lists, or "unavailable". */
  model: string;
  /** Every listed model in the chain, in fallback order. */
  chain: string[];
}

export interface RegistryHealth {
  reachable: boolean;
  reason?: "no_api_key" | "models_list_failed";
  checkedAt: string | null;
  roles: Record<Role, RoleHealth>;
}

export interface ResolverOptions {
  provider: LlmProvider | null;
  chains?: Record<Role, string[]>;
  cacheMs?: number;
  /** Failed lookups are cached briefly so an outage is not hammered. */
  failureCacheMs?: number;
  now?: () => number;
}

interface Listing {
  ids: string[] | null;
  at: number;
  ttl: number;
}

export class ModelResolver {
  private listing: Listing | null = null;
  private inflight: Promise<Listing> | null = null;
  private chains: Record<Role, string[]>;
  private cacheMs: number;
  private failureCacheMs: number;
  private now: () => number;
  private provider: LlmProvider | null;

  constructor(opts: ResolverOptions) {
    this.provider = opts.provider;
    this.chains = opts.chains ?? buildRoleChains();
    this.cacheMs = opts.cacheMs ?? 10 * 60_000;
    this.failureCacheMs = opts.failureCacheMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  private async list(): Promise<Listing> {
    const t = this.now();
    if (this.listing && t - this.listing.at < this.listing.ttl) return this.listing;
    if (!this.inflight) {
      this.inflight = (async (): Promise<Listing> => {
        try {
          const ids = await (this.provider as LlmProvider).listModels();
          return { ids, at: this.now(), ttl: this.cacheMs };
        } catch {
          return { ids: null, at: this.now(), ttl: this.failureCacheMs };
        } finally {
          this.inflight = null;
        }
      })();
    }
    this.listing = await this.inflight;
    return this.listing;
  }

  /** Listed models for a role in fallback order, matched case-insensitively. Empty = unavailable. */
  async resolve(role: Role): Promise<string[]> {
    if (!this.provider) return [];
    const { ids } = await this.list();
    if (!ids) return [];
    const canon = new Map(ids.map((id) => [id.toLowerCase(), id]));
    const out: string[] = [];
    for (const wanted of this.chains[role]) {
      const hit = canon.get(wanted.toLowerCase());
      if (hit && !out.includes(hit)) out.push(hit);
    }
    return out;
  }

  async health(): Promise<RegistryHealth> {
    const roles = {} as Record<Role, RoleHealth>;
    if (!this.provider) {
      for (const r of ROLES) roles[r] = { model: "unavailable", chain: [] };
      return { reachable: false, reason: "no_api_key", checkedAt: null, roles };
    }
    const listing = await this.list();
    for (const r of ROLES) {
      const chain = await this.resolve(r);
      roles[r] = { model: chain[0] ?? "unavailable", chain };
    }
    return {
      reachable: listing.ids !== null,
      reason: listing.ids === null ? "models_list_failed" : undefined,
      checkedAt: new Date(listing.at).toISOString(),
      roles,
    };
  }
}

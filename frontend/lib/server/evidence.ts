/**
 * The "reality check": recent news about what happened after the March 2024 Key Bridge collapse,
 * fetched from Tavily and returned as SOURCES ONLY. There is no model call, no extraction and no
 * claim: every source is marked unverified and the reader is sent to the link.
 *
 * Cost controls: the query is fixed on the server per topic (the client sends an enum), one
 * search is one credit, results are cached in process memory (6 hours when good, 2 minutes when
 * degraded), concurrent callers share one in-flight search per topic, and the same caps as the
 * closure search apply (front door, per-client hourly allowance, the global daily Tavily cap).
 * Tavily content lives only in this process's memory: it is never written to the shared store,
 * to disk or to the repository.
 */
import { EVIDENCE_TOPICS, type EvidenceResponse, type EvidenceSource, type EvidenceTopic } from "../agent/protocol";
import type { ServerConfig } from "./config";
import { logEvent } from "./log";
import { budgetWindow, DAY_MS, HOUR_MS, ipKey, type RateLimiter } from "./ratelimit";
import { StoreError, type SharedStore } from "./store";
import type { QueryParams, SearchClient, TavilyResult } from "./tavily";

/** Fixed queries, one per topic. Kept plain: they name the event and the thing measured, nothing else. */
export const EVIDENCE_QUERIES: Record<EvidenceTopic, string> = {
  detours: "Baltimore Key Bridge collapse March 2024 detours drivers Harbor Tunnel Fort McHenry Tunnel",
  traffic: "Baltimore Harbor Tunnel Fort McHenry Tunnel traffic volume delays after Key Bridge collapse",
  freight: "Port of Baltimore freight trucking impact after Key Bridge collapse March 2024",
};

/**
 * Tavily news search is limited to a recent window by default, so the request states the lookback
 * explicitly (about four years). Tavily's terms bar publishing performance information about the
 * service, so this code and its documentation describe only what the request sends, never how the
 * service behaves or responds to it (including whether a parameter is honored).
 */
export const EVIDENCE_PARAMS: QueryParams = {
  topic: "news",
  search_depth: "basic",
  max_results: 6,
  days: 1500,
  include_answer: false,
  include_raw_content: false,
};

const SNIPPET_MAX = 240;
const TITLE_MAX = 160;

/**
 * Plain characters only: diacritics folded, control and format characters dropped, markup and links
 * removed, everything outside letters, digits, spaces and basic punctuation replaced by a space.
 * The result is cut to `max` characters, ending with "..." when it was shortened.
 */
export function plainText(input: string, max: number): string {
  let t = input.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  t = t.replace(/<[^>]*>/g, " ").replace(/https?:\/\/\S+|www\.\S+/gi, " ");
  t = t.replace(/[^A-Za-z0-9 .,;:'"()&%$!?-]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 3);
  const at = cut.lastIndexOf(" ");
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[ .,;:-]+$/, "")}...`;
}

/** An ISO date (YYYY-MM-DD) from what the search API reported, or undefined. */
export function cleanPublished(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return undefined;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  return y >= 2000 && y <= 2100 ? d.toISOString().slice(0, 10) : undefined;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Sources with plain text only; results without a usable http(s) URL or host are dropped. */
export function toEvidenceSources(results: readonly TavilyResult[]): EvidenceSource[] {
  const out: EvidenceSource[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (!/^https?:\/\//i.test(r.url) || r.url.length > 500) continue;
    const domain = domainOf(r.url);
    if (!domain || seen.has(r.url)) continue;
    seen.add(r.url);
    const published = cleanPublished(r.publishedDate);
    out.push({
      title: plainText(r.title, TITLE_MAX) || domain,
      url: r.url,
      domain,
      ...(published ? { publishedDate: published } : {}),
      snippet: plainText(r.content, SNIPPET_MAX),
      confidence: "unverified",
    });
  }
  return out;
}

type OkResponse = Extract<EvidenceResponse, { status: "ok" }>;
interface Entry {
  at: number;
  degraded: boolean;
  /** A good answer, or (degraded) an "upstream_error" answer remembered for two minutes so a failing search is not hammered. */
  value: EvidenceResponse;
}

/** Process-local state, per topic. Holds Tavily content, so it never leaves this process. */
export interface EvidenceState {
  inflight: Map<EvidenceTopic, Promise<EvidenceResponse>>;
  cache: Map<EvidenceTopic, Entry>;
}
export const newEvidenceState = (): EvidenceState => ({ inflight: new Map(), cache: new Map() });

export interface EvidenceDeps {
  config: ServerConfig;
  search: SearchClient | null;
  store: SharedStore;
  limiter: RateLimiter;
  now: () => number;
}

const GOOD_CACHE_MS = 6 * HOUR_MS;
const DEGRADED_CACHE_MS = 120_000;

const unavailable = (reason: Extract<EvidenceResponse, { status: "unavailable" }>["reason"], message: string, retryAfterS?: number): EvidenceResponse => ({
  status: "unavailable",
  reason,
  message,
  ...(retryAfterS !== undefined ? { retryAfterS } : {}),
});

export function isEvidenceTopic(v: unknown): v is EvidenceTopic {
  return typeof v === "string" && (EVIDENCE_TOPICS as readonly string[]).includes(v);
}

export async function lookupEvidence(deps: EvidenceDeps, topic: EvidenceTopic, ip: string, state: EvidenceState, deadlineAt: number): Promise<EvidenceResponse> {
  const t = deps.now();
  const cached = state.cache.get(topic);
  const fresh = cached !== undefined && t - cached.at < (cached.degraded ? DEGRADED_CACHE_MS : GOOD_CACHE_MS);
  const asCached = (c: Entry): EvidenceResponse => (c.value.status === "ok" ? { ...c.value, cached: true, cachedNotice: `Cached result from ${new Date(c.at).toISOString()}.` } : c.value);
  if (!deps.config.liveAi) return unavailable("disabled", "Evidence lookup is switched off on this deployment.");
  if (cached && fresh) return asCached(cached);
  const orCached = (r: EvidenceResponse): EvidenceResponse => (cached && cached.value.status === "ok" ? asCached(cached) : r);
  if (!deps.search || !deps.search.query) return orCached(unavailable("no_key", "Evidence lookup is not configured on this deployment."));

  // The same per-client hourly allowance as closure searches (both spend Tavily credits).
  const rl = await deps.limiter.consume(`closures:${ipKey(ip)}`, [{ name: "closures_per_hour", limit: deps.config.ipClosuresPerHour, windowMs: HOUR_MS }]);
  if (rl.error) return orCached(unavailable("protection_unavailable", "Evidence lookup is paused because its safeguards are unavailable."));
  if (!rl.allowed) return orCached(unavailable("rate_limited", "Too many lookups from this connection. Try again later.", rl.retryAfterS));

  const running = state.inflight.get(topic);
  if (running) return running;
  const p = run(deps, topic, t, deadlineAt, cached, state).finally(() => {
    if (state.inflight.get(topic) === p) state.inflight.delete(topic);
  });
  state.inflight.set(topic, p);
  return p;
}

async function run(deps: EvidenceDeps, topic: EvidenceTopic, at: number, deadline: number, stale: Entry | undefined, state: EvidenceState): Promise<EvidenceResponse> {
  const fallbackTo = (r: EvidenceResponse): EvidenceResponse =>
    stale && stale.value.status === "ok" ? { ...stale.value, cached: true, cachedNotice: `Cached result from ${new Date(stale.at).toISOString()}.` } : r;
  // Increment first, then compare: the global daily Tavily allowance is shared with the closure search.
  const capKey = `tavily:${budgetWindow(at, deps.config.budgetResetHourUtc)}`;
  let n: number;
  try {
    n = await deps.store.incrLite(capKey, 1, 2 * DAY_MS);
  } catch (e) {
    if (!(e instanceof StoreError)) throw e;
    logEvent("warn", "protection_unavailable", { where: "evidence_cap" });
    return fallbackTo(unavailable("protection_unavailable", "Evidence lookup is paused because its safeguards are unavailable."));
  }
  if (n > deps.config.tavilyDailyCap) {
    await deps.store.incrLite(capKey, -1, 2 * DAY_MS).catch(() => undefined);
    logEvent("warn", "closures_cap_reached", { route: "evidence" });
    return fallbackTo(unavailable("cap_reached", "The daily search allowance is used up. Try again tomorrow."));
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(1_000, Math.min(15_000, deadline - deps.now() - 5_000)));
  let results: TavilyResult[];
  try {
    results = await (deps.search as Required<SearchClient>).query(EVIDENCE_QUERIES[topic], EVIDENCE_PARAMS, ctl.signal);
  } catch {
    const failed = unavailable("upstream_error", "The evidence search could not be reached.");
    // Remember the failure for two minutes (never over a good older answer, which is served instead).
    if (!(stale && stale.value.status === "ok")) state.cache.set(topic, { at, degraded: true, value: failed });
    return fallbackTo(failed);
  } finally {
    clearTimeout(timer);
  }
  const sources = toEvidenceSources(results);
  const value: OkResponse = {
    status: "ok",
    topic,
    retrievedAt: new Date(at).toISOString(),
    cached: false,
    sources,
    message:
      sources.length === 0
        ? "No news sources were found for this topic. Nothing here has been verified."
        : `${sources.length} news source${sources.length === 1 ? "" : "s"} found. None has been verified: read the source before relying on it.`,
  };
  // An empty answer is treated as degraded (cached for two minutes only), so a bad moment is not remembered for hours.
  state.cache.set(topic, { at, degraded: sources.length === 0, value });
  return value;
}

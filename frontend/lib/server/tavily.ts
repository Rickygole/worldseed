/**
 * Tavily road-closure lookup (server-side only).
 *
 * Fixed query shape (topic news, basic depth, 14 days, 8 results = 1 credit), a cache, a global
 * daily call cap, then Nano extraction, a grounding check (every quote must appear in the result
 * text), a screen for what the quote actually says (a current closure, inside the model area) and
 * deterministic gazetteer matching. Only PROPOSED mutations are returned, every one marked
 * unverified; each carries a single-use confirmation token that the browser can redeem only after
 * an explicit user action (POST /api/closures/confirm).
 *
 * Abuse controls: one in-flight lookup per process (later callers share its result), an atomic
 * increment-then-compare cap on the SharedStore, and a cache on the SharedStore that keeps a
 * degraded result (extraction unavailable) for two minutes only. Nothing from Tavily is written
 * to disk or to the repository. With a shared store configured the cached result (titles, short
 * snippets and quotes) lives in that store for at most 24 hours; without one it lives in process memory.
 */
import type { Catalog } from "../agent/catalog";
import {
  type ClosureProposal,
  type ClosureSource,
  type ClosureUnmatched,
  type ClosuresResponse,
} from "../agent/protocol";
import { ExtractionSchema, toJsonSchema, type ExtractedClosure } from "../agent/tools";
import { runStructured, type AgentDeps } from "./agentService";
import { matchRoad, normalizeForQuote, roadAppearsIn } from "./gazetteerMatch";
import { logEvent } from "./log";
import { MissionLedger } from "./missions";
import { buildExtractMessages, EXTRACT_SCHEMA_NAME } from "./prompts/extract";
import { budgetWindow, DAY_MS, HOUR_MS, ipKey, type RateLimiter } from "./ratelimit";
import { noopEmit } from "./sse";
import { MemoryStore, StoreError, type SharedStore } from "./store";
import type { ServerConfig } from "./config";
import { randomBytes } from "node:crypto";

export const TAVILY_ENDPOINT = "https://api.tavily.com/search";
export const TAVILY_QUERY = "Baltimore Maryland road closure OR bridge closure OR lane closure OR detour";
export const TAVILY_PARAMS = {
  topic: "news",
  search_depth: "basic",
  days: 14,
  max_results: 8,
  include_answer: false,
  include_raw_content: false,
} as const;

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export interface SearchClient {
  search(signal?: AbortSignal): Promise<TavilyResult[]>;
}

export class SearchError extends Error {}

export function createTavilyClient(opts: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }): SearchClient {
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    async search(signal) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
      signal?.addEventListener("abort", () => ctl.abort(), { once: true });
      try {
        const res = await f(TAVILY_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({ query: TAVILY_QUERY, ...TAVILY_PARAMS }),
          signal: ctl.signal,
        });
        if (!res.ok) throw new SearchError(`search failed with status ${res.status}`);
        const data = (await res.json()) as { results?: { title?: unknown; url?: unknown; content?: unknown }[] };
        return (data.results ?? [])
          .filter((r) => typeof r.url === "string" && /^https?:\/\//i.test(r.url as string))
          .slice(0, TAVILY_PARAMS.max_results)
          .map((r) => ({ title: String(r.title ?? "").slice(0, 200), url: r.url as string, content: String(r.content ?? "") }));
      } catch (e) {
        if (e instanceof SearchError) throw e;
        throw new SearchError("search request failed");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/* --------------------------------- pipeline -------------------------------- */

const SNIPPET_CHARS = 240;
const EXTRACT_CHARS_PER_RESULT = 1500;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown source";
  }
}

export interface GroundResult {
  grounded: ExtractedClosure[];
  dropped: number;
}

/** Keeps only closures whose sourceUrl is a real result and whose quote is text from that result. */
export function groundClosures(items: readonly ExtractedClosure[], results: readonly TavilyResult[]): GroundResult {
  const byUrl = new Map(results.map((r) => [r.url, normalizeForQuote(r.content)]));
  const grounded: ExtractedClosure[] = [];
  for (const it of items) {
    const text = byUrl.get(it.sourceUrl);
    const quote = normalizeForQuote(it.quote);
    if (text !== undefined && quote.length >= 12 && text.includes(quote) && roadAppearsIn(it.road, it.quote)) grounded.push(it);
  }
  return { grounded, dropped: items.length - grounded.length };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const cleanDate = (d?: string): string | undefined => (d && ISO_DATE.test(d) ? d : undefined);

/* ------------------------ what a quote actually says ----------------------- */

const CLOSURE_VERB = /\b(?:clos(?:ed|es|ing|ure|ures)|shut(?:\s?down)?|blocked|blocking|barricad\w+|out of service|impassable)\b/i;
const NEGATION = /\b(?:not|no longer|isn't|aren't|wasn't|weren't|hasn't|haven't|never|denied|denies|rumou?rs?|unfounded)\b/i;
const REOPENED = /\b(?:re-?open(?:ed|s|ing)?|lifted|resum(?:ed|es|ing)|cleared)\b/i;
const FUTURE_OR_MODAL =
  /\b(?:could|might|may|would|should|will|plans? to|planning to|planned|expected to|scheduled|proposed|considering|possible|potential|if|sometime|eventually|soon|upcoming|later this|next (?:week|month|year|spring|summer|fall|winter|autumn)|in the (?:spring|summer|fall|winter|autumn))\b/i;
/** A stated current window: the source says when the closure is in effect. */
const CURRENT_WINDOW = /\b(?:through|until|till|currently|remains?|remained|closed since|since|today|tonight|this (?:week|weekend|morning|afternoon|evening)|overnight|right now|ongoing)\b/i;

/** A place name followed by a street type is a street ("Boston Street"), not the city. Either capitalization. */
const STREET_TYPE =
  "(?:" +
  "st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|pkwy|parkway|hwy|highway|way|pl|place|ct|court|bridge|tunnel|pike|square"
    .split("|")
    .map((w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`)
    .join("|") +
  ")";
const OTHER_PLACES =
  "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|West Virginia|Wisconsin|Wyoming|District of Columbia|" +
  "Boston|Philadelphia|Chicago|Houston|Dallas|Atlanta|Miami|Seattle|Denver|Detroit|Pittsburgh|Richmond|Norfolk|Rosslyn|Georgetown|Arlington|Alexandria|Washington|New Haven|Hartford|Newark|Brooklyn|Manhattan|London|Toronto";
const OTHER_PLACE_RE = new RegExp(`\\b(?:${OTHER_PLACES})\\b(?!\\s+${STREET_TYPE}\\b)`);
const OTHER_STATE_ABBR = /,\s*(?!MD\b)(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b|\bD\.?C\.?\b/;
/** A source about this area says so somewhere (the search query names Baltimore, but results can drift). */
const AREA_ANCHOR = /\b(?:Baltimore|Maryland|MD|MDOT|MDTA|Dundalk|Patapsco|Anne Arundel|Fort McHenry)\b/;

/** The sentence of `content` that contains `quote` (normalized), or the quote itself. */
function sentenceAround(content: string, quote: string): string {
  const sentences = content.split(/(?<=[.!?])\s+/);
  const q = normalizeForQuote(quote);
  return sentences.find((x) => normalizeForQuote(x).includes(q)) ?? quote;
}

/**
 * Why a grounded quote is not a usable proposal, or null. The quote must state a closure, must not
 * be negated, reopened, speculative or future without a stated window, and neither it nor its
 * sentence may point at another city or state. The source as a whole must name the model area.
 */
export function screenClosure(
  item: Pick<ExtractedClosure, "quote">,
  result: TavilyResult | undefined,
): Extract<ClosureUnmatched["reason"], "unclear_status" | "not_in_model_area"> | null {
  const sentence = result ? sentenceAround(result.content, item.quote) : item.quote;
  const context = `${item.quote} ${sentence}`;
  if (OTHER_PLACE_RE.test(context) || OTHER_STATE_ABBR.test(context)) return "not_in_model_area";
  if (result && !AREA_ANCHOR.test(`${result.title} ${result.content}`)) return "not_in_model_area";
  if (!CLOSURE_VERB.test(item.quote)) return "unclear_status";
  if (NEGATION.test(context) || REOPENED.test(context)) return "unclear_status";
  if (FUTURE_OR_MODAL.test(context) && !CURRENT_WINDOW.test(context)) return "unclear_status";
  return null;
}

export function matchClosures(
  grounded: readonly ExtractedClosure[],
  catalog: Catalog,
  retrievedAt: string,
  results: readonly TavilyResult[] = [],
): { proposals: ClosureProposal[]; unmatched: ClosureUnmatched[] } {
  const proposals: ClosureProposal[] = [];
  const unmatched: ClosureUnmatched[] = [];
  const seen = new Set<string>();
  const today = retrievedAt.slice(0, 10);
  const byUrl = new Map(results.map((r) => [r.url, r]));
  for (const c of grounded) {
    const base = { road: c.road, quote: c.quote, sourceUrl: c.sourceUrl };
    const why = screenClosure(c, byUrl.get(c.sourceUrl));
    if (why) {
      unmatched.push({ ...base, reason: why });
      continue;
    }
    const endDate = cleanDate(c.endDate);
    if (endDate && endDate < today) {
      unmatched.push({ ...base, reason: "already_ended" });
      continue;
    }
    const startDate = cleanDate(c.startDate);
    if (startDate && startDate > today) {
      unmatched.push({ ...base, reason: "not_yet_started" });
      continue;
    }
    const m = matchRoad(catalog.gazetteer, c.road);
    if (m.status === "none") {
      unmatched.push({ ...base, reason: "not_in_model_area" });
      continue;
    }
    if (m.status === "ambiguous") {
      unmatched.push({ ...base, reason: "ambiguous" });
      continue;
    }
    const { entry } = m;
    let mutation: ClosureProposal["mutation"] | null = null;
    if (entry.ref.link) mutation = { kind: "close_link", linkId: entry.ref.link };
    else if (entry.ref.edges && entry.ref.edges.length > 0) mutation = { kind: "close_edges", edges: entry.ref.edges, label: entry.name };
    if (!mutation) {
      unmatched.push({ ...base, reason: "unsupported_kind" });
      continue;
    }
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    proposals.push({
      id: `closure-${proposals.length + 1}`,
      road: c.road,
      matchedName: entry.name,
      gazetteerId: entry.id,
      mutation,
      provenance: { url: c.sourceUrl, quote: c.quote, retrievedAt },
      verification: "unverified",
      startDate,
      endDate,
    });
  }
  return { proposals, unmatched };
}

export function summarize(proposals: number, unmatched: number, sources: number): string {
  if (proposals > 0) return `${proposals} closure${proposals === 1 ? "" : "s"} found (unverified news reports). Review`;
  if (sources === 0) return "No closures found near the model area in the last 14 days.";
  if (unmatched > 0) return `No closures found inside the model area in the last 14 days. ${unmatched} found elsewhere or unusable, shown below.`;
  return "No closures found near the model area in the last 14 days.";
}

/* -------------------------------- lookup flow ------------------------------ */

export interface ClosuresDeps {
  config: ServerConfig;
  search: SearchClient | null;
  store: SharedStore;
  limiter: RateLimiter;
  agent: AgentDeps;
  now: () => number;
}

/** Process-local single flight: concurrent callers wait for one lookup instead of starting their own. */
export interface ClosuresState {
  inflight: Promise<ClosuresResponse> | null;
}

type OkResponse = Extract<ClosuresResponse, { status: "ok" }>;
interface CacheEntry {
  at: number;
  /** True when extraction failed: only a short cache. */
  degraded: boolean;
  value: OkResponse;
}

const CACHE_KEY = "tavily:cache";
const CONFIRM_TTL_MS = 30 * 60_000;
const STALE_KEEP_MS = DAY_MS;

async function readCache(store: SharedStore): Promise<CacheEntry | null> {
  const raw = await store.get(CACHE_KEY);
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as CacheEntry;
    return e && typeof e.at === "number" && e.value?.status === "ok" ? e : null;
  } catch {
    return null;
  }
}

const fresh = (deps: ClosuresDeps, c: CacheEntry, t: number): boolean =>
  t - c.at < (c.degraded ? deps.config.tavilyDegradedCacheMs : deps.config.tavilyCacheMs);

/** Fresh single-use confirmation tokens for a response's proposals. A store failure just omits them. */
async function withTokens(store: SharedStore, value: OkResponse): Promise<OkResponse> {
  try {
    const proposals = await Promise.all(
      value.proposals.map(async (p) => {
        const token = randomBytes(16).toString("hex");
        const { confirmToken: _drop, ...bare } = p;
        void _drop;
        await store.set(`cf:${token}`, JSON.stringify(bare), CONFIRM_TTL_MS);
        return { ...bare, confirmToken: token };
      }),
    );
    return { ...value, proposals };
  } catch (e) {
    if (!(e instanceof StoreError)) throw e;
    logEvent("warn", "protection_unavailable", { where: "confirm_tokens" });
    return { ...value, proposals: value.proposals.map(({ confirmToken: _t, ...p }) => (void _t, p)) };
  }
}

const stripTokens = (v: OkResponse): OkResponse => ({ ...v, proposals: v.proposals.map(({ confirmToken: _t, ...p }) => (void _t, p)) });

/**
 * Runs the closure lookup. Cheap paths (fresh cache, per-IP limit) come first; the expensive part
 * runs at most once at a time per process, and never more than the daily cap allows.
 */
export async function lookupClosures(deps: ClosuresDeps, ip: string, state: ClosuresState, deadlineAt: number): Promise<ClosuresResponse> {
  const r = await lookupBare(deps, ip, state, deadlineAt);
  // Tokens are issued per response, never shared between callers of one in-flight lookup or a cache entry.
  return r.status === "ok" ? withTokens(deps.store, r) : r;
}

async function lookupBare(deps: ClosuresDeps, ip: string, state: ClosuresState, deadlineAt: number): Promise<ClosuresResponse> {
  const t = deps.now();
  const asCached = async (c: CacheEntry, label: string): Promise<ClosuresResponse> => ({
    ...c.value,
    cached: true,
    cachedNotice: `${label} from ${new Date(c.at).toISOString()}.`,
  });
  const unavailable = (reason: Extract<ClosuresResponse, { status: "unavailable" }>["reason"], message: string, retryAfterS?: number): ClosuresResponse => ({
    status: "unavailable",
    reason,
    message,
    ...(retryAfterS !== undefined ? { retryAfterS } : {}),
  });

  if (!deps.config.liveAi) {
    logEvent("warn", "kill_switch", { route: "closures" });
    return unavailable("disabled", "Closure search is switched off on this deployment.");
  }

  let cached: CacheEntry | null;
  try {
    cached = await readCache(deps.store);
  } catch (e) {
    if (!(e instanceof StoreError)) throw e;
    logEvent("warn", "protection_unavailable", { where: "closures_cache" });
    return unavailable("protection_unavailable", "Closure search is paused because its safeguards are unavailable.");
  }
  if (cached && fresh(deps, cached, t)) return asCached(cached, "Cached result");
  const orCached = async (fallbackResponse: ClosuresResponse) => (cached ? asCached(cached, "Cached result") : fallbackResponse);
  if (!deps.search) return orCached(unavailable("no_key", "Closure search is not configured on this deployment."));

  const rl = await deps.limiter.consume(`closures:${ipKey(ip)}`, [{ name: "closures_per_hour", limit: deps.config.ipClosuresPerHour, windowMs: HOUR_MS }]);
  if (rl.error) return orCached(unavailable("protection_unavailable", "Closure search is paused because its safeguards are unavailable."));
  if (!rl.allowed) return orCached(unavailable("rate_limited", "Too many closure searches from this connection. Try again later.", rl.retryAfterS));

  if (state.inflight) return state.inflight;
  const p = runLookup(deps, t, deadlineAt, cached).finally(() => {
    if (state.inflight === p) state.inflight = null;
  });
  state.inflight = p;
  return p;

  async function runLookup(d: ClosuresDeps, at: number, deadline: number, stale: CacheEntry | null): Promise<ClosuresResponse> {
    const fallbackTo = async (r: ClosuresResponse): Promise<ClosuresResponse> => (stale ? asCached(stale, "Cached result") : r);
    // Increment first, then compare the returned value: concurrent requests cannot all pass a check.
    const capKey = `tavily:${budgetWindow(at, d.config.budgetResetHourUtc)}`;
    let n: number;
    try {
      n = (await d.store.incr(capKey, 1, 2 * DAY_MS)).value;
    } catch (e) {
      if (!(e instanceof StoreError)) throw e;
      logEvent("warn", "protection_unavailable", { where: "closures_cap" });
      return fallbackTo(unavailable("protection_unavailable", "Closure search is paused because its safeguards are unavailable."));
    }
    if (n > d.config.tavilyDailyCap) {
      await d.store.incr(capKey, -1, 2 * DAY_MS).catch(() => undefined);
      logEvent("warn", "closures_cap_reached", {});
      return fallbackTo(unavailable("cap_reached", "The daily closure-search allowance is used up. Try again tomorrow."));
    }

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(1_000, Math.min(15_000, deadline - d.now() - 20_000)));
    let results: TavilyResult[];
    try {
      results = await (d.search as SearchClient).search(ctl.signal);
    } catch {
      return fallbackTo(unavailable("upstream_error", "The closure search could not be reached."));
    } finally {
      clearTimeout(timer);
    }

    let catalog: Catalog;
    try {
      catalog = await d.agent.loadCatalog();
    } catch {
      return unavailable("catalog_unavailable", "The model-area gazetteer is not available.");
    }

    const retrievedAt = new Date(at).toISOString();
    const sources: ClosureSource[] = results.map((r) => ({
      title: r.title,
      source: hostOf(r.url),
      url: r.url,
      snippet: r.content.replace(/\s+/g, " ").trim().slice(0, SNIPPET_CHARS),
    }));

    let proposals: ClosureProposal[] = [];
    let unmatched: ClosureUnmatched[] = [];
    let dropped = 0;
    let model: string | undefined;
    let note = "";
    let degraded = false;

    if (results.length > 0) {
      const jsonSchema = toJsonSchema(ExtractionSchema);
      // Extraction is one bounded call sequence with its own small budget, charged to the daily ledger too.
      const account = {
        ledger: new MissionLedger(new MemoryStore(d.now)),
        id: "closures",
        caps: { inputTokens: 20_000, outputTokens: 4_000, maxCalls: 3 },
      };
      const out = await runStructured({
        deps: d.agent,
        emit: noopEmit,
        account,
        role: "extractor",
        toolName: "extract_closures",
        schemaName: EXTRACT_SCHEMA_NAME,
        jsonSchema,
        messages: buildExtractMessages(
          results.map((r) => ({ url: r.url, title: r.title, content: r.content.slice(0, EXTRACT_CHARS_PER_RESULT) })),
          jsonSchema,
        ),
        maxOut: 1500,
        deadlineAt: deadline,
        validate: (raw) => {
          const parsed = ExtractionSchema.safeParse(raw);
          return parsed.success
            ? { ok: true, value: parsed.data }
            : { ok: false, violations: parsed.error.issues.slice(0, 8).map((i) => ({ rule: 1 as const, code: "schema", path: i.path.join("."), message: "does not match the extraction schema" })) };
        },
      });
      if (out.status === "ok") {
        model = out.model;
        const g = groundClosures((out.result as { closures: ExtractedClosure[] }).closures, results);
        dropped = g.dropped;
        ({ proposals, unmatched } = matchClosures(g.grounded, catalog, retrievedAt, results));
      } else {
        degraded = true;
        note = ` Closure extraction was unavailable (${out.reason}); source links are shown without extracted closures.`;
      }
    }

    const value: OkResponse = {
      status: "ok",
      retrievedAt,
      cached: false,
      sources,
      proposals,
      unmatched,
      ungroundedDropped: dropped,
      message: summarize(proposals.length, unmatched.length, sources.length) + note,
      model,
    };
    // Only a lookup whose extraction worked is cached for the full window; a degraded one for ~2 minutes.
    try {
      await d.store.set(CACHE_KEY, JSON.stringify({ at, degraded, value: stripTokens(value) } satisfies CacheEntry), STALE_KEEP_MS);
    } catch (e) {
      if (!(e instanceof StoreError)) throw e;
      logEvent("warn", "protection_unavailable", { where: "closures_cache_write" });
    }
    return stripTokens(value);
  }
}

/* ------------------------------- confirmation ------------------------------ */

export type ConfirmOutcome =
  | { status: "ok"; record: import("../agent/protocol").ConfirmedClosureRecord }
  | { status: "invalid_or_used" }
  | { status: "store_error" };

/**
 * Redeems a confirmation token. GETDEL makes it single use even under a race: exactly one caller
 * gets the proposal, everyone else (and every replay) gets nothing. The mutation, label and
 * provenance come from what the SERVER proposed, never from the caller.
 */
export async function redeemConfirmation(store: SharedStore, token: string, nowMs: number): Promise<ConfirmOutcome> {
  let raw: string | null;
  try {
    raw = await store.take(`cf:${token}`);
  } catch (e) {
    if (!(e instanceof StoreError)) throw e;
    return { status: "store_error" };
  }
  if (!raw) return { status: "invalid_or_used" };
  let p: ClosureProposal;
  try {
    p = JSON.parse(raw) as ClosureProposal;
  } catch {
    return { status: "invalid_or_used" };
  }
  return {
    status: "ok",
    record: {
      id: `tavily-${p.gazetteerId}-${randomBytes(4).toString("hex")}`,
      m: p.mutation,
      origin: "tavily",
      label: `${p.matchedName} (unverified news report)`,
      provenance: p.provenance,
      confirmedAt: new Date(nowMs).toISOString(),
    },
  };
}

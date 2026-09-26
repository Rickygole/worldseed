/**
 * Tavily road-closure lookup (server-side only).
 *
 * Fixed query shape (topic news, basic depth, 14 days, 8 results = 1 credit), 6 h in-memory cache,
 * global daily call cap, then Nano extraction, a grounding check (every quote must appear in the
 * result text) and deterministic gazetteer matching. Only PROPOSED mutations are returned; the UI
 * must obtain the user's confirmation before anything enters the world.
 *
 * Nothing from Tavily is written to disk or to the repository: results live in process memory
 * for the cache window only.
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
import { buildExtractMessages, EXTRACT_SCHEMA_NAME } from "./prompts/extract";
import { DAY_MS, utcDay, type CounterStore, type MissionRecord, type RateLimiter } from "./ratelimit";
import { noopEmit } from "./sse";
import type { ServerConfig } from "./config";

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

export function matchClosures(
  grounded: readonly ExtractedClosure[],
  catalog: Catalog,
  retrievedAt: string,
): { proposals: ClosureProposal[]; unmatched: ClosureUnmatched[] } {
  const proposals: ClosureProposal[] = [];
  const unmatched: ClosureUnmatched[] = [];
  const seen = new Set<string>();
  const today = retrievedAt.slice(0, 10);
  for (const c of grounded) {
    const base = { road: c.road, quote: c.quote, sourceUrl: c.sourceUrl };
    const endDate = cleanDate(c.endDate);
    if (endDate && endDate < today) {
      unmatched.push({ ...base, reason: "already_ended" });
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
      startDate: cleanDate(c.startDate),
      endDate,
    });
  }
  return { proposals, unmatched };
}

export function summarize(proposals: number, unmatched: number, sources: number): string {
  if (proposals > 0) return `${proposals} closure${proposals === 1 ? "" : "s"} found. Review`;
  if (sources === 0) return "No closures found near the model area in the last 14 days.";
  if (unmatched > 0) return `No closures found inside the model area in the last 14 days. ${unmatched} found elsewhere or unusable, shown below.`;
  return "No closures found near the model area in the last 14 days.";
}

export interface ClosuresDeps {
  config: ServerConfig;
  search: SearchClient | null;
  counters: CounterStore;
  limiter: RateLimiter;
  agent: AgentDeps;
  now: () => number;
}

export interface ClosuresCache {
  cache: { at: number; value: Extract<ClosuresResponse, { status: "ok" }> } | null;
}

/** Runs the closure lookup. `state.cache` is held by the caller so it survives across requests. */
export async function lookupClosures(deps: ClosuresDeps, ip: string, state: ClosuresCache): Promise<ClosuresResponse> {
  const t = deps.now();
  const cached = state.cache;
  const asCached = (label: string): ClosuresResponse => ({
    ...(cached as NonNullable<typeof cached>).value,
    cached: true,
    cachedNotice: `${label} from ${new Date((cached as NonNullable<typeof cached>).at).toISOString()}.`,
  });

  if (cached && t - cached.at < deps.config.tavilyCacheMs) return asCached("Cached result");
  if (!deps.search) {
    return cached ? asCached("Cached result") : { status: "unavailable", reason: "no_key", message: "Closure search is not configured on this deployment." };
  }

  const rl = await deps.limiter.consume(`closures:${ip}`, [{ name: "closures_per_hour", limit: deps.config.ipClosuresPerHour, windowMs: 3600_000 }]);
  if (!rl.allowed) {
    if (cached) return asCached("Cached result");
    return { status: "unavailable", reason: "rate_limited", message: "Too many closure searches from this connection. Try again later.", retryAfterS: rl.retryAfterS };
  }

  const capKey = `tavily:${utcDay(t)}`;
  if ((await deps.counters.get(capKey)) >= deps.config.tavilyDailyCap) {
    if (cached) return asCached("Cached result");
    return { status: "unavailable", reason: "cap_reached", message: "The daily closure-search allowance is used up. Try again tomorrow." };
  }
  await deps.counters.add(capKey, 1, 2 * DAY_MS);

  let results: TavilyResult[];
  try {
    results = await deps.search.search();
  } catch {
    if (cached) return asCached("Cached result");
    return { status: "unavailable", reason: "upstream_error", message: "The closure search could not be reached." };
  }

  let catalog: Catalog;
  try {
    catalog = await deps.agent.loadCatalog();
  } catch {
    return { status: "unavailable", reason: "catalog_unavailable", message: "The model-area gazetteer is not available." };
  }

  const retrievedAt = new Date(t).toISOString();
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

  if (results.length > 0) {
    const jsonSchema = toJsonSchema(ExtractionSchema);
    const rec: MissionRecord = { id: "closures", ip, createdAt: t, inputTokens: 0, outputTokens: 0, turns: new Set() };
    const limited = { ...deps.agent, config: { ...deps.agent.config, missionInputTokens: 20_000, missionOutputTokens: 4_000 } };
    const out = await runStructured({
      deps: limited,
      emit: noopEmit,
      rec,
      role: "extractor",
      toolName: "extract_closures",
      schemaName: EXTRACT_SCHEMA_NAME,
      jsonSchema,
      messages: buildExtractMessages(
        results.map((r) => ({ url: r.url, title: r.title, content: r.content.slice(0, EXTRACT_CHARS_PER_RESULT) })),
        jsonSchema,
      ),
      maxOut: 1500,
      deadlineAt: deps.now() + deps.config.routeDeadlineMs,
      validate: (raw) => {
        const p = ExtractionSchema.safeParse(raw);
        return p.success
          ? { ok: true, value: p.data }
          : { ok: false, violations: p.error.issues.slice(0, 8).map((i) => ({ rule: 1 as const, code: "schema", path: i.path.join("."), message: i.message })) };
      },
    });
    if (out.status === "ok") {
      model = out.model;
      const g = groundClosures(out.result.closures, results);
      dropped = g.dropped;
      ({ proposals, unmatched } = matchClosures(g.grounded, catalog, retrievedAt));
    } else {
      note = ` Closure extraction was unavailable (${out.reason}); source links are shown without extracted closures.`;
    }
  }

  const value: Extract<ClosuresResponse, { status: "ok" }> = {
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
  state.cache = { at: t, value };
  return value;
}


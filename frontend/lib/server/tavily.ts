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
 * increment-then-compare cap on the SharedStore (a counter only), and a results cache that keeps
 * a degraded result (extraction unavailable) for two minutes only. Tavily results (titles,
 * snippets, quotes) live in this process's memory ONLY: they are never written to the shared
 * store, to disk or to the repository, and a new process starts with an empty cache.
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
import { isCommonStreetName, matchRoad, normalizeForQuote, normalizeName, roadAppearsIn } from "./gazetteerMatch";
import { logEvent } from "./log";
import { MissionLedger } from "./missions";
import { buildExtractMessages, EXTRACT_SCHEMA_NAME } from "./prompts/extract";
import { budgetWindow, DAY_MS, HOUR_MS, ipKey, type RateLimiter } from "./ratelimit";
import { noopEmit } from "./sse";
import { MemoryStore, StoreError, type SharedStore } from "./store";
import type { ServerConfig } from "./config";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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
  /** As reported by the search API (news results); validated where it is used. */
  publishedDate?: string;
}

/** Parameters of a caller-supplied query (evidence lookups). Fixed by the server, never by a client. */
export interface QueryParams {
  topic: "news";
  search_depth: "basic";
  max_results: number;
  days?: number;
  include_answer: false;
  include_raw_content: false;
}

export interface SearchClient {
  /** The fixed closure-search query. */
  search(signal?: AbortSignal): Promise<TavilyResult[]>;
  /** A server-built query with its own parameters (the evidence route). Absent on clients that only do closure search. */
  query?(query: string, params: QueryParams, signal?: AbortSignal): Promise<TavilyResult[]>;
}

export class SearchError extends Error {}

export function createTavilyClient(opts: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }): SearchClient {
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  async function run(query: string, params: object, max: number, signal?: AbortSignal): Promise<TavilyResult[]> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
    signal?.addEventListener("abort", () => ctl.abort(), { once: true });
    try {
      const res = await f(TAVILY_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({ query, ...params }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new SearchError(`search failed with status ${res.status}`);
      const data = (await res.json()) as { results?: { title?: unknown; url?: unknown; content?: unknown; published_date?: unknown }[] };
      return (data.results ?? [])
        .filter((r) => typeof r.url === "string" && /^https?:\/\//i.test(r.url as string))
        .slice(0, max)
        .map((r) => ({
          title: String(r.title ?? "").slice(0, 200),
          url: r.url as string,
          content: String(r.content ?? ""),
          ...(typeof r.published_date === "string" ? { publishedDate: r.published_date.slice(0, 40) } : {}),
        }));
    } catch (e) {
      if (e instanceof SearchError) throw e;
      throw new SearchError("search request failed");
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    search: (signal) => run(TAVILY_QUERY, TAVILY_PARAMS, TAVILY_PARAMS.max_results, signal),
    query: (query, params, signal) => run(query, params, params.max_results, signal),
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

const CLOSURE_VERB = /\b(?:clos(?:ed|es|ing|ure|ures)|close(?!\s+(?:to|by|call|friends?|contact|together|up|out)\b)|shut(?:\s?down)?|shuts|blocked|blocking|barricad\w+|out of service|impassable)\b/i;
const NEGATION = /\b(?:not|no longer|isn't|aren't|wasn't|weren't|hasn't|haven't|never|denied|denies|rumou?rs?|unfounded)\b/i;
const REOPENED = /\b(?:re-?open(?:ed|s|ing)?|lifted|resum(?:ed|es|ing)|cleared)\b/i;
const WEEKDAY = "(?:mon|tues|wednes|thurs|fri|satur|sun)day";
const MONTH = "(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
/**
 * Speculation: the closure is a possibility, a prediction or a plan that is not fixed. No stated
 * window rescues these. ("may" is matched lower-case only, so the month May is not a modal.)
 */
const SPECULATIVE =
  /\b(?:could|might|would|should|plans? to|planning to|considering|proposed|possible|possibly|potential|if|unless|expected to|likely to|sometime|eventually|soon|upcoming|later this|next (?:week|month|year|spring|summer|fall|winter|autumn)|in the (?:spring|summer|fall|winter|autumn))\b|\bmay\b/;
/** A scheduled or announced closure: usable only together with a stated window. */
const SCHEDULED = /\b(?:will|scheduled|planned|slated|set to|to close)\b/i;
/** A stated window: the source says when the closure is in effect (a day, a date, "tonight", "through Friday"). */
const CURRENT_WINDOW = new RegExp(
  `\\b(?:through|thru|until|till|currently|remains?|remained|closed since|since|today|tonight|tomorrow|this (?:week|weekend|morning|afternoon|evening)|the weekend|weekend|overnight|right now|ongoing|further notice|${WEEKDAY}s?|${MONTH}\\s+\\d{1,2}|\\d{1,2}/\\d{1,2})\\b`,
  "i",
);

/**
 * Closing part of a facility is not closing the facility: a whole-link or whole-road mutation may
 * only be proposed for a closure that is stated as the whole thing. Phrases that state the whole
 * thing ("all lanes", "both directions", "northbound and southbound", "to traffic") are removed
 * first, so they do not trip the partial patterns below.
 */
const WHOLE_CLOSURE =
  /\b(?:all|both|every) (?:travel |traffic )?lanes\b|\b(?:in |to )?both directions\b|\b(?:northbound and southbound|southbound and northbound|eastbound and westbound|westbound and eastbound)\b|\b(?:to )?all (?:traffic|vehicles|directions)\b|\bto traffic\b|\bno traffic\b/gi;
const PARTIAL_CLOSURE =
  /\b(?:lanes?|bores?|ramps?|shoulders?|trucks?|hazmat|hazardous|one direction|one way|northbound|southbound|eastbound|westbound|inbound|outbound|[A-Za-z]+-bound|single[- ]lane|left lane|right lane|center lane|express lanes?|carpool|hov|partial(?:ly)?|intermittent(?:ly)?|alternating|one side|(?:most|some|local|through|commercial|heavy|oversize\w*) (?:traffic|vehicles|drivers)|non-\w+ traffic|except|open to|cars may)\b/i;
/** A completed or past event, or an article about a reopening. */
const PAST_EVENT =
  /\b(?:was|were|had been|briefly|temporarily closed|earlier|yesterday|last (?:night|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday) (?:morning|afternoon|evening|night)|previously|formerly|after (?:a|the) (?:crash|collision|accident))\b/i;
/** The closure is stated as a present state ("is closed", "remains closed", "has closed"). */
const PRESENT_STATE = /\b(?:is|are|remains?|stays?|has been|have been|has|have|will be|is being|are being)\s+(?:\w+\s+){0,2}?(?:closed|shut(?: down)?)\b/i;
/** Words that make a following "closed" a passive or perfect form rather than an active past action. */
const AUX = new Set(["is", "are", "was", "were", "be", "been", "being", "remains", "remain", "remained", "stays", "has", "have", "had", "will", "to", "and", "or", "not"]);
/** How long: an event that ran for a stated time is over. */
const DURATION = /\bfor (?:about |roughly |nearly |almost )?(?:\d+|an?|one|two|three|four|five|six|several|a few|many) (?:hours?|minutes?|days?)\b/i;
/** Studies, models, drills and other things that are not a real closure (nouns only: crews that "drill" or a plan "modeled on" last year are not one). */
const HYPOTHETICAL =
  /\b(?:(?:a|the|this|that|new|recent|one)\s+(?:\w+\s+){0,3}stud(?:y|ies)|stud(?:y|ies)\s+(?:of|found|shows?|suggests?|modeled|modelled)|studied|(?:mock|tabletop|fire|emergency|evacuation|training|a|the)\s+(?:drills?|exercises?)|drill scenario|tabletop|simulat\w+|scenario planning|what[- ]if|what happens|hypothetical\w*|rehearsal|test run|(?:a|the|this)\s+analysis|models? (?:show|predict|suggest|indicate)|modell?ed (?:what|how|the effect|the impact)|projected)\b/i;
/** Comment threads, hearsay and text that tries to instruct the extractor. */
const HEARSAY =
  /\b(?:comments?|commented|wrote|posted|user\d*|readers?|respond(?:s|ed)?|reportedly|allegedly|apparently|i heard|heard that|trust me|people say|word is|tweet\w*|rumou?rs?|unconfirmed)\b|\bsystem note\b|\bextractor\b|ignore (?:all )?(?:previous|prior|the above)|\binstructions?\b|\breport (?:this|the following)\b|\b[A-Z][a-z]+ (?:from|of|in) [A-Z][a-z]+:/;

/** True when the text has an ACTIVE past "closed" ("police closed the road"), not a passive or perfect one ("was closed", "has closed"). */
function hasActivePastClosed(text: string): boolean {
  const words = text.toLowerCase().split(/[^a-z']+/).filter(Boolean);
  return words.some((w, i) => (w === "closed" || w === "shut") && !AUX.has(words[i - 1] ?? "") && !AUX.has(words[i - 2] ?? ""));
}

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
  "Boston|Philadelphia|Chicago|Houston|Dallas|Atlanta|Miami|Seattle|Denver|Detroit|Pittsburgh|Richmond|Norfolk|Rosslyn|Georgetown|Arlington|Alexandria|Washington|New Haven|Hartford|Newark|Brooklyn|Manhattan|London|Toronto|Potomac|Capitol|Springfield|Annapolis Junction";
/** Full state names, matched in any capitalization ("ohio" in a lower-case headline is still Ohio). A street type after the name makes it a street. */
const STATE_NAMES = new RegExp(
  `\\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|west virginia|wisconsin|wyoming|district of columbia)\\b(?!\\s+${STREET_TYPE}\\b)`,
  "i",
);
const OTHER_PLACE_G = new RegExp(`\\b(?:${OTHER_PLACES})\\b(?!\\s+${STREET_TYPE}\\b)`, "g");
const OTHER_STATE_ABBR = /,\s*(?!MD\b)(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b|\bD\.?C\.?\b/;
/** The area, named in the quote's OWN sentence. */
const AREA_ANCHOR = /\b(?:Baltimore|Maryland|MD|MDOT|MDTA|Dundalk|Patapsco|Anne Arundel|Fort McHenry|Curtis Bay|Hawkins Point|Sparrows Point|Edgemere|Essex|Cherry Hill|Brooklyn Park)\b/;
/** Names shared with places elsewhere: the sentence must carry a Baltimore-specific landmark word. */
const SHARED_NAME_LANDMARKS: [RegExp, RegExp][] = [[/\bkey bridge\b/i, /\b(?:francis scott|baltimore|patapsco|dundalk|curtis bay|i-?695|beltway|mdta|fort carroll)\b/i]];

/** The sentence of `content` that contains `quote` (normalized), or the quote itself. */
function sentenceAround(content: string, quote: string): string {
  const sentences = content.split(/(?<=[.!?])\s+/);
  const q = normalizeForQuote(quote);
  return sentences.find((x) => normalizeForQuote(x).includes(q)) ?? quote;
}

/** Lowercase names of the gazetteer's neighborhoods: places that are part of the model area. */
export function ownPlaceNames(catalog: Pick<Catalog, "gazetteer">): Set<string> {
  const out = new Set<string>();
  for (const e of catalog.gazetteer) if (e.kind === "neighborhood") for (const n of [e.name, ...e.aliases]) out.add(n.toLowerCase());
  return out;
}

export type ScreenReason = "unclear_status" | "not_in_model_area" | "partial_closure" | "completed_event" | "hypothetical_scenario" | "hearsay";

/** Neighborhoods distinctive enough that naming one in the quote's own sentence anchors it to the model area. */
const STRONG_LOCAL = new Set([
  "canton", "highlandtown", "fells point", "fell's point", "federal hill", "locust point", "hampden", "pigtown", "washington village/pigtown",
  "bolton hill", "remington", "sowebo", "greektown", "otterbein", "inner harbor", "port covington", "turner station", "glen burnie", "linthicum",
  "lansdowne", "halethorpe", "arbutus", "catonsville", "middle river", "harbor point", "hollins market", "patterson park",
]);
const escapeRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Why a grounded quote is not a usable proposal, or null. The quote must state a whole, current
 * closure: not partial (a lane, a bore, trucks only), not past or reopened, not a study or drill,
 * not hearsay, not negated or speculative, and a scheduled closure only with a stated window. The
 * area must be named in the quote's own sentence, and neither the quote nor its sentence may point
 * at another city or state (a city that is itself one of the gazetteer's neighborhoods, like
 * Brooklyn, is not "another city").
 */
export function screenClosure(item: Pick<ExtractedClosure, "quote">, result: TavilyResult | undefined, ownPlaces: ReadonlySet<string> = new Set()): ScreenReason | null {
  const sentence = result ? sentenceAround(result.content, item.quote) : item.quote;
  const context = `${item.quote} ${sentence}`;
  const article = result ? `${result.title} ${result.content}` : context;

  const others = [...context.matchAll(OTHER_PLACE_G)].map((m) => m[0]).filter((p) => !ownPlaces.has(p.toLowerCase()));
  if (others.length > 0 || OTHER_STATE_ABBR.test(context) || STATE_NAMES.test(context)) return "not_in_model_area";
  const ownNames = [...ownPlaces].filter((p) => p.length > 3 && new RegExp(`\\b${escapeRe(p)}\\b`, "i").test(context));
  const ownHere = ownNames.length > 0;
  const strongHere = ownNames.some((p) => STRONG_LOCAL.has(p));
  // Anchor: the area named in the quote's own sentence, or a distinctive neighborhood there, or one of its neighborhoods there plus the area named somewhere in the article.
  if (!AREA_ANCHOR.test(context) && !strongHere && !(ownHere && AREA_ANCHOR.test(article))) return "not_in_model_area";
  for (const [name, landmark] of SHARED_NAME_LANDMARKS) if (name.test(context) && !landmark.test(context)) return "not_in_model_area";

  if (HEARSAY.test(context)) return "hearsay";
  if (HYPOTHETICAL.test(context)) return "hypothetical_scenario";
  if (!CLOSURE_VERB.test(item.quote)) return "unclear_status";
  if (PARTIAL_CLOSURE.test(context.replace(WHOLE_CLOSURE, " "))) return "partial_closure";
  if (NEGATION.test(context) || REOPENED.test(context)) return "unclear_status";
  const present = PRESENT_STATE.test(context);
  if (!present) {
    if (PAST_EVENT.test(context)) return "completed_event";
    // An active past action with a day name or a duration ("police closed the tunnel for two hours Tuesday") is over.
    if (hasActivePastClosed(context) && (new RegExp(`\\b${WEEKDAY}\\b`, "i").test(context) || DURATION.test(context))) return "completed_event";
  }
  if (SPECULATIVE.test(context)) return "unclear_status";
  if (SCHEDULED.test(context) && !CURRENT_WINDOW.test(context)) return "unclear_status";
  return null;
}

export interface ClosureConfidence {
  level: "high" | "low";
  /** Why a reader should check the source before confirming (present when level is "low"). */
  hint?: string;
}

/**
 * How firmly the quote states a current, whole closure. "high" needs a declarative statement ("is
 * closed", "remains closed", "has closed", "will close ... tonight") that also gives a window or a
 * cause. Anything less (a headline fragment such as "closed indefinitely, MDTA says", an active
 * past action, a closure only announced) is "low": the proposal is still shown, but the UI must
 * tell the reader to read the source first. It is a hint about wording, not a verdict on the facts.
 */
export function closureConfidence(item: Pick<ExtractedClosure, "quote">, result: TavilyResult | undefined): ClosureConfidence {
  const sentence = result ? sentenceAround(result.content, item.quote) : item.quote;
  const context = `${item.quote} ${sentence}`;
  const declarative = PRESENT_STATE.test(context) || /\b(?:will|to)\s+(?:be\s+)?(?:close|closed|shut)\b/i.test(context);
  const scheduledOnly = SCHEDULED.test(context) && !PRESENT_STATE.test(context);
  const grounded = CURRENT_WINDOW.test(context) || /\b(?:for|due to|after|because|as part of|while|following)\b/i.test(context);
  if (declarative && grounded && !scheduledOnly) return { level: "high" };
  if (scheduledOnly && declarative && grounded) return { level: "low", hint: "The source describes a closure that is scheduled, not one already in effect. Read it before confirming." };
  if (!declarative) return { level: "low", hint: "The quote is worded as a headline fragment or a past action, not a statement that the road is closed now. Read the source before confirming." };
  return { level: "low", hint: "The quote gives no time window or reason. Read the source before confirming." };
}

/** A road name as displayed: plain characters only. Anything else (markup, brackets, links) is replaced. */
export const UNREADABLE_ROAD = "(unreadable road name)";
export function safeRoadText(road: string): string {
  const t = road.replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= 80 && /^[A-Za-z0-9 .,'&\-]+$/.test(t) && !/https?|www\./i.test(t) ? t : UNREADABLE_ROAD;
}

/** The mutation a gazetteer entry stands for, or null when it cannot be closed (a neighborhood, a corridor). */
export function mutationFor(entry: Pick<Catalog["gazetteer"][number], "name" | "ref">): ClosureProposal["mutation"] | null {
  if (entry.ref.link) return { kind: "close_link", linkId: entry.ref.link };
  if (entry.ref.edges && entry.ref.edges.length > 0) return { kind: "close_edges", edges: entry.ref.edges, label: entry.name };
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
  const places = ownPlaceNames(catalog);
  for (const c of grounded) {
    const base = { road: safeRoadText(c.road), quote: c.quote, sourceUrl: c.sourceUrl };
    const why = screenClosure(c, byUrl.get(c.sourceUrl), places);
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
    let entry;
    let tieBreak = false;
    if (m.status === "ambiguous") {
      // Several entries share the name. When exactly one of them can be closed (the others are a
      // corridor or a neighborhood, which have no closure), that one is proposed, with a low-confidence
      // flag. A name that exists in every town ("Main Street") is never resolved this way.
      const closable = m.entries.filter((e) => mutationFor(e) !== null);
      if (closable.length === 1 && !isCommonStreetName(normalizeName(c.road))) {
        entry = closable[0];
        tieBreak = true;
      } else {
        unmatched.push({ ...base, reason: "ambiguous" });
        continue;
      }
    } else entry = m.entry;
    const mutation = mutationFor(entry);
    if (!mutation) {
      unmatched.push({ ...base, reason: "unsupported_kind" });
      continue;
    }
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const conf = closureConfidence(c, byUrl.get(c.sourceUrl));
    if (tieBreak) {
      conf.level = "low";
      conf.hint = "The article's road name fits more than one model-area entry; this is the one that can be closed. Confirm it is the intended road, and read the source first.";
    }
    proposals.push({
      id: `closure-${proposals.length + 1}`,
      road: base.road,
      matchedName: entry.name,
      gazetteerId: entry.id,
      mutation,
      provenance: { url: c.sourceUrl, quote: c.quote, retrievedAt },
      verification: "unverified",
      confidence: conf.level,
      ...(conf.hint ? { reviewHint: conf.hint } : {}),
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
  /** Signs stateless confirmation tokens. */
  confirmSecret: string;
}

type OkResponse = Extract<ClosuresResponse, { status: "ok" }>;
interface CacheEntry {
  at: number;
  /** True when extraction failed: only a short cache. */
  degraded: boolean;
  value: OkResponse;
}

/**
 * Process-local state: one in-flight lookup (concurrent callers wait for it instead of starting
 * their own) and the results cache. The cache holds Tavily content, so it stays in process memory:
 * the shared store never receives it.
 */
export interface ClosuresState {
  inflight: Promise<ClosuresResponse> | null;
  cache: CacheEntry | null;
}

const CONFIRM_TTL_MS = 30 * 60_000;

const fresh = (deps: ClosuresDeps, c: CacheEntry, t: number): boolean =>
  t - c.at < (c.degraded ? deps.config.tavilyDegradedCacheMs : deps.config.tavilyCacheMs);

const stripTokens = (v: OkResponse): OkResponse => ({ ...v, proposals: v.proposals.map(({ confirmToken: _t, ...p }) => (void _t, p)) });

/* ------------------------- stateless confirmation tokens ------------------------- */

/**
 * What a token signs: the proposal id, the gazetteer id and the provenance, and nothing else. The
 * mutation (which links or edges to close) is NOT in the token: it is looked up from the server's
 * own gazetteer when the token is redeemed, so token size no longer depends on how many edges a
 * road has (the Beltway has 334) and the client can never influence the mutation.
 */
interface ConfirmPayload {
  p: Pick<ClosureProposal, "id" | "gazetteerId" | "provenance">;
  /** Hashed key of the requester (browser session, else address bucket) the token was issued to. */
  c: string;
  /** Expiry, epoch ms. */
  x: number;
  /** Random token id: the single-use marker key. */
  j: string;
}

const b64 = (b: Buffer | string): string => Buffer.from(b).toString("base64url");
const sign = (secret: string, body: string): string => b64(createHmac("sha256", secret).update(`v1.${body}`).digest());

/** A confirmation token: HMAC over the proposal, requester and expiry. No store write is needed to issue one. */
export function issueConfirmToken(secret: string, p: ConfirmPayload["p"], clientKey: string, nowMs: number): string {
  if (!secret) throw new Error("no confirmation secret");
  const payload: ConfirmPayload = { p, c: clientKey, x: nowMs + CONFIRM_TTL_MS, j: randomBytes(12).toString("hex") };
  const body = b64(JSON.stringify(payload));
  return `v1.${body}.${sign(secret, body)}`;
}

function verifyConfirmToken(secret: string, token: string): ConfirmPayload | null {
  if (!secret) return null;
  const m = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!m) return null;
  const want = Buffer.from(sign(secret, m[1]));
  const got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const payload = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as ConfirmPayload;
    return payload && typeof payload.x === "number" && typeof payload.j === "string" && typeof payload.c === "string" && payload.p ? payload : null;
  } catch {
    return null;
  }
}

/** Fresh tokens for one response's proposals, bound to the requester. No store command. */
function withTokens(deps: ClosuresDeps, clientKey: string, value: OkResponse): OkResponse {
  const t = deps.now();
  return {
    ...value,
    proposals: value.proposals.map((p) => {
      const { confirmToken: _drop, ...bare } = p;
      void _drop;
      return { ...bare, confirmToken: issueConfirmToken(deps.confirmSecret, { id: p.id, gazetteerId: p.gazetteerId, provenance: p.provenance }, clientKey, t) };
    }),
  };
}

/**
 * Runs the closure lookup. The caller has already passed the in-memory front door (which applies
 * the per-IP limit before anything else, cache reads included). Cheap paths (fresh in-memory cache)
 * cost no store command; the expensive part runs at most once at a time per process, and never
 * more than the daily cap allows.
 */
export async function lookupClosures(deps: ClosuresDeps, ip: string, state: ClosuresState, deadlineAt: number, requester: string = ipKey(ip)): Promise<ClosuresResponse> {
  // Without a signing secret no confirmation could ever be honored, so no proposal is offered at all.
  if (!deps.confirmSecret) return { status: "unavailable", reason: "disabled", message: "Closure search is switched off on this deployment." };
  const r = await lookupBare(deps, ip, state, deadlineAt);
  // Tokens are issued per response, bound to this requester, never shared between callers of one lookup or cache entry.
  return r.status === "ok" ? withTokens(deps, requester, r) : r;
}

async function lookupBare(deps: ClosuresDeps, ip: string, state: ClosuresState, deadlineAt: number): Promise<ClosuresResponse> {
  const t = deps.now();
  const asCached = (c: CacheEntry, label: string): ClosuresResponse => ({
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

  const cached = state.cache;
  if (cached && fresh(deps, cached, t)) return asCached(cached, "Cached result");
  const orCached = (fallbackResponse: ClosuresResponse) => (cached ? asCached(cached, "Cached result") : fallbackResponse);
  if (!deps.search) return orCached(unavailable("no_key", "Closure search is not configured on this deployment."));

  const rl = await deps.limiter.consume(`closures:${ipKey(ip)}`, [{ name: "closures_per_hour", limit: deps.config.ipClosuresPerHour, windowMs: HOUR_MS }]);
  if (rl.error) return orCached(unavailable("protection_unavailable", "Closure search is paused because its safeguards are unavailable."));
  if (!rl.allowed) return orCached(unavailable("rate_limited", "Too many closure searches from this connection. Try again later.", rl.retryAfterS));

  if (state.inflight) return state.inflight;
  const p = runLookup(deps, t, deadlineAt, cached, state).finally(() => {
    if (state.inflight === p) state.inflight = null;
  });
  state.inflight = p;
  return p;

  async function runLookup(d: ClosuresDeps, at: number, deadline: number, stale: CacheEntry | null, st: ClosuresState): Promise<ClosuresResponse> {
    const fallbackTo = (r: ClosuresResponse): ClosuresResponse => (stale ? asCached(stale, "Cached result") : r);
    // Increment first, then compare the returned value: concurrent requests cannot all pass a check.
    const capKey = `tavily:${budgetWindow(at, d.config.budgetResetHourUtc)}`;
    let n: number;
    try {
      n = await d.store.incrLite(capKey, 1, 2 * DAY_MS);
    } catch (e) {
      if (!(e instanceof StoreError)) throw e;
      logEvent("warn", "protection_unavailable", { where: "closures_cap" });
      return fallbackTo(unavailable("protection_unavailable", "Closure search is paused because its safeguards are unavailable."));
    }
    if (n > d.config.tavilyDailyCap) {
      await d.store.incrLite(capKey, -1, 2 * DAY_MS).catch(() => undefined);
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
    // The cache lives in process memory only (it holds Tavily content).
    st.cache = { at, degraded, value: stripTokens(value) };
    return stripTokens(value);
  }
}

/* ------------------------------- confirmation ------------------------------ */

export type ConfirmOutcome =
  | { status: "ok"; record: import("../agent/protocol").ConfirmedClosureRecord }
  | { status: "invalid_or_used" }
  | { status: "expired" }
  | { status: "wrong_requester" }
  | { status: "store_error" };

/**
 * Redeems a confirmation token: verify the HMAC (no store), check expiry and the requester, then
 * record the token id as used with SET NX (the only store command, and only at redemption).
 * Exactly one caller gets the record; replays get nothing. The provenance is what the server
 * signed; the mutation and label are looked up from the server's gazetteer by the signed id.
 */
export async function redeemConfirmation(
  store: SharedStore,
  secret: string,
  token: string,
  requester: string,
  nowMs: number,
  catalog: Pick<Catalog, "gazetteerById">,
): Promise<ConfirmOutcome> {
  const payload = verifyConfirmToken(secret, token);
  if (!payload) return { status: "invalid_or_used" };
  if (payload.x <= nowMs) return { status: "expired" };
  if (payload.c !== requester) return { status: "wrong_requester" };
  const p = payload.p;
  const entry = p && typeof p.gazetteerId === "string" ? catalog.gazetteerById.get(p.gazetteerId) : undefined;
  const mutation = entry ? mutationFor(entry) : null;
  if (!entry || !mutation || !p.provenance || typeof p.provenance.url !== "string" || typeof p.provenance.quote !== "string") return { status: "invalid_or_used" };
  let first: boolean;
  try {
    first = await store.setIfAbsent(`cfu:${payload.j}`, "1", Math.max(1_000, payload.x - nowMs));
  } catch (e) {
    if (!(e instanceof StoreError)) throw e;
    return { status: "store_error" };
  }
  if (!first) return { status: "invalid_or_used" };
  return {
    status: "ok",
    record: {
      id: `tavily-${entry.id}-${payload.j.slice(0, 8)}`,
      m: mutation,
      origin: "tavily",
      label: `${entry.name} (unverified news report)`,
      provenance: { url: p.provenance.url, quote: p.provenance.quote, retrievedAt: String(p.provenance.retrievedAt ?? "") },
      confirmedAt: new Date(nowMs).toISOString(),
    },
  };
}

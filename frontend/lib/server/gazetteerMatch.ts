/**
 * Deterministic matching of a road name (as written in an article) to gazetteer entries.
 * No model is involved: normalize, then exact match, then a token-overlap score with a fixed
 * threshold. Ambiguous or missing matches are reported honestly, never guessed.
 */
import type { GazetteerEntry } from "../agent/catalog";

const ABBREV: Record<string, string> = {
  st: "street", rd: "road", ave: "avenue", av: "avenue", blvd: "boulevard", hwy: "highway",
  pkwy: "parkway", dr: "drive", ln: "lane", ct: "court", pl: "place", expy: "expressway",
  fwy: "freeway", n: "north", s: "south", e: "east", w: "west", mt: "mount", ft: "fort",
};
const STOP = new Set(["the", "of", "at", "on", "and", "closed", "closure", "bridge_"]);

/** Lowercased, accent-free, punctuation-free, abbreviations expanded, route numbers unified. */
export function normalizeName(input: string): string {
  let t = input.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  t = t.replace(/&/g, " and ");
  t = t.replace(/\b(?:interstate|i)[\s-]*(\d{1,3})\b/g, " i$1 ");
  t = t.replace(/\b(?:u\.?s\.?|us)[\s-]*(?:route|highway|hwy)?[\s-]*(\d{1,3})\b/g, " us$1 ");
  t = t.replace(/\b(?:md|maryland)[\s.-]*(?:route|rt|rte|highway|hwy)?[\s-]*(\d{1,3})\b/g, " md$1 ");
  t = t.replace(/[^a-z0-9]+/g, " ");
  const tokens = t
    .split(" ")
    .filter(Boolean)
    .map((w) => ABBREV[w] ?? w)
    .filter((w) => !STOP.has(w));
  return tokens.join(" ");
}

const tokens = (s: string): string[] => (s ? s.split(" ") : []);

function score(query: string, name: string): number {
  if (!query || !name) return 0;
  if (query === name) return 1;
  const q = new Set(tokens(query));
  const n = new Set(tokens(name));
  const inter = [...q].filter((x) => n.has(x)).length;
  if (inter === 0) return 0;
  const dice = (2 * inter) / (q.size + n.size);
  // The entry's whole name appears inside the query (e.g. "beltway near i695" contains "i695").
  const contained = inter === n.size && (n.size >= 2 || [...n].some((w) => /\d/.test(w)));
  return Math.max(dice, contained ? 0.9 : 0);
}

export type RoadMatch =
  | { status: "matched"; entry: GazetteerEntry; score: number }
  | { status: "ambiguous"; entries: GazetteerEntry[] }
  | { status: "none" };

const ROAD_KINDS = new Set(["road", "link", "corridor"]);
export const MATCH_THRESHOLD = 0.8;

export function matchRoad(gazetteer: readonly GazetteerEntry[], road: string): RoadMatch {
  const q = normalizeName(road);
  const scored: { entry: GazetteerEntry; score: number }[] = [];
  for (const entry of gazetteer) {
    if (!ROAD_KINDS.has(entry.kind)) continue;
    let best = 0;
    for (const n of [entry.name, ...entry.aliases]) best = Math.max(best, score(q, normalizeName(n)));
    if (best >= MATCH_THRESHOLD) scored.push({ entry, score: best });
  }
  if (scored.length === 0) return { status: "none" };
  scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  const top = scored.filter((s) => s.score === scored[0].score);
  if (top.length > 1) return { status: "ambiguous", entries: top.map((t) => t.entry) };
  return { status: "matched", entry: top[0].entry, score: top[0].score };
}

/** True when every normalized token of `road` also appears in the normalized quote. */
export function roadAppearsIn(road: string, quote: string): boolean {
  const q = new Set(tokens(normalizeName(quote)));
  const r = tokens(normalizeName(road));
  return r.length > 0 && r.every((w) => q.has(w));
}

/** Whitespace/case/quote-style insensitive form used for the grounding substring check. */
export function normalizeForQuote(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

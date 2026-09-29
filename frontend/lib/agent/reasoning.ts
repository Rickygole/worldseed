/**
 * The optional "model reasoning" field: a deliberate, labeled exception to the rule that no
 * model-written text reaches a reader.
 *
 * A planner or critic reply may carry a `reasoning` string. It is shown ONLY inside a collapsed
 * section of the decision log, labeled REASONING_LABEL, with the model name, token counts and
 * latency of that step. It is never used for any decision, never on a card, and never placed
 * inside a log sentence that carries a figure.
 *
 * The screen checks properties that make the text safe to render as plain text (length, ASCII
 * characters, no digits, no links, no markup or code) and two content rules: a DENYLIST (profanity
 * and slurs, words that assign fault or cause for the collapse or describe deaths, and phrases that
 * would present the tool as operational or advisory) and a proper-name rule (a capitalized word
 * that is not sentence-initial must be a catalog, gazetteer or link name or on a small fixed list).
 * It does NOT check that the text is true or free of claims ("it is much better" passes). That is
 * why the label says raw, unverified, written by an AI model and shown without human review. A
 * failing field is blanked (and the decision log says so, never quoting the text); it never
 * rejects the reply. The server and the browser run the same screen.
 */
import type { Catalog } from "./catalog";
import { STRESS_LINKS } from "./stress";
import { FAULT_STEMS, FIXED_NAMES, OFFENSIVE_STEMS, SQUEEZABLE, forbiddenPhrase } from "./wording";

export const REASONING_MAX_CHARS = 600;
export const REASONING_LABEL =
  "Model reasoning (raw, unverified; not a result). Written by an AI model and shown without human review. It may be wrong or inappropriate and is not the view of WorldSeed.";

export type ReasoningProblem = "not_text" | "too_long" | "charset" | "digits" | "link" | "markup" | "denylist" | "proper_name";

export type ReasoningVerdict = { ok: true; text: string } | { ok: false; problems: ReasoningProblem[] };

/** Letters, spaces and a small set of sentence punctuation. Nothing that can form markup, a path or code. */
const ALLOWED = /^[A-Za-z .,;:'"()?!-]*$/;
const LINK = /(?:https?|ftp|file|data|javascript):|\bwww\.|\/\/|\b[a-z0-9-]+\.(?:com|org|net|io|gov|edu|us|co|ai|dev|app|info|biz|me|md)\b/i;

const stemRe = (stems: readonly string[]): RegExp =>
  new RegExp(`\\b(?:${stems.map((x) => (x.endsWith("$") ? `${x.slice(0, -1)}\\b` : x).replace(/ /g, "[ -]")).join("|")})`, "i");
const OFFENSIVE = stemRe(OFFENSIVE_STEMS);
const FAULT = stemRe(FAULT_STEMS);

/**
 * The capitalized words that may appear mid-sentence: the fixed list, plus every word of a
 * catalog title and candidate id, gazetteer name and alias, and link name. Lowercased.
 */
export interface ReasoningAllowlist {
  names: ReadonlySet<string>;
}

const cache = new WeakMap<object, ReasoningAllowlist>();

export function buildReasoningAllowlist(catalog: Pick<Catalog, "candidates" | "gazetteer">): ReasoningAllowlist {
  const hit = cache.get(catalog);
  if (hit) return hit;
  const names = new Set<string>(FIXED_NAMES.map((n) => n.toLowerCase()));
  const add = (text: string) => {
    for (const w of text.match(/[A-Za-z][A-Za-z']*/g) ?? []) names.add(w.toLowerCase());
  };
  for (const c of catalog.candidates) {
    add(c.title);
    add(c.id);
  }
  for (const g of catalog.gazetteer) {
    add(g.name);
    for (const a of g.aliases) add(a);
  }
  for (const l of STRESS_LINKS) add(l.label);
  const out = { names };
  cache.set(catalog, out);
  return out;
}

/** Words that may start a sentence and be followed by a reporting verb without being a name. */
const NOT_NAMES = new Set(["he", "she", "they", "it", "we", "you", "i", "this", "that", "these", "those", "there", "here", "one", "someone", "somebody", "everyone", "people", "others", "who", "nobody", "anyone", "the", "a", "an", "some", "many", "most", "both", "each"]);
/** A sentence that opens with an unknown word and a reporting verb ("Smith said ...") opens with a name. */
const REPORTED = /(?:^|[.!?]\s+)["'(]*([A-Z][A-Za-z']*)\s+(?:said|says|asked|asks|told|tells|stated|states|claims?|claimed|thinks|thought|wrote|writes|argued|argues|reported|reports|noted|notes|explained|explains|added|adds|believes|believed|warned|warns|recommends?|recommended|suggests?|suggested)\b/g;

/** Capitalized words that are not the first word of a sentence and not on the allowlist (names of people, ships, companies). */
function unknownNames(text: string, allow: ReasoningAllowlist | undefined): boolean {
  const names = allow?.names ?? new Set(FIXED_NAMES.map((n) => n.toLowerCase()));
  for (const r of text.matchAll(REPORTED)) {
    const w = r[1].toLowerCase();
    if (!NOT_NAMES.has(w) && !names.has(w)) return true;
  }
  const re = /[A-Za-z][A-Za-z']*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const word = m[0];
    if (!/^[A-Z]/.test(word)) continue;
    // sentence-initial: the very first word, or one that follows ". ", "! " or "? " (optionally after a quote or parenthesis)
    const before = text.slice(0, m.index).replace(/[\s"'(]+$/, "");
    if (before === "" || /[.!?]$/.test(before)) continue;
    if (!names.has(word.toLowerCase()) && !names.has(word.replace(/'s$/i, "").toLowerCase())) return true;
  }
  return false;
}

export function screenReasoning(raw: unknown, allow?: ReasoningAllowlist): ReasoningVerdict {
  if (typeof raw !== "string") return { ok: false, problems: ["not_text"] };
  // Whitespace of every kind (newline, tab, NBSP) becomes a single space; then the text must fit.
  const text = raw.replace(/\s+/g, " ").trim();
  const problems: ReasoningProblem[] = [];
  if (text.length > REASONING_MAX_CHARS) problems.push("too_long");
  if (/\d/u.test(text) || /\p{Nd}/u.test(text)) problems.push("digits");
  if (LINK.test(text)) problems.push("link");
  if (/[`<>[\]{}\\|*_#=@~^$%&+/]/.test(text)) problems.push("markup");
  if (!ALLOWED.test(text)) problems.push("charset");
  // The denylist also runs on the letters alone, so spacing or punctuation inside a word does not hide it.
  const squeezed = text.replace(/[^A-Za-z]/g, "");
  if (OFFENSIVE.test(text) || FAULT.test(text) || forbiddenPhrase(text) !== undefined || SQUEEZED.test(squeezed)) problems.push("denylist");
  if (unknownNames(text, allow)) problems.push("proper_name");
  return problems.length > 0 ? { ok: false, problems } : { ok: true, text };
}

/** Long, unambiguous stems are also matched inside the letters-only form of the text. */
const SQUEEZED = new RegExp(SQUEEZABLE.join("|"), "i");

/** Fixed wording for the log when a field was blanked. Names the failed properties (from a fixed list), never the text. */
export function reasoningWithheldSentence(problems: readonly ReasoningProblem[]): string {
  return `Model reasoning was withheld because it did not pass the screen (${[...new Set(problems)].join(", ")}); the answer itself was used.`;
}

/** What one reasoning entry carries for the decision log's collapsed section. */
export interface ReasoningEntry {
  role: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  text: string;
}

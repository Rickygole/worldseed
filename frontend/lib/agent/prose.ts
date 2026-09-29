/**
 * Prose screen: a filter for sentences that sit near results.
 *
 * STATUS: since the rationale redesign no model-written sentence reaches the UI (a model picks a
 * rationale kind; the application renders the sentence, see rationale.ts, and finalist cards are
 * application and catalog text). The one labeled exception is the optional `reasoning` string,
 * which has its own plain-text screen (reasoning.ts). This screen therefore no longer sits on a
 * model output path.
 * It is kept as (1) the certifier for the fixed rationale sentences (rendering runs them through
 * it and tests check the whole table) and (2) a maintained regression target for the vocabulary
 * rules below. Where model-derived text can still reach a reader is listed in the known-limits
 * block of the round report, next to the screen that guards each place.
 *
 * The design decision behind it: the model never writes an outcome sentence. Every headline and
 * result line next to a figure is an application template filled from simulator numbers, with the
 * real sign and direction. The screen is written as a positive allowlist first and a vocabulary
 * blacklist second, and is a filter with known limits, not a proof that a sentence makes no
 * quantitative claim.
 *
 * Pipeline (docs/ARCHITECTURE.md 2.7, rule 5):
 *   1. Normalize: drop format and invisible characters (zero-width, soft hyphen), NFKC-fold
 *      look-alike and full-width forms, collapse every run of whitespace (newline, tab, NBSP).
 *   2. No placeholders: commentary has no slots (figures live only in application templates).
 *   3. Exact catalog / minted bundle IDs passed in `allowedTokens` are replaced by a space.
 *      Model-authored identifiers are never whitelisted (bundle IDs are minted by the application).
 *   4. What is left must be plain English: ASCII letters, spaces, basic punctuation and
 *      parentheses. That alone rejects digits in any script, Roman-numeral and circled forms,
 *      look-alike letters, CJK and accented number words, markup, brackets, slashes and at-signs.
 *   5. Vocabulary: number words in several languages, ASCII Roman numerals, fractions and
 *      multipliers (code number_word); change and comparison words (direction); quantifier and
 *      absolute words (absolute); size and amount words (magnitude); negations (negation);
 *      outcome-state words (outcome, strict profile only); links; and operational-emergency and
 *      product-claim vocabulary (wording). Every rejection names the dictionary word that caused
 *      it, taken from the fixed lists below and never copied from the model.
 *
 * Two profiles: "card" (text shown next to results) is the strict one.
 * "rationale" (the planner's decision-log commentary) also allows a few natural phrases that cannot
 * carry a result claim: "unresolved", "cut off", "drop/dropping" next to a bundle, outcome-state
 * words, and small counts of catalog things the application itself lists ("two bundles").
 *
 * Whitelist by design (everything else is rejected): exact IDs from `allowedTokens` and ordinal
 * words (first, second) that carry no digits.
 */

import { FORBIDDEN_PHRASES } from "./wording";

/** Metrics a slot may name (slots exist only in application templates; commentary has none). */
export const SLOT_METRICS = ["p50", "p90", "pctWithin", "isolated", "equityGap", "pGoal", "cost"] as const;
export type SlotMetric = (typeof SLOT_METRICS)[number];

/**
 * The one sentence about prose that the product may defend. It is deliberately not "the model
 * cannot state a number": the screen is a filter with known limits, not a proof.
 */
export const PROSE_CLAIM =
  "Numbers, outcomes and finalist cards are produced by the application from simulator results. AI text appears only as clearly labeled rationale in the decision log and, in a collapsed raw section there, as optional model reasoning that is unverified, shown without human review, screened only for plain text and a word denylist, and never used for a decision.";

const BUNDLE_SLOT_ID = "B(?:1[0-2]|[1-9])";
const SLOT_BODY =
  `(?:(?:finalist|bundle)\\.${BUNDLE_SLOT_ID}\\.)?` +
  `(?:${SLOT_METRICS.join("|")})` +
  "(?:\\.(?:baseline|current|delta))?";
const SLOT_EXACT = new RegExp(`^${SLOT_BODY}$`);

export function isValidSlot(body: string): boolean {
  return SLOT_EXACT.test(body);
}

export interface ParsedSlot {
  /** The bundle the slot names, or undefined for an unqualified slot. */
  bundleId?: string;
  metric: SlotMetric;
  variant?: "baseline" | "current" | "delta";
}

/** Splits a valid slot body into its parts (undefined when the body is not a valid slot). Used by the slot filler. */
export function parseSlot(body: string): ParsedSlot | undefined {
  if (!isValidSlot(body)) return undefined;
  const parts = body.split(".");
  let bundleId: string | undefined;
  if (parts[0] === "finalist" || parts[0] === "bundle") {
    bundleId = parts[1];
    parts.splice(0, 2);
  }
  return { bundleId, metric: parts[0] as SlotMetric, variant: parts[1] as ParsedSlot["variant"] };
}

export type ProseIssueCode =
  | "digits"
  | "number_word"
  | "bad_slot"
  | "link"
  | "wording"
  | "charset"
  | "direction"
  | "absolute"
  | "magnitude"
  | "negation"
  | "outcome";

export interface ProseIssue {
  code: ProseIssueCode;
  message: string;
  /** The fixed-list word (or stem) that triggered it, never text copied from the model. */
  word?: string;
}

export type ProseProfile = "card" | "rationale";

/* --------------------------------- dictionaries -------------------------------- */

/** A dictionary entry: the stem shown in messages and the pattern (matched against one lowercase word). */
type Entry = readonly [stem: string, re: RegExp];
const entries = (defs: readonly (readonly [string, string])[]): Entry[] => defs.map(([stem, src]) => [stem, new RegExp(`^(?:${src})$`)] as const);
const stemOf = (w: string): readonly [string, string] => [w, w];
const words = (list: string): Entry[] => entries(list.split(" ").filter(Boolean).map(stemOf));

/** Change and comparison words. Direction is written by the application next to a filled number, never by a model. */
const DIRECTION: Entry[] = [
  ...entries([
    ["improve*", "improv\\w*"], ["worsen*", "worsen\\w*"], ["reduc*", "reduc\\w*"], ["cut", "cuts?|cutting"], ["save*", "sav(?:e|es|ed|ing|ings)"],
    ["gain*", "gain(?:s|ed|ing)?"], ["boost*", "boost\\w*"], ["ease*", "eas(?:e|es|ed|ing)"], ["increas*", "increas\\w*"], ["decreas*", "decreas\\w*"],
    ["lower*", "lower(?:s|ed|ing)?"], ["drop*", "drop(?:s|ped|ping)?"], ["raise*", "rais(?:e|es|ed|ing)"], ["grow*", "grow(?:s|n|ing|th)?"], ["shrink*", "shrink(?:s|ing)?|shrank"],
    ["shorten*", "shorten\\w*"], ["lengthen*", "lengthen\\w*"], ["speed*", "speed(?:s|ed|ing)?"], ["slash*", "slash\\w*"], ["trim*", "trim\\w*"],
    ["narrow*", "narrow(?:s|ed|ing)?"], ["widen*", "widen\\w*"], ["elimin*", "elimin\\w*"], ["fix*", "fix(?:es|ed|ing)?"], ["solv*", "solv(?:e|es|ed|ing)"],
    ["resolv*", "resolv(?:e|es|ed|ing)"], ["recover*", "recover\\w*"], ["restor*", "restor\\w*"], ["regain*", "regain\\w*"], ["return*", "return(?:s|ed|ing)"],
    ["beat*", "beat(?:s|ing)?"], ["outperform*", "outperform\\w*"], ["exceed*", "exceed\\w*"], ["match*", "match(?:es|ed|ing)"], ["close*", "clos(?:e|es|ed|ing)"],
    ["recommend*", "recommend\\w*"],
  ]),
  ...words(
    "higher faster slower quicker sooner later shorter longer better worse cheaper costlier pricier smaller larger bigger greater lesser easier harder " +
      "best worst cheapest fastest slowest quickest highest lowest largest smallest biggest longest shortest greatest stronger strongest weaker weakest " +
      "lighter lightest heavier heaviest safer safest more less fewer extra most least than baseline optimal ideal winner superior inferior preferred",
  ),
];
/** Quantifiers and absolutes: statements about everyone or no one are outcome claims. */
const ABSOLUTE: Entry[] = [
  ...entries([
    ["entire*", "entire\\w*"], ["complete*", "complet\\w*"], ["total*", "total\\w*"], ["guarantee*", "guarantee\\w*"], ["virtually", "virtual(?:ly)?"],
    ["essential*", "essentially"], ["practical*", "practically"], ["effective*", "effectively"], ["absolute*", "absolute(?:ly)?"], ["definite*", "definite(?:ly)?"],
    ["sure*", "surely"], ["full*", "fully"], ["permanent*", "permanent(?:ly)?"],
  ]),
  ...words("all every everyone everybody everything none nobody nothing never always almost nearly forever undoubtedly solely enough sufficient adequate"),
];
/** Amounts and sizes. */
const MAGNITUDE: Entry[] = [
  ...entries([
    ["dramatic*", "dramatic\\w*"], ["vast*", "vast\\w*"], ["sharp*", "sharp(?:ly|er|est)?"], ["slight*", "slight\\w*"], ["marginal*", "marginal\\w*"],
    ["substantial*", "substantial\\w*"], ["significant*", "significan\\w*"], ["considerabl*", "considerabl\\w*"], ["massive*", "massive\\w*"],
    ["enormous*", "enormous\\w*"], ["minute*", "minutes?"], ["hour*", "hours?"], ["day*", "days?"], ["week*", "weeks?"], ["month*", "months?"], ["year*", "years?"],
    ["mile*", "miles?"], ["kilometer*", "kilomet(?:er|re)s?"], ["block*", "blocks?"],
  ]),
  ...words(
    "majority minority handful few several many numerous multiple countless plenty lot lots little tiny minor major negligible huge large small big steep " +
      "greatly mostly largely roughly approximately nil zero score fortnight dozen dozens couple",
  ),
];
/** Negations: a negative claim is an outcome claim ("does not help ...", "no one ..."). */
const NEGATION_WORDS = words("no not nor cannot neither nowhere barely hardly scarcely");
const NEGATION_CONTRACTION = /\b\w+n['’]t\b/i;
/** Outcome-state words: what an option leaves behind. Rejected next to results; allowed in decision-log rationale. */
const OUTCOME: Entry[] = [
  ...entries([["leave*", "leav(?:e|es|ing)"], ["remain*", "remain\\w*"], ["isolat*", "isolat\\w+"], ["unresolved", "unresolved"], ["stranded", "strand\\w*"]]),
  ...words("left"),
];

/** English, French, German, Spanish, Italian, Portuguese number words (ASCII spellings). */
const NUMBER_TOKENS = new Set(
  (
    "zero two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen " +
    "twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion dozen dozens couple " +
    "half halves halve halved halving quarter quarters double doubles doubled doubling triple triples tripled tripling quadruple quadrupled " +
    "twice thrice twofold threefold fourfold fivefold sixfold sevenfold eightfold ninefold tenfold tenth tenths thirds " +
    "percent percents percentage percentages pct cent cents " +
    "zero un une deux trois quatre cinq sept huit neuf dix onze douze treize quatorze quinze seize vingt trente quarante cinquante soixante cent mille moitie " +
    "null eins zwei drei vier funf fuenf sechs sieben acht neun zehn elf zwolf zwoelf dreizehn vierzehn funfzehn zwanzig dreissig vierzig hundert tausend halb " +
    "cero uno dos tres cuatro cinco seis siete ocho nueve diez doce trece catorce quince veinte treinta cuarenta cincuenta ciento mil mitad " +
    "tre quattro sei sette otto nove dieci dodici tredici venti trenta cento mille quatro cinquenta dezoito vinte trinta doze"
  )
    .split(" ")
    .filter(Boolean),
);
/** Long number words are also caught inside a longer run of letters (for example glued to a unit). */
const NUMBER_SUBSTRINGS = "twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty hundred thousand million billion dozen".split(" ");
/** "one" is an ordinary pronoun ("the one that", "one of the options"); it is rejected only where it reads as a quantity. */
const ONE_QUANTITY =
  /\bone[- ](?:minutes?|mins?|hours?|days?|weeks?|months?|years?|blocks?|miles?|lanes?|households|residents|people|workers|homes|groups|areas)\b|\b(?:by|is|are|was|were|be|to|of|about|around|nearly|almost|only|just|exactly|at|from)\s+one\b(?!\s+(?:of|that|which|who|option|bundle|corridor|link|connector))/i;
/** A fraction: "a third", "one fifth", "a tenth of". */
const FRACTION = /\b(?:a|one|two|three|four|five)\s+(?:third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)s?\b|\b(?:third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)s\b/i;
/** Small counts of things the application itself lists. Allowed only in the rationale profile. */
const CATALOG_COUNT =
  /\b(?:two|three|four|five|six|both)\s+(?:of\s+the\s+)?(?:bundles?|options?|candidates?|interventions?|links?|corridors?|sites?|signals?|connectors?|shuttles?|types?|rounds?|mechanisms?)\b/gi;

const ROMAN = /^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/i;
const ROMAN_OK_WORDS = new Set(["mix"]);

/* Operational-emergency and product-claim vocabulary. Fragments are joined so the words do not appear as literals in the source. */
const WORDING_ENTRIES: Entry[] = entries([
  [["dis", "patch*"].join(""), ["dis", "patch\\w*"].join("")],
  [["tri", "age*"].join(""), ["tri", "age\\w*"].join("")],
  [["prioriti", "z*"].join(""), ["prioriti", "[sz]\\w*"].join("")],
  [["respon", "der*"].join(""), ["respon", "ders?"].join("")],
  ["rescue*", "rescu\\w*"],
  ["deploy*", "deploy\\w*"],
  ["protect*", "protect\\w*"],
  ["routing", "routing"],
  ["operational*", "operation(?:al|s)?"],
  ["lives", "lives?"],
  ["lifesaving", "life[- ]?sav\\w*"],
  ["guidance", "guidance"],
]);
const BANNED_PHRASES: [string, RegExp][] = [
  [["real", " ", "time"].join(""), new RegExp(["real[- ]?", "time"].join(""), "i")],
  ["live operations", /\blive\s+(?:operations?|aid|routing|response|guidance|use|tool)\b/i],
  ["on the fly", /\bon the fly\b/i],
  // Phrases that would present the simulation as an operational or advisory tool (fragments live in wording.ts).
  ...FORBIDDEN_PHRASES,
];
/** Same words with every non-letter removed, so punctuation cannot split them. */
const SQUEEZED_BANNED = new RegExp(
  [
    ["dis", "patch"].join(""),
    ["tri", "age"].join(""),
    ["real", "time"].join(""),
    ["prioriti", "[sz]e"].join(""),
    ["respon", "der"].join(""),
    ["lifes", "av"].join(""),
    ["savea", "life"].join(""),
    ["liv", "essaved"].join(""),
  ].join("|"),
  "i",
);

const LINK_RE = /(?:https?:|www\.|<\s*\/?\s*[a-z])/i;
const BARE_DOMAIN = /[a-z0-9-]{2,}\.(?:com|org|net|io|gov|edu|us|co|dev|app|xyz|info|biz|ly|me|example|test|local|internal)\b/i;

const CHARSET_BAD = /[^A-Za-z .,;:!?'"()‘’“”\-–—\p{N}]/u;
const ANY_NUMBER = /\p{N}/u;
const INVISIBLE = /[\p{Cf}­]/gu;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ProseOptions {
  /** Exact identifiers that may appear even though they contain digits (catalog IDs, minted bundle IDs). */
  allowedTokens?: readonly string[];
  profile?: ProseProfile;
}

/** The text as the screen sees it: invisible characters gone, NFKC-folded, whitespace collapsed. */
export function normalizeProse(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Z}\s]+/gu, " ")
    .trim();
}

const firstHit = (list: readonly Entry[], tokens: readonly string[]): string | undefined => {
  for (const w of tokens) for (const [stem, re] of list) if (re.test(w)) return stem;
  return undefined;
};

/** Returns the list of problems (empty when the text is acceptable commentary). */
export function proseIssues(text: string, opts: ProseOptions = {}): ProseIssue[] {
  const issues: ProseIssue[] = [];
  const profile = opts.profile ?? "card";
  const bad = (code: ProseIssueCode, message: string, word?: string) => {
    if (!issues.some((i) => i.code === code)) issues.push({ code, message, word });
  };
  let t = normalizeProse(text);

  if (t.includes("{") || t.includes("}")) {
    // The whole placeholder is dropped so the field is withheld (bad_slot) rather than rejected for the digits inside it.
    bad("bad_slot", "commentary may not contain placeholders or braces; figures come from the application");
    t = t.replace(/\{\{[^{}]*\}\}/g, " ").replace(/[{}]/g, " ");
  }

  // Natural phrases that cannot carry a result claim.
  t = t.replace(/\b(?:stays?\s+|stayed\s+|kept\s+)?cut[- ]off\b/gi, " "); // "cut off", "stay cut off"
  t = t.replace(/\bdrop(?:s|ped|ping)?(?=\s+(?:the\s+)?(?:bundles?\s+)?B(?:1[0-2]|[1-9])\b)/gi, " "); // "dropping B4"
  // "pair a link with a site" is a verb; "a pair of ..." is a count.
  if (/\bpair(?:s|ed|ing)?\s+of\b/i.test(t)) bad("magnitude", 'contains the amount word "pair of"', "pair of");
  t = t.replace(/\bpair(?:s|ed|ing)?\b/gi, " ");
  if (profile === "rationale") {
    t = t.replace(/\bworst[- ]case\b/gi, " "); // a metric name, used to say what the planner is looking at
    t = t.replace(/\bunresolved\b/gi, " ");
    t = t.replace(CATALOG_COUNT, " ");
  }

  for (const tok of opts.allowedTokens ?? []) {
    if (!tok) continue;
    const re = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(tok)}(?![A-Za-z0-9_-])`, "g");
    t = t.replace(re, "$1 ");
  }

  if (ANY_NUMBER.test(t)) bad("digits", "prose contains digits; figures come from the application, never from commentary");
  if (CHARSET_BAD.test(t)) bad("charset", "commentary may use plain letters, basic punctuation and parentheses only");

  const raw = t.match(/[A-Za-z]+/g) ?? [];
  const lower = raw.map((w) => w.toLowerCase());

  const numWord = lower.find((w) => NUMBER_TOKENS.has(w)) ?? lower.find((w) => w.length > 6 && NUMBER_SUBSTRINGS.find((n) => w.includes(n)));
  if (numWord && NUMBER_TOKENS.has(numWord)) bad("number_word", `contains the number word "${numWord}"; numbers come from the application`, numWord);
  else if (numWord) bad("number_word", "contains a number word glued to other letters", NUMBER_SUBSTRINGS.find((n) => numWord.includes(n)));
  else if (raw.some((w) => w.length >= 2 && ROMAN.test(w) && !ROMAN_OK_WORDS.has(w.toLowerCase()))) bad("number_word", "contains a Roman numeral");
  else if (raw.some((w) => /^(?=.*O)(?=.*[lI])[lIO]{2,}$/.test(w))) bad("number_word", "contains a look-alike numeral");
  else if (ONE_QUANTITY.test(t)) bad("number_word", 'uses "one" as a quantity');
  else if (FRACTION.test(t)) bad("number_word", "contains a fraction word");

  const dir = firstHit(DIRECTION, lower);
  if (dir) bad("direction", `contains the change or comparison word "${dir}"; direction is written by the application next to figures`, dir);
  const abs = firstHit(ABSOLUTE, lower);
  if (abs) bad("absolute", `contains the absolute or quantifier word "${abs}"`, abs);
  else if (/\bno one\b/i.test(t)) bad("absolute", 'contains the absolute phrase "no one"', "no one");
  const mag = firstHit(MAGNITUDE, lower);
  if (mag) bad("magnitude", `contains the amount or size word "${mag}"`, mag);
  const neg = firstHit(NEGATION_WORDS, lower);
  if (neg) bad("negation", `contains the negation "${neg}"; describe what the option does, not what it does not do`, neg);
  else if (NEGATION_CONTRACTION.test(t)) bad("negation", "contains a negative contraction", "n't");
  if (profile === "card") {
    const out = firstHit(OUTCOME, lower);
    if (out) bad("outcome", `contains the outcome word "${out}"; commentary describes mechanism, not results`, out);
  }

  if (LINK_RE.test(t) || BARE_DOMAIN.test(t)) bad("link", "prose must not contain links or markup");
  const wording = firstHit(WORDING_ENTRIES, lower) ?? BANNED_PHRASES.find(([, re]) => re.test(t))?.[0];
  if (wording) bad("wording", `uses the operational or product-claim word "${wording}"; describe counterfactual planning only`, wording);
  else if (SQUEEZED_BANNED.test(t.replace(/[^A-Za-z]/g, ""))) bad("wording", "uses operational-emergency vocabulary; describe counterfactual planning only");
  return issues;
}

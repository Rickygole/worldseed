/**
 * Prose screen: what a model may write in a text field.
 *
 * The honest claim is narrow: model prose is SCREENED, and numbers appear only through
 * server-filled {{slot}} placeholders. The screen is not proof that a sentence contains no
 * quantitative claim; it removes every route we know of and is written as a positive allowlist
 * first, blacklists second.
 *
 * Pipeline (docs/ARCHITECTURE.md 2.7, rule 5):
 *   1. Normalize: drop format and invisible characters (zero-width, soft hyphen), NFKC-fold
 *      look-alike and full-width forms, collapse every run of whitespace (newline, tab, NBSP).
 *   2. Slots: a well-formed {{slot}} is replaced by a space; everything else in braces is an error.
 *      Bundle-qualified slots may name only the item's OWN bundle (see SlotPolicy).
 *   3. Exact catalog / minted bundle IDs passed in `allowedTokens` are replaced by a space.
 *      Model-authored identifiers are never whitelisted (bundle IDs are minted by the application).
 *   4. What is left must be plain English: ASCII letters, spaces and basic punctuation only.
 *      That alone rejects digits in any script, Roman-numeral and circled forms, look-alike
 *      letters, CJK and accented number words, markup, brackets, slashes, at-signs and entities.
 *   5. Blacklists on top: number words in English and common other languages (with or without a
 *      unit), ASCII Roman numerals, multiplier and fraction words, comparative / direction words
 *      (direction is written by the application next to a filled number, never by a model),
 *      links and bare domains, and operational-emergency vocabulary.
 *
 * Whitelist by design (everything else is rejected): well-formed slots, exact IDs from
 * `allowedTokens`, and ordinal words (first, second, third), which contain no digits.
 */

/** Metrics a slot may name. */
export const SLOT_METRICS = ["p50", "p90", "pctWithin", "isolated", "equityGap", "pGoal", "cost"] as const;
export type SlotMetric = (typeof SLOT_METRICS)[number];

/**
 * The one sentence about prose that the product may defend. It is deliberately not "the model
 * cannot state a number": the screen is a filter with known limits, not a proof.
 */
export const PROSE_CLAIM = "Model prose is screened; numbers appear only through slots the application fills from simulator results.";

const BUNDLE_SLOT_ID = "B(?:1[0-2]|[1-9])";
const SLOT_BODY =
  `(?:(?:finalist|bundle)\\.${BUNDLE_SLOT_ID}\\.)?` +
  `(?:${SLOT_METRICS.join("|")})` +
  "(?:\\.(?:baseline|current|delta))?";
const SLOT_EXACT = new RegExp(`^${SLOT_BODY}$`);
const SLOT_TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

export function isValidSlot(body: string): boolean {
  return SLOT_EXACT.test(body);
}

export interface ParsedSlot {
  /** The bundle the slot names, or undefined for an unqualified slot. */
  bundleId?: string;
  metric: SlotMetric;
  variant?: "baseline" | "current" | "delta";
}

/** Splits a valid slot body into its parts (undefined when the body is not a valid slot). */
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

/**
 * Which slots a field may use. With no `ownerBundleId` (log sentences, hypotheses, tradeoffs) only
 * baseline figures, which belong to no bundle, are allowed. With an owner (a finalist's own
 * headline and body) that bundle's own figures are allowed too, written unqualified or qualified
 * with the same ID. A slot naming any other bundle is refused.
 */
export interface SlotPolicy {
  ownerBundleId?: string;
}

function slotAllowed(slot: ParsedSlot, policy: SlotPolicy): boolean {
  if (slot.bundleId !== undefined && slot.bundleId !== policy.ownerBundleId) return false;
  if (slot.metric === "cost") return slot.variant === undefined && policy.ownerBundleId !== undefined;
  if (slot.metric === "pGoal") return slot.variant === undefined && policy.ownerBundleId !== undefined;
  if (slot.variant === "baseline") return slot.bundleId === undefined; // baseline belongs to no bundle
  return policy.ownerBundleId !== undefined; // current / delta / bare need an own bundle
}

export type ProseIssueCode = "digits" | "number_word" | "bad_slot" | "link" | "wording" | "charset" | "direction";
export interface ProseIssue {
  code: ProseIssueCode;
  message: string;
}

/* --------------------------------- word lists -------------------------------- */

const list = (s: string): string[] => s.split(" ").filter(Boolean);

/** English, French, German, Spanish, Italian, Portuguese number words (ASCII spellings). */
const NUMBER_TOKENS = new Set(
  list(
    "zero two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen " +
      "twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion dozen dozens couple " +
      "half halves halve halved halving quarter quarters double doubles doubled doubling triple triples tripled tripling quadruple quadrupled " +
      "twice thrice twofold threefold fourfold fivefold sixfold sevenfold eightfold ninefold tenfold " +
      "percent percents percentage percentages pct cent cents " +
      // French
      "zero un une deux trois quatre cinq sept huit neuf dix onze douze treize quatorze quinze seize vingt trente quarante cinquante soixante cent mille moitie " +
      // German
      "null eins zwei drei vier funf fuenf sechs sieben acht neun zehn elf zwolf zwoelf dreizehn vierzehn funfzehn zwanzig dreissig vierzig hundert tausend halb " +
      // Spanish
      "cero uno dos tres cuatro cinco seis siete ocho nueve diez doce trece catorce quince veinte treinta cuarenta cincuenta ciento mil mitad " +
      // Italian and Portuguese
      "tre quattro sei sette otto nove dieci dodici tredici venti trenta cento mille quatro cinquenta dezoito vinte trinta doze",
  ),
);
/** Long number words are also caught inside a longer run of letters (for example glued to a unit). */
const NUMBER_SUBSTRINGS = list(
  "twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty hundred thousand million billion dozen",
);
const UNIT_WORDS =
  "minutes?|mins?|seconds?|secs?|hours?|hrs?|days?|weeks?|months?|years?|blocks?|miles?|kilometers?|kilometres?|lanes?|households|residents|people|workers|homes|groups|areas";
/**
 * "one" is an ordinary pronoun ("the one that", "one of the options"), so it is rejected only where
 * it reads as a quantity: next to a unit ("one minute") or after a word that introduces a value
 * ("by one", "is one.", "only one").
 */
const ONE_WITH_UNIT = new RegExp(
  `\\bone[- ](?:${UNIT_WORDS})\\b|\\b(?:by|is|are|was|were|be|to|of|about|around|nearly|almost|only|just|exactly|at|from)\\s+one\\b(?!\\s+(?:of|that|which|who|option|bundle|corridor|link|connector))`,
  "i",
);

const ROMAN = /^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/i;
const ROMAN_OK_WORDS = new Set(["mix"]);

/**
 * Direction and magnitude words. A model must not author "better", "cuts", "halves" or
 * "cheaper": the application prints the direction next to a filled number, computed from the real
 * sign. Fragments are joined where a word could trip the repository wording checks.
 */
const DIRECTION_WORDS = new RegExp(
  "^(?:" +
    [
      "improv\\w*", "reduc\\w*", "cuts?", "cutting", "sav(?:e|es|ed|ing|ings)", "gain(?:s|ed|ing)?", "boost\\w*", "eas(?:e|es|ed|ing)",
      "increas\\w*", "decreas\\w*", "lower(?:s|ed|ing)?", "higher", "rais(?:e|es|ed|ing)", "drop(?:s|ped|ping)?",
      "grow(?:s|n|ing|th)?", "shrink(?:s|ing)?", "shrank", "shorten\\w*", "lengthen\\w*",
      "faster", "slower", "quicker", "shorter", "longer", "better", "worse", "worsen\\w*", "cheaper", "costlier", "pricier",
      "smaller", "larger", "bigger", "greater", "lesser", "easier", "harder", "best", "cheapest", "fastest", "more", "less", "fewer",
      "extra", "most", "least", "than", "beat(?:s|ing)?", "outperform\\w*", "exceed\\w*",
    ].join("|") +
    ")$",
  "i",
);

const BANNED_WORDS = [
  ["dis", "patch\\w*"].join(""),
  ["tri", "age\\w*"].join(""),
  ["real[- ]?", "time"].join(""),
  ["prioriti", "[sz]\\w*"].join(""),
  ["respon", "ders?"].join(""),
  ["life[- ]?", "sav\\w*"].join(""),
  ["lives?\\s+", "saved"].join(""),
  ["sav(?:e|es|ed|ing)\\s+(?:a\\s+|\\w+\\s+)?", "li(?:fe|ves)"].join(""),
];
const BANNED_RE = new RegExp(`\\b(?:${BANNED_WORDS.join("|")})\\b`, "i");
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

const CHARSET_BAD = /[^A-Za-z .,;:!?'"‘’“”\-–—\p{N}]/u;
const ANY_NUMBER = /\p{N}/u;
const INVISIBLE = /[\p{Cf}­]/gu;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ProseOptions {
  /** Exact identifiers that may appear even though they contain digits (catalog IDs, minted bundle IDs). */
  allowedTokens?: readonly string[];
  slots?: SlotPolicy;
}

/** The text as the screen sees it: invisible characters gone, NFKC-folded, whitespace collapsed. */
export function normalizeProse(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Z}\s]+/gu, " ")
    .trim();
}

/** Returns the list of problems (empty when the text is acceptable prose). */
export function proseIssues(text: string, opts: ProseOptions = {}): ProseIssue[] {
  const issues: ProseIssue[] = [];
  const policy = opts.slots ?? {};
  const bad = (code: ProseIssueCode, message: string) => {
    if (!issues.some((i) => i.code === code)) issues.push({ code, message });
  };
  let t = normalizeProse(text);

  t = t.replace(SLOT_TOKEN, (_m, body: string) => {
    const slot = parseSlot(body);
    if (!slot) bad("bad_slot", "a placeholder is not an allowed slot");
    else if (!slotAllowed(slot, policy)) bad("bad_slot", "a placeholder names a figure this text may not use");
    return " ";
  });
  if (t.includes("{{") || t.includes("}}")) {
    bad("bad_slot", "malformed placeholder braces");
    t = t.replace(/[{}]/g, " ");
  }

  for (const tok of opts.allowedTokens ?? []) {
    if (!tok) continue;
    const re = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(tok)}(?![A-Za-z0-9_-])`, "g");
    t = t.replace(re, "$1 ");
  }

  if (ANY_NUMBER.test(t)) bad("digits", "prose contains digits; cite numbers only as {{slot}} placeholders");
  if (CHARSET_BAD.test(t)) bad("charset", "prose may use plain letters and basic punctuation only");

  const words = t.match(/[A-Za-z]+/g) ?? [];
  const lower = words.map((w) => w.toLowerCase());
  const number =
    lower.some((w) => NUMBER_TOKENS.has(w)) ||
    lower.some((w) => w.length > 6 && NUMBER_SUBSTRINGS.some((n) => w.includes(n))) ||
    ONE_WITH_UNIT.test(t) ||
    words.some((w) => w.length >= 2 && ROMAN.test(w) && !ROMAN_OK_WORDS.has(w.toLowerCase())) ||
    words.some((w) => /^(?=.*O)(?=.*[lI])[lIO]{2,}$/.test(w));
  if (number) bad("number_word", "prose contains a number word or numeral; cite numbers only as {{slot}} placeholders");

  if (words.some((w) => DIRECTION_WORDS.test(w))) {
    bad("direction", "prose may not state a direction or size of change; the application adds it next to filled numbers");
  }
  if (LINK_RE.test(t) || BARE_DOMAIN.test(t)) bad("link", "prose must not contain links or markup");
  if (BANNED_RE.test(t) || SQUEEZED_BANNED.test(t.replace(/[^A-Za-z]/g, ""))) {
    bad("wording", "prose uses operational-emergency vocabulary; describe counterfactual planning only");
  }
  return issues;
}

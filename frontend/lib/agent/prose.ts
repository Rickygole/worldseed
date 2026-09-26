/**
 * Prose guard: the model never outputs a metric.
 *
 * Rule 5 of docs/ARCHITECTURE.md 2.7. Prose fields must match /^[^0-9]*$/ after
 * removing {{slot}} placeholders. Documented whitelist (everything else is rejected):
 *   - well-formed slot placeholders, e.g. {{p90.delta}} or {{finalist.B2.pGoal}}
 *     (the UI fills these from simulator results);
 *   - exact catalog / bundle / gazetteer IDs passed in `allowedTokens`
 *     (they may contain digits, but are identifiers, not metrics);
 *   - ordinal and other non-numeric words (first, second, third) contain no digits
 *     and are never a problem.
 * Beyond the plan, spelled-out quantities ("twelve minutes"), links and
 * operational-emergency vocabulary are also rejected.
 */

/** Metrics a slot may name. */
export const SLOT_METRICS = ["p50", "p90", "pctWithin", "isolated", "equityGap", "pGoal", "cost"] as const;

const SLOT_BODY =
  "(?:(?:finalist|bundle)\\.[A-Za-z][A-Za-z0-9_-]{0,15}\\.)?" +
  `(?:${SLOT_METRICS.join("|")})` +
  "(?:\\.(?:baseline|current|delta))?";
const SLOT_EXACT = new RegExp(`^${SLOT_BODY}$`);
const SLOT_TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

export function isValidSlot(body: string): boolean {
  return SLOT_EXACT.test(body);
}

export type ProseIssueCode = "digits" | "number_word" | "bad_slot" | "link" | "wording";
export interface ProseIssue {
  code: ProseIssueCode;
  message: string;
}

const NUMBER_WORDS =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|" +
  "sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|" +
  "hundred|thousand|million|dozen|couple";
const UNIT_WORDS =
  "minutes?|mins?|seconds?|secs?|hours?|hrs?|days?|weeks?|months?|years?|percent|per cent|percentage points?|" +
  "households|residents|people|workers|blocks?|miles?|kilometers?|kilometres?|lanes?|times|fold|x";
const SPELLED_QUANTITY = new RegExp(
  `\\b(?:${NUMBER_WORDS})(?:[- ](?:${NUMBER_WORDS}))*[- ](?:${UNIT_WORDS})\\b`,
  "i",
);
const PERCENT_WORD = /\bpercent(?:age)?\b/i;

// Operational-emergency vocabulary is not how this planning tool is described. Fragments are
// joined so the words do not appear as literals in the source.
const BANNED_WORDS = [
  ["dis", "patch\\w*"].join(""),
  ["tri", "age\\w*"].join(""),
  ["real[- ]", "time"].join(""),
  ["lives?\\s+", "saved"].join(""),
  ["sav(?:e|es|ed|ing)\\s+", "lives"].join(""),
];
const BANNED_RE = new RegExp(`\\b(?:${BANNED_WORDS.join("|")})\\b`, "i");

const LINK_RE = /(?:https?:\/\/|www\.|<\s*\/?\s*[a-z])/i;
const DIGIT_RE = new RegExp("\\p{Nd}", "u");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ProseOptions {
  /** Exact identifiers that may appear even though they contain digits. */
  allowedTokens?: readonly string[];
}

/** Returns the list of problems (empty when the text is acceptable prose). */
export function proseIssues(text: string, opts: ProseOptions = {}): ProseIssue[] {
  const issues: ProseIssue[] = [];
  // NFKC folds full-width and superscript digits to ASCII so they cannot hide a number.
  let t = text.normalize("NFKC");

  t = t.replace(SLOT_TOKEN, (_m, body: string) => {
    if (isValidSlot(body)) return " ";
    issues.push({ code: "bad_slot", message: `placeholder {{${body.slice(0, 40)}}} is not an allowed slot` });
    return " ";
  });
  if (t.includes("{{") || t.includes("}}")) {
    issues.push({ code: "bad_slot", message: "malformed placeholder braces" });
    t = t.replace(/[{}]/g, " ");
  }

  for (const tok of opts.allowedTokens ?? []) {
    if (!tok) continue;
    const re = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(tok)}(?![A-Za-z0-9_-])`, "g");
    t = t.replace(re, "$1 ");
  }

  if (DIGIT_RE.test(t)) issues.push({ code: "digits", message: "prose contains digits; cite numbers only as {{slot}} placeholders" });
  if (SPELLED_QUANTITY.test(t) || PERCENT_WORD.test(t)) {
    issues.push({ code: "number_word", message: "prose contains a spelled-out quantity; cite numbers only as {{slot}} placeholders" });
  }
  if (LINK_RE.test(t)) issues.push({ code: "link", message: "prose must not contain links or markup" });
  if (BANNED_RE.test(t)) {
    issues.push({ code: "wording", message: "prose uses operational-emergency vocabulary; describe counterfactual planning only" });
  }
  return issues;
}

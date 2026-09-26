/**
 * The optional "model reasoning" field: a deliberate, labeled exception to the rule that no
 * model-written text reaches a reader.
 *
 * A planner or critic reply may carry a `reasoning` string. It is shown ONLY inside a collapsed
 * section of the decision log, labeled REASONING_LABEL, with the model name, token counts and
 * latency of that step. It is never used for any decision, never on a card, and never placed
 * inside a log sentence that carries a figure.
 *
 * The screen checks only properties that make the text safe to render as plain text: length,
 * ASCII characters, no digits, no links, no markup or code. It does NOT check that the text is
 * true or free of claims ("it is much better" passes). That is why the label says raw and
 * unverified, and why a reader is told it is not a result. A failing field is blanked (and the
 * decision log says so); it never rejects the reply.
 */
export const REASONING_MAX_CHARS = 600;
export const REASONING_LABEL = "Model reasoning (raw, unverified; not a result)";

export type ReasoningProblem = "not_text" | "too_long" | "charset" | "digits" | "link" | "markup";

export type ReasoningVerdict = { ok: true; text: string } | { ok: false; problems: ReasoningProblem[] };

/** Letters, spaces and a small set of sentence punctuation. Nothing that can form markup, a path or code. */
const ALLOWED = /^[A-Za-z .,;:'"()?!-]*$/;
const LINK = /(?:https?|ftp|file|data|javascript):|\bwww\.|\/\/|\b[a-z0-9-]+\.(?:com|org|net|io|gov|edu|us|co|ai|dev|app|info|biz|me|md)\b/i;

export function screenReasoning(raw: unknown): ReasoningVerdict {
  if (typeof raw !== "string") return { ok: false, problems: ["not_text"] };
  // Whitespace of every kind (newline, tab, NBSP) becomes a single space; then the text must fit.
  const text = raw.replace(/\s+/g, " ").trim();
  const problems: ReasoningProblem[] = [];
  if (text.length > REASONING_MAX_CHARS) problems.push("too_long");
  if (/\d/u.test(text) || /\p{Nd}/u.test(text)) problems.push("digits");
  if (LINK.test(text)) problems.push("link");
  if (/[`<>[\]{}\\|*_#=@~^$%&+/]/.test(text)) problems.push("markup");
  if (!ALLOWED.test(text)) problems.push("charset");
  return problems.length > 0 ? { ok: false, problems } : { ok: true, text };
}

/** Fixed wording for the log when a field was blanked. Names the failed properties (from a fixed list), never the text. */
export function reasoningWithheldSentence(problems: readonly ReasoningProblem[]): string {
  return `Model reasoning was withheld because it did not pass the plain-text screen (${[...new Set(problems)].join(", ")}); the answer itself was used.`;
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

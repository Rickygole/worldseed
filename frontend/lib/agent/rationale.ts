/**
 * The planner's and critic's "why", as a SELECTION from a fixed set of application sentences.
 *
 * A model never writes a sentence that reaches a reader through this path (its one other text
 * field, the optional plain-text `reasoning`, is a separate, labeled exception: see reasoning.ts). It picks a `kind` (and optionally one catalog
 * candidate to focus on); the application renders the sentence from the table below, and the
 * sentence appears only in the decision log, labeled RATIONALE_LABEL. Finalist cards contain no
 * model text at all. Every sentence describes what the planner weighed, never what a plan
 * achieves, and the whole table is checked against the prose screen (tests, and at render time).
 */
import { z } from "zod";
import type { Catalog } from "./catalog";
import { proseIssues } from "./prose";

export const RATIONALE_LABEL = "AI rationale (unverified; not a result)";

export const RATIONALE_KINDS = [
  "spread_mechanisms",
  "cheap_first",
  "goal_metric",
  "worst_case",
  "equity",
  "combine_complementary",
  "extend_kept",
  "mix_of_types",
  "respond_to_stress",
  "avoid_single_point",
] as const;
export type RationaleKind = (typeof RATIONALE_KINDS)[number];

/** What each kind means, in the words the reader sees. */
export const RATIONALE_TEXT: Record<RationaleKind, string> = {
  spread_mechanisms: "The planner chose options that work through different kinds of intervention.",
  cheap_first: "The planner considered the cost tier first.",
  goal_metric: "The planner weighed the goal metric you set first.",
  worst_case: "The planner weighed the unluckiest simulated futures first.",
  equity: "The planner weighed the gap between areas first.",
  combine_complementary: "The planner combined options that touch different parts of the network.",
  extend_kept: "The planner built on the bundles it kept.",
  mix_of_types: "The planner picked finalists of different intervention types.",
  respond_to_stress: "The planner weighed the stress test result first.",
  avoid_single_point: "The planner favored options that rely on different links.",
};

/** Optional catalog id the rationale focuses on; the model-facing schema pins it to the eligible candidates. */
export function makeRationaleSchema(candidateId: z.ZodType<string> = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)) {
  return z.strictObject({ kind: z.enum(RATIONALE_KINDS), focus: candidateId.optional() });
}
export const RationaleSchema = makeRationaleSchema();
export type Rationale = z.infer<typeof RationaleSchema>;

/**
 * The sentence for a rationale, or "" when it cannot be shown (the caller then skips the log
 * entry). The rendered text is run through the prose screen as a guard against a future edit of
 * the table that would let a claim in.
 */
export function renderRationale(r: Rationale, catalog: Pick<Catalog, "byId">): string {
  const base = RATIONALE_TEXT[r.kind];
  if (!base) return "";
  const c = r.focus ? catalog.byId.get(r.focus) : undefined;
  const text = c ? `${base} Focus: ${c.id} (cost tier ${c.costTier}).` : base;
  return proseIssues(base, { allowedTokens: [], profile: "rationale" }).length > 0 ? "" : text;
}

/** The decision-log sentence: the label, then the rendered text. */
export function rationaleLogSentence(text: string, who?: string): string {
  return `${RATIONALE_LABEL}${who ? ` (${who})` : ""}: ${text}`;
}

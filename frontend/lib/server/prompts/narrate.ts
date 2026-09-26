import type { CandidatePromptView } from "../../agent/catalog";
import type { NarrateRequest } from "../../agent/protocol";
import type { BaselineRow, EvaluationRow } from "../../agent/tools";
import { FRAMING, RATIONALE_RULE, candidateLines, lensDescription, messages, schemaBlock } from "./shared";

export const NARRATE_SCHEMA_NAME = "narration";

/**
 * The narrator sees only IDs, candidates and cost tiers, never a result or a direction. It picks a
 * rationale kind per finalist; the application renders the sentence into the decision log only.
 * No narrator output ever reaches a finalist card.
 */
export function buildNarrateMessages(i: {
  req: NarrateRequest;
  used: readonly CandidatePromptView[];
  rows: readonly EvaluationRow[];
  baseline?: BaselineRow;
  jsonSchema: Record<string, unknown>;
}) {
  const system = [
    FRAMING,
    `TASK: for each of the 3 finalist bundles return an item with its bundleId and a rationale selection (a kind, optionally a focus candidate id). Mission lens: ${lensDescription(i.req.mission.lens)}. Do not rank the finalists and do not recommend one.`,
    RATIONALE_RULE,
    `Candidates used:\n${candidateLines(i.used)}`,
    schemaBlock(i.jsonSchema),
  ].join("\n\n");
  const byId = new Map(i.rows.map((r) => [r.bundleId, r]));
  const lines = i.req.finalists.map((f) => {
    const r = byId.get(f.bundleId);
    return `- ${f.bundleId} | candidates ${r?.candidateIds.join("+") ?? "unknown"} | cost ${r?.costTier ?? "unknown"}`;
  });
  return messages(system, `Finalists:\n${lines.join("\n")}\n\nReturn your narrate action now.`);
}

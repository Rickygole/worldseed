import type { CandidatePromptView } from "../../agent/catalog";
import type { NarrateRequest } from "../../agent/protocol";
import type { BaselineRow, EvaluationRow } from "../../agent/tools";
import { FRAMING, NUMBER_RULE, candidateLines, lensDescription, messages, schemaBlock } from "./shared";

export const NARRATE_SCHEMA_NAME = "narration";

/**
 * The narrator sees only IDs, candidates and cost tiers, never a result or a direction, so it has
 * nothing to repeat. Headlines and result lines on the cards are application templates; the
 * narrator writes one commentary per finalist about mechanism.
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
    `TASK: write the AI commentary for each of the 3 finalist bundles. Mission lens: ${lensDescription(i.req.mission.lens)}. Each item has bundleId and a commentary of one to three sentences (at most 420 characters) on the bundle's MECHANISM: what its candidates physically or operationally do, which corridor or shore they touch, what they depend on, and the cost tier in words. The application prints the headline and every result next to your commentary, so never mention results. Do not rank the finalists, do not recommend one, do not say any of them is best.`,
    NUMBER_RULE,
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

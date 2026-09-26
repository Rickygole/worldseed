import type { CandidatePromptView } from "../../agent/catalog";
import type { NarrateRequest } from "../../agent/protocol";
import type { BaselineRow, EvaluationRow } from "../../agent/tools";
import { FRAMING, NUMBER_RULE, candidateLines, lensDescription, messages, schemaBlock } from "./shared";

export const NARRATE_SCHEMA_NAME = "narration";

type Direction = "better" | "worse" | "about the same";
const dir = (delta: number, lowerIsBetter = true): Direction => {
  if (Math.abs(delta) < 1e-9) return "about the same";
  return (delta < 0) === lowerIsBetter ? "better" : "worse";
};

/**
 * The narrator sees only qualitative directions, never the numbers, so there is nothing to repeat.
 * Numbers reach the reader through placeholders that the application fills from simulator results.
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
    `TASK: write a short reader-facing note for each of the 3 finalist bundles. Mission lens: ${lensDescription(i.req.mission.lens)}. Each item has bundleId, a headline (a few words) and a body of one to three sentences that explain the bundle's mechanism and what it leaves unresolved. Weave in figures ONLY as placeholders about that item's own bundle, for example "the worst case is now {{p90.current}} against {{p90.baseline}} before". The application prints the direction of any change. Do not rank the finalists, do not recommend one, do not say any of them is best.`,
    NUMBER_RULE,
    `Candidates used:\n${candidateLines(i.used)}`,
    schemaBlock(i.jsonSchema),
  ].join("\n\n");
  const byId = new Map(i.rows.map((r) => [r.bundleId, r]));
  const lines = i.req.finalists.map((f) => {
    const r = byId.get(f.bundleId);
    const b = i.baseline;
    const q = r && b
      ? `p90 ${dir(r.p90S - b.p90S)} than baseline; isolated groups ${dir(r.isolatedCount - b.isolatedCount)}; equity gap ${dir(r.equityGapS - b.equityGapS)}`
      : "no baseline comparison available";
    return `- ${f.bundleId} | candidates ${r?.candidateIds.join("+") ?? "unknown"} | cost ${r?.costTier ?? "unknown"} | ${q}`;
  });
  return messages(system, `Finalists:\n${lines.join("\n")}\n\nReturn your narrate action now.`);
}

import type { CandidatePromptView } from "../../agent/catalog";
import type { CritiqueRequest } from "../../agent/protocol";
import type { BaselineRow, EvaluationRow } from "../../agent/tools";
import { FRAMING, candidateLines, evaluationTable, lensDescription, messages, schemaBlock } from "./shared";

export const CRITIQUE_SCHEMA_NAME = "critic_action";

export function buildCritiqueMessages(i: {
  req: CritiqueRequest;
  used: readonly CandidatePromptView[];
  rows: readonly EvaluationRow[];
  baseline?: BaselineRow;
  jsonSchema: Record<string, unknown>;
}) {
  const system = [
    FRAMING,
    `TASK: you are the skeptical reviewer of candidate bundles. Mission lens: ${lensDescription(i.req.mission.lens)}. Read the simulator table and raise concerns a careful planner should weigh: worst_case (poor outcomes in the unluckiest futures), equity (who is left behind), cost, feasibility (lead time, hypothetical status).`,
    "concerns: each names an evaluated bundleId and a kind (no free text: the application writes the sentence for each kind). veto: optional list of evaluated bundle ids that should not be finalists. You do not pick winners and you do not recommend.",
    `Candidates used in the bundles:\n${candidateLines(i.used)}`,
    schemaBlock(i.jsonSchema),
  ].join("\n\n");
  const user = `Simulator results (evaluation tool message):\n${evaluationTable(i.rows, i.baseline, i.req.dropped)}\n\nReturn your critique action now.`;
  return messages(system, user);
}

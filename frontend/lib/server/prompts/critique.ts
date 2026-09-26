import type { CandidatePromptView } from "../../agent/catalog";
import type { CritiqueRequest } from "../../agent/protocol";
import type { BaselineRow, EvaluationRow } from "../../agent/tools";
import { stressLabel, stressOptionLines } from "../../agent/stress";
import type { StressResultRequest } from "../../agent/protocol";
import { FRAMING, REASONING_RULE, RATIONALE_RULE, candidateLines, evaluationTable, lensDescription, messages, schemaBlock, stressTable } from "./shared";

export const CRITIQUE_SCHEMA_NAME = "critic_action";

export function buildCritiqueMessages(i: {
  req: CritiqueRequest;
  used: readonly CandidatePromptView[];
  rows: readonly EvaluationRow[];
  baseline?: BaselineRow;
  jsonSchema: Record<string, unknown>;
  stresses?: readonly StressResultRequest[];
}) {
  const system = [
    FRAMING,
    `TASK: you are the skeptical reviewer of candidate bundles. Mission lens: ${lensDescription(i.req.mission.lens)}. Read the simulator table and raise concerns a careful planner should weigh: worst_case (poor outcomes in the unluckiest futures), equity (who is left behind), cost, feasibility (lead time, hypothetical status).`,
    `STRESS TEST: you also choose ONE stress test for the simulator to run on the leading bundles, from this closed list (choose exactly one member; anything else is rejected). Pick the condition you think the leading bundles depend on most, so the test can expose a weak bundle:\n${stressOptionLines()}\nYou may not choose a stress that was already run (listed below). You do not describe the stress in words; the application labels it and the simulator computes every result.`,
    "concerns: each names an evaluated bundleId and a kind (no free text: the application writes the sentence for each kind). veto: optional list of evaluated bundle ids that should not be finalists. You do not pick winners and you do not recommend.",
    RATIONALE_RULE,
    REASONING_RULE,
    `Candidates used in the bundles:\n${candidateLines(i.used)}`,
    schemaBlock(i.jsonSchema),
  ].join("\n\n");
  const done = (i.stresses ?? []).map((st) => stressTable(stressLabel(st.stress), st.evaluations, st.baseline, i.req.mission.lens));
  const user = `Simulator results (evaluation tool message):\n${evaluationTable(i.rows, i.baseline, i.req.dropped, i.req.mission.lens)}${done.length ? `\n\nStress tests already run (choose a different one):\n${done.join("\n\n")}` : ""}\n\nReturn your critique action now.`;
  return messages(system, user);
}

import type { CandidatePromptView } from "../../agent/catalog";
import type { PlanRequest } from "../../agent/protocol";
import { CONCERN_TEXT, type BaselineRow, type EvaluationRow, type PlannerActionName } from "../../agent/tools";
import {
  FRAMING,
  RATIONALE_RULE,
  candidateLines,
  evaluationTable,
  lensDescription,
  messages,
  schemaBlock,
} from "./shared";

export const PLAN_SCHEMA_NAME = "planner_action";

const ACTION_RULES: Record<PlannerActionName, string> = {
  propose:
    "This turn you must return action propose: a rationale, and between 1 and 6 bundles, each listing 1 to 3 distinct candidateIds from the catalog (the application assigns each bundle its id). Vary the bundles: different intervention types, different combinations.",
  refine:
    "This turn you must return action refine: a rationale, keep (ids of bundles worth keeping), drop (ids to stop considering) and add (0 to 4 new bundles, each listing 1 to 3 distinct catalog candidateIds; never repeat a candidate set already evaluated; the application assigns ids). Use the evaluation table to decide, but never quote or describe its results.",
  finalize:
    "This turn you must return action finalize: a rationale and exactly 3 distinct finalists (each just a bundleId) chosen only from evaluated bundles listed in the table that are marked active. Do not rank them and do not recommend one.",
};

export interface PlanPromptInput {
  req: PlanRequest;
  action: PlannerActionName;
  eligible: readonly CandidatePromptView[];
  /** Server-computed rows (cost tier recomputed from the catalog). */
  rows: readonly EvaluationRow[];
  baseline?: BaselineRow;
  excluded: ReadonlySet<string>;
  jsonSchema: Record<string, unknown>;
}

export function buildPlanMessages(i: PlanPromptInput) {
  const m = i.req.mission;
  const system = [
    FRAMING,
    `TASK: you search a closed catalog of hypothetical interventions for a planner. Mission lens: ${lensDescription(m.lens)}. Goal: lower ${m.goal.metric} versus the baseline, using the pGoal column (share of sampled futures meeting the goal) as the yardstick.`,
    `Round ${i.req.round} of at most 3. ${ACTION_RULES[i.action]}`,
    "You only choose IDs from the catalog below and combine 1 to 3 of them per bundle. You cannot invent interventions, parameters or data. You never score anything: the simulator does.",
    RATIONALE_RULE,
    `Catalog (eligible under the mission constraints):\n${candidateLines(i.eligible)}`,
    schemaBlock(i.jsonSchema),
  ].join("\n\n");

  const parts: string[] = [];
  if (i.rows.length === 0) parts.push("No bundles have been evaluated yet.");
  else parts.push(`Simulator results (evaluation tool message):\n${evaluationTable(i.rows, i.baseline, i.req.dropped)}`);
  if (i.req.critique && i.req.critique.concerns.length > 0) {
    // The sentence per kind is written here, on the server; the client sends only bundle and kind.
    parts.push(
      "Critic concerns:\n" + i.req.critique.concerns.map((c) => `- ${c.bundleId} (${c.kind}): ${CONCERN_TEXT[c.kind]}`).join("\n"),
    );
  }
  if (i.excluded.size > 0) parts.push(`Not eligible as finalists: ${[...i.excluded].join(", ")}.`);
  if (i.req.mission.constraints.areas.length > 0) parts.push(`Areas of focus (gazetteer IDs): ${i.req.mission.constraints.areas.join(", ")}.`);
  parts.push(`Return your ${i.action} action now.`);
  return messages(system, parts.join("\n\n"));
}

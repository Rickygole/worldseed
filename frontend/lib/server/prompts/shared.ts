/**
 * Shared prompt pieces. Prompts are built on the server from these templates only; the client
 * never sends prompt text. The catalog subset shows IDs, titles, types and cost tiers, and no
 * numeric effects, so the model reasons about mechanisms and has no figures to repeat.
 */
import type { CandidatePromptView } from "../../agent/catalog";
import { RATIONALE_KINDS } from "../../agent/rationale";
import type { BaselineRow, EvaluationRow } from "../../agent/tools";
import type { ChatMessage } from "../tokenfactory";

export const FRAMING = [
  "You work inside WorldSeed, a counterfactual infrastructure-planning research prototype.",
  "A human planner reviews every output and makes every decision. Nothing you write is operational guidance, and it is never an instruction to any agency.",
  "Never claim that a plan protects, rescues or saves anyone, and never describe what a plan achieves: the simulator computes every result and the application prints it.",
  "Use plain, neutral planning language.",
].join(" ");

/**
 * The rationale rule. The model writes no sentences at all: its "why" is a rationale kind from a
 * fixed list (plus an optional catalog id), and the application renders the wording. Nothing a
 * model writes reaches a reader as text.
 */
export const RATIONALE_RULE = [
  `RATIONALE: you never write a sentence. In the rationale field choose exactly one kind: ${RATIONALE_KINDS.join(", ")}. The application shows the fixed wording for that kind in the decision log, labeled as an unverified AI rationale. Optionally add focus: one catalog candidate id from the list below that the choice centers on.`,
  "Never describe results or outcomes: the simulator computes them and the application prints them. Bundle IDs are assigned by the application; you never invent one.",
].join(" ");

export function candidateLines(views: readonly CandidatePromptView[]): string {
  if (views.length === 0) return "(none)";
  return views
    .map((c) => `- ${c.id} | ${c.type} | cost ${c.costTier} | lead ${c.leadTime}${c.hypothetical ? " | hypothetical" : ""} | ${c.title}`)
    .join("\n");
}

const min = (s: number) => (s / 60).toFixed(1);

/** The compact `evaluation` tool message: simulator results the model may read but never repeat. */
export function evaluationTable(rows: readonly EvaluationRow[], baseline?: BaselineRow, dropped: readonly string[] = []): string {
  const head = "bundle | candidates | p50 min | p90 min | within pct | isolated groups | equity gap min | pGoal | cost | status";
  const lines = rows.map(
    (r) =>
      `${r.bundleId} | ${r.candidateIds.join("+")} | ${min(r.p50S)} | ${min(r.p90S)} | ${r.pctWithin.toFixed(1)} | ${r.isolatedCount} | ${min(r.equityGapS)} | ${
        r.pGoal === null ? "n/a" : Math.round(r.pGoal * 100) + "%"
      } | ${r.costTier} | ${dropped.includes(r.bundleId) ? "dropped" : "active"}`,
  );
  const base = baseline
    ? `\nbaseline (no intervention): p50 ${min(baseline.p50S)} min, p90 ${min(baseline.p90S)} min, within ${baseline.pctWithin.toFixed(1)} pct, isolated ${baseline.isolatedCount}, equity gap ${min(baseline.equityGapS)} min`
    : "";
  return `${head}\n${lines.join("\n")}${base}`;
}

/** Free text from a user is fenced as quoted data and stripped of control characters. */
export function fenceUserText(text: string): string {
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/"""/g, '"').trim();
  return `"""\n${clean}\n"""`;
}

export function lensDescription(lens: "access" | "ems"): string {
  return lens === "access"
    ? "access lens: modeled cross-harbor travel time from neighborhoods to job-weighted destinations"
    : "resilience-check lens: modeled travel time from fire and EMS stations to neighborhoods";
}

export function messages(system: string, user: string): ChatMessage[] {
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function schemaBlock(schema: Record<string, unknown>): string {
  return `JSON schema of your reply (reply with exactly one JSON object, nothing else):\n${JSON.stringify(schema)}`;
}

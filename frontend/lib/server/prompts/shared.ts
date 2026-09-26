/**
 * Shared prompt pieces. Prompts are built on the server from these templates only; the client
 * never sends prompt text. The catalog subset shows IDs, titles, types and cost tiers, and no
 * numeric effects, so the model reasons about mechanisms and has no figures to repeat.
 */
import type { CandidatePromptView } from "../../agent/catalog";
import type { BaselineRow, EvaluationRow } from "../../agent/tools";
import type { ChatMessage } from "../tokenfactory";

export const FRAMING = [
  "You work inside WorldSeed, a counterfactual infrastructure-planning research prototype.",
  "A human planner reviews every output and makes every decision. Nothing you write is operational guidance, and it is never an instruction to any agency.",
  "Never claim that a plan protects, rescues or saves anyone. Describe only how modeled travel access changes under hypothetical interventions.",
  "Use plain, neutral planning language.",
].join(" ");

export const NUMBER_RULE = [
  "NUMBERS: you never output a number, digit, numeral or spelled-out quantity in any text field, in any language. That includes words such as twelve, dozen, half, double, quarter and percent.",
  "Do not write metric names that contain digits (such as p50 or p90) in prose: say median or worst-case travel time instead.",
  "You also never write direction or size words: no better, worse, faster, cheaper, more, less, fewer, than, improves, reduces, cuts, saves, raises, lowers or similar. The application adds the direction next to every filled number. Describe mechanisms and unresolved issues only.",
  "When a figure would help, write a placeholder such as {{p90.baseline}}, {{pctWithin.baseline}} or, only in a finalist's own headline and body, {{p90.delta}}, {{p90.current}}, {{isolated.current}} or {{pGoal}}. The application fills placeholders from simulator results.",
  "Allowed placeholder metrics: p50, p90, pctWithin, isolated, equityGap, pGoal, cost. Allowed suffixes: baseline, current, delta. A placeholder may refer only to the bundle it sits in, never to another bundle.",
  "Refer to candidates and bundles only by their exact IDs as given, never by title. Bundle IDs are assigned by the application; you never invent one.",
  "Write plain English using letters and basic punctuation only. Never include links, markup, brackets or symbols.",
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

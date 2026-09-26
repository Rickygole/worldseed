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
  "Never claim that a plan protects, rescues or saves anyone, and never describe what a plan achieves: the simulator computes every result and the application prints it.",
  "Use plain, neutral planning language.",
].join(" ");

/**
 * The commentary rules. Model text is labeled "AI commentary" and is limited to mechanism and
 * rationale. The screen in lib/agent/prose.ts enforces these rules; this text tells the model what
 * the screen will refuse, so its first answer usually passes.
 */
export const NUMBER_RULE = [
  'COMMENTARY: your text fields are labeled "AI commentary" and describe MECHANISM and RATIONALE only: what an intervention physically or operationally does, which corridor, shore or neighborhood it touches, what it depends on, and its cost tier in words. You never describe results or outcomes: the simulator computes them and the application prints them.',
  "you never output a number, digit, numeral or spelled-out quantity in any text field, in any language: no twelve, dozen, half, double, quarter, percent, and no counts such as two neighborhoods. Say first or second for rank, both for a pair.",
  "You never write words of change or size: no better, worse, faster, cheaper, more, less, fewer, than, improves, reduces, cuts, eases, saves, raises, lowers, fixes, solves, restores, eliminates, all, every, none, nobody, never, always, entire, complete, most, few, tiny, huge, dramatic, sooner, later, baseline. No negations (no, not, cannot). No time units (minutes, hours, days).",
  "Do not write metric names that contain digits (such as p50 or p90).",
  "Refer to candidates and bundles only by their exact IDs as given, never by title. Bundle IDs are assigned by the application; you never invent one.",
  "Write plain English using letters, basic punctuation and parentheses only. Never include links, markup, brackets, slashes or symbols, and never use words about rescue, deployment, routing or operations.",
  'Good commentary: "Combines a harbor shuttle link with retimed signals on the tunnel approach, so it touches both shores and depends on a hypothetical link."',
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

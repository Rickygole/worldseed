import type { Runner } from "./contract";

/**
 * The runner sentence shown in the UI. Every result is computed on the user's own machine; the
 * formatter has no cloud branch.
 */
export function formatRunnerLabel(m: { runner: Runner; workers: number; ms: number }): string {
  const ms = Math.max(0, Math.round(m.ms));
  const w = `${m.workers} worker${m.workers === 1 ? "" : "s"}`;
  return m.runner === "local-browser"
    ? `Computed locally in your browser (${w}, ${ms} ms)`
    : `Computed locally (Node, ${w}, ${ms} ms)`;
}

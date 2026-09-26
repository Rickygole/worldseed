/**
 * Slot filling. Model prose carries placeholders such as {{p90.delta}}; the application replaces
 * them with numbers computed by the simulator. Unresolvable slots become "n/a", never a raw brace.
 *
 * Direction is written HERE, not by the model: a delta is rendered as its size plus "better" or
 * "worse" computed from the real sign and the metric's polarity ("1.7 min worse"). A model
 * sentence such as "reduces the worst case by {{p90.delta}}" therefore cannot mislabel a
 * worsening: the filled figure says which way it went, and the prose screen already refuses
 * comparative and direction words in model text.
 *
 * Scope: a slot resolves only for the focused bundle (the card's own bundle) or against the
 * baseline. A slot that names a different bundle, or a bundle that has no row, is "n/a".
 */
import { parseSlot } from "./prose";
import type { BaselineRow, EvaluationRow } from "./tools";

export interface SlotContext {
  baseline?: BaselineRow;
  rows: readonly EvaluationRow[];
  /** Bundle used for slots that omit the bundle segment. Slots may not name any other bundle. */
  focusBundleId?: string;
}

/** Lower is better for every metric except the share of people reached within the time limit. */
const LOWER_IS_BETTER: Record<string, boolean> = { p50: true, p90: true, equityGap: true, isolated: true, pctWithin: false };

function value(metric: string, row: EvaluationRow | BaselineRow): number | null | undefined {
  switch (metric) {
    case "p50":
      return row.p50S;
    case "p90":
      return row.p90S;
    case "equityGap":
      return row.equityGapS;
    case "pctWithin":
      return row.pctWithin;
    case "isolated":
      return row.isolatedCount;
    case "pGoal":
      return "pGoal" in row ? row.pGoal : undefined;
    default:
      return undefined;
  }
}

function level(metric: string, n: number): string {
  if (metric === "p50" || metric === "p90" || metric === "equityGap") return `${(n / 60).toFixed(1)} min`;
  if (metric === "pctWithin") return `${n.toFixed(0)}%`;
  if (metric === "pGoal") return `${Math.round(n * 100)}%`;
  return `${Math.round(n)}`;
}

/** Size of a change plus a direction computed from its sign, or "no change" when it rounds to zero. */
function change(metric: string, d: number): string {
  let size: string;
  let shown: number;
  if (metric === "p50" || metric === "p90" || metric === "equityGap") {
    shown = Math.abs(d) / 60;
    size = `${shown.toFixed(1)} min`;
  } else if (metric === "pctWithin") {
    shown = Math.abs(d);
    size = `${shown.toFixed(1)} points`;
  } else {
    shown = Math.abs(Math.round(d));
    size = `${shown} ${shown === 1 ? "group" : "groups"}`;
  }
  if (Number(shown.toFixed(1)) === 0 || shown === 0) return "no change";
  const improved = LOWER_IS_BETTER[metric] ? d < 0 : d > 0;
  return `${size} ${improved ? "better" : "worse"}`;
}

export function makeSlotResolver(ctx: SlotContext): (slot: string) => string | undefined {
  const byId = new Map<string, EvaluationRow>();
  for (const r of ctx.rows) if (!byId.has(r.bundleId)) byId.set(r.bundleId, r);
  return (slotBody) => {
    const slot = parseSlot(slotBody);
    if (!slot) return undefined;
    if (slot.bundleId !== undefined && ctx.focusBundleId !== undefined && slot.bundleId !== ctx.focusBundleId) return undefined;
    const bundleId = slot.bundleId ?? ctx.focusBundleId;
    const row = bundleId ? byId.get(bundleId) : undefined;
    if (slot.bundleId !== undefined && !row) return undefined; // a named bundle must have a scored row
    const variant = slot.variant ?? "current";
    if (slot.metric === "cost") return row?.costTier;
    if (variant === "baseline") {
      const b = ctx.baseline ? value(slot.metric, ctx.baseline) : undefined;
      return typeof b === "number" ? level(slot.metric, b) : undefined;
    }
    if (!row) return undefined;
    const cur = value(slot.metric, row);
    if (typeof cur !== "number") return undefined;
    if (variant === "delta") {
      const b = ctx.baseline ? value(slot.metric, ctx.baseline) : undefined;
      return typeof b === "number" && slot.metric !== "pGoal" ? change(slot.metric, cur - b) : undefined;
    }
    return level(slot.metric, cur);
  };
}

export function fillSlots(text: string, resolve: (slot: string) => string | undefined): string {
  return text.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_m, body: string) => resolve(body) ?? "n/a");
}

/**
 * The result lines of a finalist card. Every line is an application template filled from the
 * bundle's own simulator row and the baseline: the real value, the baseline, and a direction
 * computed from the real sign ("1.7 min worse"). No model text is involved, so a card cannot
 * state a result the simulator did not produce.
 */
export function cardLines(row: EvaluationRow, baseline: BaselineRow | undefined, lens: "access" | "ems"): string[] {
  const travel = lens === "access" ? "Cross-harbor travel time" : "Station-to-neighborhood travel time";
  const line = (label: string, metric: string): string => {
    const cur = value(metric, row);
    if (typeof cur !== "number") return `${label}: not computed`;
    const base = baseline ? value(metric, baseline) : undefined;
    if (typeof base !== "number") return `${label}: ${level(metric, cur)}`;
    return `${label}: ${level(metric, cur)} (baseline ${level(metric, base)}; ${change(metric, cur - base)})`;
  };
  return [
    line(`${travel}, median`, "p50"),
    line(`${travel}, worst case (90th percentile)`, "p90"),
    line("Reached within the goal", "pctWithin"),
    line("Isolated groups", "isolated"),
    line("Equity gap", "equityGap"),
    row.pGoal === null ? "Chance of meeting the goal: not computed" : `Chance of meeting the goal: ${level("pGoal", row.pGoal)} of sampled futures`,
    `Cost tier: ${row.costTier}`,
  ];
}

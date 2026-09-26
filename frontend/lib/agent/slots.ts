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

/** The value as it is displayed: minutes and percentages to one decimal, groups whole, chance in whole percent. */
function shown(metric: string, n: number): number {
  if (metric === "p50" || metric === "p90" || metric === "equityGap") return Math.round((n / 60) * 10) / 10;
  if (metric === "pctWithin") return Math.round(n * 10) / 10;
  if (metric === "pGoal") return Math.round(n * 100);
  return Math.round(n);
}

function level(metric: string, n: number): string {
  const v = shown(metric, n);
  if (metric === "p50" || metric === "p90" || metric === "equityGap") return `${v.toFixed(1)} min`;
  if (metric === "pctWithin") return `${v.toFixed(1)}%`;
  if (metric === "pGoal") return `${v}%`;
  return `${v}`;
}

/**
 * Size of a change plus a direction, both computed from the DISPLAYED values (the same rounding as
 * `level`), so the text can never contradict itself: two figures that display as equal are "no
 * change", and "0.1 min better" only ever appears next to figures that differ by 0.1 min.
 */
function change(metric: string, cur: number, base: number): string {
  const d = Math.round((shown(metric, cur) - shown(metric, base)) * 10) / 10;
  if (d === 0) return "no change";
  const size = Math.abs(d);
  let text: string;
  if (metric === "p50" || metric === "p90" || metric === "equityGap") text = `${size.toFixed(1)} min`;
  else if (metric === "pctWithin") text = `${size.toFixed(1)} points`;
  else text = `${size} ${size === 1 ? "group" : "groups"}`;
  const improved = LOWER_IS_BETTER[metric] ? d < 0 : d > 0;
  return `${text} ${improved ? "better" : "worse"}`;
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
      return typeof b === "number" && slot.metric !== "pGoal" ? change(slot.metric, cur, b) : undefined;
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
    return `${label}: ${level(metric, cur)} (baseline ${level(metric, base)}; ${change(metric, cur, base)})`;
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

/* ------------------------------- stress tests ------------------------------ */

const METRIC_NOUN: Record<string, string> = {
  p50: "median travel-time",
  p90: "worst-case (90th percentile) travel-time",
  isolated: "isolated-group",
  equityGap: "equity-gap",
};

function slotMetric(goal: string): string {
  return goal === "isolatedCount" ? "isolated" : goal === "equityGap" ? "equityGap" : goal;
}

/** A benefit is the metric's improvement over the baseline (lower is better for every goal metric), computed from displayed values. */
function benefit(metric: string, baseline: number, value: number): number {
  return Math.round((shown(metric, baseline) - shown(metric, value)) * 10) / 10;
}

function benefitText(metric: string, b: number): string {
  const sign = b < 0 ? "minus " : "";
  const n = Math.abs(b);
  if (metric === "p50" || metric === "p90" || metric === "equityGap") return `${sign}${n.toFixed(1)} min`;
  return `${sign}${Math.round(n)} ${Math.round(n) === 1 ? "group" : "groups"}`;
}

/**
 * The application's sentence for one bundle under a stress, computed from real rows. The benefit is
 * the goal metric's improvement over the matching baseline (normal and stressed). Direction words
 * come from the sign of the difference between the two DISPLAYED benefits:
 *   "B2 loses 3.2 min of its worst-case (90th percentile) travel-time benefit (from 5.0 min to 1.8 min)"
 *   "B3 keeps all of its ... benefit (5.0 min)"   "B4 gains 0.4 min of its ... benefit (from ... to ...)"
 * Without a stress baseline only the level under stress is stated.
 */
export function stressBenefitLine(
  goal: string,
  bundleId: string,
  normal: { baseline?: BaselineRow; row: EvaluationRow },
  stressed: { baseline?: BaselineRow; row: EvaluationRow },
): string {
  const metric = slotMetric(goal);
  const noun = METRIC_NOUN[metric] ?? "goal-metric";
  const cur = value(metric, stressed.row);
  if (typeof cur !== "number") return `${bundleId} was not scored on the ${noun} measure under this stress.`;
  const nb = normal.baseline ? value(metric, normal.baseline) : undefined;
  const sb = stressed.baseline ? value(metric, stressed.baseline) : undefined;
  const nv = value(metric, normal.row);
  if (typeof nb !== "number" || typeof sb !== "number" || typeof nv !== "number") {
    return `Under this stress ${bundleId} scores ${level(metric, cur)} on the ${noun} measure (no stressed baseline was available, so its benefit is not stated).`;
  }
  const before = benefit(metric, nb, nv);
  const after = benefit(metric, sb, cur);
  const d = Math.round((after - before) * 10) / 10;
  if (d === 0) return `Under this stress ${bundleId} keeps all of its ${noun} benefit (${benefitText(metric, after)}).`;
  const size = benefitText(metric, Math.abs(d));
  return d < 0
    ? `Under this stress ${bundleId} loses ${size} of its ${noun} benefit (from ${benefitText(metric, before)} to ${benefitText(metric, after)}).`
    : `Under this stress ${bundleId} gains ${size} on its ${noun} benefit (from ${benefitText(metric, before)} to ${benefitText(metric, after)}).`;
}

/** How much WORSE a bundle's own goal metric is under a stress than without it (positive = worse), unrounded. Used to pick the stress that hurts the leaders most. */
export function benefitLoss(goal: string, normalRow: EvaluationRow, stressedRow: EvaluationRow): number {
  const metric = slotMetric(goal);
  const a = value(metric, normalRow);
  const b = value(metric, stressedRow);
  return typeof a === "number" && typeof b === "number" ? b - a : 0;
}

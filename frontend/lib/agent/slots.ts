/**
 * Slot filling. Model prose carries placeholders such as {{p90.delta}}; the UI replaces them with
 * numbers computed by the simulator. Unresolvable slots become "n/a", never a raw brace.
 */
import { isValidSlot } from "./prose";
import type { BaselineRow, EvaluationRow } from "./tools";

export interface SlotContext {
  baseline?: BaselineRow;
  rows: readonly EvaluationRow[];
  /** Bundle used for slots that omit the bundle segment. */
  focusBundleId?: string;
}

type Variant = "current" | "baseline" | "delta";

const minutes = (s: number, signed: boolean): string => {
  const m = s / 60;
  const txt = m.toFixed(1);
  return `${signed && m > 0 ? "+" : ""}${txt} min`;
};

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

function format(metric: string, n: number, delta: boolean): string {
  if (metric === "p50" || metric === "p90" || metric === "equityGap") return minutes(n, delta);
  if (metric === "pctWithin") return delta ? `${n > 0 ? "+" : ""}${n.toFixed(1)} pts` : `${n.toFixed(0)}%`;
  if (metric === "pGoal") return `${Math.round(n * 100)}%`;
  return `${delta && n > 0 ? "+" : ""}${Math.round(n)}`;
}

export function makeSlotResolver(ctx: SlotContext): (slot: string) => string | undefined {
  const byId = new Map(ctx.rows.map((r) => [r.bundleId, r]));
  return (slot) => {
    if (!isValidSlot(slot)) return undefined;
    const parts = slot.split(".");
    let bundleId = ctx.focusBundleId;
    if (parts[0] === "finalist" || parts[0] === "bundle") {
      bundleId = parts[1];
      parts.splice(0, 2);
    }
    const metric = parts[0];
    const variant = (parts[1] as Variant | undefined) ?? "current";
    const row = bundleId ? byId.get(bundleId) : undefined;
    if (metric === "cost") return row?.costTier;
    if (variant === "baseline") {
      const b = ctx.baseline ? value(metric, ctx.baseline) : undefined;
      return typeof b === "number" ? format(metric, b, false) : undefined;
    }
    if (!row) return undefined;
    const cur = value(metric, row);
    if (typeof cur !== "number") return undefined;
    if (variant === "delta") {
      const b = ctx.baseline ? value(metric, ctx.baseline) : undefined;
      return typeof b === "number" ? format(metric, cur - b, true) : undefined;
    }
    return format(metric, cur, false);
  };
}

export function fillSlots(text: string, resolve: (slot: string) => string | undefined): string {
  return text.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_m, body: string) => resolve(body) ?? "n/a");
}

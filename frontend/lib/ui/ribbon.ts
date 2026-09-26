/**
 * The five ribbon numbers, read from `SimOutput.detail.lenses` (all three lenses are computed on every run,
 * so these never depend on which lens drives the terrain). Values are kept in their natural unit; the ribbon
 * formats them. Nothing here is typed by hand.
 */
import type { LensId } from "../sim/contract";
import type { SimOutput } from "../sim/types";

export type RibbonKey = "xhTime" | "xhPeople" | "xhLowWage" | "regional" | "ems";

export const RIBBON_KEYS: RibbonKey[] = ["xhTime", "xhPeople", "xhLowWage", "regional", "ems"];

export interface RibbonValues {
  /** Population mean of the job-weighted mean time to all opposite-shore jobs, seconds. */
  xhTime: number;
  /** Residents losing more than 10 percent of their cross-harbor jobs within 30 min. */
  xhPeople: number;
  /** Low-wage workers (by home) losing more than 10 percent. */
  xhLowWage: number;
  /** Regional access: population mean added time, seconds (0 in the baseline by definition). */
  regional: number;
  /** EMS: population-weighted p90 first-response time, seconds. */
  ems: number;
}

export interface RibbonExtras {
  xhAddedP99S: number;
  xhAddedMaxS: number;
  xhPeopleGt25: number;
  popCovered: number;
  lowWageCovered: number;
  peopleSharePct: number;
  lowWageSharePct: number;
  regionalP90S: number;
  emsPctWithin: number;
}

export const RIBBON_LENS: Record<RibbonKey, LensId> = {
  xhTime: "xharbor",
  xhPeople: "xharbor",
  xhLowWage: "xharbor",
  regional: "access",
  ems: "ems",
};

export function ribbonValues(out: SimOutput | null): { v: RibbonValues; x: RibbonExtras } | null {
  const L = out?.detail?.lenses;
  const xh = L?.xharbor.xharbor;
  if (!L || !xh) return null;
  const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : 0);
  return {
    v: {
      xhTime: xh.popMeanMeanTimeS,
      xhPeople: xh.popLossGt10pct,
      xhLowWage: xh.lowWageLossGt10pct,
      regional: L.access.popAddedS ?? 0,
      ems: L.ems.p90S,
    },
    x: {
      xhAddedP99S: xh.addedP99S,
      xhAddedMaxS: xh.addedMaxS,
      xhPeopleGt25: xh.popLossGt25pct,
      popCovered: xh.popCovered,
      lowWageCovered: xh.lowWageCovered,
      peopleSharePct: pct(xh.popLossGt10pct, xh.popCovered),
      lowWageSharePct: pct(xh.lowWageLossGt10pct, xh.lowWageCovered),
      regionalP90S: L.access.p90S,
      emsPctWithin: L.ems.pctWithin,
    },
  };
}

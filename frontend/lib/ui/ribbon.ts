/**
 * The five ribbon numbers, read from `SimOutput.detail.lenses` (all three lenses are computed on every run,
 * so these never depend on which lens drives the terrain). Values are kept in their natural unit; the ribbon
 * formats them. Nothing here is typed by hand.
 */
import type { LensId } from "../sim/contract";
import type { SimOutput } from "../sim/types";

export type RibbonKey = "xhTime" | "xhPeople" | "xhLowWage" | "regional" | "ems";

/** People affected first; the average trip (a small number over a million residents) last. */
export const RIBBON_KEYS: RibbonKey[] = ["xhPeople", "xhLowWage", "regional", "ems", "xhTime"];

/** Equity wording from the computed shares (percent of low-wage workers vs percent of all residents losing >10%). */
export function equityWording(lowWagePct: number, allPct: number): { text: string; tone: "bad" | "neutral" } {
  const gap = lowWagePct - allPct;
  if (Math.abs(gap) < 0.25) return { text: "About the same rate as all residents", tone: "neutral" };
  return gap > 0 ? { text: "Hit more often than all residents", tone: "bad" } : { text: "Hit less often than all residents", tone: "neutral" };
}

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
  /** Worst added time among hexes where people live (the unweighted max includes empty industrial land). */
  xhAddedMaxPopS: number;
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

/** Points a ribbon sparkline shows: the last twelve runs of the session. */
export const SPARK_POINTS = 12;

export const sparkTail = (values: readonly number[], n = SPARK_POINTS): number[] => values.slice(-n);

/**
 * Tone of a ribbon delta: direction times whether up is good for THAT metric. Every ribbon number today is
 * lower-is-better (people affected, drive and response times, hazmat minutes), so up is worse unless told otherwise.
 */
export function deltaTone(d: number, flat: number, upIsGood = false): "worse" | "better" | "flat" {
  if (!Number.isFinite(d) || Math.abs(d) < flat) return "flat";
  return d > 0 === upIsGood ? "better" : "worse";
}

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
      xhAddedMaxPopS: xh.addedMaxPopulatedS ?? xh.addedP99S,
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

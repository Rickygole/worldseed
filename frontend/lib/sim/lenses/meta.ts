/**
 * Display metadata for the lenses, listed in `SnapshotInfo.lenses` so the UI and the AI layer name the search
 * measures without hard-coding them. `measures` maps a search-row field to the label to show for this lens.
 */
import type { LensId } from "../contract";

export type MeasureKey = "p50S" | "p90S" | "pctWithin" | "isolatedCount" | "equityGapS";

export interface LensDisplay {
  id: LensId;
  label: string;
  /** Unit of the seconds-valued measures when shown ("min"). */
  unitLabel: string;
  /** false: no per-hex terrain (freight shows a trips list). */
  hasTerrain: boolean;
  measures: Partial<Record<MeasureKey, string>>;
  /** One sentence on what p50S / p90S / isolatedCount are, for tooltips. */
  note: string;
}

export const LENS_DISPLAY: Record<LensId, LensDisplay> = {
  xharbor: {
    id: "xharbor",
    label: "Cross-harbor access",
    unitLabel: "min",
    hasTerrain: true,
    measures: { p50S: "Typical cross-harbor travel time", p90S: "Slow-end cross-harbor travel time", pctWithin: "Share with a small detour", isolatedCount: "Cut-off block groups", equityGapS: "Equity gap (low-wage workers minus everyone)" },
    note: "Mean travel time to the jobs on the other shore, per hex; the detour is measured against the baseline.",
  },
  access: {
    id: "access",
    label: "Regional access",
    unitLabel: "min",
    hasTerrain: true,
    measures: { p50S: "Typical job-access time", p90S: "Slow-end job-access time", pctWithin: "Share with a small added time", isolatedCount: "Cut-off block groups", equityGapS: "Equity gap (low-wage workers minus everyone)" },
    note: "Job-weighted driving time to the regional job centers.",
  },
  ems: {
    id: "ems",
    label: "First response",
    unitLabel: "min",
    hasTerrain: true,
    measures: { p50S: "Typical first-response time", p90S: "Slow-end first-response time", pctWithin: "Share within the response threshold", isolatedCount: "Isolated block groups", equityGapS: "Equity gap (zero-vehicle households minus everyone)" },
    note: "Call-processing and turnout delay plus travel time from the nearest station.",
  },
  freight: {
    id: "freight",
    label: "Hazmat freight",
    unitLabel: "min",
    hasTerrain: false,
    measures: { p50S: "Typical hazmat cross-harbor detour", p90S: "Slow-end hazmat detour", isolatedCount: "Trips with long detours", pctWithin: "Share of trips without a long detour" },
    note: "Added time versus before the collapse on the 24 cross-harbor trips of a hazmat truck (both tunnels are closed to it). A long detour is more than 5 minutes. A trip with no route counts as 2 hours added.",
  },
};

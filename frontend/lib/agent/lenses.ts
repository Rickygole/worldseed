/**
 * Per-lens wording and rules, written by the application (never by a model).
 *
 * Lenses: access (cross-harbor travel to destinations), ems (station-to-neighborhood travel) and
 * freight. For freight the simulator's rows mean:
 *   p50S = median over the 24 cross-harbor hazmat-truck trips of (trip time in the world minus the
 *          trip time on the pre-collapse network, same future);
 *   p90S = the 90th percentile of the same;
 *   isolatedCount = trips with more than 300 s added ("trips with long detours");
 *   equityGapS = 0 (not applicable), pctWithin not used.
 * So the goal metrics offered for freight are p50, p90 and isolatedCount; equityGap is not.
 */
import type { GoalMetric } from "./tools";

export type LensName = "access" | "ems" | "freight";

/** Number of hazmat-truck trips in the freight lens, and the added time that makes a trip a "long detour". */
export const FREIGHT_TRIPS = 24;
export const FREIGHT_LONG_DETOUR_S = 300;

/** Goal metrics a mission of this lens may name. */
export function goalMetricsFor(lens: LensName): readonly GoalMetric[] {
  return lens === "freight" ? ["p50", "p90", "isolatedCount"] : ["p50", "p90", "isolatedCount", "equityGap"];
}

export function metricOffered(lens: LensName, metric: GoalMetric): boolean {
  return goalMetricsFor(lens).includes(metric);
}

/** What a goal metric is called for this lens (used in mission readings and stress sentences). */
export function metricLabel(lens: LensName, metric: GoalMetric): string {
  if (lens === "freight") {
    if (metric === "p50") return "typical hazmat cross-harbor detour";
    if (metric === "p90") return "slow-end hazmat detour";
    if (metric === "isolatedCount") return "trips with long detours";
    return "the equity gap (not offered for freight)";
  }
  if (metric === "p50") return "median travel time";
  if (metric === "p90") return "worst-case (90th percentile) travel time";
  if (metric === "isolatedCount") return "isolated groups";
  return "the equity gap";
}

/** Unit noun for a count metric. */
export const countNoun = (lens: LensName, n: number): string => (lens === "freight" ? (n === 1 ? "trip" : "trips") : n === 1 ? "group" : "groups");

/** One sentence describing the lens to a model (server-built). */
export function lensSentence(lens: LensName): string {
  if (lens === "access") return "access lens: modeled cross-harbor travel time from neighborhoods to job-weighted destinations";
  if (lens === "ems") return "resilience-check lens: modeled travel time from fire and EMS stations to neighborhoods";
  return "freight lens: for each of 24 cross-harbor hazmat-truck trips, the added time versus the pre-collapse network in the same future (typical, slow end, and how many trips lose more than five minutes). Trucks carrying hazardous materials are prohibited in the harbor tunnels, so a tunnel closure barely changes their trips unless an escort window is part of the bundle. A negative added time means the trip is faster than on the pre-collapse network; the escort-window options are the levers that reach them. Results describe the effect of a published rule on simulated times, never routing advice; the escort-window options are hypothetical scenario levers, not an agency program";
}

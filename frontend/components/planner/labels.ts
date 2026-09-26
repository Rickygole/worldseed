import type { GoalMetric } from "@/lib/agent/tools";
import { fmtDur } from "@/lib/format";
import { metricLabel as agentMetricLabel, type LensName } from "@/lib/agent/lenses";

type MissionLens = LensName;

/** What each goal metric means on each mission lens (the access mission is scored on the cross-harbor lens). */
export function metricLabel(lens: MissionLens, metric: GoalMetric): string {
  if (lens === "freight") {
    const t = agentMetricLabel("freight", metric);
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  if (lens === "ems") {
    return {
      p90: "Slow-end first response (p90)",
      p50: "Typical first response (median)",
      equityGap: "Equity gap (zero-vehicle households, p90)",
      isolatedCount: "Block groups slower than the response threshold",
    }[metric];
  }
  return {
    p90: "Slow-end cross-harbor trip (p90)",
    p50: "Typical cross-harbor trip (median)",
    equityGap: "Equity gap (low-wage minus everyone, added time)",
    isolatedCount: "Cut-off block groups (more than 10 min added)",
  }[metric];
}

export const lensLabel = (lens: MissionLens): string =>
  lens === "ems" ? "First response (EMS)" : lens === "freight" ? "Hazmat truck detours (freight)" : "Cross-harbor access";

export const isCountMetric = (m: GoalMetric): boolean => m === "isolatedCount";

/** A goal-metric value: durations in s/min, counts as block groups. */
export function fmtMetric(metric: GoalMetric, v: number): string {
  if (!Number.isFinite(v)) return "--";
  if (isCountMetric(metric)) return `${Math.round(v)}`;
  const d = fmtDur(v);
  return `${d.value} ${d.unit}`;
}

/** A signed change in a goal metric. Lower is better for all four metrics. */
export function fmtMetricDelta(metric: GoalMetric, d: number): string {
  if (!Number.isFinite(d)) return "--";
  if (isCountMetric(metric)) {
    const n = Math.round(d);
    return n === 0 ? "no change" : `${n > 0 ? "+" : "-"}${Math.abs(n)}`;
  }
  if (Math.abs(d) < 0.5) return "no change";
  const x = fmtDur(Math.abs(d));
  return `${d > 0 ? "+" : "-"}${x.value} ${x.unit}`;
}

/** Target chips (within X of the pre-collapse network in the same future). */
export function targetChoices(metric: GoalMetric, lens: MissionLens = "access"): { value: number; label: string }[] {
  if (isCountMetric(metric)) return [0, 1, 3].map((v) => ({ value: v, label: v === 0 ? "none more" : `+${v}` }));
  if (lens === "freight") {
    // Hazmat detours with the bridge removed are about 14 min typical and 30+ min at the slow end, so targets of a
    // minute or two are never met by any option; these give P(goal) room to tell options apart.
    return [
      { value: 300, label: "+5 min" },
      { value: 600, label: "+10 min" },
      { value: 900, label: "+15 min" },
    ];
  }
  return [
    { value: 30, label: "+30 s" },
    { value: 60, label: "+1 min" },
    { value: 120, label: "+2 min" },
  ];
}

export const stripHypothetical = (title: string): string => {
  const t = title.replace(/^Hypothetical scenario option:\s*/i, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Cost tiers: shade plus the tier text itself (never color alone). */
export const TIER_COLOR: Record<string, string> = { $: "#c4b5fd", $$: "#a78bfa", $$$: "#7c5cf0" };

/**
 * Stress tests: the closed set of "attacks" the critic may choose from, built by the application.
 *
 * The critic (or the deterministic critic) selects ONE stress from this set; it never describes
 * one in words. The machine hands the chosen stress to the simulator through the evaluator
 * context (`EvaluateContext.stress`), and every number that follows comes from the simulator.
 *
 * Only REAL links of the snapshot are offered (its graph.meta.json `links`): a stress the simulator
 * cannot run would come back with no rows. The Key Bridge link is not offered: it is already closed
 * in the baseline, so closing it changes nothing. A test keeps this list a subset of the snapshot's
 * real links. Time of day uses "midday" here; the simulator's own name for it is "mid", so the
 * evaluator adapter maps `midday` to `mid`.
 */
import { z } from "zod";

export const STRESS_TODS = ["am", "midday", "pm", "night"] as const;
export type StressTod = (typeof STRESS_TODS)[number];

export const STRESS_TOD_LABEL: Record<StressTod, string> = {
  am: "morning peak",
  midday: "midday",
  pm: "evening peak",
  night: "overnight",
};

export const STRESS_LINKS = [
  { id: "L-HARBORTUNNEL", label: "Harbor Tunnel" },
  { id: "L-FORTMCHENRY", label: "Fort McHenry Tunnel" },
] as const;
export type StressLink = (typeof STRESS_LINKS)[number];

const LINK_IDS = STRESS_LINKS.map((l) => l.id) as [StressLink["id"], ...StressLink["id"][]];
export const STRESS_LINK_IDS: readonly string[] = LINK_IDS;

/** The model-facing spec. Every field is an enum, so a model cannot name anything outside the set. */
export const StressSpecSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("close_link"), linkId: z.enum(LINK_IDS) }),
  z.strictObject({ kind: z.literal("time_of_day"), tod: z.enum(STRESS_TODS) }),
  z.strictObject({ kind: z.literal("combined"), linkId: z.enum(LINK_IDS), tod: z.enum(STRESS_TODS) }),
]);
export type StressSpec = z.infer<typeof StressSpecSchema>;

const linkLabel = (id: string): string => STRESS_LINKS.find((l) => l.id === id)?.label ?? id;

/** Application-authored label for a stress. Never derived from model text. */
export function stressLabel(s: StressSpec): string {
  if (s.kind === "close_link") return `${linkLabel(s.linkId)} closed`;
  if (s.kind === "time_of_day") return `${STRESS_TOD_LABEL[s.tod][0].toUpperCase()}${STRESS_TOD_LABEL[s.tod].slice(1)} conditions`;
  return `${linkLabel(s.linkId)} closed during the ${STRESS_TOD_LABEL[s.tod]}`;
}

/** Stable key, used to tell whether a stress was already tried. */
export function stressKey(s: StressSpec): string {
  return s.kind === "close_link" ? `link:${s.linkId}` : s.kind === "time_of_day" ? `tod:${s.tod}` : `both:${s.linkId}:${s.tod}`;
}

/** What the evaluator receives (see EvaluateContext.stress). */
export interface StressContext {
  closedLinks: string[];
  tod?: string;
  label: string;
}

export function stressContext(s: StressSpec): StressContext {
  return {
    closedLinks: s.kind === "time_of_day" ? [] : [s.linkId],
    ...(s.kind === "close_link" ? {} : { tod: s.tod }),
    label: stressLabel(s),
  };
}

/** Every single-link stress, in the deterministic critic's scan order. */
export function linkStresses(): StressSpec[] {
  return STRESS_LINKS.map((l) => ({ kind: "close_link" as const, linkId: l.id }));
}

/** The options list a prompt shows the critic (ids and application labels only). */
export function stressOptionLines(): string {
  return [
    `close_link: linkId one of ${STRESS_LINKS.map((l) => `${l.id} (${l.label})`).join(", ")}`,
    `time_of_day: tod one of ${STRESS_TODS.join(", ")}`,
    "combined: a linkId and a tod together",
  ].join("\n");
}

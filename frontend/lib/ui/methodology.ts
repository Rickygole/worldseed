/**
 * Findings of the sensitivity and validation study (docs/METHODOLOGY.md, snapshot keybridge-2024-03-01-v1).
 * These are documented results of a separate study, not simulator outputs of this session, so every place
 * that shows them says so and links the methodology. They describe the Key Bridge-removed reference world
 * only; the UI shows them only when the world on screen is exactly that world.
 */
import type { LinkId } from "../sim/types";

export const METHODOLOGY_URL = "https://github.com/Rickygole/worldseed/blob/main/docs/METHODOLOGY.md";

export const STUDY_SNAPSHOT = "keybridge-2024-03-01-v1";

/** Residents losing more than 10% of cross-harbor jobs, across free-flow speed and time-budget variants (section 0). */
export const PEOPLE_GT10_RANGE = { lo: 6667, hi: 96450 };

/** Population mean added cross-harbor time across the same variants, seconds (stable, unlike the counts). */
export const MEAN_ADDED_RANGE_S = { lo: 11.4, hi: 17.0 };

/** With tunnel times x1.25 or x1.5 after the closure, the added-time median becomes about 11 to 17 s instead of 0.2 s. */
export const CONGESTED_MEDIAN_ADDED_S = { lo: 10.9, hi: 17.3 };

/** The one reported detour the study could source (section 6.1). */
export const REPORTED_DETOUR = {
  pair: "Dundalk to Ferndale",
  beforeMin: 20,
  afterMin: 41,
  modelAddedMin: 1.2,
  modelAddedBothTunnelsClosedMin: 9.4,
  source: "Capital News Service (via Baltimore Fishbowl), 27 March 2025",
};

/** The news piece behind REPORTED_DETOUR (METHODOLOGY section 6.1 and "News citations"; one clause only, link out). */
export const REPORTED_DETOUR_ARTICLE = {
  title: "Baltimore residents face daily disruptions after Key Bridge collapse",
  byline: "Charlotte Kanner and Mira Beinart, Capital News Service",
  publisher: "Capital News Service, via Baltimore Fishbowl",
  date: "27 March 2025",
  url: "https://baltimorefishbowl.com/stories/baltimore-residents-face-daily-disruptions-after-key-bridge-collapse/",
};

/** Cross-check against the public OSRM router on current OpenStreetMap (section 6.2). */
export const ROUTER_CHECK = { spearman: 0.98, medianRatio: 0.78 };

/** "about 20,000": two significant figures, for counts whose size depends on assumptions. */
export function fmtAbout(v: number): string {
  if (!Number.isFinite(v)) return "--";
  const a = Math.abs(v);
  if (a < 100) return `${Math.round(v)}`;
  const mag = Math.pow(10, Math.floor(Math.log10(a)) - 1);
  return (Math.round(v / mag) * mag).toLocaleString("en-US");
}

export const LOWER_BOUND_SENTENCE =
  `Free-flow times are a lower bound on real disruption: a reported post-collapse commute from ${REPORTED_DETOUR.pair} went from about ` +
  `${REPORTED_DETOUR.beforeMin} to ${REPORTED_DETOUR.afterMin} minutes; this model adds about ${REPORTED_DETOUR.modelAddedMin} minutes for that pair ` +
  `(about ${Math.round(REPORTED_DETOUR.modelAddedBothTunnelsClosedMin)} with both tunnels also closed).`;

export const ROUTER_SENTENCE = `Rank agreement with the public OpenStreetMap router (OSRM) is very high (Spearman ${ROUTER_CHECK.spearman}); the model is about ${Math.round(
  (1 - ROUTER_CHECK.medianRatio) * 100,
)}% faster than that router because free-flow has no signals.`;

/** Size of the free-flow speed variation in the study (all speeds x0.8 and x1.2), percent. */
export const SPEED_VARIANT_PCT = 20;

/**
 * Error of the app's fast cross-harbor variant against the exact calculation for the headline count
 * (METHODOLOGY section 7, fast_vs_exact.json, Key Bridge-removed world): about 2% at the deterministic
 * default (64 anchors per shore), 9 to 11% at the anchor counts the futures use (16 and 32 per shore).
 */
export const FAST_ERR = { defaultPct: 2, futuresPct: { lo: 9, hi: 11 } };

/**
 * FAST_ERR.defaultPct (about 2%) holds for the Key Bridge's own headline count at the default anchor count;
 * it does not hold in general (section 7). Smaller counts - most other rows in the crossing comparison - can
 * be off by as much as this, in either direction (section 7's Harbor Tunnel alone, people losing more than
 * 25%, at the default 64 anchors per shore: +20.0%).
 */
export const FAST_ERR_WORST_PCT = 20;

/** How study-derived figures are labeled wherever they appear. */
export const STUDY_LABEL = "From our sensitivity study";

// ---- the /methodology page (checked against pipeline/sensitivity/out by test/ui/story.test.ts) ----------------

/** The reference run of the study: Key Bridge removed, 30-minute budget, free-flow. */
export const STUDY_REFERENCE = { peopleGt10: 19705, meanAddedS: 13.6, regionalAddedS: 2.9, emsP90S: 367.5, popCovered: 1056263, variants: 51 };

/** The six conclusions fixed before the variants ran, and in how many of the 51 variants each held. */
export const STUDY_CONCLUSIONS: { id: string; plain: string; held: number }[] = [
  { id: "C1", plain: "The regional average barely moves (under 30 seconds)", held: 51 },
  { id: "C2", plain: "Time to the nearest station does not change (under 1 second)", held: 51 },
  { id: "C3", plain: "Only a minority is hit (0.5% to 10% of people)", held: 47 },
  { id: "C4", plain: "The typical resident is unaffected (median under 5 seconds)", held: 48 },
  { id: "C5", plain: "Low-wage workers are hit at about the same rate as everyone", held: 51 },
  { id: "C6", plain: "The same places stay worst-hit (7 of the top 10)", held: 50 },
];

// ---- crossing comparison (section 4.2): one deterministic run per crossing, closed alone or together -------

export interface CrossingComparisonRow {
  /** Matches scenario.removedLinks when this row's ids (order-independent) are exactly what's closed. */
  ids: readonly LinkId[];
  label: string;
  directedEdges: number;
  peopleGt10: number;
  peopleGt25: number;
  lowWageGt10: number;
  xharborMeanAddedS: number;
  xharborAddedP90S: number;
  regionalMeanAddedS: number;
}

/**
 * Single run at default assumptions, each real crossing closed alone or in combination (METHODOLOGY section
 * 4.2, same reference snapshot as STUDY_REFERENCE). Unlike STUDY_REFERENCE, this is ONE run per row, not a
 * 51-variant sensitivity study: that study covers the Key Bridge only (see SINGLE_RUN_LABEL below). EMS is
 * unchanged in every row, including with all three crossings closed (not one of 7,985 hexes moves by 1 s).
 *
 * Golden-data coverage (frontend/test/sim/golden.test.ts): the three single-crossing rows and the two
 * "Bridge + one tunnel" rows are checked against the snapshot's independently-computed golden.json worlds.
 * "Both tunnels" (no bridge) and "Bridge + both tunnels" are transcribed from the doc only; golden.json has
 * no world for either (a known, accepted gap - the Expert mode picker can still reach both live, since the
 * simulator applies close_link generically with no combination-specific logic, see lib/sim/compile.ts; there
 * is no structural reason to expect them to behave differently from the rows that are checked, but they have
 * not been).
 */
export const CROSSING_COMPARISON: readonly CrossingComparisonRow[] = [
  { ids: ["key_bridge"], label: "Key Bridge (I-695)", directedEdges: 6, peopleGt10: 19705, peopleGt25: 11623, lowWageGt10: 1371, xharborMeanAddedS: 13.6, xharborAddedP90S: 26.6, regionalMeanAddedS: 2.9 },
  { ids: ["harbor_tunnel"], label: "Harbor Tunnel (I-895)", directedEdges: 6, peopleGt10: 63272, peopleGt25: 4934, lowWageGt10: 4849, xharborMeanAddedS: 23.9, xharborAddedP90S: 60.3, regionalMeanAddedS: 14.5 },
  { ids: ["fort_mchenry"], label: "Fort McHenry Tunnel (I-95)", directedEdges: 4, peopleGt10: 5207, peopleGt25: 0, lowWageGt10: 404, xharborMeanAddedS: 2.1, xharborAddedP90S: 7.2, regionalMeanAddedS: 3.4 },
  { ids: ["key_bridge", "harbor_tunnel"], label: "Bridge + Harbor Tunnel", directedEdges: 12, peopleGt10: 145876, peopleGt25: 39604, lowWageGt10: 10659, xharborMeanAddedS: 49.8, xharborAddedP90S: 134.8, regionalMeanAddedS: 22.6 },
  { ids: ["key_bridge", "fort_mchenry"], label: "Bridge + Fort McHenry", directedEdges: 10, peopleGt10: 33957, peopleGt25: 12016, lowWageGt10: 2427, xharborMeanAddedS: 16.2, xharborAddedP90S: 47.1, regionalMeanAddedS: 6.8 },
  { ids: ["harbor_tunnel", "fort_mchenry"], label: "Both tunnels", directedEdges: 10, peopleGt10: 151676, peopleGt25: 71083, lowWageGt10: 11178, xharborMeanAddedS: 48.8, xharborAddedP90S: 170.0, regionalMeanAddedS: 35.1 },
  { ids: ["key_bridge", "harbor_tunnel", "fort_mchenry"], label: "Bridge + both tunnels", directedEdges: 16, peopleGt10: 311086, peopleGt25: 153393, lowWageGt10: 21968, xharborMeanAddedS: 105.4, xharborAddedP90S: 298.5, regionalMeanAddedS: 56.6 },
];

/** The row whose ids exactly equal `removedLinks` (order and duplicates ignored), or undefined. */
export function findCrossingComparisonRow(removedLinks: readonly LinkId[]): CrossingComparisonRow | undefined {
  const want = new Set(removedLinks);
  return CROSSING_COMPARISON.find((r) => r.ids.length === want.size && r.ids.every((id) => want.has(id)));
}

/**
 * How a single run (any crossing other than the documented Key Bridge sensitivity study) must be labeled,
 * so its one number is never shown next to, or confused with, the Key Bridge's 51-variant range.
 */
export const SINGLE_RUN_LABEL =
  "Single run at default assumptions. The sensitivity study covers the Key Bridge only; see Methodology §4.2 for the cross-crossing comparison and §4.1 for the noise floor.";

/**
 * Why the highlighted row and the live ribbon below it can disagree even when they describe the same
 * closure: the table is the exact reference calculation above; the ribbon (and every other live number in
 * Expert mode) uses a faster in-browser approximation instead, so the map stays responsive (Methodology §7).
 * Not a contradiction - a documented, known gap between the two methods, typically {{defaultPct}}% but up to
 * {{worstPct}}% for smaller counts.
 */
export const FAST_VS_EXACT_NOTE = `This table is the exact reference calculation; the ribbon above and every other live number here use a faster in-browser approximation for responsiveness, and can differ from it by about ${FAST_ERR.defaultPct}% to as much as ${FAST_ERR_WORST_PCT}% for smaller counts (Methodology §7).`;

/** Selected variants (sensitivity.json names) and what they did to the people count and the added time. */
export const STUDY_VARIANTS: { name: string; plain: string; peopleGt10: number; meanAddedS: number; medianAddedS: number }[] = [
  { name: "speed x1.2: all edges", plain: "All drive speeds 20% faster", peopleGt10: 6667, meanAddedS: 11.4, medianAddedS: 0.2 },
  { name: "speed x0.8: all edges", plain: "All drive speeds 20% slower", peopleGt10: 96277, meanAddedS: 17.0, medianAddedS: 0.2 },
  { name: "T = 36 min", plain: "A 36-minute limit instead of 30", peopleGt10: 6422, meanAddedS: 13.6, medianAddedS: 0.2 },
  { name: "T = 24 min", plain: "A 24-minute limit instead of 30", peopleGt10: 96450, meanAddedS: 13.6, medianAddedS: 0.2 },
  { name: "tunnel time x1.25 only AFTER bridge closure (diversion)", plain: "Tunnels 25% slower after the closure (diverted traffic)", peopleGt10: 39893, meanAddedS: 21.0, medianAddedS: 10.9 },
  { name: "tunnel time x1.5 only AFTER bridge closure (diversion)", plain: "Tunnels 50% slower after the closure", peopleGt10: 76221, meanAddedS: 28.1, medianAddedS: 17.3 },
];

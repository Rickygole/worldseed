/**
 * Findings of the sensitivity and validation study (docs/METHODOLOGY.md, snapshot keybridge-2024-03-01-v1).
 * These are documented results of a separate study, not simulator outputs of this session, so every place
 * that shows them says so and links the methodology. They describe the Key Bridge-removed reference world
 * only; the UI shows them only when the world on screen is exactly that world.
 */
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
  source: "Capital News Service (via Baltimore Fishbowl), 28 March 2025",
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

/** How study-derived figures are labeled wherever they appear. */
export const STUDY_LABEL = "From our sensitivity study";

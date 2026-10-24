/**
 * The "before" of a story scene's own world change (the bridge removed in scene 1, an idea applied in scene 5):
 * the previous terrain field is kept so the map can print the change where it is largest, as a number on the
 * terrain itself ("+2.9 MIN", "WAS +4.9, NOW +4.4 MIN").
 *
 * Honest by construction: it only ever compares the SAME quantity (same lens) across two worlds, never a lens
 * switch, and it reads the exact heights and minutes the terrain showed. (Drawing the old heights as lids was
 * tried and dropped: scene 1's before is flat ground, and scene 5's largest drop is about half a minute, under
 * a pixel at that framing; it could only have been made visible by exaggerating it.)
 */

/**
 * Story scenes whose own action changes the world and draws the before/after, and which change counts: the
 * bridge coming out (scene 1), an idea going in (scene 5). Any other world change, such as the bridge a deep
 * link to scene 5 removes on arrival, makes no ghost, so the map reads the same however the visitor got there.
 */
export const GHOST_SCENES: Readonly<Record<string, (prev: GhostField, now: GhostField) => boolean>> = {
  crossing: (prev, now) => !prev.bridgeRemoved && now.bridgeRemoved,
  fix: (prev, now) => now.mutations > prev.mutations,
};

/** Smallest change (m) worth a label: under about 0.4 min on the added-minutes scale it would read as noise. */
export const GHOST_MIN_GAP_M = 38;

/** The field a ghost is made from: what the terrain showed, which lens, in which world. */
export interface GhostField {
  elev: Float32Array;
  minutes: Float32Array;
  lens: string;
  worldKey: string;
  bridgeRemoved: boolean;
  /** How many changes (applied ideas, closures) the world carries. */
  mutations: number;
}

/** A ghost that belongs to one scene: shown only while that scene and that lens are on screen. */
export interface Ghost extends GhostField {
  scene: string;
}

/**
 * What the ghost becomes when the terrain target changes. A world change in a ghost scene, with the lens
 * unchanged and the scene's own kind of change, makes the previous field the ghost; any other world change or a
 * lens change clears it; a refresh of the same world leaves it alone.
 */
export function nextGhost(current: Ghost | null, prev: GhostField | null, now: GhostField, scene: string | null): Ghost | null {
  if (!prev || prev.lens !== now.lens) return null;
  if (prev.worldKey !== now.worldKey) {
    if (scene === null) return null;
    const counts = GHOST_SCENES[scene];
    return counts && counts(prev, now) ? { ...prev, scene } : null;
  }
  return current;
}

/**
 * The hex that tells the change best: the largest drop (scene 5, an idea applied), else the largest rise
 * (scene 1, where the ghost is flat ground). -1 when nothing moved. `eligible` limits it to hexes where people
 * live (a jobs-only hex is drawn faded on the map and is not "who is affected").
 */
export function ghostPeak(
  ghostElev: ArrayLike<number>,
  nowElev: ArrayLike<number>,
  minGap = GHOST_MIN_GAP_M,
  eligible: (i: number) => boolean = () => true,
): { index: number; kind: "drop" | "rise" } {
  let drop = -1;
  let dropBy = minGap;
  let rise = -1;
  let riseBy = minGap;
  const n = Math.min(ghostElev.length, nowElev.length);
  for (let i = 0; i < n; i++) {
    if (!eligible(i)) continue;
    const d = ghostElev[i] - nowElev[i];
    if (d > dropBy) {
      dropBy = d;
      drop = i;
    } else if (-d > riseBy) {
      riseBy = -d;
      rise = i;
    }
  }
  return drop >= 0 ? { index: drop, kind: "drop" } : { index: rise, kind: rise >= 0 ? "rise" : "drop" };
}

/** Added minutes as the map prints them: one decimal, like the tooltips (whole numbers would overstate a 0.5 min change). */
export function fmtAddedShort(min: number): string {
  return `+${Math.max(0, min).toFixed(1)}`;
}

/**
 * The on-terrain label at the peak: "EDGEMERE  WORST: WAS +4.9, NOW +4.4 MIN", or "WORST: +3.4 MIN" when the
 * old value was nothing. "WORST" disambiguates this from the card's region-wide average in the same scene
 * (for example "about 3 seconds"): this label is the single hardest-hit hex, not the region, and the two
 * numbers are meant to look nothing alike. Plain words, not an arrow: the self-hosted label font is a Latin
 * subset.
 */
export function ghostLabelText(before: number, after: number, place: string | null): string {
  const value = before < 0.05 ? `WORST: ${fmtAddedShort(after)} MIN` : `WORST: WAS ${fmtAddedShort(before)}, NOW ${fmtAddedShort(after)} MIN`;
  return place ? `${place}  ${value}` : value;
}

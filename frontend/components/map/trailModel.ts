/**
 * The freight trail model (pure, no deck): how a route and its real travel minutes become an animation clock.
 *
 *   - a trip takes `minutes / MIN_PER_SEC` seconds on screen (real free-flow minutes, time-compressed), so a
 *     longer detour visibly takes longer; every trip starts together and repeats
 *   - the comet's length is a fixed span of TIME, so a slower trip has a shorter comet in space
 *   - one vehicle per route: no traffic volume is implied (no fake cars)
 */
import { pathFractions } from "./geometry";

/** Minutes of free-flow driving shown per second of screen time. Said on the map. */
export const MIN_PER_SEC = 6;
export const TRAIL_CAPTION = `1 second on screen = ${MIN_PER_SEC} minutes of free-flow driving. Trips start together and repeat.`;
/** Trail length in seconds of screen time. */
export const TRAIL_S = 1.5;
/** Pause before the loop restarts, seconds. */
export const PAUSE_S = 1.6;
/** Animated vehicle cap (routes drawn as trails). */
export const MAX_TRAILS = 150;

export interface TrailRoute {
  tripId: string;
  cls: string;
  crossHarbor: boolean;
  path: [number, number, number][];
  /** Seconds of screen time at each vertex. */
  ts: number[];
  minutes: number;
}

/** The slice of a runTrips result the model reads. */
export interface TripLike {
  id: string;
  kind: string;
  classes: Record<string, { currentMinutes: number | null; route?: { nodes: number[] } }>;
}

export function buildTrailRoutes(trips: readonly TripLike[], coords: { lon: ArrayLike<number>; lat: ArrayLike<number> }): TrailRoute[] {
  const out: TrailRoute[] = [];
  for (const t of trips) {
    for (const [cls, v] of Object.entries(t.classes)) {
      if (!v.route || v.route.nodes.length < 2 || v.currentMinutes === null) continue;
      const ll = v.route.nodes.map((n) => [coords.lon[n], coords.lat[n]] as [number, number]);
      const frac = pathFractions(ll);
      const dur = v.currentMinutes / MIN_PER_SEC;
      out.push({
        tripId: t.id,
        cls,
        crossHarbor: t.kind === "cross_harbor",
        path: ll.map(([x, y]) => [x, y, 22]),
        ts: frac.map((f) => f * dur),
        minutes: v.currentMinutes,
      });
    }
  }
  return out;
}

/** Length of the loop in seconds for a set of routes. */
export function cycleSeconds(routes: readonly TrailRoute[]): number {
  let m = 0;
  for (const r of routes) m = Math.max(m, r.ts[r.ts.length - 1] ?? 0);
  return m + TRAIL_S + PAUSE_S;
}

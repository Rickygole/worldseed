/**
 * Freight trails: an animated comet along each real route the simulator returns (runTrips with routes), one
 * per (trip, vehicle class). Data-encoding only (see trailModel.ts for the clock): hazmat truck is amber, car
 * is teal-white; both draw twice (a wide additive glow under a thin bright line).
 */
import type { Layer } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";

import type { Scenario } from "@/lib/sim";
import { loadNodeCoords } from "@/lib/ui/snapshotAux";
import type { RGBA } from "./geometry";
import { ON_TOP } from "./terrainLayers";
import { ADDITIVE } from "./SoftGlowLayer";
import { buildTrailRoutes, MAX_TRAILS, TRAIL_S, type TrailRoute } from "./trailModel";

export const CAR_RGB: [number, number, number] = [150, 240, 226];
export const HAZMAT_RGB: [number, number, number] = [245, 165, 36];

const cache = new Map<string, Promise<TrailRoute[]>>();

/** Routes for every trip in a world: from the simulator's own runTrips (nodes to lng/lat via the graph). */
export async function loadTrailRoutes(scenario: Scenario): Promise<TrailRoute[]> {
  // Imported lazily so the pure model stays testable without the store.
  const { snapshotSimulator, scenarioKey } = await import("@/lib/store");
  const key = scenarioKey(scenario);
  let p = cache.get(key);
  if (!p) {
    const sb = snapshotSimulator();
    if (!sb) return [];
    p = Promise.all([sb.runTrips(scenario, { includeRoutes: true }), loadNodeCoords()]).then(([res, coords]) => buildTrailRoutes(res.trips, coords));
    p.catch(() => cache.delete(key));
    if (cache.size > 6) cache.delete(cache.keys().next().value as string);
    cache.set(key, p);
  }
  return p;
}

const colorOf = (cls: string): [number, number, number] => (cls === "hazmat_truck" ? HAZMAT_RGB : CAR_RGB);
const rgba = (c: readonly number[], a: number): RGBA => [c[0], c[1], c[2], a];

export interface TrailOpts {
  /** Seconds into the loop. */
  time: number;
  /** Trip to emphasise (bright, wider). */
  highlightId: string | null;
  /** 0..1 fade of the whole set. */
  alpha: number;
  glow: boolean;
  /** Reduced motion: draw the routes as steady lines, no comet. */
  still: boolean;
}

/**
 * The routes to draw: cross-harbor trips (plus the highlighted one), only the highlighted one in "selected"
 * mode, capped at MAX_TRAILS. Memoize the result: a new array every frame would rebuild the GPU buffers.
 */
export function selectTrailRoutes(routes: readonly TrailRoute[], highlightId: string | null, mode: "all" | "selected"): TrailRoute[] {
  let use = routes.filter((r) => r.crossHarbor || r.tripId === highlightId);
  if (mode === "selected") use = use.filter((r) => r.tripId === highlightId);
  return use.slice(0, MAX_TRAILS);
}

export function trailLayers(use: TrailRoute[], o: TrailOpts): Layer[] {
  if (use.length === 0 || o.alpha <= 0.01) return [];
  const hi = (r: TrailRoute) => r.tripId === o.highlightId;
  // With a highlight, everything else steps back.
  const dim = (r: TrailRoute) => (o.highlightId && !hi(r) ? 0.32 : 1);

  const out: Layer[] = [
    new PathLayer<TrailRoute>({
      id: "trail-routes",
      data: use,
      getPath: (r) => r.path,
      getColor: (r) => rgba(colorOf(r.cls), (o.still ? 170 : 62) * o.alpha * dim(r) * (hi(r) ? 1.8 : 1)),
      getWidth: (r) => (hi(r) ? 2.4 : 1.2),
      widthUnits: "pixels",
      jointRounded: true,
      capRounded: true,
      parameters: ON_TOP,
      pickable: false,
      updateTriggers: { getColor: [o.alpha, o.highlightId, o.still], getWidth: o.highlightId },
    }),
  ];
  if (o.still) return out;

  const common = {
    data: use,
    getPath: (r: TrailRoute) => r.path,
    getTimestamps: (r: TrailRoute) => r.ts,
    currentTime: o.time,
    trailLength: TRAIL_S,
    fadeTrail: true,
    capRounded: true,
    jointRounded: true,
    widthUnits: "pixels" as const,
    pickable: false,
  };
  if (o.glow) {
    out.push(
      new TripsLayer<TrailRoute>({
        ...common,
        id: "trail-glow",
        getColor: (r) => rgba(colorOf(r.cls), 84 * o.alpha * dim(r)),
        getWidth: (r) => (hi(r) ? 15 : 9),
        parameters: ADDITIVE,
        updateTriggers: { getColor: [o.alpha, o.highlightId], getWidth: o.highlightId },
      }),
    );
  }
  out.push(
    new TripsLayer<TrailRoute>({
      ...common,
      id: "trail-core",
      getColor: (r) => rgba(colorOf(r.cls), 255 * o.alpha * dim(r)),
      getWidth: (r) => (hi(r) ? 4 : 2.6),
      parameters: ON_TOP,
      updateTriggers: { getColor: [o.alpha, o.highlightId], getWidth: o.highlightId },
    }),
  );
  return out;
}

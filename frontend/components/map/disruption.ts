/**
 * One-shot choreography for the moment a change lands: a shockwave ring expanding from the disruption's real
 * origin (the same distance metric that drives the staggered terrain rise, so its radius at any instant is a
 * real quantity — "how far the stagger has reached" — not a decorative animation with its own invented pace),
 * a brief bright flash at the origin, and, on recovery, a traveling pulse of light riding the option line as it
 * draws itself in. Everything here plays exactly once per real event and is fully driven by that event's own
 * progress (0 to 1); nothing loops or idles.
 *
 * Honesty note: the ring's radius is Euclidean distance from the origin (`Cell.bridgeKm` / the same `dist`
 * array `MapStage` already builds for the stagger), not a true shortest-path-on-the-road-network distance —
 * the client does not have a cheap way to compute a live network isochoron from the compiled graph. It is the
 * same real number already driving which hexes have started rising, so the ring's leading edge always matches
 * the leading edge of the terrain change; it just does not literally bend to follow individual streets.
 */
import type { Layer } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";

import { tipOf, type Path3, type RGBA } from "./geometry";
import { ON_TOP } from "./terrainLayers";
import SoftGlowLayer, { ADDITIVE } from "./SoftGlowLayer";

const KM_PER_DEG_LAT = 110.57;
const kmPerDegLng = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

/** A point `kmOut` km from `origin`, `frac` of the way around the circle (0..1). Local equirectangular approx, fine at this scale (matches lib/geo.ts). */
function ringPoint(origin: [number, number], kmOut: number, frac: number): [number, number] {
  const ang = frac * Math.PI * 2;
  const dy = Math.sin(ang) * kmOut;
  const dx = Math.cos(ang) * kmOut;
  return [origin[0] + dx / kmPerDegLng(origin[1]), origin[1] + dy / KM_PER_DEG_LAT];
}

const RING_SEGMENTS = 96;

/**
 * The expanding ring: `progress` 0..1 over the disruption's own lead-in (shorter than and ahead of the terrain
 * stagger, so the ring visibly arrives at a place just before that hex starts rising), `maxKm` the same
 * normalizing distance the stagger uses. Fades in, travels, fades out; a thin bright core under a soft glow.
 */
export function shockwaveLayers(origin: [number, number], progress: number, maxKm: number, color: readonly [number, number, number], glow: boolean): Layer[] {
  if (progress <= 0 || progress >= 1 || maxKm <= 0) return [];
  const radiusKm = progress * maxKm * 1.05;
  const path: Path3 = [];
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const [lng, lat] = ringPoint(origin, radiusKm, i / RING_SEGMENTS);
    path.push([lng, lat, 20]);
  }
  // Fades in quickly, holds, fades out as it completes so it never looks like it "stops" mid-map.
  const alphaEnv = Math.min(1, progress * 6) * Math.min(1, (1 - progress) * 2.2);
  const data = [{ path }];
  const out: Layer[] = [];
  if (glow) {
    out.push(
      new PathLayer<{ path: Path3 }>({
        id: "shockwave-glow",
        data,
        getPath: (d) => d.path,
        getColor: [color[0], color[1], color[2], 130 * alphaEnv],
        getWidth: 14,
        widthUnits: "pixels",
        jointRounded: true,
        capRounded: true,
        pickable: false,
        parameters: ADDITIVE,
      }),
    );
  }
  out.push(
    new PathLayer<{ path: Path3 }>({
      id: "shockwave-core",
      data,
      getPath: (d) => d.path,
      getColor: [255, 255, 255, 210 * alphaEnv],
      getWidth: 2.2,
      widthUnits: "pixels",
      jointRounded: true,
      capRounded: true,
      pickable: false,
      parameters: ON_TOP,
    }),
  );
  return out;
}

/** A brief bright flash at the disruption's origin: peaks fast, fades over the same lead-in as the ring. */
export function originPulseLayer(point: [number, number], progress: number, color: readonly [number, number, number], glow: boolean): Layer[] {
  if (!glow || progress <= 0 || progress >= 1) return [];
  const rise = Math.min(1, progress * 5);
  const fall = 1 - progress;
  const k = rise * fall;
  if (k <= 0.02) return [];
  return [
    new SoftGlowLayer<{ p: [number, number] }>({
      id: "disruption-pulse",
      data: [{ p: point }],
      getPosition: (d) => [d.p[0], d.p[1], 26],
      getRadius: 90 + 900 * (1 - fall),
      radiusUnits: "meters",
      billboard: true,
      getFillColor: [color[0], color[1], color[2], 230 * k],
      parameters: ADDITIVE,
      pickable: false,
    }),
  ];
}

/**
 * The traveling pulse riding an option's "draws itself in" line: a bright glow that rides the leading tip of
 * the reveal (see `drawPrefix`/`tipOf` in geometry.ts) so the line reads as being drawn by a moving point of
 * light, not just growing on its own.
 */
export function travelingPulseLayer(revealed: readonly Path3[], progress: number, color: readonly [number, number, number], glow: boolean): Layer[] {
  if (!glow || progress <= 0 || progress >= 1) return [];
  const tip = tipOf(revealed);
  if (!tip) return [];
  return [
    new SoftGlowLayer<{ p: Path3[number] }>({
      id: "option-draw-pulse",
      data: [{ p: tip }],
      getPosition: (d) => d.p,
      getRadius: 46,
      radiusUnits: "pixels",
      billboard: true,
      getFillColor: [255, 255, 255, 235] as RGBA,
      parameters: ADDITIVE,
      pickable: false,
    }),
    new SoftGlowLayer<{ p: Path3[number] }>({
      id: "option-draw-pulse-wide",
      data: [{ p: tip }],
      getPosition: (d) => d.p,
      getRadius: 100,
      radiusUnits: "pixels",
      billboard: true,
      getFillColor: [color[0], color[1], color[2], 140] as RGBA,
      parameters: ADDITIVE,
      pickable: false,
    }),
  ];
}

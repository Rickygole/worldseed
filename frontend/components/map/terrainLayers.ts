/**
 * Terrain layers: the extruded H3 columns (the data), a thin bright rim on tall columns, a soft glow at the
 * peak, and hover/selection outlines. Everything here encodes the simulator's numbers (height and color come
 * from lib/ui/lenses); nothing is decorative.
 */
import { LayerExtension, type Layer } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { cellToLatLng } from "h3-js";

import { hexRing, mixRgb, smoothstep, type Path3 } from "./geometry";
import { TERRAIN_MATERIAL } from "./lighting";
import SoftGlowLayer, { ADDITIVE } from "./SoftGlowLayer";
import type { HexEdge } from "./terrainEdges";
import { aoSegments } from "./terrainEdges";

export interface HexDatum {
  i: number;
  id: string;
}

/** Overlays (markers, routes, selection) draw over the terrain regardless of depth. */
export const ON_TOP = { depthCompare: "always" as const };

/** Where a hex's residents are zero (ports, industrial land): drawn faded so a tall empty tower reads as such. */
const JOB_ONLY_ALPHA = 0.32;

/** Columns darken toward their base (ambient occlusion feel) so height reads without changing the hue. */
class BaseShade extends LayerExtension {
  static extensionName = "BaseShade";
  getShaders() {
    return {
      inject: {
        "vs:#main-end": `
          float baseT = (positions.z + 1.0) / 2.0;
          float tallK = clamp(instanceElevations / 300.0, 0.0, 1.0);
          vColor.rgb *= mix(1.0, mix(0.4, 1.14, baseT), tallK);
        `,
      },
    };
  }
}
const BASE_SHADE = new BaseShade();

export interface TerrainCells {
  edgeFade: number;
  residents?: number;
}

export interface TerrainOpts {
  pickable?: boolean;
  selected?: Set<number> | null;
  /** Scene opacity multiplier, 0..1. */
  opacity?: number;
  shade?: boolean;
}

/** Terrain layer for an encoded field (used by the main map and the compare overlay). */
export function terrainLayer(
  id: string,
  hexData: HexDatum[],
  elev: Float32Array,
  rgb: Float32Array,
  cells: TerrainCells[],
  tick: number,
  opts: TerrainOpts = {},
): Layer {
  const selected = opts.selected ?? null;
  return new H3HexagonLayer<HexDatum>({
    id,
    data: hexData,
    getHexagon: (h) => h.id,
    extruded: true,
    // Near-full coverage closes the black seam between every hex (the biggest single reason the field read as
    // discrete painted blocks instead of continuous relief): two neighbors at the same real value now touch
    // almost edge to edge, and the only boundary line left is the AO groove drawn where they actually differ.
    coverage: 0.985,
    opacity: opts.opacity ?? 1,
    pickable: opts.pickable ?? false,
    getElevation: (h) => elev[h.i],
    getFillColor: (h) => {
      const k = h.i * 3;
      const raised = elev[h.i] > 4;
      const c = cells[h.i];
      const jobOnly = c.residents === 0;
      let r = rgb[k];
      let g = rgb[k + 1];
      let b = rgb[k + 2];
      if (selected?.has(h.i)) {
        // Selected block group: lift toward the text color so it reads without relying on hue.
        r += (230 - r) * 0.35;
        g += (237 - g) * 0.35;
        b += (243 - b) * 0.35;
      }
      if (jobOnly) {
        // Desaturate toward the muted gray and fade: nobody lives here.
        r += (139 - r) * 0.45;
        g += (152 - g) * 0.45;
        b += (169 - b) * 0.45;
      }
      return [r, g, b, (raised ? 235 : 130) * c.edgeFade * (jobOnly ? JOB_ONLY_ALPHA : 1)];
    },
    updateTriggers: { getElevation: tick, getFillColor: [tick, selected] },
    material: TERRAIN_MATERIAL,
    extensions: opts.shade === false ? [] : [BASE_SHADE],
    autoHighlight: opts.pickable ?? false,
    highlightColor: [230, 237, 243, 46],
  });
}

/** Elevation (m) above which a column gets a rim and glow. One fixed scale, never rescaled per result. */
export const RIM_MIN_ELEV = 60;
export const GLOW_MIN_ELEV = 190;
export const GLOW_FULL_ELEV = 620;

/** Hexes worth a rim or glow: tall now or tall at the target. Recomputed when the target changes, not per frame. */
export function tallHexes(hexData: HexDatum[], elevNow: Float32Array, elevTarget: Float32Array, min: number): HexDatum[] {
  const out: HexDatum[] = [];
  for (const h of hexData) if (elevNow[h.i] > min || elevTarget[h.i] > min) out.push(h);
  return out;
}

/**
 * Thin bright edges on tall columns: the column silhouette catches the eye where the change is. `vel` (the
 * animator's real per-hex rate of change, optional) brightens a column further while it is actively rising or
 * sinking, so a column visibly in motion reads as "still moving" and fades back to its resting brightness the
 * instant it settles, by construction (vel is exactly 0 at rest, never a separate decorative timer).
 */
export function rimLayer(tall: HexDatum[], elev: Float32Array, rgb: Float32Array, tick: number, opacity: number, vel?: Float32Array): Layer {
  return new H3HexagonLayer<HexDatum>({
    id: "terrain-rim",
    data: tall,
    getHexagon: (h) => h.id,
    extruded: true,
    filled: false,
    wireframe: true,
    coverage: 0.985,
    opacity,
    getElevation: (h) => elev[h.i],
    getLineColor: (h) => {
      const k = h.i * 3;
      const [r, g, b] = mixRgb([rgb[k], rgb[k + 1], rgb[k + 2]], [255, 255, 255], 0.5);
      const moving = vel ? smoothstep(0.15, 3, vel[h.i]) : 0;
      return [r, g, b, 34 + 150 * smoothstep(RIM_MIN_ELEV, 500, elev[h.i]) + 70 * moving];
    },
    getLineWidth: (h) => 1 + (vel ? 1.4 * smoothstep(0.15, 3, vel[h.i]) : 0),
    lineWidthUnits: "pixels",
    lineWidthMinPixels: 1,
    pickable: false,
    updateTriggers: { getElevation: tick, getLineColor: tick, getLineWidth: tick },
  });
}

/** Cache of hex centers by id: h3 lookups only once per cell. */
const centers = new Map<string, [number, number]>();
function centerOf(id: string): [number, number] {
  let c = centers.get(id);
  if (!c) {
    const [lat, lng] = cellToLatLng(id);
    c = [lng, lat];
    centers.set(id, c);
  }
  return c;
}

/**
 * A soft additive glow at the top of the tallest columns (a wide translucent disc under the thin bright rim).
 * Brightness and size follow the column's height, so it is exactly as strong as the number it sits on.
 */
export function glowLayer(tall: HexDatum[], elev: Float32Array, rgb: Float32Array, tick: number, opacity: number): Layer {
  const peak = tall.filter((h) => elev[h.i] > GLOW_MIN_ELEV);
  return new SoftGlowLayer<HexDatum>({
    id: "terrain-glow",
    data: peak,
    pickable: false,
    getPosition: (h) => {
      const [lng, lat] = centerOf(h.id);
      return [lng, lat, elev[h.i]];
    },
    // Urgency reads in the glow's size, not only its opacity: the worst-hit peak should look, at a glance,
    // like the one place on the map that needs attention. Both ends of the ramp scale with the real elevation.
    getRadius: (h) => 260 + elev[h.i] * 0.62,
    radiusUnits: "meters",
    billboard: true,
    getFillColor: (h) => {
      const k = h.i * 3;
      const t = smoothstep(GLOW_MIN_ELEV, GLOW_FULL_ELEV, elev[h.i]);
      return [rgb[k], rgb[k + 1], rgb[k + 2], 16 + 150 * t * t];
    },
    opacity,
    parameters: ADDITIVE,
    updateTriggers: { getPosition: tick, getRadius: tick, getFillColor: tick },
  });
}

/**
 * The AO groove layer: dark lines along exactly the hex-boundary edges that currently have a real height gap,
 * as dark as that gap is big (see terrainEdges.ts). Recomputed every animation frame from the live elevation,
 * so the grooves appear and fade with the real transition, not as a static decal.
 */
export function terrainAOLayer(edges: readonly HexEdge[], elev: Float32Array, tick: number, opacity: number): Layer {
  const segs = aoSegments(edges, elev);
  return new PathLayer<{ path: Path3; a: number }>({
    id: "terrain-ao",
    data: segs,
    getPath: (d) => d.path,
    getColor: (d) => [5, 7, 11, d.a],
    getWidth: 2,
    widthUnits: "pixels",
    opacity,
    pickable: false,
    updateTriggers: { getPath: tick, getColor: tick },
  });
}

/** Hover / selection outline: a wide translucent ring under a thin bright one. */
export function hexOutline(id: string, ringId: string, z: number, strong: boolean): Layer[] {
  const path = [{ path: hexRing(ringId, z) as Path3 }];
  return [
    new PathLayer<{ path: Path3 }>({
      id: `${id}-halo`,
      data: path,
      getPath: (d) => d.path,
      getColor: [230, 237, 243, strong ? 70 : 42],
      getWidth: strong ? 7 : 5,
      widthUnits: "pixels",
      jointRounded: true,
      parameters: ON_TOP,
      pickable: false,
    }),
    new PathLayer<{ path: Path3 }>({
      id: `${id}-line`,
      data: path,
      getPath: (d) => d.path,
      getColor: [236, 242, 248, strong ? 255 : 190],
      getWidth: strong ? 2.5 : 1.5,
      widthUnits: "pixels",
      jointRounded: true,
      parameters: ON_TOP,
      pickable: false,
    }),
  ];
}

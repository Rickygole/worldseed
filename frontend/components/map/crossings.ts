/**
 * Harbor crossings: the Key Bridge marker, the Fort McHenry and Harbor tunnels, and the applied options.
 * Every line is a glowing double stroke (a wide translucent line under a thin bright one). All static: the
 * Key Bridge is a dashed marker for a removed link and is never animated; only an applied option draws itself
 * in (a data change the user just made).
 */
import type { Layer } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";

import { BRIDGE } from "@/lib/geo";
import { MAGENTA } from "@/lib/ui/lenses";
import { loadLinkGeometry, type OptionGeo } from "@/lib/ui/candidateGeo";
import { dashes, drawPrefix, type Path3, type RGBA } from "./geometry";
import { ON_TOP } from "./terrainLayers";
import SoftGlowLayer, { ADDITIVE } from "./SoftGlowLayer";

const WHITE: [number, number, number] = [230, 237, 243];
/** Tunnels run under the water: a cool light blue, distinct from the bridge white and the data colors. */
const TUNNEL: [number, number, number] = [126, 184, 255];
/** Applied options: the blue token. */
export const OPTION_BLUE: [number, number, number] = [76, 141, 255];

const rgba = (c: readonly number[], a: number): RGBA => [c[0], c[1], c[2], a];

/** A double-stroke line: wide translucent additive glow, thin bright core. */
function doubleStroke(id: string, paths: Path3[], color: readonly number[], o: { glowPx: number; glowA: number; corePx: number; coreA: number; glow: boolean; round?: boolean; pickable?: boolean; tag?: (p: Path3) => object }): Layer[] {
  const data = paths.map((path) => ({ path, ...(o.tag ? o.tag(path) : {}) }));
  const out: Layer[] = [];
  if (o.glow && o.glowA > 0) {
    out.push(
      new PathLayer<{ path: Path3 }>({
        id: `${id}-glow`,
        data,
        getPath: (d) => d.path,
        getColor: rgba(color, o.glowA),
        getWidth: o.glowPx,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        pickable: false,
        // Plain alpha blending: additive light would wash out to yellow over the pale hexagons.
        parameters: ON_TOP,
        updateTriggers: { getColor: o.glowA, getWidth: o.glowPx },
      }),
    );
  }
  out.push(
    new PathLayer<{ path: Path3 }>({
      id: `${id}-core`,
      data,
      getPath: (d) => d.path,
      getColor: rgba(color, o.coreA),
      getWidth: o.corePx,
      widthUnits: "pixels",
      capRounded: o.round ?? false,
      jointRounded: o.round ?? false,
      pickable: o.pickable ?? false,
      parameters: ON_TOP,
      updateTriggers: { getColor: [o.coreA, color[0], color[1], color[2]], getWidth: o.corePx },
    }),
  );
  return out;
}

const BRIDGE_DASHES = dashes(BRIDGE.path, 0.12, 0.09, 30);

/**
 * The Key Bridge marker: dashed in both states; removal is said in color and words, never animated.
 * `emphasis` 0..1 is the scene's volume for it.
 */
export function bridgeLayers(removed: boolean, emphasis: number, glow: boolean): Layer[] {
  const color = removed ? MAGENTA : WHITE;
  return doubleStroke("bridge", BRIDGE_DASHES, color, {
    glowPx: 9 + 8 * emphasis,
    glowA: (removed ? 26 : 14) + 44 * emphasis,
    corePx: 2.2 + 1.6 * emphasis,
    coreA: removed ? 255 : 150 + 90 * emphasis,
    glow,
  });
}

export interface TunnelGeo {
  id: "L-FORTMCHENRY" | "L-HARBORTUNNEL";
  name: string;
  path: [number, number][];
  dashes: Path3[];
  ends: [[number, number], [number, number]];
}

const TUNNEL_IDS: TunnelGeo["id"][] = ["L-FORTMCHENRY", "L-HARBORTUNNEL"];
const TUNNEL_NAMES: Record<TunnelGeo["id"], string> = { "L-FORTMCHENRY": "Fort McHenry Tunnel (I-95)", "L-HARBORTUNNEL": "Harbor Tunnel (I-895)" };

const lengthDeg = (p: [number, number][]) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);

let tunnelsP: Promise<TunnelGeo[]> | null = null;
/** The two tunnels from the snapshot's link geometry: the longest line per tunnel (the other direction overlaps it). */
export function loadTunnels(): Promise<TunnelGeo[]> {
  tunnelsP ??= loadLinkGeometry()
    .then((m) => {
      const out: TunnelGeo[] = [];
      for (const id of TUNNEL_IDS) {
        const lines = m.get(id);
        if (!lines?.length) continue;
        const path = [...lines].sort((a, b) => lengthDeg(b) - lengthDeg(a))[0];
        out.push({ id, name: TUNNEL_NAMES[id], path, dashes: dashes(path, 0.16, 0.12, 24), ends: [path[0], path[path.length - 1]] });
      }
      return out;
    })
    .catch((e) => {
      tunnelsP = null;
      throw e;
    });
  return tunnelsP;
}

/** Tunnels: soft glowing dashed lines with a portal at each end. A tunnel closed in the world reads magenta. */
export function tunnelLayers(tunnels: TunnelGeo[], closed: ReadonlySet<string>, alpha: number, glow: boolean): Layer[] {
  if (alpha <= 0.01 || tunnels.length === 0) return [];
  const out: Layer[] = [];
  const portals: { p: [number, number]; closed: boolean }[] = [];
  for (const t of tunnels) {
    const isClosed = closed.has(t.id);
    const color = isClosed ? MAGENTA : TUNNEL;
    out.push(...doubleStroke(`tunnel-${t.id}`, t.dashes, color, { glowPx: 10, glowA: 46 * alpha, corePx: 2, coreA: 210 * alpha, glow }));
    for (const p of t.ends) portals.push({ p, closed: isClosed });
  }
  if (glow) {
    out.push(
      new SoftGlowLayer<{ p: [number, number]; closed: boolean }>({
        id: "tunnel-portal-glow",
        data: portals,
        getPosition: (d) => [d.p[0], d.p[1], 24],
        getRadius: 16,
        radiusUnits: "pixels",
        getFillColor: (d) => rgba(d.closed ? MAGENTA : TUNNEL, 120 * alpha),
        parameters: ADDITIVE,
        pickable: false,
        updateTriggers: { getFillColor: alpha },
      }),
    );
  }
  out.push(
    new ScatterplotLayer<{ p: [number, number]; closed: boolean }>({
      id: "tunnel-portals",
      data: portals,
      getPosition: (d) => [d.p[0], d.p[1], 26],
      getRadius: 4.5,
      radiusUnits: "pixels",
      stroked: true,
      filled: true,
      getFillColor: [10, 14, 20, 240 * alpha],
      getLineColor: (d) => rgba(d.closed ? MAGENTA : TUNNEL, 255 * alpha),
      getLineWidth: 1.6,
      lineWidthUnits: "pixels",
      parameters: ON_TOP,
      pickable: false,
      updateTriggers: { getFillColor: alpha, getLineColor: alpha },
    }),
  );
  return out;
}

/**
 * Applied options (blue): steady for as long as they are in the world; the latest one draws itself in
 * (`t` 0..1) along its own geometry.
 */
export function optionLayers(geos: OptionGeo[], latestIds: readonly string[], t: number, glow: boolean): Layer[] {
  const out: Layer[] = [];
  for (const g of geos) {
    const p = latestIds.includes(g.candidateId) ? t : 1;
    if (g.kind === "site") {
      out.push(
        ...(glow
          ? [
              new SoftGlowLayer<{ p: [number, number] }>({
                id: `option-site-glow-${g.candidateId}`,
                data: [{ p: g.point }],
                getPosition: (d) => [d.p[0], d.p[1], 30],
                getRadius: 34,
                radiusUnits: "pixels",
                getFillColor: rgba(OPTION_BLUE, 130 * p),
                parameters: ADDITIVE,
                pickable: false,
                updateTriggers: { getFillColor: p },
              }),
            ]
          : []),
        new ScatterplotLayer<{ p: [number, number]; candidateId: string }>({
          id: `option-site-${g.candidateId}`,
          data: [{ p: g.point, candidateId: g.candidateId }],
          pickable: true,
          getPosition: (d) => [d.p[0], d.p[1], 30],
          getRadius: 260,
          stroked: true,
          filled: true,
          getFillColor: rgba(OPTION_BLUE, 56 * p),
          getLineColor: rgba(OPTION_BLUE, 255 * p),
          lineWidthMinPixels: 2,
          updateTriggers: { getFillColor: p, getLineColor: p },
          parameters: ON_TOP,
        }),
      );
      continue;
    }
    const paths = drawPrefix(g.paths, p, 30, g.point);
    out.push(
      new PathLayer<{ path: Path3 }>({
        id: `option-casing-${g.candidateId}`,
        data: paths.map((path) => ({ path })),
        getPath: (d) => d.path,
        getColor: [10, 14, 20, 220],
        getWidth: 8,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        parameters: ON_TOP,
      }),
      ...doubleStroke(`option-${g.candidateId}`, paths, OPTION_BLUE, {
        glowPx: 14,
        glowA: glow ? 70 : 0,
        corePx: 3.5,
        coreA: 255,
        glow,
        round: true,
        pickable: true,
        tag: () => ({ candidateId: g.candidateId }),
      }),
    );
  }
  return out;
}

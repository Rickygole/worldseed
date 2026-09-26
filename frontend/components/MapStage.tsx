"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator, type Layer, type MapViewState, type PickingInfo } from "@deck.gl/core";
import { PathLayer, TextLayer } from "@deck.gl/layers";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { Map } from "react-map-gl/maplibre";
import { cellToBoundary } from "h3-js";
import { useReducedMotion } from "framer-motion";
import { Compass, Orbit, Presentation } from "lucide-react";
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { useApp, simInfo } from "@/lib/store";
import { MAP_STYLE } from "@/lib/mapStyle";
import { BASE_VIEW, BRIDGE, focusView, toLocalKm } from "@/lib/geo";
import { clamp, easeOutCubic, fmtMin, fmtPct1 } from "@/lib/format";
import { encode, MAGENTA, type LensId } from "@/lib/ui/lenses";
import { loadAux } from "@/lib/ui/snapshotAux";
import { useSnapshotFile } from "@/lib/ui/useSnapshotFile";

// Worker files are copied to /public/maplibre by scripts/copy-maplibre-worker.mjs.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const ANIM_MS = 1500;
const STAGGER_FRAC = 0.6;
const FLY_MS = 2200;

/** Overlays (bridge marker, routes, selection) draw over the terrain regardless of depth. */
const ON_TOP = { depthCompare: "always" as const };


interface HexDatum {
  i: number;
  id: string;
}

type Path3 = [number, number, number][];

/** Three diagonal chords per hex, [lng,lat] pairs, clipped to the hex outline. */
function hatchChords(id: string): [number, number][][] {
  const ring = cellToBoundary(id); // [lat, lng][]
  const lat0 = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lng0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const [cx, cy] = toLocalKm(lat0, lng0);
  const SHRINK = 0.86;
  const poly = ring.map(([la, ln]) => {
    const [x, y] = toLocalKm(la, ln);
    return [cx + (x - cx) * SHRINK, cy + (y - cy) * SHRINK] as [number, number];
  });
  const r = Math.max(...poly.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  const kmLng = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const out: [number, number][][] = [];
  // Lines x - y = c (45 degrees), offsets across the hex.
  for (const k of [-0.5, 0, 0.5]) {
    const c = k * r * 1.2;
    const ts: { s: number; x: number; y: number }[] = [];
    for (let e = 0; e < poly.length; e++) {
      const [ax, ay] = poly[e];
      const [bx, by] = poly[(e + 1) % poly.length];
      const fa = ax - cx - (ay - cy) - c;
      const fb = bx - cx - (by - cy) - c;
      if (fa === fb || fa * fb > 0) continue;
      const t = fa / (fa - fb);
      ts.push({ s: ax + (bx - ax) * t + ay + (by - ay) * t, x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
    }
    if (ts.length < 2) continue;
    ts.sort((a, b) => a.s - b.s);
    const toLL = (x: number, y: number): [number, number] => [lng0 + (x - cx) / kmLng, lat0 + (y - cy) / 110.57];
    out.push([toLL(ts[0].x, ts[0].y), toLL(ts[ts.length - 1].x, ts[ts.length - 1].y)]);
  }
  return out;
}

/** Split a polyline into dashes (km lengths). The bridge is a dashed marker, never an animation. */
function dashes(path: [number, number][], dashKm: number, gapKm: number, z: number): Path3[] {
  const pts = path.map(([lng, lat]) => ({ lng, lat, xy: toLocalKm(lat, lng) }));
  const out: Path3[] = [];
  let on = true;
  let left = dashKm;
  let cur: Path3 = [[pts[0].lng, pts[0].lat, z]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = Math.hypot(b.xy[0] - a.xy[0], b.xy[1] - a.xy[1]);
    let t0 = 0;
    while (seg * (1 - t0) > left) {
      const t = t0 + left / seg;
      const p: [number, number, number] = [a.lng + (b.lng - a.lng) * t, a.lat + (b.lat - a.lat) * t, z];
      if (on) {
        cur.push(p);
        out.push(cur);
      } else cur = [p];
      on = !on;
      left = on ? dashKm : gapKm;
      t0 = t;
    }
    left -= seg * (1 - t0);
    if (on) cur.push([b.lng, b.lat, z]);
  }
  if (on && cur.length > 1) out.push(cur);
  return out;
}

function hexRing(id: string, z: number): Path3 {
  const ring = cellToBoundary(id).map(([la, ln]) => [ln, la, z] as [number, number, number]);
  return [...ring, ring[0]];
}

type ViewState = MapViewState & {
  padding?: { left: number; right: number; top: number; bottom: number };
  transitionDuration?: number;
  transitionInterpolator?: FlyToInterpolator;
};

interface Frame {
  elev: Float32Array;
  rgb: Float32Array;
  /** Hatch drawn for hexes whose target is hatched once they have risen most of the way. */
  hatch: Uint8Array;
  id: number;
}

export default function MapStage() {
  const world = useApp((s) => s.world);
  const view = useApp((s) => s.view);
  const current = useApp((s) => s.current);
  const viewRevision = useApp((s) => s.viewRevision);
  const revision = useApp((s) => s.revision);
  const scenario = useApp((s) => s.scenario);
  const orbit = useApp((s) => s.orbit);
  const toggleOrbit = useApp((s) => s.toggleOrbit);
  const leftOpen = useApp((s) => s.leftOpen);
  const rightOpen = useApp((s) => s.rightOpen);
  const presentation = useApp((s) => s.presentation);
  const togglePresentation = useApp((s) => s.togglePresentation);
  const selectedHex = useApp((s) => s.selectedHex);
  const inspection = useApp((s) => s.inspection);
  const selectHex = useApp((s) => s.selectHex);
  const status = useApp((s) => s.status);
  const reduced = !!useReducedMotion();
  const { data: aux } = useSnapshotFile(loadAux, status === "ready");

  const removed = scenario.removedLinks.includes("key_bridge");
  const changed = scenario.removedLinks.length > 0 || (scenario.mutations?.length ?? 0) > 0;

  const padding = useMemo(
    () => ({
      left: presentation || !leftOpen ? 0 : 316,
      right: presentation || (!rightOpen && selectedHex === null) ? 0 : 376,
      top: 72,
      bottom: 32,
    }),
    [presentation, leftOpen, rightOpen, selectedHex],
  );

  const [camera, setViewState] = useState<ViewState>({ ...BASE_VIEW, maxPitch: 75, minZoom: 9, maxZoom: 16 });

  // What the terrain encodes: the mock (no detail) is a response-time field, like EMS.
  // Read the lens from the result itself, so a lens switch never re-encodes the previous field.
  const encLens: LensId = view?.detail ? view.detail.lens : "ems";
  const emsThresholdMin = (simInfo()?.params.emsThresholdS ?? 480) / 60;

  const target = useMemo(() => {
    if (!view) return null;
    const xd = view.detail?.xharbor;
    return encode(encLens, view.minutes, { lossFrac: xd?.lossFrac, isOrigin: xd?.isOrigin, emsThresholdMin });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, viewRevision, encLens, emsThresholdMin]);

  // ---------- animated terrain ----------
  const [frame, setFrame] = useState<Frame | null>(null);
  const shown = useRef<{ elev: Float32Array; rgb: Float32Array } | null>(null);
  const frameId = useRef(0);

  const hexData = useMemo<HexDatum[]>(() => (world ? world.cells.map((c, i) => ({ i, id: c.id })) : []), [world]);
  const chords = useMemo(() => (world ? world.cells.map((c) => hatchChords(c.id)) : []), [world]);

  useEffect(() => {
    if (!world || !target) return;
    const n = world.cells.length;
    if (!shown.current || shown.current.elev.length !== n) {
      // First paint rises from a flat plain in the target colors.
      shown.current = { elev: new Float32Array(n), rgb: Float32Array.from(target.rgb) };
    }
    const fromE = Float32Array.from(shown.current.elev);
    const fromC = Float32Array.from(shown.current.rgb);
    const cells = world.cells;
    const total = reduced ? 400 : ANIM_MS;
    const stagger = reduced ? 0 : STAGGER_FRAC;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const tt = (now - t0) / total;
      const e = shown.current!.elev;
      const c = shown.current!.rgb;
      const hatch = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const delay = (cells[i].bridgeKm / world.maxBridgeKm) * stagger;
        const local = clamp((tt - delay) / (1 - stagger), 0, 1);
        const p = reduced ? local : easeOutCubic(local);
        e[i] = fromE[i] + (target.elev[i] - fromE[i]) * p;
        for (let k = 0; k < 3; k++) c[i * 3 + k] = fromC[i * 3 + k] + (target.rgb[i * 3 + k] - fromC[i * 3 + k]) * p;
        hatch[i] = target.hatch[i] && p > 0.6 ? 1 : 0;
      }
      setFrame({ elev: Float32Array.from(e), rgb: Float32Array.from(c), hatch, id: ++frameId.current });
      if (tt < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [world, target, reduced]);

  // ---------- camera ----------
  const viewState = useMemo<ViewState>(() => ({ ...camera, padding }), [camera, padding]);
  const pauseUntil = useRef(0);
  const interacting = useRef(false);

  /** Where the change is: the cross-harbor added-time field, whatever lens is showing. */
  const focus = useMemo(() => {
    if (!world || !changed) return BASE_VIEW;
    const added = current?.detail?.xharbor?.addedMin;
    return added ? focusView(world.cells, added) : BASE_VIEW;
  }, [world, current, changed]);

  const firstRev = useRef(true);
  useEffect(() => {
    if (!world) return;
    if (firstRev.current) {
      firstRev.current = false;
      return;
    }
    pauseUntil.current = performance.now() + (reduced ? 300 : FLY_MS + 300);
    setViewState((v) => ({
      ...v,
      ...focus,
      transitionDuration: reduced ? 0 : FLY_MS,
      transitionInterpolator: reduced ? undefined : new FlyToInterpolator({ speed: 1.3 }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // Slow orbit (presentation mode, or toggled). Off under reduced motion.
  useEffect(() => {
    if (!orbit || reduced) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (now > pauseUntil.current && !interacting.current) {
        setViewState((v) => ({ ...v, bearing: (v.bearing ?? 0) + 0.8 * dt, transitionDuration: 0, transitionInterpolator: undefined }));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [orbit, reduced]);

  // ---------- layers ----------
  const [fontFamily] = useState(() => {
    if (typeof document === "undefined") return "monospace";
    return getComputedStyle(document.documentElement).getPropertyValue("--font-jetbrains").trim() || "monospace";
  });

  const selectedBgHexes = useMemo(() => {
    if (selectedHex === null || !aux) return null;
    const bg = aux.hexes.bg[selectedHex];
    const set = new Set<number>();
    for (let i = 0; i < aux.hexes.count; i++) if (aux.hexes.bg[i] === bg) set.add(i);
    return set;
  }, [selectedHex, aux]);

  const bridgeDashes = useMemo(() => dashes(BRIDGE.path, 0.12, 0.09, 30), []);

  const layers = useMemo(() => {
    if (!world || !frame) return [];
    const { elev, rgb, hatch: hatchOn, id: tick } = frame;

    const hatch: { path: Path3 }[] = [];
    for (let i = 0; i < world.cells.length; i++) {
      if (!hatchOn[i]) continue;
      const z = elev[i] + 6;
      for (const [a, b] of chords[i]) hatch.push({ path: [[a[0], a[1], z], [b[0], b[1], z]] });
    }

    const out: Layer[] = [
      new H3HexagonLayer<HexDatum>({
        id: "terrain",
        data: hexData,
        getHexagon: (h) => h.id,
        extruded: true,
        coverage: 0.9,
        pickable: true,
        getElevation: (h) => elev[h.i],
        getFillColor: (h) => {
          const k = h.i * 3;
          const raised = elev[h.i] > 4;
          const fade = world.cells[h.i].edgeFade;
          let r = rgb[k];
          let g = rgb[k + 1];
          let b = rgb[k + 2];
          if (selectedBgHexes?.has(h.i)) {
            // Selected block group: lift toward the text color so it reads without relying on hue.
            r += (230 - r) * 0.35;
            g += (237 - g) * 0.35;
            b += (243 - b) * 0.35;
          }
          return [r, g, b, (raised ? 230 : 120) * fade];
        },
        updateTriggers: { getElevation: tick, getFillColor: [tick, selectedBgHexes] },
        material: { ambient: 0.55, diffuse: 0.65, shininess: 24, specularColor: [70, 80, 100] },
        autoHighlight: true,
        highlightColor: [230, 237, 243, 70],
      }),
      new PathLayer<{ path: Path3 }>({
        id: "severe-hatch",
        data: hatch,
        getPath: (h) => h.path,
        getColor: [10, 14, 20, 230],
        getWidth: 1.5,
        widthUnits: "pixels",
        pickable: false,
      }),
    ];

    // Route overlay for the inspected hexagon: baseline dim, current bright.
    const routes = inspection?.status === "ready" ? inspection.routes : undefined;
    if (routes && inspection?.chain) {
      const same = !inspection.chain.routeChanged;
      const z = (p: [number, number][]) => p.map(([x, y]) => [x, y, 25] as [number, number, number]);
      if (!same && routes.before.length > 1) {
        out.push(
          new PathLayer<{ path: Path3 }>({
            id: "route-before",
            data: [{ path: z(routes.before) }],
            getPath: (d) => d.path,
            getColor: [139, 152, 169, 170],
            getWidth: 3,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            parameters: ON_TOP,
          }),
        );
      }
      if (routes.after.length > 1) {
        out.push(
          new PathLayer<{ path: Path3 }>({
            id: "route-after-casing",
            data: [{ path: z(routes.after) }],
            getPath: (d) => d.path,
            getColor: [10, 14, 20, 220],
            getWidth: 7,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            parameters: ON_TOP,
          }),
          new PathLayer<{ path: Path3 }>({
            id: "route-after",
            data: [{ path: z(routes.after) }],
            getPath: (d) => d.path,
            getColor: [230, 237, 243, 255],
            getWidth: 3.5,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            parameters: ON_TOP,
          }),
        );
      }
      const end = inspection.chain.focus.kind === "destination" ? routes.after[routes.after.length - 1] : routes.after[0];
      const name = inspection.chain.focus.name;
      if (end && name) {
        out.push(
          new TextLayer<{ text: string; position: [number, number, number] }>({
            id: "route-end-label",
            data: [{ text: name.toUpperCase(), position: [end[0], end[1], 40] }],
            getText: (o) => o.text,
            getPosition: (o) => o.position,
            getSize: 11,
            getColor: [230, 237, 243, 255],
            getPixelOffset: [0, -16],
            background: true,
            backgroundPadding: [6, 3],
            getBackgroundColor: [17, 23, 34, 235],
            fontFamily,
            fontWeight: 500,
            characterSet: "auto",
            sizeUnits: "pixels",
            parameters: ON_TOP,
          }),
        );
      }
    }

    if (selectedHex !== null && world.cells[selectedHex]) {
      out.push(
        new PathLayer<{ path: Path3 }>({
          id: "selected-hex",
          data: [{ path: hexRing(world.cells[selectedHex].id, elev[selectedHex] + 8) }],
          getPath: (d) => d.path,
          getColor: [230, 237, 243, 255],
          getWidth: 2.5,
          widthUnits: "pixels",
          parameters: ON_TOP,
        }),
      );
    }

    // Key Bridge: a dashed marker in both states; removal is said in words and color, not animated.
    const bridgeColor: [number, number, number, number] = removed ? [MAGENTA[0], MAGENTA[1], MAGENTA[2], 255] : [230, 237, 243, 220];
    out.push(
      new PathLayer<{ path: Path3 }>({
        id: "bridge-dashes",
        data: bridgeDashes.map((path) => ({ path })),
        getPath: (d) => d.path,
        getColor: bridgeColor,
        getWidth: 3,
        widthUnits: "pixels",
        capRounded: false,
        parameters: ON_TOP,
        updateTriggers: { getColor: removed },
      }),
      new TextLayer<{ text: string; position: [number, number, number] }>({
        id: "bridge-label",
        data: [{ text: removed ? "KEY BRIDGE  ×  LINK REMOVED" : "KEY BRIDGE", position: [BRIDGE.lng, BRIDGE.lat, 40] }],
        getText: (o) => o.text,
        getPosition: (o) => o.position,
        getSize: 11,
        getColor: removed ? [MAGENTA[0], MAGENTA[1], MAGENTA[2], 255] : [230, 237, 243, 255],
        getPixelOffset: [0, -18],
        background: true,
        backgroundPadding: [6, 3],
        getBackgroundColor: [17, 23, 34, 235],
        fontFamily,
        fontWeight: 600,
        characterSet: "auto",
        sizeUnits: "pixels",
        parameters: ON_TOP,
        updateTriggers: { getText: removed, getColor: removed },
      }),
    );
    return out;
  }, [world, hexData, chords, frame, fontFamily, inspection, selectedHex, selectedBgHexes, removed, bridgeDashes]);

  const getTooltip = ({ object }: PickingInfo) => {
    const h = object as HexDatum | null;
    if (!h || !view) return null;
    const m = view.minutes[h.i];
    const xd = view.detail?.xharbor;
    let body: string;
    if (encLens === "ems") {
      body = `<div style="font-size:16px">${fmtMin(m)} min</div><div style="opacity:.75">simulated first response</div>`;
    } else if (encLens === "xharbor" && xd && xd.isOrigin[h.i] === 0) {
      body = `<div>Not scored</div><div style="opacity:.75">on the harbor divider (ambiguous shore)</div>`;
    } else {
      const added = encLens === "xharbor" && xd ? xd.addedMin[h.i] : m;
      const loss = encLens === "xharbor" && xd ? `<div>loses ${fmtPct1(100 * xd.lossFrac[h.i])}% of cross-harbor jobs within 30 min</div>` : "";
      body = `<div style="font-size:16px">${added >= 0 ? "+" : ""}${fmtMin(added)} min</div><div style="opacity:.75">${encLens === "xharbor" ? "added to cross-harbor trips" : "added to regional job access"}</div>${loss}`;
    }
    return {
      html: `${body}<div style="opacity:.6;margin-top:4px">Click for details</div>`,
      style: {
        background: "rgba(17,23,34,0.96)",
        color: "#E6EDF3",
        border: "1px solid #243044",
        borderRadius: "8px",
        padding: "8px 12px",
        fontSize: "12px",
        lineHeight: "16px",
        fontVariantNumeric: "tabular-nums",
      },
    };
  };

  return (
    <div
      className="ws-map absolute inset-0"
      data-testid="map-stage"
      data-left-open={!presentation && leftOpen ? "true" : "false"}
    >
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs as ViewState)}
        onInteractionStateChange={(s) => {
          const active = !!(s.isDragging || s.isPanning || s.isRotating || s.isZooming);
          interacting.current = active;
          if (!active) pauseUntil.current = performance.now() + 4000;
        }}
        onClick={(info) => {
          const h = info.object as HexDatum | undefined;
          void selectHex(h ? h.i : null);
        }}
        controller={{ dragRotate: true, touchRotate: true, inertia: false }}
        layers={layers}
        getTooltip={getTooltip}
        getCursor={({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
        style={{ position: "absolute", inset: "0" }}
      >
        <Map mapStyle={MAP_STYLE} attributionControl={{ compact: false }} reuseMaps />
      </DeckGL>

      {/* Map toolbar: bottom-center of the map area, above the footer. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center">
        <div className="panel pointer-events-auto flex items-center gap-1 p-1" role="toolbar" aria-label="Map controls">
          <button
            className="btn-icon"
            aria-pressed={orbit}
            aria-label="Slow camera orbit"
            title={reduced ? "Orbit is off because your system asks for reduced motion" : "Slow camera orbit"}
            disabled={reduced}
            onClick={toggleOrbit}
            style={orbit && !reduced ? { color: "var(--color-text)", background: "var(--color-surface-2)" } : undefined}
          >
            <Orbit size={16} aria-hidden />
          </button>
          <button
            className="btn-icon"
            aria-label="Reset camera"
            title="Reset camera"
            onClick={() =>
              setViewState((v) => ({
                ...v,
                ...focus,
                transitionDuration: reduced ? 0 : 1200,
                transitionInterpolator: reduced ? undefined : new FlyToInterpolator({ speed: 1.6 }),
              }))
            }
          >
            <Compass size={16} aria-hidden />
          </button>
          <button
            className="btn-icon"
            aria-pressed={presentation}
            aria-label="Presentation mode (P)"
            title="Presentation mode (P)"
            onClick={togglePresentation}
          >
            <Presentation size={16} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator, type MapViewState, type PickingInfo } from "@deck.gl/core";
import { PathLayer, TextLayer } from "@deck.gl/layers";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { Map } from "react-map-gl/maplibre";
import { cellToBoundary } from "h3-js";
import { useReducedMotion } from "framer-motion";
import { Compass, Orbit, Presentation } from "lucide-react";
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { useApp, isBridgeRemoved } from "@/lib/store";
import { MAP_STYLE } from "@/lib/mapStyle";
import { BASE_VIEW, BRIDGE, DISRUPTED_VIEW, toLocalKm } from "@/lib/geo";
import { clamp, easeOutCubic } from "@/lib/format";
import { ISOLATED_MIN, OK_MAX_MIN, statusOf, type Cell } from "@/lib/sim";

// Worker files are copied to /public/maplibre by scripts/copy-maplibre-worker.mjs.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

type RGB = [number, number, number];
const TEAL: RGB = [45, 212, 191];
const AMBER: RGB = [245, 165, 36];
const MAGENTA: RGB = [255, 61, 113];

const lerp3 = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Semantic coverage color with short blend zones so transitions read smoothly. */
function coverageColor(m: number): RGB {
  if (m <= OK_MAX_MIN - 0.5) return TEAL;
  if (m < OK_MAX_MIN + 0.5) return lerp3(TEAL, AMBER, m - (OK_MAX_MIN - 0.5));
  if (m <= ISOLATED_MIN - 0.5) return AMBER;
  if (m < ISOLATED_MIN + 0.5) return lerp3(AMBER, MAGENTA, m - (ISOLATED_MIN - 0.5));
  return MAGENTA;
}

/** Response-time minutes -> extrusion height in meters. */
const FLOOR_MIN = 3.5;
const M_PER_MIN = 40;
const elevationOf = (m: number) => Math.max(0, m - FLOOR_MIN) * M_PER_MIN;

const ANIM_MS = 1500;
const STAGGER_FRAC = 0.6;
const FLY_MS = 2200;

interface HexDatum {
  i: number;
  id: string;
}

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
  const kmLng = (111.32 * Math.cos((lat0 * Math.PI) / 180));
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
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      ts.push({ s: x + y, x, y });
    }
    if (ts.length < 2) continue;
    ts.sort((a, b) => a.s - b.s);
    const p = ts[0];
    const q = ts[ts.length - 1];
    const toLL = (x: number, y: number): [number, number] => [
      lng0 + (x - cx) / kmLng,
      lat0 + (y - cy) / 110.57,
    ];
    out.push([toLL(p.x, p.y), toLL(q.x, q.y)]);
  }
  return out;
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

type ViewState = MapViewState & {
  padding?: { left: number; right: number; top: number; bottom: number };
};

export default function MapStage() {
  const world = useApp((s) => s.world);
  const current = useApp((s) => s.current);
  const revision = useApp((s) => s.revision);
  const removed = useApp(isBridgeRemoved);
  const orbit = useApp((s) => s.orbit);
  const toggleOrbit = useApp((s) => s.toggleOrbit);
  const leftOpen = useApp((s) => s.leftOpen);
  const rightOpen = useApp((s) => s.rightOpen);
  const presentation = useApp((s) => s.presentation);
  const togglePresentation = useApp((s) => s.togglePresentation);
  const reduced = !!useReducedMotion();

  const padding = useMemo(
    () => ({
      left: presentation || !leftOpen ? 0 : 316,
      right: presentation || !rightOpen ? 0 : 376,
      top: 0,
      bottom: 0,
    }),
    [presentation, leftOpen, rightOpen],
  );

  const [camera, setViewState] = useState<ViewState>({
    ...BASE_VIEW,
    maxPitch: 75,
    minZoom: 9,
    maxZoom: 16,
  });

  // ---------- animated state (refs; a tick counter drives re-render) ----------
  interface Frame {
    /** Currently displayed response-time minutes (snapshot per animation frame). */
    minutes: Float32Array;
    /** 1 = bridge line fully visible, ~0.18 = faded ("link removed"). */
    bridge: number;
    /** Monotonic frame id, used as the deck.gl updateTrigger. */
    id: number;
  }
  const [frame, setFrame] = useState<Frame | null>(null);
  const displayed = useRef<Float32Array | null>(null);
  const bridgeAlpha = useRef(1);
  const frameId = useRef(0);

  const hexData = useMemo<HexDatum[]>(
    () => (world ? world.cells.map((c, i) => ({ i, id: c.id })) : []),
    [world],
  );
  // Precomputed once per world (cheap: a few thousand hex outlines).
  const chords = useMemo(() => (world ? world.cells.map((c) => hatchChords(c.id)) : []), [world]);

  // Animate on every revision: elevation/color ease-out, staggered by bridge distance.
  useEffect(() => {
    if (!world || !current) return;
    const n = world.cells.length;
    if (!displayed.current) displayed.current = new Float32Array(n).fill(FLOOR_MIN);
    const from = Float32Array.from(displayed.current);
    const to = current.minutes;
    const cells: Cell[] = world.cells;
    const total = reduced ? 400 : ANIM_MS;
    const stagger = reduced ? 0 : STAGGER_FRAC;
    const bFrom = bridgeAlpha.current;
    const bTo = removed ? 0.18 : 1;
    const t0 = performance.now();
    let raf = 0;

    const step = (now: number) => {
      const tt = (now - t0) / total;
      const d = displayed.current!;
      for (let i = 0; i < n; i++) {
        const delay = (cells[i].bridgeKm / world.maxBridgeKm) * stagger;
        const local = clamp((tt - delay) / (1 - stagger), 0, 1);
        const p = reduced ? local : easeOutCubic(local);
        d[i] = from[i] + (to[i] - from[i]) * p;
      }
      bridgeAlpha.current = bFrom + (bTo - bFrom) * clamp(tt, 0, 1);
      setFrame({ minutes: Float32Array.from(d), bridge: bridgeAlpha.current, id: ++frameId.current });
      if (tt < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [world, current, revision, removed, reduced]);

  // ---------- camera ----------
  // Padding keeps the visible center correct when panels collapse / presentation toggles.
  const viewState = useMemo<ViewState>(() => ({ ...camera, padding }), [camera, padding]);
  const pauseUntil = useRef(0);
  const interacting = useRef(false);

  // Fly-to on every world change after the first load.
  const firstRev = useRef(true);
  useEffect(() => {
    if (!world) return;
    if (firstRev.current) {
      firstRev.current = false;
      return;
    }
    const target = removed ? DISRUPTED_VIEW : BASE_VIEW;
    pauseUntil.current = performance.now() + (reduced ? 300 : FLY_MS + 300);
    setViewState((v) => ({
      ...v,
      ...target,
      transitionDuration: reduced ? 0 : FLY_MS,
      transitionInterpolator: reduced ? undefined : new FlyToInterpolator({ speed: 1.3 }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // Slow orbit (off under reduced motion; toggle in the map toolbar).
  useEffect(() => {
    if (!orbit || reduced) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (now > pauseUntil.current && !interacting.current) {
        const rate = removed ? 0.5 : 1.0; // deg / sec
        setViewState((v) => ({
          ...v,
          bearing: (v.bearing ?? 0) + rate * dt,
          transitionDuration: 0,
          transitionInterpolator: undefined,
        }));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [orbit, reduced, removed]);

  // ---------- layers ----------
  // Client-only component (dynamic ssr:false), so reading the CSS var here is safe.
  const [fontFamily] = useState(() => cssVar("--font-jetbrains", "monospace"));

  const layers = useMemo(() => {
    if (!world || !frame) return [];
    const d = frame.minutes;
    const tick = frame.id;

    // Isolated hexes get a diagonal hatch drawn on their top face.
    const hatch: { path: [number, number, number][] }[] = [];
    for (let i = 0; i < world.cells.length; i++) {
      if (statusOf(d[i]) !== "isolated") continue;
      const z = elevationOf(d[i]) + 6;
      for (const [a, b] of chords[i]) hatch.push({ path: [[a[0], a[1], z], [b[0], b[1], z]] });
    }
    const hatchAlpha = Math.round(255 * 0.85);

    const bAlpha = frame.bridge;
    const removedAmt = clamp((1 - bAlpha) / 0.82, 0, 1);

    return [
      new H3HexagonLayer<HexDatum>({
        id: "coverage-hex",
        data: hexData,
        getHexagon: (h) => h.id,
        extruded: true,
        coverage: 0.9,
        pickable: true,
        getElevation: (h) => elevationOf(d[h.i]),
        getFillColor: (h) => {
          const c = coverageColor(d[h.i]);
          return [c[0], c[1], c[2], 215 * world.cells[h.i].edgeFade];
        },
        updateTriggers: { getElevation: tick, getFillColor: tick },
        material: { ambient: 0.5, diffuse: 0.7, shininess: 20, specularColor: [70, 80, 100] },
        autoHighlight: true,
        highlightColor: [230, 237, 243, 60],
      }),
      new PathLayer<{ path: [number, number, number][] }>({
        id: "isolated-hatch",
        data: hatch,
        getPath: (h) => h.path,
        getColor: [230, 237, 243, hatchAlpha],
        getWidth: 1.5,
        widthUnits: "pixels",
        capRounded: false,
        pickable: false,
      }),
      new PathLayer({
        id: "bridge-line",
        data: [{ path: BRIDGE.path.map(([x, y]) => [x, y, 40]) }],
        getPath: (o: { path: number[][] }) => o.path as [number, number, number][],
        getColor: [230, 237, 243, 255 * bAlpha],
        getWidth: 4,
        widthUnits: "pixels",
        capRounded: true,
        updateTriggers: { getColor: tick },
      }),
      new TextLayer<{ text: string; position: [number, number, number] }>({
        id: "bridge-label",
        data: [{ text: "KEY BRIDGE", position: [BRIDGE.lng, BRIDGE.lat, 60] }],
        getText: (o) => o.text,
        getPosition: (o) => o.position,
        getSize: 12,
        getColor: [230, 237, 243, 255],
        getPixelOffset: [0, -20],
        background: true,
        backgroundPadding: [6, 3],
        getBackgroundColor: [17, 23, 34, 235],
        fontFamily,
        fontWeight: 500,
        characterSet: "auto",
        billboard: true,
        sizeUnits: "pixels",
      }),
      new TextLayer<{ text: string; position: [number, number, number] }>({
        id: "bridge-removed",
        data: removedAmt > 0.02 ? [{ text: "× LINK REMOVED", position: [BRIDGE.lng, BRIDGE.lat, 60] }] : [],
        getText: (o) => o.text,
        getPosition: (o) => o.position,
        getSize: 12,
        getColor: [255, 61, 113, 255 * removedAmt],
        getPixelOffset: [0, -44],
        background: true,
        backgroundPadding: [6, 3],
        getBackgroundColor: [17, 23, 34, 235 * removedAmt],
        fontFamily,
        fontWeight: 600,
        characterSet: "auto",
        billboard: true,
        sizeUnits: "pixels",
        updateTriggers: { getColor: tick, getBackgroundColor: tick },
      }),
    ];
  }, [world, hexData, chords, frame, fontFamily]);

  const getTooltip = ({ object }: PickingInfo) => {
    const h = object as HexDatum | null;
    if (!h || !frame) return null;
    const m = frame.minutes[h.i];
    const st = statusOf(m);
    const label = st === "ok" ? "Within 8 min" : st === "degraded" ? "Degraded" : "Isolated";
    return {
      html: `<div><div style="opacity:.7">${h.id}</div><div style="font-size:16px">${m.toFixed(1)} min</div><div>${label}</div></div>`,
      style: {
        background: "rgba(17,23,34,0.96)",
        color: "#E6EDF3",
        border: "1px solid #243044",
        borderRadius: "8px",
        padding: "8px 12px",
        fontSize: "12px",
        fontVariantNumeric: "tabular-nums",
      },
    };
  };

  return (
    <div className="absolute inset-0" data-testid="map-stage">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs as ViewState)}
        onInteractionStateChange={(s) => {
          const active = !!(s.isDragging || s.isPanning || s.isRotating || s.isZooming);
          interacting.current = active;
          if (!active) pauseUntil.current = performance.now() + 4000;
        }}
        controller={{ dragRotate: true, touchRotate: true, inertia: false }}
        layers={layers}
        getTooltip={getTooltip}
        style={{ position: "absolute", inset: "0" }}
      >
        <Map mapStyle={MAP_STYLE} attributionControl={false} reuseMaps />
      </DeckGL>

      {/* Map toolbar, bottom-center of the map area */}
      <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center">
        <div className="panel pointer-events-auto flex items-center gap-1 p-1">
          <button
            className="btn-icon"
            aria-pressed={orbit}
            aria-label="Toggle camera orbit"
            title="Toggle slow orbit"
            onClick={toggleOrbit}
            style={orbit ? { color: "var(--color-text)", background: "var(--color-surface-2)" } : undefined}
          >
            <Orbit size={16} />
          </button>
          <button
            className="btn-icon"
            aria-label="Reset camera"
            title="Reset camera"
            onClick={() =>
              setViewState((v) => ({
                ...v,
                ...(removed ? DISRUPTED_VIEW : BASE_VIEW),
                transitionDuration: reduced ? 0 : 1200,
                transitionInterpolator: reduced ? undefined : new FlyToInterpolator({ speed: 1.6 }),
              }))
            }
          >
            <Compass size={16} />
          </button>
          <button
            className="btn-icon"
            aria-pressed={presentation}
            aria-label="Toggle presentation mode (P)"
            title="Presentation mode (P)"
            onClick={togglePresentation}
          >
            <Presentation size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

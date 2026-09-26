"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator, type Layer, type MapViewState, type PickingInfo } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { Map } from "react-map-gl/maplibre";
import { cellToBoundary } from "h3-js";
import { useReducedMotion } from "framer-motion";
import { Compass, Orbit, Presentation } from "lucide-react";
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { useApp, simInfo } from "@/lib/store";
import { MAP_STYLE } from "@/lib/mapStyle";
import { BASE_VIEW, BRIDGE, distKm, focusView, toLocalKm } from "@/lib/geo";
import { easeOutCubic, fmtMin, fmtPct1 } from "@/lib/format";
import { TerrainAnimator } from "@/lib/ui/terrainAnimator";
import { encode, MAGENTA, type LensId } from "@/lib/ui/lenses";
import { loadAux } from "@/lib/ui/snapshotAux";
import { useSnapshotFile } from "@/lib/ui/useSnapshotFile";
import { useSearch } from "@/lib/ui/search";
import { loadLinkGeometry, optionGeo, type OptionGeo } from "@/lib/ui/candidateGeo";
import CompareSlider from "./CompareSlider";

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

/** Where a hex's residents are zero (ports, industrial land): drawn faded so a tall empty tower reads as such. */
const JOB_ONLY_ALPHA = 0.32;

/** Terrain layer for an encoded field (used by the main map and the compare overlay). */
function terrainLayer(id: string, hexData: HexDatum[], elev: Float32Array, rgb: Float32Array, cells: { edgeFade: number; residents?: number }[], tick: number, extra: Partial<{ pickable: boolean; selected: Set<number> | null }> = {}) {
  return new H3HexagonLayer<HexDatum>({
    id,
    data: hexData,
    getHexagon: (h) => h.id,
    extruded: true,
    coverage: 0.9,
    pickable: extra.pickable ?? false,
    getElevation: (h) => elev[h.i],
    getFillColor: (h) => {
      const k = h.i * 3;
      const raised = elev[h.i] > 4;
      const c = cells[h.i];
      const jobOnly = c.residents === 0;
      let r = rgb[k];
      let g = rgb[k + 1];
      let b = rgb[k + 2];
      if (extra.selected?.has(h.i)) {
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
      return [r, g, b, (raised ? 230 : 120) * c.edgeFade * (jobOnly ? JOB_ONLY_ALPHA : 1)];
    },
    updateTriggers: { getElevation: tick, getFillColor: [tick, extra.selected] },
    material: { ambient: 0.55, diffuse: 0.65, shininess: 24, specularColor: [70, 80, 100] },
    autoHighlight: extra.pickable ?? false,
    highlightColor: [230, 237, 243, 70],
  });
}

/**
 * The "draws itself" effect: segments are revealed in order of distance from `from` (the option's centre), so
 * a corridor of many short pieces grows outward as one line instead of flickering everywhere at once.
 */
function drawPrefix(paths: [number, number][][], t: number, z: number, from: [number, number]): Path3[] {
  const lift = (p: [number, number][]) => p.map(([x, y]) => [x, y, z] as [number, number, number]);
  if (t >= 1) return paths.map(lift);
  if (t <= 0) return [];
  const d = (p: [number, number][]) => Math.min(...p.map(([x, y]) => (x - from[0]) ** 2 + (y - from[1]) ** 2));
  const order = [...paths].sort((a, b) => d(a) - d(b));
  const k = t * order.length;
  const whole = Math.floor(k);
  const out = order.slice(0, whole).map(lift);
  const next = order[whole];
  if (next && k > whole) out.push(lift(next.slice(0, Math.max(2, Math.ceil(next.length * (k - whole))))));
  return out;
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
  const freightSel = useApp((s) => s.freightSel);
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
  // The per-frame work mutates typed arrays in refs and bumps one counter: no array copies per frame.
  const [tick, setTick] = useState(0);
  const [hatchTick, setHatchTick] = useState(0);
  // Animation buffers and loop live outside React (lib/ui/terrainAnimator); render reads them keyed by `tick`.
  const buffers = useMemo(() => (world ? new TerrainAnimator(world.cells.length) : null), [world]);
  const staggerFrom = useApp((s) => s.staggerFrom);

  const hexData = useMemo<HexDatum[]>(() => (world ? world.cells.map((c, i) => ({ i, id: c.id })) : []), [world]);
  const chords = useMemo(() => (world ? world.cells.map((c) => hatchChords(c.id)) : []), [world]);

  useEffect(() => {
    if (!world || !target || !buffers) return;
    const cells = world.cells;
    // Ripple origin: an applied option's location, else the bridge.
    const dist = new Float32Array(cells.length);
    for (let i = 0; i < cells.length; i++) {
      dist[i] = staggerFrom ? distKm(cells[i].lat, cells[i].lng, staggerFrom.lat, staggerFrom.lng) : cells[i].bridgeKm;
    }
    buffers.start(
      target,
      dist,
      { ms: reduced ? 400 : ANIM_MS, stagger: reduced ? 0 : STAGGER_FRAC, linear: reduced },
      () => setTick((v) => v + 1),
      () => setHatchTick((v) => v + 1),
    );
    return () => buffers.stop();
    // staggerFrom is read at the start of each change on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, target, reduced, buffers]);

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

  // A selected freight trip: frame both anchors and the detour (the hazmat route can run around the western Beltway).
  const tripKey = freightSel ? `${freightSel.tripId}|${Object.keys(freightSel.routes).length}` : "";
  useEffect(() => {
    if (!freightSel) return;
    const pts = [freightSel.ends.o, freightSel.ends.d, ...Object.values(freightSel.routes).flatMap((p) => p ?? [])];
    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    const span = Math.max(Math.max(...lngs) - Math.min(...lngs), (Math.max(...lats) - Math.min(...lats)) * 1.3);
    const zoom = Math.max(9.4, Math.min(12, 10.9 - Math.log2(Math.max(span, 0.05) / 0.12)));
    pauseUntil.current = performance.now() + 4000;
    const raf = requestAnimationFrame(() =>
      setViewState((v) => ({
      ...v,
      longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
      zoom,
      pitch: 40,
      bearing: 0,
      transitionDuration: reduced ? 0 : 1200,
      transitionInterpolator: reduced ? undefined : new FlyToInterpolator({ speed: 1.6 }),
      })),
    );
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripKey]);

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

  // Hatch geometry only changes when the terrain settles, not every frame.
  const hatchData = useMemo(() => {
    const S = buffers;
    if (!world || !S) return [];
    const out: { path: Path3 }[] = [];
    for (let i = 0; i < world.cells.length; i++) {
      if (!S.hatch[i]) continue;
      const z = S.elev[i] + 6;
      for (const [a, b] of chords[i]) out.push({ path: [[a[0], a[1], z], [b[0], b[1], z]] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, chords, hatchTick, buffers]);

  // ---------- options on the map: applied (steady, the latest draws itself), preview ghost ----------
  const catalog = useSearch((s) => s.catalog);
  const preview = useSearch((s) => s.preview);
  const compare = useSearch((s) => s.compare);
  const appliedFx = useApp((s) => s.appliedFx);
  const [links, setLinks] = useState<Map<string, [number, number][][]> | null>(null);
  const appliedIds = useMemo(() => (scenario.mutations ?? []).flatMap((r) => (r.m.kind === "apply_candidate" ? [r.m.candidateId] : [])), [scenario]);
  useEffect(() => {
    if (appliedIds.length === 0 && !preview && !compare) return;
    let live = true;
    loadLinkGeometry().then((m) => live && setLinks(m), () => {});
    return () => {
      live = false;
    };
  }, [appliedIds.length, preview, compare]);
  const appliedGeo = useMemo<OptionGeo[]>(
    () => (catalog && links ? appliedIds.map((id) => optionGeo(catalog, links, id)).filter((g): g is OptionGeo => g !== null) : []),
    [catalog, links, appliedIds],
  );
  const appliedLabel = useMemo(() => {
    if (appliedGeo.length === 0) return null;
    const fx = focus.longitude;
    const fy = focus.latitude;
    let best: [number, number] = appliedGeo[0].point;
    let bd = Infinity;
    for (const g of appliedGeo) {
      const pts = g.kind === "site" ? [g.point] : g.paths.flat();
      for (const p of pts) {
        const d = (p[0] - fx) ** 2 + (p[1] - fy) ** 2;
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
    }
    return { at: best, text: appliedGeo.length === 1 ? `OPTION ${appliedGeo[0].candidateId}` : `${appliedGeo.length} OPTIONS APPLIED (HOVER FOR NAMES)` };
  }, [appliedGeo, focus]);
  const [drawAnim, setDrawAnim] = useState(1);
  useEffect(() => {
    if (!appliedFx || reduced) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 1100);
      setDrawAnim(easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [appliedFx, reduced]);
  const drawT = reduced ? 1 : drawAnim;

  const previewEnc = useMemo(() => {
    const out = preview?.status === "ready" ? preview.out : null;
    if (!out) return null;
    const xd = out.detail?.xharbor;
    return encode(out.detail?.lens ?? encLens, out.minutes, { lossFrac: xd?.lossFrac, isOrigin: xd?.isOrigin, emsThresholdMin });
  }, [preview, encLens, emsThresholdMin]);

  const compareEnc = useMemo(() => {
    const out = compare?.status === "ready" ? compare.out : null;
    if (!out) return null;
    const xd = out.detail?.xharbor;
    return encode(out.detail?.lens ?? encLens, out.minutes, { lossFrac: xd?.lossFrac, isOrigin: xd?.isOrigin, emsThresholdMin });
  }, [compare, encLens, emsThresholdMin]);

  const layers = useMemo(() => {
    const S = buffers;
    if (!world || !S) return [];
    const { elev } = S;
    const hatch = hatchData;

    const out: Layer[] = [
      terrainLayer("terrain", hexData, S.elev, S.rgb, world.cells, tick, { pickable: true, selected: selectedBgHexes }),
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

    // Preview: the option's terrain as a translucent violet wireframe over the current terrain.
    if (previewEnc) {
      const pe = previewEnc.elev;
      const ghost = hexData.filter((h) => pe[h.i] > 2 || elev[h.i] > 2);
      out.push(
        new H3HexagonLayer<HexDatum>({
          id: "preview-ghost",
          data: ghost,
          getHexagon: (h) => h.id,
          extruded: true,
          filled: false,
          wireframe: true,
          coverage: 0.9,
          getElevation: (h) => pe[h.i],
          getLineColor: [167, 139, 250, 200],
          lineWidthMinPixels: 1,
          pickable: false,
        }),
      );
    }

    // Applied options: drawn on the map for as long as they are in the world; the latest draws itself.
    for (const g of appliedGeo) {
      const latest = appliedFx?.candidateIds.includes(g.candidateId) ?? false;
      const t = latest ? drawT : 1;
      if (g.kind === "site") {
        out.push(
          new ScatterplotLayer<{ p: [number, number]; candidateId: string }>({
            id: `applied-site-${g.candidateId}`,
            data: [{ p: g.point, candidateId: g.candidateId }],
            pickable: true,
            getPosition: (d) => [d.p[0], d.p[1], 30],
            getRadius: 260,
            stroked: true,
            filled: true,
            getFillColor: [45, 212, 191, 70 * t],
            getLineColor: [45, 212, 191, 255 * t],
            lineWidthMinPixels: 2,
            updateTriggers: { getFillColor: t, getLineColor: t },
            parameters: ON_TOP,
          }),
        );
      } else {
        out.push(
          new PathLayer<{ path: Path3 }>({
            id: `applied-casing-${g.candidateId}`,
            data: drawPrefix(g.paths, t, 30, g.point).map((path) => ({ path })),
            getPath: (d) => d.path,
            getColor: [10, 14, 20, 220],
            getWidth: 7,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            parameters: ON_TOP,
          }),
          new PathLayer<{ path: Path3; candidateId: string }>({
            id: `applied-path-${g.candidateId}`,
            data: drawPrefix(g.paths, t, 30, g.point).map((path) => ({ path, candidateId: g.candidateId })),
            pickable: true,
            getPath: (d) => d.path,
            getColor: [45, 212, 191, 255],
            getWidth: 3.5,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            parameters: ON_TOP,
          }),
        );
      }
    }

    // One label for all applied options, on the applied geometry nearest the view's focus (so it sits in the
    // visible map, not under a panel). Each option's name is on hover.
    if (appliedLabel && drawT >= 1) {
      out.push(
        new TextLayer<{ text: string; position: [number, number, number] }>({
          id: "applied-label",
          data: [{ text: appliedLabel.text, position: [appliedLabel.at[0], appliedLabel.at[1], 40] }],
          getText: (o) => o.text,
          getPosition: (o) => o.position,
          getSize: 11,
          getColor: [45, 212, 191, 255],
          getPixelOffset: [0, -16],
          background: true,
          backgroundPadding: [6, 3],
          getBackgroundColor: [17, 23, 34, 235],
          fontFamily,
          fontWeight: 600,
          characterSet: "auto",
          sizeUnits: "pixels",
          parameters: ON_TOP,
        }),
      );
    }

    // Freight trip from the freight panel: the car route (bright) and the hazmat truck route (amber) when the
    // simulator returned them; otherwise a dashed straight line between the anchors, labeled schematic.
    if (freightSel) {
      const z = (p: [number, number][]) => p.map(([x, y]) => [x, y, 28] as [number, number, number]);
      const style: Record<string, [number, number, number, number]> = { car: [230, 237, 243, 255], hazmat_truck: [245, 165, 36, 255] };
      const any = Object.keys(freightSel.routes).length > 0;
      for (const [cls, path] of Object.entries(freightSel.routes)) {
        if (!path || path.length < 2) continue;
        out.push(
          new PathLayer<{ path: Path3 }>({
            id: `trip-casing-${cls}`,
            data: [{ path: z(path) }],
            getPath: (d) => d.path,
            getColor: [10, 14, 20, 220],
            getWidth: cls === "hazmat_truck" ? 8 : 6,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            parameters: ON_TOP,
          }),
          new PathLayer<{ path: Path3 }>({
            id: `trip-${cls}`,
            data: [{ path: z(path) }],
            getPath: (d) => d.path,
            getColor: style[cls] ?? [167, 139, 250, 255],
            getWidth: cls === "hazmat_truck" ? 4.5 : 2.5,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            parameters: ON_TOP,
          }),
        );
      }
      if (!any) {
        out.push(
          new PathLayer<{ path: Path3 }>({
            id: "trip-schematic",
            data: dashes([freightSel.ends.o, freightSel.ends.d], 0.25, 0.18, 28).map((path) => ({ path })),
            getPath: (d) => d.path,
            getColor: [230, 237, 243, 220],
            getWidth: 2,
            widthUnits: "pixels",
            parameters: ON_TOP,
          }),
        );
      }
      out.push(
        new TextLayer<{ text: string; position: [number, number, number] }>({
          id: "trip-ends",
          getTextAnchor: "middle",
          data: [
            { text: freightSel.ends.oName.split(" (")[0].toUpperCase(), position: [freightSel.ends.o[0], freightSel.ends.o[1], 40] },
            { text: `${freightSel.ends.dName.split(" (")[0].toUpperCase()}${any ? "" : " (SCHEMATIC LINE)"}`, position: [freightSel.ends.d[0], freightSel.ends.d[1], 40] },
          ],
          getText: (o) => o.text,
          getPosition: (o) => o.position,
          getSize: 11,
          getColor: [230, 237, 243, 255],
          getPixelOffset: [0, -34],
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
  }, [freightSel, appliedLabel, world, buffers, hexData, tick, hatchData, fontFamily, inspection, selectedHex, selectedBgHexes, removed, bridgeDashes, previewEnc, appliedGeo, appliedFx, drawT]);

  const compareLayers = useMemo(() => {
    if (!world || !compareEnc) return [];
    return [terrainLayer("compare-terrain", hexData, compareEnc.elev, compareEnc.rgb, world.cells, 1)];
  }, [world, hexData, compareEnc]);

  const getTooltip = ({ object }: PickingInfo) => {
    const opt = object as { candidateId?: string } | null;
    if (opt?.candidateId) {
      const c = catalog?.byId.get(opt.candidateId);
      const title = c ? c.title.replace(/^Hypothetical scenario option:\s*/i, "") : opt.candidateId;
      const el = document.createElement("div");
      el.textContent = `${title} (${opt.candidateId}, applied; hypothetical)`;
      return { html: el.innerHTML, style: { background: "rgba(17,23,34,0.96)", color: "#E6EDF3", border: "1px solid #243044", borderRadius: "8px", padding: "8px 12px", fontSize: "12px" } };
    }
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
    const jobOnly = world?.cells[h.i]?.residents === 0 ? `<div style="opacity:.75">No residents here (jobs only)</div>` : "";
    return {
      html: `${body}${jobOnly}<div style="opacity:.6;margin-top:4px">Click for details</div>`,
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
      data-compare={compareEnc ? "true" : "false"}
      style={{ ["--split" as string]: `${((compare?.split ?? 0.5) * 100).toFixed(2)}%` }}
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
          const o = info.object as (HexDatum & { candidateId?: string }) | undefined;
          if (o?.candidateId) return; // an applied option: its name is on hover
          void selectHex(o && typeof o.i === "number" ? o.i : null);
        }}
        controller={{ dragRotate: true, touchRotate: true, inertia: false }}
        layers={layers}
        getTooltip={getTooltip}
        getCursor={({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
        style={{ position: "absolute", inset: "0" }}
      >
        <Map mapStyle={MAP_STYLE} attributionControl={{ compact: false }} reuseMaps />
      </DeckGL>

      {/* Compare: the option's world on the right of the slider, same camera, clipped; the main terrain on the left. */}
      {compareEnc && (
        <DeckGL
          id="compare-overlay"
          viewState={viewState}
          controller={false}
          layers={compareLayers}
          style={{ position: "absolute", inset: "0", pointerEvents: "none", clipPath: `inset(0 0 0 ${((compare?.split ?? 0.5) * 100).toFixed(2)}%)` }}
        />
      )}
      {compare && <CompareSlider />}
      {freightSel && Object.keys(freightSel.routes).length > 0 && (
        <div className="pointer-events-none absolute left-[600px] top-[152px]">
          <p className="panel flex items-center gap-3 px-3 py-1 text-xs" role="status">
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-5 rounded bg-text" aria-hidden /> car route
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-1 w-5 rounded bg-warn" aria-hidden /> hazmat truck route
            </span>
            {freightSel.worldLabel && <span className="text-muted">({freightSel.worldLabel})</span>}
          </p>
        </div>
      )}
      {preview && (
        <div className="pointer-events-none absolute left-1/2 top-[152px] -translate-x-1/2">
          <p className="panel px-3 py-1 text-xs" role="status">
            {preview.status === "loading" ? (
              `Computing ${preview.bundleId}...`
            ) : preview.status === "error" ? (
              `Preview failed: ${preview.error}`
            ) : (
              <>
                <span style={{ color: "var(--color-future)" }}>Violet outline</span>: terrain with {preview.bundleId} (preview, not applied)
              </>
            )}
          </p>
        </div>
      )}

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

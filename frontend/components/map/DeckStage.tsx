"use client";

/**
 * The GPU surface: MapLibre (base map) under deck.gl (data layers), the camera, and everything that depends on
 * the camera or the clock (place labels with collision handling, freight trail time). Kept apart from
 * MapStage so a camera frame or a trail frame re-renders only this component, never the data pipeline.
 *
 * The map director drives the camera through the registered driver (eased moves, ambient drift); the user's
 * drag / scroll / pinch interrupts it and the camera is theirs until the next scene move.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL, { type DeckGLRef } from "@deck.gl/react";
import type { Layer, MapViewState, PickingInfo } from "@deck.gl/core";
import { Map, type MapRef } from "react-map-gl/maplibre";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";

import { BASE_VIEW } from "@/lib/geo";
import { BUILDING_LAYER_IDS, SATELLITE_ENABLED, STYLE_CHAIN } from "@/lib/mapStyle";
import {
  interruptCamera,
  markMapReady,
  qualityLevel,
  registerMapDriver,
  startFrameMonitor,
  subscribeQuality,
  type Padding,
  type QualityLevel,
} from "@/lib/ui/mapDirector";
import { createLighting } from "./lighting";
import { labelLayers, makeProjector } from "./labels";
import { easeAlphas, resolveLabels, type LabelDef } from "./labelLayout";
import { selectTrailRoutes, trailLayers } from "./trails";
import { cycleSeconds, TRAIL_CAPTION, type TrailRoute } from "./trailModel";

type ViewState = MapViewState & { padding?: Padding; transitionDuration?: number; transitionInterpolator?: unknown };

/** Debug hooks (window.__wsMap, __wsLabels) exist only with ?mapdebug in the URL. */
const DEBUG = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mapdebug");

const NO_EFFECTS: never[] = [];

const START: ViewState = { ...BASE_VIEW, maxPitch: 75, minZoom: 9, maxZoom: 16 };

export interface TrailProps {
  routes: TrailRoute[];
  highlightId: string | null;
  mode: "all" | "selected";
  alpha: number;
}

interface Props {
  layers: Layer[];
  compareLayers: Layer[];
  compareSplit: number | null;
  labelDefs: LabelDef[];
  trails: TrailProps | null;
  padding: Padding;
  fontFamily: string;
  reduced: boolean;
  onClick: (info: PickingInfo) => void;
  onHover: (info: PickingInfo) => void;
  getTooltip: (info: PickingInfo) => { html: string; style: Record<string, string> } | null;
}

function DeckStage({ layers, compareLayers, compareSplit, labelDefs, trails, padding, fontFamily, reduced, onClick, onHover, getTooltip }: Props) {
  const [camera, setCamera] = useState<ViewState>(START);
  const camRef = useRef<ViewState>(START);
  const wrapRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<DeckGLRef>(null);
  const mapRef = useRef<MapRef>(null);
  const [size, setSize] = useState({ width: 1280, height: 720 });
  const [quality, setQuality] = useState<QualityLevel>(qualityLevel());
  // Quality-tier aware: a session already known to be low-tier skips the heavier satellite imagery and starts
  // on the vector style (index 1 of the chain when satellite is enabled, else index 0). Reduced motion needs
  // no special case here: every style swap below is an instant cut, never an animated crossfade.
  const [styleIndex, setStyleIndex] = useState(() => (SATELLITE_ENABLED && qualityLevel() >= 2 ? 1 : 0));
  const styleEntry = STYLE_CHAIN[styleIndex] ?? STYLE_CHAIN[STYLE_CHAIN.length - 1];
  const isLastStyle = styleIndex >= STYLE_CHAIN.length - 1;
  const [lost, setLost] = useState(false);
  const hooked = useRef(false);
  const [trailT, setTrailT] = useState(0);
  // One lighting effect per Deck instance (an effect keeps per-device state).
  const effects = useMemo(() => [createLighting()], []);
  const compareEffects = useMemo(() => [createLighting()], []);

  // ---- camera driver ----
  const apply = useCallback((c: ViewState) => {
    camRef.current = c;
    setCamera(c);
  }, []);
  useEffect(
    () =>
      registerMapDriver({
        getCamera: () => {
          const c = camRef.current;
          return { longitude: c.longitude, latitude: c.latitude, zoom: c.zoom, pitch: c.pitch ?? 0, bearing: c.bearing ?? 0 };
        },
        setCamera: (c) => apply({ ...START, ...c }),
      }),
    [apply],
  );
  useEffect(() => startFrameMonitor(), []);
  useEffect(() => subscribeQuality(() => setQuality(qualityLevel())), []);

  // ---- size ----
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: Math.max(1, e.contentRect.width), height: Math.max(1, e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- style fallback chain: satellite -> vector -> Census shapes, never a blank map ----
  const failures = useRef(0);
  const tilesSeen = useRef(false);
  const mapLoaded = useRef(false);
  // Two hero styles share a source id ("openmaptiles"): once it has proven reachable under one style, a
  // transient blip right after switching to the other must never re-litigate that (a real outage keeps
  // erroring well past a moment; one late straggler from the just-torn-down previous style must not count).
  const provenGood = useRef(new Set<string>());
  // A source that a later style also declares by the same id is torn down and re-added when `setStyle` swaps
  // in the new style object; that teardown can itself fire a spurious "error" for an in-flight request with no
  // `tile` attached. Ignore errors for a moment after every switch so that noise is never mistaken for the new
  // style's own tiles failing.
  const styleSwitchedAt = useRef(0);
  const SETTLE_MS = 2000;
  // A burst of tile requests can all reject in the same synchronous turn (one `abort`-style network failure
  // fires once per pending tile). Each of those calls still closes over the render's `styleEntry`/`isLastStyle`
  // and reads the same `failures` ref, so without a guard here every one of them past the threshold would call
  // `advanceStyle` again; React batches the resulting `setStyleIndex` calls and would apply all of them before
  // the next render, skipping straight past the intermediate style. `advancing` makes the decision idempotent:
  // only the first call in a burst (or ever, per attempt) actually moves the index.
  const advancing = useRef(false);
  // Only a real failure sets this (not the quality-tier's own choice to skip satellite): it drives the banner.
  const [degraded, setDegraded] = useState(false);
  const advanceStyle = useCallback(() => {
    if (advancing.current) return;
    advancing.current = true;
    setDegraded(true);
    setStyleIndex((i) => Math.min(i + 1, STYLE_CHAIN.length - 1));
  }, []);
  // A new style attempt starts its own failure count (each style has its own source to watch), seeded as
  // already-healthy if that exact source id was proven good under a previous style.
  useEffect(() => {
    failures.current = 0;
    tilesSeen.current = provenGood.current.has(styleEntry.watchSourceId ?? "");
    styleSwitchedAt.current = performance.now();
    advancing.current = false;
    // styleEntry is derived from styleIndex; re-running per source id would be equivalent and noisier
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleIndex]);
  useEffect(() => {
    if (isLastStyle) return;
    // Slow is not broken: fall back only when requests actually failed and no tile ever arrived.
    const t = window.setTimeout(() => {
      if (!tilesSeen.current && failures.current > 0) advanceStyle();
    }, 20000);
    return () => window.clearTimeout(t);
  }, [styleIndex, isLastStyle, advanceStyle]);
  // A later auto-downgrade to the low quality tier also drops satellite imagery, the heavier of the two hero
  // looks; it only ever moves toward the lighter style, matching the one-way auto quality ratchet elsewhere.
  useEffect(
    () =>
      subscribeQuality(() => {
        if (SATELLITE_ENABLED && qualityLevel() >= 2) setStyleIndex((i) => Math.max(i, 1));
      }),
    [],
  );

  // ---- quality: buildings are the first thing to go (vector style only; satellite has none) ----
  const setBuildings = useCallback(() => {
    const m = mapRef.current?.getMap();
    if (!m) return;
    for (const id of BUILDING_LAYER_IDS) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", qualityLevel() === 0 ? "visible" : "none");
  }, []);
  useEffect(setBuildings, [quality, styleIndex, setBuildings]);

  // ---- trail clock (only while trails are showing) ----
  const trailsOn = !!trails && trails.routes.length > 0 && trails.alpha > 0.01;
  const trailRoutes = trails?.routes;
  const trailHighlight = trails?.highlightId ?? null;
  const trailMode = trails?.mode ?? "all";
  const drawn = useMemo(() => (trailRoutes ? selectTrailRoutes(trailRoutes, trailHighlight, trailMode) : []), [trailRoutes, trailHighlight, trailMode]);
  const cycle = useMemo(() => cycleSeconds(drawn), [drawn]);
  useEffect(() => {
    if (!trailsOn || reduced) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      if (!document.hidden) setTrailT(((now - t0) / 1000) % cycle);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [trailsOn, reduced, cycle]);

  // ---- labels: collision resolved when the camera or the label set changes; alpha eases ----
  const easedRef = useRef(new globalThis.Map<string, number>());
  const [eased, setEased] = useState(() => new globalThis.Map<string, number>());
  const target = useMemo(() => {
    const project = makeProjector(camera, size.width, size.height, padding);
    return resolveLabels(labelDefs, project, size, padding);
  }, [camera, size, padding, labelDefs]);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      // Time-based (about 90 ms time constant), so a slow frame rate fades at the same speed as a fast one.
      const dt = Math.min(200, now - last);
      last = now;
      const moving = easeAlphas(easedRef.current, target, quality >= 2 ? 1 : 1 - Math.exp(-dt / 90));
      setEased(new globalThis.Map(easedRef.current));
      if (moving) raf = requestAnimationFrame(step);
    };
    // Only spend a render when a label actually has to change (most camera frames change nothing).
    let differs = false;
    for (const [id, t] of target) if ((easedRef.current.get(id) ?? 0) !== t) differs = true;
    if (differs) raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, quality]);
  // Reduced motion: labels cut in and out, no fades.
  const alphas = reduced ? target : eased;

  useEffect(() => {
    if (DEBUG) (window as unknown as { __wsLabels: unknown }).__wsLabels = () => ({ alphas: Object.fromEntries(alphas), target: Object.fromEntries(target), defs: labelDefs.map((d) => [d.id, d.visible]) });
  }, [alphas, target, labelDefs]);

  const allLayers = useMemo(() => {
    const out = [...layers];
    if (trails && trailsOn) {
      out.push(
        ...trailLayers(drawn, {
          time: trailT,
          highlightId: trails.highlightId,
          alpha: trails.alpha,
          glow: quality < 2,
          still: reduced,
        }),
      );
    }
    out.push(...labelLayers(labelDefs, alphas, fontFamily));
    return out;
  }, [layers, trails, drawn, trailsOn, trailT, quality, reduced, labelDefs, fontFamily, alphas]);

  const viewState = useMemo(() => ({ ...camera, padding }), [camera, padding]);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const pixelRatio = quality === 0 ? Math.min(2, dpr) : quality === 1 ? Math.min(1.5, dpr) : 1;

  const onViewStateChange = useCallback(
    ({ viewState: vs, interactionState }: { viewState: unknown; interactionState: { isDragging?: boolean; isPanning?: boolean; isRotating?: boolean; isZooming?: boolean } }) => {
      if (interactionState.isDragging || interactionState.isPanning || interactionState.isRotating || interactionState.isZooming) interruptCamera();
      apply(vs as ViewState);
    },
    [apply],
  );

  const style: StyleSpecification = styleEntry.style;

  return (
    <div ref={wrapRef} className="absolute inset-0" data-quality={quality} data-style={style.name}>
      <DeckGL
        ref={deckRef}
        viewState={viewState}
        onViewStateChange={onViewStateChange as never}
        onClick={onClick}
        onHover={onHover}
        controller={{ dragRotate: true, touchRotate: true, inertia: 220 }}
        layers={allLayers}
        effects={quality >= 2 ? NO_EFFECTS : effects}
        useDevicePixels={pixelRatio}
        getTooltip={getTooltip as never}
        getCursor={({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
        onAfterRender={() => {
          markMapReady();
          if (!hooked.current) {
            hooked.current = true;
            // Losing the WebGL context (sleep, GPU reset, too many tabs) blanks the map: say so in plain words.
            const canvases = [deckRef.current?.deck?.getCanvas?.(), mapRef.current?.getMap().getCanvas()];
            for (const c of canvases) c?.addEventListener("webglcontextlost", (ev) => { ev.preventDefault(); setLost(true); });
          }
        }}
        style={{ position: "absolute", inset: "0" }}
      >
        <Map
          ref={mapRef}
          mapLib={maplibregl}
          mapStyle={style}
          // A static OSM baseline credit; MapLibre's own AttributionControl additionally lists whichever
          // sources are actually in use by the current style (each source below declares its own
          // `attribution`) and re-derives that list on every style swap, so the Esri credit appears only
          // while satellite imagery is the active source and disappears the moment it falls back.
          attributionControl={{ compact: false, customAttribution: "© OpenStreetMap contributors" }}
          reuseMaps
          onLoad={(e) => {
            mapLoaded.current = true;
            setBuildings();
            if (DEBUG) (window as unknown as { __wsMap: unknown }).__wsMap = e.target;
          }}
          onData={(e) => {
            const ev = e as unknown as { dataType?: string; sourceId?: string; tile?: unknown };
            if (ev.dataType !== "source" || !ev.tile || !ev.sourceId) return;
            // Any source succeeding is remembered (the satellite style's own road/label overlay already uses
            // "openmaptiles", so it gets proven good before the vector style ever becomes the active one).
            provenGood.current.add(ev.sourceId);
            // Only the style's own hero source counts toward "this style is alive": a road/label overlay
            // failing on its own is not "the map is blank".
            if (ev.sourceId === styleEntry.watchSourceId) tilesSeen.current = true;
          }}
          onError={(e) => {
            const ev = e as unknown as { sourceId?: string; tile?: unknown; error?: { message?: string; status?: number } };
            if (isLastStyle || tilesSeen.current) return;
            if (performance.now() - styleSwitchedAt.current < SETTLE_MS) return;
            // The tile source itself failing (its TileJSON) is fatal at once; single tile errors need a run of them.
            // Glyph and sprite failures carry no source and never take the base map down.
            if (ev.sourceId !== styleEntry.watchSourceId) return;
            failures.current += ev.tile ? 1 : 3;
            if (failures.current >= 3) advanceStyle();
          }}
        />
      </DeckGL>

      {compareLayers.length > 0 && (
        <DeckGL
          id="compare-overlay"
          viewState={viewState}
          controller={false}
          layers={compareLayers}
          effects={compareEffects}
          useDevicePixels={pixelRatio}
          style={{ position: "absolute", inset: "0", pointerEvents: "none", clipPath: `inset(0 0 0 ${((compareSplit ?? 0.5) * 100).toFixed(2)}%)` }}
        />
      )}

      {/* Horizon and edge falloff: a quiet vignette so the eye stays on the harbor. */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 75% 70% at 50% 46%, rgba(4,7,12,0) 55%, rgba(4,7,12,0.5) 100%)" }} aria-hidden />

      {trailsOn && (
        <p
          className="pointer-events-none absolute rounded-md px-2 py-1 text-xs"
          style={{ right: padding.right + 16, bottom: padding.bottom + 40, maxWidth: 300, color: "#a4b0c0", background: "rgba(10,14,20,0.78)" }}
          data-testid="trail-caption"
        >
          {reduced ? "Routes shown as steady lines (reduced motion)." : TRAIL_CAPTION}
        </p>
      )}

      {degraded && (
        <p className="pointer-events-none absolute rounded-md px-2 py-1 text-xs" style={{ left: padding.left + 16, bottom: padding.bottom + 44, maxWidth: 340, color: "#a4b0c0", background: "rgba(10,14,20,0.82)" }} role="status">
          {style === STYLE_CHAIN[STYLE_CHAIN.length - 1].style
            ? "Street map unavailable. Showing block-group outlines instead; the data on the map is unchanged."
            : "Satellite imagery unavailable. Showing the street map instead; the data on the map is unchanged."}
        </p>
      )}

      {lost && (
        <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: "rgba(10,14,20,0.86)" }} role="alert">
          <div className="max-w-sm rounded-xl border p-5 text-center" style={{ borderColor: "#243044", background: "#111722", color: "#e6edf3" }}>
            <p className="text-base">The 3D map lost its connection to your graphics card.</p>
            <p className="mt-2 text-sm" style={{ color: "#8b98a9" }}>
              This can happen when the computer sleeps or many tabs are open. The numbers in the panels are unaffected. Reload the page to draw the map again.
            </p>
            <button className="mt-4 rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "#243044" }} onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(DeckStage);

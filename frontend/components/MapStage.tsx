"use client";

/**
 * The map: terrain (the data), crossings, options, routes, freight trails, place labels and stations, over a
 * dark vector base map. This component turns store state into deck layers; the GPU surface, the camera and
 * everything clock-driven live in `components/map/DeckStage` and `lib/ui/mapDirector`.
 *
 * Honesty: only data is drawn and animated (terrain height and color from the simulator, freight travel time,
 * an option drawing itself). The Key Bridge is a static dashed marker.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { useReducedMotion } from "framer-motion";
import { Compass, Orbit, Presentation } from "lucide-react";
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { useApp, simInfo, scenarioKey } from "@/lib/store";
import { BASE_VIEW, BRIDGE, PLACES, distKm, focusView } from "@/lib/geo";
import { easeOutCubic, fmtMin, fmtPct1 } from "@/lib/format";
import { TerrainAnimator } from "@/lib/ui/terrainAnimator";
import { encode, MAGENTA, type LensId } from "@/lib/ui/lenses";
import { loadAux } from "@/lib/ui/snapshotAux";
import { useSnapshotFile } from "@/lib/ui/useSnapshotFile";
import { useSearch } from "@/lib/ui/search";
import { loadLinkGeometry, optionGeo, type OptionGeo } from "@/lib/ui/candidateGeo";
import {
  currentScene,
  flyTo,
  frameStats,
  getCamera,
  getFreightTripHighlight,
  getViewportPadding,
  getVisual,
  getVisualVersion,
  goToScene,
  interruptCamera,
  isUserControlled,
  markMapReady,
  qualityLevel,
  resetView,
  SCENES,
  setFreightTripHighlight,
  setOrbit,
  setQuality,
  setViewportPadding,
  subscribeFreightHighlight,
  subscribePadding,
  subscribeQuality,
  subscribeScene,
  subscribeVisual,
  whenMapReady,
  type Padding,
} from "@/lib/ui/mapDirector";
import { optionName } from "./planner/labels";
import CompareSlider from "./CompareSlider";
import DeckStage from "./map/DeckStage";
import { drawPrefix, hatchChords, type Path3, type RGBA } from "./map/geometry";
import { bridgeLayers, loadTunnels, optionLayers, tunnelLayers, type TunnelGeo } from "./map/crossings";
import { glowLayer, hexOutline, ON_TOP, rimLayer, RIM_MIN_ELEV, tallHexes, terrainAOLayer, terrainLayer, type HexDatum } from "./map/terrainLayers";
import { buildAdjacency, applyJitter, smoothField, type Adjacency } from "./map/terrainSmoothing";
import { buildHexEdges, type HexEdge } from "./map/terrainEdges";
import { originPulseLayer, shockwaveLayers, travelingPulseLayer } from "./map/disruption";
import { buildTinTopology, refreshTinNormals, tinTerrainLayer, TIN_OPTION_KEY, type TinMeshTopology } from "./map/TinTerrainLayer";
import { loadFacilities, stationLayers, FACILITY_LABEL, type Facility } from "./map/stations";
import { loadTrailRoutes } from "./map/trails";
import type { TrailRoute } from "./map/trailModel";
import type { LabelDef } from "./map/labelLayout";

// Worker files are copied to /public/maplibre by scripts/copy-maplibre-worker.mjs.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const ANIM_MS = 1500;
const STAGGER_FRAC = 0.6;
const FLY_MS = 2200;

/**
 * Debug-only time scale for the choreography (terrain rise, shockwave, option draw-in), so a slow real GPU's
 * sparse frame rate does not make the sub-second effects impossible to see or screenshot in review. 1 in
 * production always; only settable via the `?mapdebug` hook, never from any user-facing control.
 */
let debugSlowMo = 1;
const slow = (ms: number) => ms * debugSlowMo;

const LEGACY_PANEL_TOP = 72;
const NO_ROUTES: TrailRoute[] = [];
const TEXT: RGBA = [230, 237, 243, 255];
const MAG: RGBA = [MAGENTA[0], MAGENTA[1], MAGENTA[2], 255];
const OPTION: RGBA = [96, 160, 255, 255];

function useVisual(): number {
  return useSyncExternalStore(subscribeVisual, getVisualVersion, getVisualVersion);
}

let paddingSnapshot: Padding | null = null;
function usePaddingOverride(): Padding | null {
  return useSyncExternalStore(
    subscribePadding,
    () => {
      const p = getViewportPadding();
      // useSyncExternalStore needs a stable reference between unchanged reads.
      if (p && paddingSnapshot && p.left === paddingSnapshot.left && p.right === paddingSnapshot.right && p.top === paddingSnapshot.top && p.bottom === paddingSnapshot.bottom) return paddingSnapshot;
      paddingSnapshot = p ? { ...p } : null;
      return paddingSnapshot;
    },
    () => null,
  );
}

export default function MapStage({ toolbar = true }: { toolbar?: boolean } = {}) {
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
  const mode = useApp((s) => s.mode);
  const freightSel = useApp((s) => s.freightSel);
  const reduced = !!useReducedMotion();
  const { data: aux } = useSnapshotFile(loadAux, status === "ready");
  const visualVersion = useVisual();
  const visual = getVisual();
  const qLevel = useSyncExternalStore(subscribeQuality, qualityLevel, qualityLevel);
  const highlight = useSyncExternalStore(subscribeFreightHighlight, getFreightTripHighlight, getFreightTripHighlight);
  const sceneNow = useSyncExternalStore(subscribeScene, currentScene, currentScene);

  const removed = scenario.removedLinks.includes("key_bridge");
  const changed = scenario.removedLinks.length > 0 || (scenario.mutations?.length ?? 0) > 0;
  const closedTunnels = useMemo(
    () => new Set((scenario.mutations ?? []).flatMap((r) => (r.m.kind === "close_link" ? [r.m.linkId] : []))),
    [scenario],
  );

  // Safe area: what the story UI reported, else what the legacy panels imply.
  const override = usePaddingOverride();
  const padding = useMemo<Padding>(
    () =>
      override ?? {
        left: presentation || !leftOpen ? 0 : 316,
        right: presentation || (!rightOpen && selectedHex === null) ? 0 : 376,
        top: LEGACY_PANEL_TOP,
        bottom: 32,
      },
    [override, presentation, leftOpen, rightOpen, selectedHex],
  );

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
  const cellIds = useMemo(() => (world ? world.cells.map((c) => c.id) : []), [world]);

  // Neighbor topology, computed once per world: which hex touches which. Drives the color blend across shared
  // edges, the AO groove at real height steps, and (prototype) the TIN mesh's triangulation.
  const adjacency = useMemo<Adjacency | null>(() => (cellIds.length ? buildAdjacency(cellIds) : null), [cellIds]);
  const hexEdges = useMemo<HexEdge[]>(() => (adjacency ? buildHexEdges(cellIds, adjacency) : []), [cellIds, adjacency]);

  // PROTOTYPE, off by default: a continuous triangulated surface instead of extruded hexes, toggled only by
  // `?terrain=tin` for the design comparison (see components/map/TinTerrainLayer.ts). Never the production path.
  const [tinMode] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get(TIN_OPTION_KEY) === "tin");
  const tinTopo = useMemo<TinMeshTopology | null>(() => (tinMode && world ? buildTinTopology(world.cells) : null), [tinMode, world]);

  // The rendered field: the real per-hex numbers (elevation untouched) with color blended toward the neighbor
  // average and a tiny, hash-seeded height jitter on top of real relief only (see terrainSmoothing.ts) — the
  // treatment that makes the field read as continuous terrain instead of flat painted blocks.
  const renderTarget = useMemo(() => {
    if (!target || !adjacency) return target;
    const smoothed = smoothField(target, adjacency);
    return { elev: applyJitter(cellIds, smoothed.elev, new Float32Array(smoothed.elev.length)), rgb: smoothed.rgb, hatch: smoothed.hatch };
  }, [target, adjacency, cellIds]);

  // The real max distance from the bridge (a fixed property of the region, not the scenario): what the
  // disruption shockwave's radius is normalized against, so its radius always means the same real distance.
  const maxBridgeKm = useMemo(() => (world ? world.cells.reduce((m, c) => Math.max(m, c.bridgeKm), 0) : 0), [world]);

  useEffect(() => {
    if (!world || !renderTarget || !buffers) return;
    const cells = world.cells;
    // Ripple origin: an applied option's location, else the bridge.
    const dist = new Float32Array(cells.length);
    for (let i = 0; i < cells.length; i++) {
      dist[i] = staggerFrom ? distKm(cells[i].lat, cells[i].lng, staggerFrom.lat, staggerFrom.lng) : cells[i].bridgeKm;
    }
    buffers.start(
      renderTarget,
      dist,
      { ms: reduced ? 400 : slow(ANIM_MS), stagger: reduced ? 0 : STAGGER_FRAC, linear: reduced },
      () => setTick((v) => v + 1),
      () => {
        setHatchTick((v) => v + 1);
        if (tinMode && tinTopo) refreshTinNormals(tinTopo, cells.length, buffers.elev);
      },
    );
    return () => buffers.stop();
    // staggerFrom is read at the start of each change on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, renderTarget, reduced, buffers]);

  // ---------- camera: the change, a selected trip, the toolbar ----------
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
    // In a story scene the story owns the camera; in the free (expert) view a world change flies to the change.
    const sc = currentScene();
    if (sc !== null && sc !== "explore") return;
    void flyTo({ longitude: focus.longitude, latitude: focus.latitude, zoom: focus.zoom, pitch: focus.pitch, bearing: focus.bearing }, { durationMs: FLY_MS, curve: "fly" });
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
    const raf = requestAnimationFrame(() =>
      void flyTo({ longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2, latitude: (Math.min(...lats) + Math.max(...lats)) / 2, zoom, pitch: 40, bearing: 0 }, { durationMs: 1300, curve: "fly" }),
    );
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripKey]);

  // The presentation toggle (store) drives the ambient orbit; a story scene sets its own default.
  const firstOrbit = useRef(true);
  useEffect(() => {
    if (firstOrbit.current) {
      firstOrbit.current = false;
      return;
    }
    setOrbit(orbit && !reduced ? true : null);
  }, [orbit, reduced]);

  // ---------- disruption choreography: a one-shot shockwave + flash exactly at the moment the bridge is
  // removed, timed to lead the staggered terrain rise (see disruption.ts for why the radius is a real distance,
  // not a decorative animation with its own pace) ----------
  const prevRemoved = useRef(removed);
  const [shockProgress, setShockProgress] = useState(0);
  useEffect(() => {
    const justRemoved = removed && !prevRemoved.current;
    prevRemoved.current = removed;
    if (!justRemoved || reduced) return;
    const t0 = performance.now();
    const durMs = slow(650);
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / durMs);
      setShockProgress(t);
      if (t < 1) raf = requestAnimationFrame(step);
      else setShockProgress(0);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [removed, reduced]);

  // ---------- fonts, selection ----------
  const [fontFamily] = useState(() => {
    if (typeof document === "undefined") return "sans-serif";
    const cs = getComputedStyle(document.documentElement);
    return cs.getPropertyValue("--font-inter").trim() || cs.getPropertyValue("--font-jetbrains").trim() || "system-ui, sans-serif";
  });

  const selectedBgHexes = useMemo(() => {
    if (selectedHex === null || !aux) return null;
    const bg = aux.hexes.bg[selectedHex];
    const set = new Set<number>();
    for (let i = 0; i < aux.hexes.count; i++) if (aux.hexes.bg[i] === bg) set.add(i);
    return set;
  }, [selectedHex, aux]);

  const [hover, setHover] = useState<number | null>(null);

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

  // Columns worth a rim and a glow: recomputed when the target changes (not per frame).
  const tall = useMemo(() => {
    if (!buffers || !renderTarget) return [];
    return tallHexes(hexData, buffers.elev, renderTarget.elev, RIM_MIN_ELEV);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hexData, renderTarget, buffers, hatchTick]);

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
    const text =
      appliedGeo.length === 1
        ? `OPTION ${optionName(catalog, appliedGeo[0].candidateId)}`
        : mode === "story"
          ? `Ideas applied: ${appliedGeo.length}`
          : `${appliedGeo.length} OPTIONS APPLIED (HOVER FOR NAMES)`;
    return { at: best, text };
  }, [appliedGeo, focus, catalog, mode]);
  const [drawAnim, setDrawAnim] = useState(1);
  useEffect(() => {
    if (!appliedFx || reduced) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / slow(1100));
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

  // ---------- crossings, stations, freight routes: loaded when a scene or a selection needs them ----------
  const [tunnels, setTunnels] = useState<TunnelGeo[]>([]);
  useEffect(() => {
    if (status !== "ready") return;
    let live = true;
    loadTunnels().then((t) => live && setTunnels(t), () => {});
    return () => {
      live = false;
    };
  }, [status]);

  // The EMS lens shows its inputs in the free (expert) view too, not only in the story's "held" scene.
  const expertEms = (sceneNow === null || sceneNow === "explore") && encLens === "ems" && !!view?.detail;
  const stationsA = Math.max(visual.stations, expertEms ? 1 : 0);
  const hospitalsA = Math.max(visual.hospitals, expertEms ? 1 : 0);
  const wantStations = stationsA > 0.02 || hospitalsA > 0.02;
  const [facilities, setFacilities] = useState<Facility[]>([]);
  useEffect(() => {
    if (!wantStations || facilities.length) return;
    let live = true;
    loadFacilities().then((f) => live && setFacilities(f), () => {});
    return () => {
      live = false;
    };
  }, [wantStations, facilities.length]);

  // A selected trip in this same world animates; one from another world (a finalist compared) keeps steady lines.
  const sameWorldSel = !!freightSel && !freightSel.worldLabel;
  const highlightId = highlight ?? (sameWorldSel ? freightSel.tripId : null);
  const sceneTrails = visual.trails > 0.02 && visual.trailMode === "all";
  const wantRoutes = sceneTrails || highlightId !== null;
  const sKey = scenarioKey(scenario);
  // Routes are keyed by the world they were computed in: a trail is never drawn on the wrong world's roads.
  const [routesFor, setRoutesFor] = useState<{ key: string; routes: TrailRoute[] }>({ key: "", routes: [] });
  const routes = routesFor.key === sKey ? routesFor.routes : NO_ROUTES;
  useEffect(() => {
    if (!wantRoutes || status !== "ready") return;
    let live = true;
    loadTrailRoutes(scenario).then((r) => live && setRoutesFor({ key: sKey, routes: r }), () => live && setRoutesFor({ key: sKey, routes: [] }));
    return () => {
      live = false;
    };
    // sKey is the scenario's identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantRoutes, sKey, status]);

  const trails = useMemo(() => {
    if (!wantRoutes || routes.length === 0) return null;
    const mode: "all" | "selected" = sceneTrails ? "all" : "selected";
    return { routes, highlightId, mode, alpha: sceneTrails ? visual.trails : 1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantRoutes, routes, highlightId, sceneTrails, visualVersion]);
  const trailsAnimating = !!trails && !!highlightId && trails.routes.some((r) => r.tripId === highlightId) || sceneTrails;

  // ---------- place labels (positions here; collision and fades in DeckStage) ----------
  const placeHex = useMemo(() => {
    if (!world) return null;
    return PLACES.map((p) => {
      let best = -1;
      let bd = 1.6; // km
      for (let i = 0; i < world.cells.length; i++) {
        const d = distKm(world.cells[i].lat, world.cells[i].lng, p.lat, p.lng);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    });
  }, [world]);

  const labelDefs = useMemo<LabelDef[]>(() => {
    const S = buffers;
    const out: LabelDef[] = [];
    // An applied option's label outranks the place names (after the crossing label).
    const appliedDef = appliedLabel && drawT >= 1 ? ({ id: "applied", text: appliedLabel.text, lng: appliedLabel.at[0], lat: appliedLabel.at[1], z: 40, color: OPTION, visible: 1, strong: true } as LabelDef) : null;
    PLACES.forEach((p, k) => {
      const hi = placeHex?.[k] ?? -1;
      const z = p.kind === "link" ? 40 : hi >= 0 && S ? S.elev[hi] + 12 : 12;
      const isBridge = p.id === "keybridge";
      const text = isBridge && removed ? "KEY BRIDGE  ×  LINK REMOVED" : p.text;
      const closed = (p.id === "fortmchenry" && closedTunnels.has("L-FORTMCHENRY")) || (p.id === "harbortunnel" && closedTunnels.has("L-HARBORTUNNEL"));
      if (k === 1 && appliedDef) out.push(appliedDef);
      // A tunnel closed in the world is news: its label outranks the open ones.
      (closed ? out.unshift.bind(out) : out.push.bind(out))({
        id: p.id,
        text: closed ? `${p.text}  ×  CLOSED` : text,
        lng: p.lng,
        lat: p.lat,
        z,
        color: (isBridge && removed) || closed ? MAG : p.kind === "link" ? [200, 226, 255, 255] : [214, 224, 236, 235],
        visible: visual.labels[p.id],
        strong: p.kind === "link",
      });
    });
    if (freightSel) {
      const any = Object.keys(freightSel.routes).length > 0;
      out.push({ id: "trip-o", text: freightSel.ends.oName.split(" (")[0].toUpperCase(), lng: freightSel.ends.o[0], lat: freightSel.ends.o[1], z: 40, color: TEXT, visible: 1, strong: true });
      out.push({ id: "trip-d", text: `${freightSel.ends.dName.split(" (")[0].toUpperCase()}${any ? "" : " (SCHEMATIC LINE)"}`, lng: freightSel.ends.d[0], lat: freightSel.ends.d[1], z: 40, color: TEXT, visible: 1, strong: true });
    }
    const routes2 = inspection?.status === "ready" ? inspection.routes : undefined;
    if (routes2 && inspection?.chain) {
      const end = inspection.chain.focus.kind === "destination" ? routes2.after[routes2.after.length - 1] : routes2.after[0];
      const name = inspection.chain.focus.name;
      if (end && name) out.push({ id: "route-end", text: name.toUpperCase(), lng: end[0], lat: end[1], z: 40, color: TEXT, visible: 1, strong: true });
    }
    return out;
    // tick keeps label anchors on the moving terrain
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffers, placeHex, removed, closedTunnels, visualVersion, appliedLabel, drawT, freightSel, inspection, tick, hatchTick]);

  // ---------- layers ----------
  const glow = qLevel < 1;
  const layers = useMemo(() => {
    const S = buffers;
    if (!world || !S) return [];
    const { elev } = S;
    const out: Layer[] = [];
    const terrainOpacity = visual.terrain;

    if (tinMode && tinTopo) {
      // The visible surface is the continuous mesh; an invisible copy of the usual hex layer stays pickable so
      // hover/click/tooltip and selection keep working exactly as in hex mode.
      out.push(tinTerrainLayer(world.cells, S.elev, S.rgb, tinTopo, terrainOpacity));
      out.push(terrainLayer("terrain-pick", hexData, S.elev, S.rgb, world.cells, tick, { pickable: true, selected: selectedBgHexes, opacity: 0, shade: false }));
    } else {
      out.push(terrainLayer("terrain", hexData, S.elev, S.rgb, world.cells, tick, { pickable: true, selected: selectedBgHexes, opacity: terrainOpacity, shade: qLevel < 2 }));
    }
    if (tall.length && qLevel < 2 && !tinMode) out.push(rimLayer(tall, S.elev, S.rgb, tick, terrainOpacity, S.vel));
    if (tall.length && glow) out.push(glowLayer(tall, S.elev, S.rgb, tick, terrainOpacity));
    // AO groove at real height steps between neighbors: a new, heavier per-frame layer, so it is the first
    // thing the quality tier drops (same tier as the severity glow above), and it makes no sense once the
    // surface is already a continuous mesh with no hex seams to shadow.
    if (hexEdges.length && glow && !tinMode) out.push(terrainAOLayer(hexEdges, S.elev, tick, terrainOpacity));
    if (hatchData.length && visual.hatch > 0.02) {
      out.push(
        new PathLayer<{ path: Path3 }>({
          id: "severe-hatch",
          data: hatchData,
          getPath: (h) => h.path,
          getColor: [10, 14, 20, 230],
          getWidth: 1.5,
          widthUnits: "pixels",
          opacity: visual.hatch * terrainOpacity,
          pickable: false,
        }),
      );
    }

    // Hover: a soft outline on the hexagon under the pointer (not the selected one).
    if (hover !== null && hover !== selectedHex && world.cells[hover]) out.push(...hexOutline("hover-hex", world.cells[hover].id, elev[hover] + 6, false));

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

    // Crossings.
    out.push(...tunnelLayers(tunnels, closedTunnels, visual.tunnels, glow));
    out.push(...optionLayers(appliedGeo, appliedFx?.candidateIds ?? [], drawT, glow));

    // Recovery: a traveling pulse of light rides the tip of an applied option's line as it draws itself in.
    if (appliedFx && drawT < 1) {
      const latest = appliedGeo.find((g) => appliedFx.candidateIds.includes(g.candidateId) && g.kind !== "site");
      if (latest) out.push(...travelingPulseLayer(drawPrefix(latest.paths, drawT, 30, latest.point), drawT, [45, 212, 191], glow));
    }

    // Disruption: a shockwave ring expanding from the bridge at the instant it is removed, leading the terrain
    // stagger, plus a brief bright flash at the origin.
    if (shockProgress > 0) {
      out.push(...shockwaveLayers([BRIDGE.lng, BRIDGE.lat], shockProgress, maxBridgeKm, [MAGENTA[0], MAGENTA[1], MAGENTA[2]], glow));
      out.push(...originPulseLayer([BRIDGE.lng, BRIDGE.lat], shockProgress, [MAGENTA[0], MAGENTA[1], MAGENTA[2]], glow));
    }

    // A trip from another world (freight finalist compare): steady lines, the car route bright, the hazmat route amber.
    if (freightSel && !sameWorldSel) {
      const z = (p: [number, number][]) => p.map(([x, y]) => [x, y, 28] as [number, number, number]);
      const style: Record<string, RGBA> = { car: [230, 237, 243, 255], hazmat_truck: [245, 165, 36, 255] };
      for (const [cls, path] of Object.entries(freightSel.routes)) {
        if (!path || path.length < 2) continue;
        out.push(
          new PathLayer<{ path: Path3 }>({ id: `trip-casing-${cls}`, data: [{ path: z(path) }], getPath: (d) => d.path, getColor: [10, 14, 20, 220], getWidth: cls === "hazmat_truck" ? 8 : 6, widthUnits: "pixels", capRounded: true, jointRounded: true, parameters: ON_TOP }),
          new PathLayer<{ path: Path3 }>({ id: `trip-${cls}`, data: [{ path: z(path) }], getPath: (d) => d.path, getColor: style[cls] ?? [167, 139, 250, 255], getWidth: cls === "hazmat_truck" ? 4.5 : 2.5, widthUnits: "pixels", capRounded: true, jointRounded: true, parameters: ON_TOP }),
        );
      }
    }
    if (freightSel && Object.keys(freightSel.routes).length === 0) {
      // No route from the simulator yet (or none): a dashed straight line between the anchors, labeled schematic.
      out.push(
        new PathLayer<{ path: Path3 }>({
          id: "trip-schematic",
          data: [{ path: [[freightSel.ends.o[0], freightSel.ends.o[1], 28], [freightSel.ends.d[0], freightSel.ends.d[1], 28]] as Path3 }],
          getPath: (d) => d.path,
          getColor: [230, 237, 243, 200],
          getWidth: 1.5,
          widthUnits: "pixels",
          parameters: ON_TOP,
        }),
      );
    }

    // Route overlay for the inspected hexagon: baseline dim, current bright.
    const r = inspection?.status === "ready" ? inspection.routes : undefined;
    if (r && inspection?.chain) {
      const same = !inspection.chain.routeChanged;
      const z = (p: [number, number][]) => p.map(([x, y]) => [x, y, 25] as [number, number, number]);
      if (!same && r.before.length > 1) {
        out.push(new PathLayer<{ path: Path3 }>({ id: "route-before", data: [{ path: z(r.before) }], getPath: (d) => d.path, getColor: [139, 152, 169, 170], getWidth: 3, widthUnits: "pixels", capRounded: true, jointRounded: true, parameters: ON_TOP }));
      }
      if (r.after.length > 1) {
        out.push(
          new PathLayer<{ path: Path3 }>({ id: "route-after-casing", data: [{ path: z(r.after) }], getPath: (d) => d.path, getColor: [10, 14, 20, 220], getWidth: 7, widthUnits: "pixels", capRounded: true, jointRounded: true, parameters: ON_TOP }),
          new PathLayer<{ path: Path3 }>({ id: "route-after", data: [{ path: z(r.after) }], getPath: (d) => d.path, getColor: [230, 237, 243, 255], getWidth: 3.5, widthUnits: "pixels", capRounded: true, jointRounded: true, parameters: ON_TOP }),
        );
      }
    }

    if (selectedHex !== null && world.cells[selectedHex]) out.push(...hexOutline("selected-hex", world.cells[selectedHex].id, elev[selectedHex] + 8, true));

    out.push(...stationLayers(facilities, stationsA, hospitalsA));
    out.push(...bridgeLayers(removed, visual.bridge, glow));
    return out;
    // `visualVersion` stands in for the mutable scene visual state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, buffers, hexData, tick, hatchData, tall, hexEdges, tinMode, tinTopo, glow, selectedBgHexes, hover, selectedHex, previewEnc, tunnels, closedTunnels, appliedGeo, appliedFx, drawT, shockProgress, maxBridgeKm, freightSel, sameWorldSel, inspection, facilities, removed, visualVersion, stationsA, hospitalsA, qLevel]);

  const compareLayers = useMemo(() => {
    if (!world || !compareEnc) return [];
    return [terrainLayer("compare-terrain", hexData, compareEnc.elev, compareEnc.rgb, world.cells, 1)];
  }, [world, hexData, compareEnc]);

  const getTooltip = ({ object }: PickingInfo) => {
    const boxStyle = { background: "rgba(17,23,34,0.96)", color: "#E6EDF3", border: "1px solid #243044", borderRadius: "8px", padding: "8px 12px", fontSize: "12px" };
    const fac = object as Partial<Facility> | null;
    if (fac?.kind && fac.name !== undefined && fac.id?.startsWith("F-")) {
      const el = document.createElement("div");
      el.textContent = `${FACILITY_LABEL[fac.kind]}: ${fac.name || "(unnamed)"}`;
      return { html: el.innerHTML, style: boxStyle };
    }
    const opt = object as { candidateId?: string } | null;
    if (opt?.candidateId) {
      const title = optionName(catalog, opt.candidateId);
      const el = document.createElement("div");
      el.textContent = `${title} (${opt.candidateId}, applied; hypothetical)`;
      return { html: el.innerHTML, style: boxStyle };
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
      style: { ...boxStyle, lineHeight: "16px", fontVariantNumeric: "tabular-nums" },
    };
  };

  const onHover = (info: PickingInfo) => {
    const o = info.object as (HexDatum & { candidateId?: string; kind?: string }) | null | undefined;
    const next = o && typeof o.i === "number" && !o.candidateId ? o.i : null;
    setHover((prev) => (prev === next ? prev : next));
  };
  const onClick = (info: PickingInfo) => {
    const o = info.object as (HexDatum & { candidateId?: string; kind?: string }) | undefined;
    if (o?.candidateId) return; // an applied option: its name is on hover
    if (o?.kind) return; // a station: its name is on hover
    void selectHex(o && typeof o.i === "number" ? o.i : null);
  };

  // ---------- debug hook (only with ?mapdebug in the URL; never carries secrets) ----------
  useEffect(() => {
    if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("mapdebug")) return;
    (window as unknown as { __ws: unknown }).__ws = {
      goToScene,
      currentScene,
      resetView,
      flyTo,
      setQuality,
      frameStats,
      setViewportPadding,
      setFreightTripHighlight,
      interruptCamera,
      markMapReady,
      store: useApp,
      search: useSearch,
      quality: qualityLevel,
      setSlowMo: (factor: number) => {
        debugSlowMo = factor > 0 ? factor : 1;
      },
      visual: () => JSON.parse(JSON.stringify(getVisual())),
      camera: getCamera,
      isUserControlled,
      whenMapReady,
    };
  }, []);

  const trailCaptionLeft = padding.left + 16;
  return (
    <div
      className="ws-map absolute inset-0"
      data-testid="map-stage"
      role="group"
      aria-label={`Map: ${sceneNow ? SCENES[sceneNow].label : "Key Bridge region, Baltimore"}`}
      data-left-open={!presentation && leftOpen ? "true" : "false"}
      data-compare={compareEnc ? "true" : "false"}
      data-trails={trailsAnimating ? "true" : "false"}
      data-hover={hover ?? ""}
      style={{ ["--split" as string]: `${((compare?.split ?? 0.5) * 100).toFixed(2)}%`, background: "#0a0e14" }}
    >
      <DeckStage
        layers={layers}
        compareLayers={compareLayers}
        compareSplit={compareEnc ? (compare?.split ?? 0.5) : null}
        labelDefs={labelDefs}
        trails={trails}
        padding={padding}
        fontFamily={fontFamily}
        reduced={reduced}
        onClick={onClick}
        onHover={onHover}
        getTooltip={getTooltip as never}
      />

      {compare && <CompareSlider />}
      {freightSel && Object.keys(freightSel.routes).length > 0 && (
        <div className="pointer-events-none absolute" style={{ left: trailCaptionLeft, top: padding.top + 80 }}>
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

      {/* Map toolbar: bottom-center of the map area, above the footer. Off when the story UI provides its own. */}
      {toolbar && (
        <div className="pointer-events-none absolute flex justify-center" style={{ left: padding.left, right: padding.right, bottom: padding.bottom + 16 }}>
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
              onClick={() => {
                const sc = currentScene();
                if (sc !== null && sc !== "explore") void resetView();
                else void flyTo({ longitude: focus.longitude, latitude: focus.latitude, zoom: focus.zoom, pitch: focus.pitch, bearing: focus.bearing }, { durationMs: 1200, curve: "fly" });
              }}
            >
              <Compass size={16} aria-hidden />
            </button>
            <button className="btn-icon" aria-pressed={presentation} aria-label="Presentation mode (P)" title="Presentation mode (P)" onClick={togglePresentation}>
              <Presentation size={16} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

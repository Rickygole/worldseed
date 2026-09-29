/**
 * The map director: the one place the story UI talks to the map layer.
 *
 * It owns the CAMERA (eased, cancelable moves; ambient drift), the MAP-ONLY visual state of each scene (which
 * layers are on and how strongly), freight trails, the label set, viewport padding and the quality tier.
 * It never touches the simulator world or the lens: the story UI owns the store and calls store actions;
 * this module only decides what the map looks like while that happens.
 *
 * It is plain TypeScript with no React: `components/MapStage.tsx` registers a driver (how to read and write
 * the camera) and subscribes to the visual state. Everything is safe to import and call on the server
 * (calls before a map exists are remembered and applied when it mounts).
 *
 * Honesty rules baked in: only data is animated (terrain height, freight travel time, an option drawing
 * itself). Nothing here animates a collapse, a ship or traffic. The Key Bridge is a static dashed marker.
 */
import { BASE_VIEW, type CameraView, type PlaceId } from "../geo";

// ---------------------------------------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------------------------------------

export type SceneId = "intro" | "crossing" | "averages" | "held" | "freight" | "fix" | "explore";

export type CameraCurve = "easeInOut" | "fly" | "easeOut" | "linear";

/** Place labels the deck layer can draw (see `PLACES` in lib/geo.ts). */
export type PlaceLabelId = PlaceId;

export interface SceneCamera extends CameraView {
  /** 1.2 s to 2.5 s for a story move. */
  durationMs: number;
  curve: CameraCurve;
  /** Slow ambient bearing drift once the move has landed, in degrees per second (0 = still). */
  driftDegPerSec: number;
}

export interface SceneLayers {
  /** Terrain (H3 hexagons) opacity, 0 to 1. The world's numbers are the store's business, not this. */
  terrain: number;
  /** Diagonal hatch on severe cells. */
  hatch: boolean;
  /** How loudly the removed-link marker reads: 0 quiet, 1 emphasised (still a static dashed line). */
  bridgeEmphasis: number;
  /** Fort McHenry and Harbor tunnel lines and portals. */
  tunnels: boolean;
  /** Freight trails: none, only the highlighted trip, or every cross-harbor trip. */
  trails: "off" | "selected" | "all";
  /** Fire/EMS station points on both banks. */
  stations: boolean;
  /** Hospitals (small precise marks). */
  hospitals: boolean;
  /** Which place labels are visible in this scene. */
  labels: readonly PlaceLabelId[];
}

export interface SceneSpec {
  id: SceneId;
  /** Plain-language name, for screen readers ("Map view: ..."). */
  label: string;
  camera: SceneCamera;
  layers: SceneLayers;
  /** The camera drifts slowly by itself (ambient orbit) while this scene rests. */
  orbit: boolean;
}

/** All place labels, in priority order (earlier wins a collision). */
const ALL_LABELS: readonly PlaceLabelId[] = ["keybridge", "sparrows", "edgemere", "dundalk", "curtis", "hawkins", "fortmchenry", "harbortunnel"];

export const SCENES: Record<SceneId, SceneSpec> = {
  intro: {
    id: "intro",
    label: "Harbor overview",
    camera: { longitude: -76.515, latitude: 39.235, zoom: 10.25, pitch: 48, bearing: -24, durationMs: 2500, curve: "fly", driftDegPerSec: 0.9 },
    layers: { terrain: 1, hatch: false, bridgeEmphasis: 0.25, tunnels: false, trails: "off", stations: false, hospitals: false, labels: ["keybridge", "sparrows", "dundalk", "curtis"] },
    orbit: true,
  },
  crossing: {
    id: "crossing",
    label: "The Patapsco crossing",
    camera: { longitude: -76.5275, latitude: 39.2195, zoom: 12.85, pitch: 58, bearing: 24, durationMs: 2300, curve: "fly", driftDegPerSec: 0 },
    layers: { terrain: 1, hatch: false, bridgeEmphasis: 1, tunnels: false, trails: "off", stations: false, hospitals: false, labels: ["keybridge", "hawkins", "sparrows"] },
    orbit: false,
  },
  averages: {
    id: "averages",
    label: "Sparrows Point and Edgemere",
    camera: { longitude: -76.478, latitude: 39.228, zoom: 11.7, pitch: 66, bearing: -42, durationMs: 2500, curve: "fly", driftDegPerSec: 1.6 },
    layers: { terrain: 1, hatch: true, bridgeEmphasis: 0.6, tunnels: false, trails: "off", stations: false, hospitals: false, labels: ["sparrows", "edgemere", "keybridge", "dundalk"] },
    orbit: true,
  },
  held: {
    id: "held",
    label: "Both shores, first response",
    camera: { longitude: -76.535, latitude: 39.222, zoom: 10.75, pitch: 46, bearing: 0, durationMs: 2300, curve: "easeInOut", driftDegPerSec: 0 },
    layers: { terrain: 0.55, hatch: false, bridgeEmphasis: 0.5, tunnels: false, trails: "off", stations: true, hospitals: true, labels: ["keybridge", "dundalk", "curtis"] },
    orbit: false,
  },
  freight: {
    id: "freight",
    label: "Freight routes across the harbor",
    camera: { longitude: -76.535, latitude: 39.235, zoom: 11.0, pitch: 58, bearing: -14, durationMs: 2200, curve: "fly", driftDegPerSec: 0 },
    layers: { terrain: 0.4, hatch: false, bridgeEmphasis: 0.7, tunnels: true, trails: "all", stations: false, hospitals: false, labels: ["keybridge", "fortmchenry", "harbortunnel", "curtis", "sparrows"] },
    orbit: false,
  },
  fix: {
    id: "fix",
    label: "Options overview",
    camera: { longitude: -76.52, latitude: 39.232, zoom: 10.85, pitch: 54, bearing: 8, durationMs: 2200, curve: "easeInOut", driftDegPerSec: 0 },
    layers: { terrain: 1, hatch: true, bridgeEmphasis: 0.6, tunnels: true, trails: "off", stations: false, hospitals: false, labels: ["keybridge", "sparrows", "curtis", "hawkins", "dundalk"] },
    orbit: false,
  },
  explore: {
    id: "explore",
    label: "Free camera",
    camera: { ...BASE_VIEW, durationMs: 1400, curve: "easeInOut", driftDegPerSec: 0 },
    layers: { terrain: 1, hatch: true, bridgeEmphasis: 0.6, tunnels: true, trails: "off", stations: false, hospitals: false, labels: ALL_LABELS },
    orbit: false,
  },
};

/** The interpolated, currently displayed map-only state (0..1 numbers so layers can fade). */
export interface MapVisual {
  terrain: number;
  hatch: number;
  bridge: number;
  tunnels: number;
  trails: number;
  /** Which trails: everything or only the highlighted trip. */
  trailMode: "off" | "selected" | "all";
  stations: number;
  hospitals: number;
  labels: Record<PlaceLabelId, number>;
}

export type QualityTier = "auto" | "high" | "low";
/** What the map actually renders at: 0 full, 1 no buildings/glow, 2 also no label fades, thinner trails. */
export type QualityLevel = 0 | 1 | 2;

export interface CameraState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface Padding {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** What the mounted map gives the director. */
export interface MapDriver {
  getCamera(): CameraState;
  setCamera(c: CameraState): void;
}

// ---------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------

const isBrowser = (): boolean => typeof window !== "undefined" && typeof requestAnimationFrame === "function";

let driver: MapDriver | null = null;
let scene: SceneId | null = null;
let pendingScene: { id: SceneId; instant: boolean } | null = null;
let ready = false;
let readyResolvers: (() => void)[] = [];
let userControl = false;
let padding: Padding | null = null;
let highlightedTrip: string | null = null;
let orbitOverride: boolean | null = null;

const sceneSubs = new Set<(id: SceneId | null) => void>();
const visualSubs = new Set<() => void>();
const paddingSubs = new Set<() => void>();
const qualitySubs = new Set<() => void>();
const tripSubs = new Set<() => void>();

const emptyLabels = (): Record<PlaceLabelId, number> => Object.fromEntries(ALL_LABELS.map((l) => [l, 0])) as Record<PlaceLabelId, number>;

const visual: MapVisual = {
  terrain: 1,
  hatch: 1,
  bridge: 0.6,
  tunnels: 0,
  trails: 0,
  trailMode: "off",
  stations: 0,
  hospitals: 0,
  labels: emptyLabels(),
};
let visualTarget = layersToTarget(SCENES.explore.layers);
let visualVersion = 0;

function layersToTarget(l: SceneLayers): MapVisual {
  const labels = emptyLabels();
  for (const id of l.labels) labels[id] = 1;
  return {
    terrain: l.terrain,
    hatch: l.hatch ? 1 : 0,
    bridge: l.bridgeEmphasis,
    tunnels: l.tunnels ? 1 : 0,
    trails: l.trails === "off" ? 0 : 1,
    trailMode: l.trails,
    stations: l.stations ? 1 : 0,
    hospitals: l.hospitals ? 1 : 0,
    labels,
  };
}

export function prefersReducedMotion(): boolean {
  return isBrowser() && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const shortestAngle = (from: number, to: number) => {
  const d = ((((to - from) % 360) + 540) % 360) - 180;
  return from + d;
};

const CURVES: Record<CameraCurve, (t: number) => number> = {
  easeInOut: easeInOutCubic,
  fly: easeInOutCubic,
  easeOut: easeOutCubic,
  linear: (t) => t,
};

// ---------------------------------------------------------------------------------------------------------
// Ready
// ---------------------------------------------------------------------------------------------------------

/** Resolves once the base map and the deck layer have drawn (or after a safety timeout, so a story never hangs). */
export function whenMapReady(): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((res) => {
    readyResolvers.push(res);
    if (isBrowser()) window.setTimeout(res, 15000);
  });
}

/** MapStage calls this once the map has drawn its first frame. */
export function markMapReady(): void {
  if (ready) return;
  ready = true;
  const rs = readyResolvers;
  readyResolvers = [];
  for (const r of rs) r();
}

export function isMapReady(): boolean {
  return ready;
}

// ---------------------------------------------------------------------------------------------------------
// Driver + camera engine
// ---------------------------------------------------------------------------------------------------------

/** MapStage registers how to read and write the camera. Returns the unregister function. */
export function registerMapDriver(d: MapDriver): () => void {
  driver = d;
  // A scene asked for before the map existed, or a remount (hot reload, strict mode): frame it now.
  const p = pendingScene ?? (scene !== null ? { id: scene, instant: true } : null);
  if (p) {
    pendingScene = null;
    void goToScene(p.id, { instant: p.instant });
  } else if (scene === null) {
    // First mount with no story running: a neutral, controllable camera.
    applyLayers(SCENES.explore.layers, true);
  }
  return () => {
    if (driver === d) {
      driver = null;
      cancelMove();
    }
  };
}

interface Move {
  from: CameraState;
  to: CameraState;
  t0: number;
  ms: number;
  curve: (t: number) => number;
  arc: number;
  done: () => void;
}

let move: Move | null = null;
let raf = 0;
let drift = 0; // degrees per second
let lastFrame = 0;

function ensureLoop(): void {
  if (raf || !isBrowser()) return;
  lastFrame = performance.now();
  raf = requestAnimationFrame(frame);
}

function frame(now: number): void {
  raf = 0;
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  let again = false;

  if (move && driver) {
    const m = move;
    const t = clamp01((now - m.t0) / m.ms);
    const p = m.curve(t);
    // A little zoom-out arc on long moves reads as a flight, not a slide.
    const zoom = lerp(m.from.zoom, m.to.zoom, p) - m.arc * Math.sin(Math.PI * p);
    driver.setCamera({
      longitude: lerp(m.from.longitude, m.to.longitude, p),
      latitude: lerp(m.from.latitude, m.to.latitude, p),
      zoom,
      pitch: lerp(m.from.pitch, m.to.pitch, p),
      bearing: lerp(m.from.bearing, m.to.bearing, p),
    });
    if (t >= 1) {
      move = null;
      m.done();
    }
    again = true;
  } else if (drift !== 0 && driver && !userControl && !prefersReducedMotion() && (typeof document === "undefined" || !document.hidden)) {
    const c = driver.getCamera();
    driver.setCamera({ ...c, bearing: c.bearing + drift * dt });
    again = true;
  }

  if (fading(dt)) again = true;
  if (again) raf = requestAnimationFrame(frame);
}

function cancelMove(): void {
  if (!move) return;
  const m = move;
  move = null;
  m.done();
}

/** The user grabbed the camera (drag, scroll, pinch): stop any move and the ambient drift. Free camera from here. */
export function interruptCamera(): void {
  userControl = true;
  cancelMove();
}

/** The camera as drawn right now (null before a map is mounted). */
export function getCamera(): CameraState | null {
  return driver ? driver.getCamera() : null;
}

/** True while the user has taken over the camera since the last scene move. */
export function isUserControlled(): boolean {
  return userControl;
}

// ---------------------------------------------------------------------------------------------------------
// Visual state (fades)
// ---------------------------------------------------------------------------------------------------------

const FADE_PER_SEC = 3.2; // full fade in ~0.3 s

function fading(dt: number): boolean {
  let moving = false;
  let changed = false;
  const step = (cur: number, tgt: number): number => {
    if (cur === tgt) return cur;
    changed = true;
    const d = tgt - cur;
    const s = FADE_PER_SEC * dt;
    if (Math.abs(d) <= s) return tgt;
    moving = true;
    return cur + Math.sign(d) * s;
  };
  visual.terrain = step(visual.terrain, visualTarget.terrain);
  visual.hatch = step(visual.hatch, visualTarget.hatch);
  visual.bridge = step(visual.bridge, visualTarget.bridge);
  visual.tunnels = step(visual.tunnels, visualTarget.tunnels);
  visual.trails = step(visual.trails, visualTarget.trails);
  visual.stations = step(visual.stations, visualTarget.stations);
  visual.hospitals = step(visual.hospitals, visualTarget.hospitals);
  for (const id of ALL_LABELS) visual.labels[id] = step(visual.labels[id], visualTarget.labels[id]);
  if (visual.trails === 0 && visualTarget.trails === 0) visual.trailMode = visualTarget.trailMode;
  else if (visualTarget.trails > 0) visual.trailMode = visualTarget.trailMode;
  if (changed) notifyVisual();
  return moving;
}

function applyLayers(l: SceneLayers, instant: boolean): void {
  visualTarget = layersToTarget(l);
  if (instant || prefersReducedMotion()) {
    // Reduced motion: crossfades become cuts.
    visual.terrain = visualTarget.terrain;
    visual.hatch = visualTarget.hatch;
    visual.bridge = visualTarget.bridge;
    visual.tunnels = visualTarget.tunnels;
    visual.trails = visualTarget.trails;
    visual.trailMode = visualTarget.trailMode;
    visual.stations = visualTarget.stations;
    visual.hospitals = visualTarget.hospitals;
    visual.labels = { ...visualTarget.labels };
    notifyVisual();
  } else {
    if (visualTarget.trails > 0) visual.trailMode = visualTarget.trailMode;
    ensureLoop();
  }
}

function notifyVisual(): void {
  visualVersion++;
  for (const f of visualSubs) f();
}

/** Bumps whenever the visual state changed (a cheap snapshot for useSyncExternalStore). */
export function getVisualVersion(): number {
  return visualVersion;
}

/** The live visual state. Read it when building layers; it changes in place. */
export function getVisual(): MapVisual {
  return visual;
}

/** Called whenever the visual state changes (during fades only, about 20 times per transition). */
export function subscribeVisual(fn: () => void): () => void {
  visualSubs.add(fn);
  return () => void visualSubs.delete(fn);
}

// ---------------------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------------------

export function currentScene(): SceneId | null {
  return scene;
}

export function subscribeScene(fn: (id: SceneId | null) => void): () => void {
  sceneSubs.add(fn);
  return () => void sceneSubs.delete(fn);
}

/**
 * Fly the camera to a scene and switch the map-only layers. Does not change the simulator world or the lens.
 * Resolves when the move lands (or is cancelled by the user or a newer scene). Reduced motion: an instant cut.
 */
export function goToScene(id: SceneId, opts: { instant?: boolean } = {}): Promise<void> {
  const spec = SCENES[id];
  const instant = !!opts.instant || prefersReducedMotion();
  const prev = scene;
  scene = id;
  userControl = false;
  if (prev !== id) for (const f of sceneSubs) f(id);
  drift = 0;

  if (!driver) {
    pendingScene = { id, instant };
    applyLayers(spec.layers, true);
    return Promise.resolve();
  }

  cancelMove();
  applyLayers(spec.layers, instant);
  const from = driver.getCamera();
  const to: CameraState = { longitude: spec.camera.longitude, latitude: spec.camera.latitude, zoom: spec.camera.zoom, pitch: spec.camera.pitch, bearing: spec.camera.bearing };
  const restDrift = spec.orbit && orbitOverride !== false ? spec.camera.driftDegPerSec : 0;

  if (instant) {
    driver.setCamera(to);
    drift = restDrift;
    if (drift) ensureLoop();
    return Promise.resolve();
  }

  return startMove(from, to, spec.camera.durationMs, spec.camera.curve, () => {
    if (scene === id && !userControl) drift = restDrift;
  });
}

function startMove(from: CameraState, to: CameraState, durationMs: number, curve: CameraCurve, onDone: () => void): Promise<void> {
  to.bearing = shortestAngle(from.bearing, to.bearing);
  const dLng = (to.longitude - from.longitude) * Math.cos((to.latitude * Math.PI) / 180);
  const distDeg = Math.hypot(dLng, to.latitude - from.latitude);
  // Zoom-out arc scales with how far the eye travels, capped so a hop never leaves the harbor.
  const arc = curve === "fly" ? Math.min(0.7, distDeg * 8) : 0;
  return new Promise<void>((resolve) => {
    move = {
      from,
      to,
      t0: performance.now(),
      ms: durationMs,
      curve: CURVES[curve],
      arc,
      done: () => {
        onDone();
        resolve();
      },
    };
    ensureLoop();
  });
}

/**
 * Ease the camera to any framing (a selected freight trip, the change on the map). Cancelable by the user like
 * a scene move. Does not change the scene. Reduced motion: an instant cut.
 */
export function flyTo(target: Partial<CameraState>, opts: { durationMs?: number; curve?: CameraCurve; instant?: boolean } = {}): Promise<void> {
  if (!driver) return Promise.resolve();
  cancelMove();
  userControl = false;
  drift = 0;
  const from = driver.getCamera();
  const to: CameraState = { ...from, ...target };
  if (opts.instant || prefersReducedMotion()) {
    driver.setCamera(to);
    return Promise.resolve();
  }
  return startMove(from, to, opts.durationMs ?? 1400, opts.curve ?? "fly", () => {});
}

/** Fly back to the current scene's framing (or the neutral overview when no scene is set). */
export function resetView(opts: { instant?: boolean } = {}): Promise<void> {
  return goToScene(scene ?? "explore", opts);
}

/** Ambient orbit on/off for whatever scene is showing (the presentation toggle). `null` returns to the scene default. */
export function setOrbit(on: boolean | null): void {
  orbitOverride = on;
  if (on === true) userControl = false;
  if (!driver || move) return;
  const spec = SCENES[scene ?? "explore"];
  drift = on === true ? (spec.camera.driftDegPerSec || 0.8) : on === false ? 0 : spec.orbit ? spec.camera.driftDegPerSec : 0;
  if (drift) ensureLoop();
}

// ---------------------------------------------------------------------------------------------------------
// Padding
// ---------------------------------------------------------------------------------------------------------

/**
 * Safe-area padding in CSS pixels: the part of the map covered by panels. The camera centers in the free area
 * and place labels stay clear of it. Once set, it replaces the legacy panel-derived padding.
 */
export function setViewportPadding(p: Partial<Padding>): void {
  padding = { left: 0, right: 0, top: 0, bottom: 0, ...(padding ?? {}), ...p };
  for (const f of paddingSubs) f();
}

export function getViewportPadding(): Padding | null {
  return padding;
}

export function subscribePadding(fn: () => void): () => void {
  paddingSubs.add(fn);
  return () => void paddingSubs.delete(fn);
}

// ---------------------------------------------------------------------------------------------------------
// Freight highlight
// ---------------------------------------------------------------------------------------------------------

/**
 * Highlight one freight trip: its car and hazmat-truck routes get bright animated trails. `null` clears it (the
 * freight scene then shows every cross-harbor trip dimly). The routes are the ones the simulator returns.
 */
export function setFreightTripHighlight(tripId: string | null): void {
  if (highlightedTrip === tripId) return;
  highlightedTrip = tripId;
  for (const f of tripSubs) f();
}

export function getFreightTripHighlight(): string | null {
  return highlightedTrip;
}

export function subscribeFreightHighlight(fn: () => void): () => void {
  tripSubs.add(fn);
  return () => void tripSubs.delete(fn);
}

// ---------------------------------------------------------------------------------------------------------
// Quality tiers
// ---------------------------------------------------------------------------------------------------------

let qualityTier: QualityTier = "auto";
let autoLevel: QualityLevel = 0;

export function setQuality(tier: QualityTier): void {
  qualityTier = tier;
  if (tier === "auto") autoLevel = 0;
  resetFrameWindow();
  for (const f of qualitySubs) f();
}

export function getQualityTier(): QualityTier {
  return qualityTier;
}

/** What is actually rendered right now. */
export function qualityLevel(): QualityLevel {
  return qualityTier === "high" ? 0 : qualityTier === "low" ? 2 : autoLevel;
}

export function subscribeQuality(fn: () => void): () => void {
  qualitySubs.add(fn);
  return () => void qualitySubs.delete(fn);
}

// Frame-time monitor: p95 of rAF deltas over a sliding window; downgrade after 3 s over 25 ms.
const WINDOW = 180;
const frames = new Float32Array(WINDOW);
let frameN = 0;
let frameFill = 0;
let overSince = 0;
let monitorRaf = 0;
let monitorLast = 0;
let lastDecision = "";

function resetFrameWindow(): void {
  frameN = 0;
  frameFill = 0;
  overSince = 0;
}

export function percentile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return sorted[Math.min(n - 1, Math.floor(p * n))];
}

/** p50 / p95 of the recent frame deltas in ms (all zero until frames were sampled). */
export function frameStats(): { p50: number; p95: number; n: number } {
  const n = frameFill;
  if (n === 0) return { p50: 0, p95: 0, n: 0 };
  const a = Array.from(frames.subarray(0, n)).sort((x, y) => x - y);
  return { p50: percentile(a, 0.5), p95: percentile(a, 0.95), n };
}

function monitor(now: number): void {
  monitorRaf = requestAnimationFrame(monitor);
  const dt = now - monitorLast;
  monitorLast = now;
  // Ignore background-tab gaps and the first frame (a genuinely slow device still counts: up to 1 s).
  if (dt <= 0 || dt > 1000 || document.hidden) return;
  frames[frameN] = dt;
  frameN = (frameN + 1) % WINDOW;
  frameFill = Math.min(WINDOW, frameFill + 1);
  if (qualityTier !== "auto" || frameFill < 10) return;
  const { p95 } = frameStats();
  if (p95 > 25) {
    if (!overSince) overSince = now;
    else if (now - overSince > 3000 && autoLevel < 2) {
      autoLevel = (autoLevel + 1) as QualityLevel;
      const msg = `[worldseed] map quality auto: p95 frame ${p95.toFixed(1)} ms over 3 s, dropping to level ${autoLevel} (${autoLevel === 1 ? "no buildings, no glow" : "also no label fades, thinner trails"})`;
      if (msg !== lastDecision) console.info(msg);
      lastDecision = msg;
      resetFrameWindow();
      for (const f of qualitySubs) f();
    }
  } else overSince = 0;
}

/** MapStage starts the sampler when it mounts. Returns the stop function. */
export function startFrameMonitor(): () => void {
  if (!isBrowser() || monitorRaf) return () => {};
  monitorLast = performance.now();
  monitorRaf = requestAnimationFrame(monitor);
  return () => {
    cancelAnimationFrame(monitorRaf);
    monitorRaf = 0;
  };
}

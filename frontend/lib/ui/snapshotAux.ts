/**
 * Read-only snapshot files the UI shows directly (inspector, assumptions drawer, explainer place names, route
 * geometry). The simulator loads its own copies inside the workers; these are plain fetches of the same
 * static files, so after the first load they come from the HTTP cache.
 *
 * Every loader is memoized and resets on failure, so a later call can retry.
 */
import { parseHexes } from "../sim/snapshot";
import type { AssumptionRecord, Hexes } from "../sim/contract";

const BASE = "/snapshot/";

async function fetchOk(file: string): Promise<Response> {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`GET ${BASE + file} failed: HTTP ${res.status}`);
  return res;
}
const json = async <T>(file: string): Promise<T> => (await fetchOk(file)).json() as Promise<T>;

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    p ??= fn().catch((e) => {
      p = null;
      throw e;
    });
    return p;
  };
}

// ---- manifest + assumptions (assumptions drawer) ----------------------------------------------------------

export interface ManifestSource {
  name: string;
  license?: string;
  attribution?: string;
  url?: string;
  use?: string;
  vintage?: string;
  transport?: string;
  officialApi?: boolean;
  fetchedAt?: string;
}

export interface ManifestFull {
  snapshotId: string;
  pipelineVersion?: string;
  builtAt?: string;
  osmDate?: string;
  acsVintage?: string;
  lodes?: string;
  bbox?: number[];
  h3Res?: number;
  sources?: ManifestSource[];
  notes?: unknown;
}

export const loadManifest = memo(() => json<ManifestFull>("manifest.json"));
export const loadAssumptions = memo(() => json<AssumptionRecord[]>("assumptions.json"));

// ---- hexes, block groups, place names (inspector, explainer) ----------------------------------------------

export interface BlockGroupRow {
  geoid: string;
  i: number;
  county: string;
  pop: number;
  households: number;
  zvh: number;
  lowWageWorkers: number;
  centroid: [number, number];
  hexes: number[];
}

interface GazetteerEntry {
  id: string;
  name: string;
  kind: string;
  ref: { hexes?: number[] };
}

export interface AuxIndex {
  hexes: Hexes;
  blockGroups: BlockGroupRow[];
  /** Per hex: index into `places`, -1 when no OSM place node lies within the gazetteer radius. */
  hexPlace: Int32Array;
  places: string[];
}

export const loadAux = memo(async (): Promise<AuxIndex> => {
  const [hexMeta, hexBin, blockGroups, gazetteer] = await Promise.all([
    json<unknown>("hexes.meta.json"),
    fetchOk("hexes.bin").then((r) => r.arrayBuffer()),
    json<BlockGroupRow[]>("blockgroups.json"),
    json<GazetteerEntry[]>("gazetteer.json"),
  ]);
  const hexes = parseHexes(hexMeta, hexBin);
  const hexPlace = new Int32Array(hexes.count).fill(-1);
  const places: string[] = [];
  for (const g of gazetteer) {
    if (g.kind !== "neighborhood" || !g.ref.hexes) continue;
    const k = places.push(g.name) - 1;
    for (const h of g.ref.hexes) if (h >= 0 && h < hexes.count) hexPlace[h] = k;
  }
  return { hexes, blockGroups, hexPlace, places };
});

/** Block group by its index (hexes.bg / WorstBlockGroup.bg). */
export function blockGroupAt(aux: AuxIndex, bg: number): BlockGroupRow | null {
  const row = aux.blockGroups[bg];
  if (row && row.i === bg) return row;
  return aux.blockGroups.find((b) => b.i === bg) ?? null;
}

/** "Baltimore County, Tract 4524.00, Block Group 2". Derived from the GEOID, not a neighborhood name. */
export function blockGroupLabel(geoid: string | null, county: string | null): string {
  if (!geoid || geoid.length < 12) return county ?? "Block group";
  return `${county ?? "County " + geoid.slice(2, 5)}, Tract ${geoid.slice(5, 9)}.${geoid.slice(9, 11)}, Block Group ${geoid.slice(11)}`;
}

/**
 * The OSM place names covering a set of hexes, heaviest first by the given per-hex weight (population by
 * default). A name is the nearest OSM place node, not an official boundary.
 */
export function placesFor(aux: AuxIndex, hexIdx: Iterable<number>, weight?: (h: number) => number): string[] {
  const w = new Map<number, number>();
  for (const h of hexIdx) {
    const p = aux.hexPlace[h];
    if (p < 0) continue;
    w.set(p, (w.get(p) ?? 0) + (weight ? weight(h) : aux.hexes.pop[h] || 0.001));
  }
  return [...w.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => aux.places[p]);
}

// ---- road-node coordinates (route overlay) ----------------------------------------------------------------

interface GraphMetaLite {
  nodeCount: number;
  buffers: Record<string, { offset: number; length: number; type: string }>;
}

export const loadNodeCoords = memo(async (): Promise<{ lon: Float32Array; lat: Float32Array }> => {
  const [meta, bin] = await Promise.all([
    json<GraphMetaLite>("graph.meta.json"),
    fetchOk("graph.bin").then((r) => r.arrayBuffer()),
  ]);
  const slice = (name: string) => {
    const s = meta.buffers[name];
    if (!s || s.type !== "f32" || s.length !== meta.nodeCount) throw new Error(`graph.meta.json: unexpected ${name} buffer`);
    return new Float32Array(bin.slice(s.offset, s.offset + s.length * 4));
  };
  return { lon: slice("nodeLon"), lat: slice("nodeLat") };
});

// ---- facilities and shores (story facts) -------------------------------------------------------------------

export interface FacilityLite {
  id: string;
  kind: "fire_station" | "ems_station" | "hospital";
  lat: number;
  lng: number;
  active: boolean;
}

export const loadFacilities = memo(() => json<FacilityLite[]>("facilities.json"));

/** Nearest hex center within `maxKm` (equirectangular; fine at this scale), or -1. */
export function nearestHex(hexes: Hexes, lat: number, lng: number, maxKm = 1): number {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.57;
  let best = -1;
  let bestD = maxKm * maxKm;
  for (let i = 0; i < hexes.count; i++) {
    const dx = (hexes.lng[i] - lng) * kx;
    const dy = (hexes.lat[i] - lat) * ky;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * ems.shoresWithStations: how many of the two shores (0 north/east, 1 south/west) have at least one active
 * fire station, each station placed on the shore of its nearest hexagon. Stations off the hex grid or on
 * ambiguous (shore 2) hexes do not count.
 */
export function shoresWithStations(hexes: Hexes, facilities: readonly FacilityLite[]): number {
  const shores = new Set<number>();
  for (const f of facilities) {
    if (f.kind !== "fire_station" || !f.active) continue;
    const h = nearestHex(hexes, f.lat, f.lng);
    if (h >= 0 && (hexes.shore[h] === 0 || hexes.shore[h] === 1)) shores.add(hexes.shore[h]);
  }
  return shores.size;
}

/** data.fireStations / data.ambulanceStations: active response sources in the first-response lens. */
export function stationCounts(facilities: readonly FacilityLite[]): { fire: number; ambulance: number } {
  let fire = 0;
  let ambulance = 0;
  for (const f of facilities) {
    if (!f.active) continue;
    if (f.kind === "fire_station") fire++;
    else if (f.kind === "ems_station") ambulance++;
  }
  return { fire, ambulance };
}

/** def.budgetMin: the cross-harbor time budget from assumption A-XHARBOR-T (seconds in the file). */
export function budgetMinutes(assumptions: readonly AssumptionRecord[]): number | null {
  const a = assumptions.find((r) => r.id === "A-XHARBOR-T");
  const v = typeof a?.value === "number" ? a.value : Number(a?.value);
  if (!Number.isFinite(v) || v <= 0) return null;
  return a?.unit === "s" ? Math.round(v / 60) : Math.round(v);
}

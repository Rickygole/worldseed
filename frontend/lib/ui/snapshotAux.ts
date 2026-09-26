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

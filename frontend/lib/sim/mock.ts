/**
 * MOCK SIMULATOR. NOT REAL DATA.
 *
 * Everything here is deterministic, hand-shaped demo data so the UI has
 * something to render before the real road-network snapshot and simulator
 * exist:
 *   - the "land" mask is a few hand-drawn river/bay polylines (approximate),
 *   - baseline response times are smooth seeded noise around 3-6 minutes,
 *   - the "Key Bridge removed" times are gaussian bumps placed over Dundalk,
 *     Hawkins Point, Sollers Point / Edgemere, and Curtis Bay,
 *   - metrics are computed from those synthetic values.
 * None of it comes from routing, EMS station data, or census data.
 */
import {
  cellToLatLng,
  cellToParent,
  gridDisk,
  latLngToCell,
} from "h3-js";
import { BRIDGE, H3_RES, REGION_CENTER, distKm, toLocalKm } from "../geo";
import {
  ISOLATED_MIN,
  OK_MAX_MIN,
  type Assumption,
  type Cell,
  type Metrics,
  type Scenario,
  type SimOutput,
  type Simulator,
  type World,
} from "./types";

// ---------- seeded value noise (mock) ----------

/** Integer hash -> [0,1). Deterministic. */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth 2D value noise in [0,1], feature size ~ `scaleKm`. */
function valueNoise(xKm: number, yKm: number, scaleKm: number, seed: number): number {
  const x = xKm / scaleKm;
  const y = yKm / scaleKm;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// ---------- crude water mask (mock; hand-drawn, approximate) ----------

interface WaterPoint {
  lat: number;
  lng: number;
  /** half-width in km */
  hw: number;
}

const WATER_POLYLINES: WaterPoint[][] = [
  // Patapsco mouth -> Key Bridge -> inner harbor
  [
    { lat: 39.195, lng: -76.43, hw: 2.2 },
    { lat: 39.205, lng: -76.48, hw: 1.2 },
    { lat: 39.2175, lng: -76.5205, hw: 0.75 },
    { lat: 39.228, lng: -76.555, hw: 0.6 },
    { lat: 39.247, lng: -76.575, hw: 0.65 },
    { lat: 39.268, lng: -76.585, hw: 0.6 },
  ],
  // Middle Branch
  [
    { lat: 39.262, lng: -76.6, hw: 0.4 },
    { lat: 39.245, lng: -76.615, hw: 0.3 },
  ],
  // Curtis Bay
  [
    { lat: 39.222, lng: -76.552, hw: 0.15 },
    { lat: 39.207, lng: -76.575, hw: 0.35 },
    { lat: 39.205, lng: -76.585, hw: 0.3 },
  ],
  // Chesapeake Bay to the east
  [
    { lat: 39.1, lng: -76.415, hw: 2.5 },
    { lat: 39.235, lng: -76.415, hw: 2.5 },
    { lat: 39.37, lng: -76.415, hw: 2.5 },
  ],
];

function distToSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): { d: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

function isWater(lat: number, lng: number): boolean {
  const [px, py] = toLocalKm(lat, lng);
  for (const line of WATER_POLYLINES) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay] = toLocalKm(line[i].lat, line[i].lng);
      const [bx, by] = toLocalKm(line[i + 1].lat, line[i + 1].lng);
      const { d, t } = distToSegment(px, py, ax, ay, bx, by);
      const hw = line[i].hw + (line[i + 1].hw - line[i].hw) * t;
      if (d < hw) return true;
    }
  }
  return false;
}

// ---------- mock response-time field ----------

interface Bump {
  name: string;
  lat: number;
  lng: number;
  amp: number;
  sigmaKm: number;
}

/** Where the mock "bridge removed" penalty lands. Purely illustrative. */
const BUMPS: Bump[] = [
  { name: "Hawkins Point / Fairfield", lat: 39.205, lng: -76.535, amp: 17, sigmaKm: 1.7 },
  { name: "Sollers Point / Edgemere", lat: 39.225, lng: -76.462, amp: 15, sigmaKm: 2.3 },
  { name: "Dundalk", lat: 39.255, lng: -76.52, amp: 10, sigmaKm: 2.2 },
  { name: "Curtis Bay", lat: 39.21, lng: -76.585, amp: 9, sigmaKm: 2.1 },
];

const MAX_MIN = 24;

function baselineMinutes(xKm: number, yKm: number): number {
  const n = valueNoise(xKm, yKm, 1.6, 11);
  const n2 = valueNoise(xKm, yKm, 0.6, 12);
  return 3.0 + 1.9 * n + 0.6 * n2 + 0.09 * Math.hypot(xKm, yKm);
}

function penaltyMinutes(lat: number, lng: number, xKm: number, yKm: number): number {
  let p = 0;
  for (const b of BUMPS) {
    const d = distKm(lat, lng, b.lat, b.lng);
    p += b.amp * Math.exp(-(d * d) / (2 * b.sigmaKm * b.sigmaKm));
  }
  const rough = 0.75 + 0.5 * valueNoise(xKm, yKm, 0.9, 21);
  return p * rough;
}

/** Mock vulnerability index in [0,1]; biased toward the bump areas. */
function vulnerability(lat: number, lng: number, xKm: number, yKm: number): number {
  const n = valueNoise(xKm, yKm, 2.4, 31);
  const curtis = Math.exp(-distKm(lat, lng, 39.21, -76.585) / 3);
  const dundalk = Math.exp(-distKm(lat, lng, 39.255, -76.52) / 3);
  return Math.min(1, 0.55 * n + 0.35 * Math.max(curtis, dundalk));
}

// ---------- world + metrics ----------

const K_RINGS = 34; // ~3.5k hexes before the water mask

function buildCells(): { cells: Cell[]; vuln: Float32Array; parents: string[] } {
  const centerCell = latLngToCell(REGION_CENTER.lat, REGION_CENTER.lng, H3_RES);
  const ids = gridDisk(centerCell, K_RINGS);
  const cells: Cell[] = [];
  const vuln: number[] = [];
  const parents: string[] = [];
  // Approx radius of the k-ring disk in km (res 9 center spacing ~0.31 km).
  const radiusKm = K_RINGS * 0.31;
  for (const id of ids) {
    const [lat, lng] = cellToLatLng(id);
    if (isWater(lat, lng)) continue;
    const [x, y] = toLocalKm(lat, lng);
    const r = Math.hypot(x, y) / radiusKm;
    const edgeFade = r < 0.72 ? 1 : Math.max(0.12, 1 - smooth((r - 0.72) / 0.28));
    cells.push({
      id,
      lat,
      lng,
      bridgeKm: distKm(lat, lng, BRIDGE.lat, BRIDGE.lng),
      edgeFade,
    });
    vuln.push(vulnerability(lat, lng, x, y));
    // Res-8 parent stands in for a "block group" in the mock.
    parents.push(cellToParent(id, 8));
  }
  return { cells, vuln: Float32Array.from(vuln), parents };
}

function quantile(sorted: Float32Array, q: number): number {
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeMetrics(
  minutes: Float32Array,
  vuln: Float32Array,
  parents: string[],
): Metrics {
  const sorted = Float32Array.from(minutes).sort();
  const within = minutes.reduce((n, m) => n + (m <= OK_MAX_MIN ? 1 : 0), 0);

  const groups = new Map<string, { sum: number; n: number }>();
  parents.forEach((p, i) => {
    const g = groups.get(p) ?? { sum: 0, n: 0 };
    g.sum += minutes[i];
    g.n += 1;
    groups.set(p, g);
  });
  let isolated = 0;
  groups.forEach((g) => {
    if (g.sum / g.n >= ISOLATED_MIN) isolated += 1;
  });

  // Equity gap: p90 response time of the most-vulnerable third minus the least.
  const order = Array.from(minutes.keys()).sort((a, b) => vuln[a] - vuln[b]);
  const third = Math.floor(order.length / 3);
  const pick = (idxs: number[]) => {
    const arr = Float32Array.from(idxs.map((i) => minutes[i])).sort();
    return quantile(arr, 0.9);
  };
  const equityGap = pick(order.slice(-third)) - pick(order.slice(0, third));

  return {
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    pctWithin8: (within / minutes.length) * 100,
    isolated,
    equityGap,
  };
}

const MOCK_ASSUMPTIONS: Assumption[] = [
  { label: "Dispatch constant", value: "1.0 min", note: "Call-to-wheels-rolling, added to every trip.", placeholder: true },
  { label: "Speed: motorway", value: "55 mph", note: "Default by OSM road class.", placeholder: true },
  { label: "Speed: primary / secondary", value: "35 mph", placeholder: true },
  { label: "Speed: residential", value: "25 mph", placeholder: true },
  { label: "Emergency speed factor", value: "1.15x", note: "Applied to free-flow speeds for lights-and-sirens travel.", placeholder: true },
  { label: "Coverage threshold", value: "8 min", note: "Teal at or under this. Isolated at 15 min or more.", placeholder: false },
  { label: "Spatial unit", value: "H3 res 9 (~0.1 km2)", note: "Block groups are stood in by H3 res 8 parents in the mock.", placeholder: false },
  { label: "Network data date", value: "TBD", note: "OSM extract date, set when the snapshot is built.", placeholder: true },
  { label: "Census / ACS vintage", value: "TBD", note: "Population and vulnerability weights.", placeholder: true },
  { label: "EMS station data date", value: "TBD", note: "Station locations and unit counts.", placeholder: true },
  { label: "Simplified", value: "No traffic, no unit availability, no hospital diversion", note: "Free-flow travel time from the nearest station only.", placeholder: false },
];

export function createMockSimulator(): Simulator {
  // Cached by loadWorld so run() can reuse the vulnerability/parent arrays.
  let cache: ReturnType<typeof buildCells> | null = null;

  return {
    meta: {
      id: "mock-browser",
      runnerLabel: "Local (browser)",
      kind: "mock",
    },

    async loadWorld(): Promise<World> {
      cache = buildCells();
      const maxBridgeKm = cache.cells.reduce((m, c) => Math.max(m, c.bridgeKm), 0);
      return {
        regionName: "Key Bridge Region",
        cells: cache.cells,
        maxBridgeKm,
        assumptions: MOCK_ASSUMPTIONS,
        provenance: "Mock data: synthetic, deterministic, not from the road network.",
      };
    },

    async run(world: World, scenario: Scenario): Promise<SimOutput> {
      if (!cache) cache = buildCells();
      const t0 = performance.now();
      const removed = scenario.removedLinks.includes("key_bridge");
      const minutes = new Float32Array(world.cells.length);
      for (let i = 0; i < world.cells.length; i++) {
        const c = world.cells[i];
        const [x, y] = toLocalKm(c.lat, c.lng);
        // Mock: a small baseline disadvantage for high-vulnerability cells.
        let m = baselineMinutes(x, y) + 1.8 * cache.vuln[i];
        if (removed) m += penaltyMinutes(c.lat, c.lng, x, y);
        minutes[i] = Math.min(MAX_MIN, m);
      }
      const metrics = computeMetrics(minutes, cache.vuln, cache.parents);
      return { minutes, metrics, computeMs: performance.now() - t0 };
    },
  };
}

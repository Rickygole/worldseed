/**
 * Synthetic fixtures for the simulator tests: a graph builder that goes through the real graph.bin parser,
 * and a small two-shore "harbor" snapshot (bridge, tunnel, detour, one disabled candidate link).
 */
import { parseGraph } from "../../lib/sim/csr";
import type { BlockGroup, Candidate, TripsMeta, Destination, Facility, Graph, GraphMeta, Hexes, Snapshot } from "../../lib/sim/contract";
import type { ModelParams } from "../../lib/sim/contract";
import { CONTRACT_MODEL_DEFAULTS } from "../../lib/sim/snapshot";

export interface EdgeSpec {
  from: number;
  to: number;
  timeS: number;
  lenM?: number;
  cls?: number;
  flags?: number;
  corridor?: number; // 0xFFFF none
}

export const FLAGS = { TUNNEL: 1, BRIDGE: 2, HAZMAT_PROHIBITED: 4, TOLL: 8, CANDIDATE: 16, KEYBRIDGE: 32 };
export const CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "service", "link", "candidate"];

const SIZES = { f32: 4, f64: 8, u32: 4, u16: 2, u8: 1 } as const;
type T = keyof typeof SIZES;

/** Pack buffers the way the pipeline does: 8-byte aligned offsets, element-count lengths. */
export function pack(specs: [string, T, ArrayLike<number>][]): { raw: ArrayBuffer; buffers: GraphMeta["buffers"] } {
  let pos = 0;
  const layout: { name: string; type: T; offset: number; data: ArrayLike<number> }[] = [];
  const buffers: GraphMeta["buffers"] = {};
  for (const [name, type, data] of specs) {
    pos += (8 - (pos % 8)) % 8;
    layout.push({ name, type, offset: pos, data });
    buffers[name] = { offset: pos, length: data.length, type };
    pos += data.length * SIZES[type];
  }
  pos += (8 - (pos % 8)) % 8;
  const raw = new ArrayBuffer(pos);
  for (const l of layout) {
    const ctor = { f32: Float32Array, f64: Float64Array, u32: Uint32Array, u16: Uint16Array, u8: Uint8Array }[l.type];
    new ctor(raw, l.offset, l.data.length).set(l.data as ArrayLike<number> as never);
  }
  return { raw, buffers };
}

export interface GraphInput {
  N: number;
  edges: EdgeSpec[];
  links?: { id: string; name: string; edges: number[] }[];
  candidateLinks?: { id: string; edges: number[]; nodes?: number[] }[];
  corridors?: { id: string; name: string }[];
  lon?: number[];
  lat?: number[];
}

/** Build meta + bin from an edge list and parse them with the real parser. */
export function buildGraph(input: GraphInput): { graph: Graph; meta: GraphMeta; raw: ArrayBuffer } {
  const { N, edges } = input;
  const E = edges.length;
  const fwdOff = new Uint32Array(N + 1);
  const revOff = new Uint32Array(N + 1);
  for (const e of edges) {
    fwdOff[e.from + 1]++;
    revOff[e.to + 1]++;
  }
  for (let i = 0; i < N; i++) {
    fwdOff[i + 1] += fwdOff[i];
    revOff[i + 1] += revOff[i];
  }
  const fwdEdge = new Uint32Array(E);
  const revEdge = new Uint32Array(E);
  const fc = fwdOff.slice(0, N);
  const rc = revOff.slice(0, N);
  edges.forEach((e, i) => {
    fwdEdge[fc[e.from]++] = i;
    revEdge[rc[e.to]++] = i;
  });
  const { raw, buffers } = pack([
    ["nodeOsmId", "f64", Array.from({ length: N }, (_, i) => 1000 + i)],
    ["edgeOsmWay", "f64", Array.from({ length: E }, (_, i) => 5000 + i)],
    ["nodeLon", "f32", input.lon ?? Array.from({ length: N }, (_, i) => -76.5 + (i % 50) * 0.001)],
    ["nodeLat", "f32", input.lat ?? Array.from({ length: N }, (_, i) => 39.2 + Math.floor(i / 50) * 0.001)],
    ["edgeFrom", "u32", edges.map((e) => e.from)],
    ["edgeTo", "u32", edges.map((e) => e.to)],
    ["edgeTimeS", "f32", edges.map((e) => e.timeS)],
    ["edgeLenM", "f32", edges.map((e) => e.lenM ?? e.timeS * 10)],
    ["edgeCorridor", "u16", edges.map((e) => e.corridor ?? 0xffff)],
    ["edgeClass", "u8", edges.map((e) => e.cls ?? 5)],
    ["edgeFlags", "u8", edges.map((e) => e.flags ?? 0)],
    ["fwdOff", "u32", fwdOff],
    ["fwdEdge", "u32", fwdEdge],
    ["revOff", "u32", revOff],
    ["revEdge", "u32", revEdge],
  ]);
  const meta: GraphMeta = {
    nodeCount: N,
    edgeCount: E,
    classes: CLASSES,
    flags: FLAGS,
    corridors: input.corridors ?? [],
    links: input.links ?? [],
    ...(input.candidateLinks ? { candidateLinks: input.candidateLinks } : {}),
    buffers,
  };
  return { graph: parseGraph(JSON.parse(JSON.stringify(meta)), raw), meta, raw };
}

/** Deterministic tiny LCG for fixture data (not the simulator PRNG). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Harbor fixture: W x H grid, river between columns W/2-1 and W/2.

export interface Harbor {
  snap: Snapshot;
  params: ModelParams;
  W: number;
  H: number;
  node: (x: number, y: number) => number;
  bridgeEdges: number[];
  tunnelEdges: number[];
  candEdges: number[];
  graphMeta: GraphMeta;
  graphRaw: ArrayBuffer;
}

export const HARBOR_ID = "fixture-harbor-v1";

export function buildHarbor(W = 12, Hh = 8, candidateStyle: "links" | "candidateLinks" = "links"): Harbor {
  const node = (x: number, y: number) => y * W + x;
  const edges: EdgeSpec[] = [];
  const add = (a: number, b: number, timeS: number, extra: Partial<EdgeSpec> = {}) => {
    edges.push({ from: a, to: b, timeS, ...extra });
    edges.push({ from: b, to: a, timeS, ...extra });
  };
  const half = W / 2;
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      if (x + 1 < W && x + 1 !== half) add(node(x, y), node(x + 1, y), 60);
      if (y + 1 < Hh) add(node(x, y), node(x, y + 1), 60);
    }
  }
  const bridgeY = 2;
  const tunnelY = 6;
  const detourY = Hh - 1;
  const candY = 4;
  const startBridge = edges.length;
  add(node(half - 1, bridgeY), node(half, bridgeY), 30, { cls: 0, flags: FLAGS.BRIDGE | FLAGS.KEYBRIDGE });
  const bridgeEdges = [startBridge, startBridge + 1];
  const startTunnel = edges.length;
  add(node(half - 1, tunnelY), node(half, tunnelY), 90, { cls: 0, flags: FLAGS.TUNNEL | FLAGS.HAZMAT_PROHIBITED, corridor: 0 });
  const tunnelEdges = [startTunnel, startTunnel + 1];
  // detour: a slow crossing on the last row replaces the grid edge there
  const startDetour = edges.length;
  add(node(half - 1, detourY), node(half, detourY), 240, { cls: 2 });
  const startCand = edges.length;
  add(node(half - 1, candY), node(half, candY), 45, { cls: 8, flags: FLAGS.CANDIDATE });
  const candEdges = [startCand, startCand + 1];
  void startDetour;

  const { graph, meta: graphMeta, raw: graphRaw } = buildGraph({
    N: W * Hh,
    edges,
    links: [
      { id: "L-KEYBRIDGE", name: "Fixture Key Bridge", edges: bridgeEdges },
      { id: "L-HARBORTUNNEL", name: "Fixture Harbor Tunnel", edges: tunnelEdges },
      ...(candidateStyle === "links" ? [{ id: "L-TEMPLINK", name: "Fixture temporary link", edges: candEdges }] : []),
    ],
    ...(candidateStyle === "candidateLinks" ? { candidateLinks: [{ id: "L-TEMPLINK", edges: candEdges, nodes: [node(half - 1, candY), node(half, candY)] }] } : {}),
    corridors: [{ id: "C-I895-TUNNEL", name: "Fixture tunnel corridor" }],
  });

  const rnd = lcg(42);
  const H = W * Hh;
  const bg = new Uint16Array(H);
  const lat = new Float32Array(H);
  const lng = new Float32Array(H);
  const nodeIdx = new Uint32Array(H);
  const snapS = new Float32Array(H).fill(12);
  const pop = new Float32Array(H);
  const zvh = new Float32Array(H);
  const lowWage = new Float32Array(H);
  const jobs = new Float32Array(H);
  const shore = new Uint8Array(H);
  const h3: string[] = [];
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const h = node(x, y);
      h3.push(`fx-${h}`);
      bg[h] = Math.floor(x / 3) + 4 * Math.floor(y / 4); // 4 x 2 block groups
      nodeIdx[h] = h;
      lat[h] = 39.2 + y * 0.003;
      lng[h] = -76.55 + x * 0.004;
      pop[h] = 50 + Math.floor(rnd() * 200);
      zvh[h] = Math.floor(pop[h] * (0.05 + 0.2 * rnd()));
      lowWage[h] = Math.floor(pop[h] * (0.1 + 0.3 * rnd()));
      jobs[h] = Math.floor(rnd() * 100) + (x === 0 && y === 0 ? 50 : 0);
      if (x === 3 && y === 7) {
        // job-only cell (an industrial site): nobody lives here
        pop[h] = 0;
        zvh[h] = 0;
        lowWage[h] = 0;
        jobs[h] = 500;
      }
      shore[h] = x === 0 && y === 0 ? 2 : x < half ? 1 : 0; // one ambiguous hex (neither origin nor destination)
    }
  }
  const hexes: Hexes = { count: H, h3, lat, lng, node: nodeIdx, snapS, pop, zvh, lowWage, jobs, bg, shore };
  const facilities: Facility[] = [
    { id: "F-WEST", kind: "fire_station", name: "West Station", lat: 39.2, lng: -76.55, node: node(1, 1), active: true },
    { id: "F-EAST", kind: "ems_station", name: "East Station", lat: 39.2, lng: -76.5, node: node(W - 2, Hh - 2), active: true },
    { id: "F-HOSP", kind: "hospital", name: "General Hospital", lat: 39.21, lng: -76.52, node: node(2, 3), active: true },
    { id: "F-EAST2", kind: "fire_station", name: "East Station 2", lat: 39.21, lng: -76.5, node: node(W - 2, 1), active: false },
  ];
  const destinations: Destination[] = [
    { id: "D-EAST-A", name: "East employment A", node: node(W - 2, 2), jobs: 3000, shore: 0 },
    { id: "D-EAST-B", name: "East employment B", node: node(W - 3, Hh - 3), jobs: 1000, shore: 0 },
  ];
  const candidates: Candidate[] = [
    { id: "TL-TEMP", type: "temp_link", title: "Temporary link", lens: ["access", "ems"], costTier: "$$", effect: { op: "enable_edges", edges: candEdges }, hypothetical: true },
    { id: "SP-TUNNEL", type: "signal_priority", title: "Tunnel corridor speed", lens: ["access"], costTier: "$", effect: { op: "corridor_speed", corridor: "C-I895-TUNNEL", factor: 2 }, hypothetical: true },
    { id: "PP-SITE", type: "prepos_site", title: "Pre-positioned unit", lens: ["ems"], costTier: "$$", effect: { op: "add_source", facilityLike: { lat: 39.2, lng: -76.5, node: node(W - 1, 4) } }, hypothetical: true },
    { id: "HW-TUNNEL", type: "hazmat_window", title: "Hazmat window", lens: ["freight"], costTier: "$$", effect: { op: "allow_class_on", edges: tunnelEdges, vehicleClass: "hazmat", timePenaltyS: 30, penaltyEdges: tunnelEdges }, hypothetical: true },
    { id: "IM-TUNNEL", type: "incident_mgmt", title: "Incident management", lens: ["access"], costTier: "$$", effect: { op: "congestion_sigma", corridor: "C-I895-TUNNEL", scale: 0.5 }, hypothetical: true },
  ];
  const blockGroups: BlockGroup[] = [];
  const nBg = Math.max(...bg) + 1;
  for (let b = 0; b < nBg; b++) {
    const hs = [...Array(H).keys()].filter((i) => bg[i] === b);
    blockGroups.push({ geoid: `2451000${String(b).padStart(2, "0")}001`, i: b, county: b < 4 ? "Fixture County A" : "Fixture County B", pop: Math.round(hs.reduce((a, i) => a + pop[i], 0)), households: 0, zvh: 0, lowWageWorkers: 0, centroid: [-76.5, 39.2], hexes: hs });
  }
  const anchor = (id: string, x: number, y: number, shore: number) => ({ id, name: `Anchor ${id}`, shore, node: node(x, y), lat: 39.2 + y * 0.003, lng: -76.55 + x * 0.004 });
  const anchors = [anchor("W1", 1, 2, 1), anchor("W2", 2, 6, 1), anchor("E1", 10, 2, 0), anchor("E2", 9, 6, 0)];
  const trip = (o: string, d: string) => {
    const a = anchors.find((x) => x.id === o) as (typeof anchors)[number];
    const b = anchors.find((x) => x.id === d) as (typeof anchors)[number];
    return { id: `${o}>${d}`, origin: o, destination: d, kind: (a.shore === b.shore ? "same_shore_control" : "cross_harbor") as "cross_harbor" | "same_shore_control", originNode: a.node, destinationNode: b.node };
  };
  const trips: TripsMeta = {
    anchors,
    trips: [trip("W1", "E1"), trip("E1", "W1"), trip("W1", "E2"), trip("E2", "W1"), trip("W2", "E1"), trip("E1", "W2"), trip("W1", "W2"), trip("W2", "W1")],
    classes: { car: { removesFlag: null }, hazmat_truck: { removesFlag: "HAZMAT_PROHIBITED" } },
    toleranceS: 0.5,
  };
  const snap: Snapshot = {
    trips,
    id: HARBOR_ID,
    manifest: null,
    graph,
    hexes,
    facilities,
    destinations,
    candidates,
    assumptions: [],
    blockGroups,
  };
  return { snap, params: { ...CONTRACT_MODEL_DEFAULTS }, W, H: Hh, node, bridgeEdges, tunnelEdges, candEdges, graphMeta, graphRaw };
}

export function rec(id: string, m: import("../../lib/sim/contract").Mutation, extra: Partial<import("../../lib/sim/contract").MutationRecord> = {}): import("../../lib/sim/contract").MutationRecord {
  return { id, m, origin: "user", label: id, confirmedAt: "2026-09-26T12:00:00.000Z", ...extra };
}

/** Naive reference: Bellman-Ford style relaxation to a fixed point, float64, same cost formula. */
export function naiveDistances(
  N: number,
  edges: EdgeSpec[],
  enabled: Uint8Array,
  mul: Float32Array,
  sources: number[],
  delays: number[],
  reverse: boolean,
  maxCost: number,
): Float64Array {
  const dist = new Float64Array(N).fill(Infinity);
  sources.forEach((s, i) => {
    dist[s] = Math.min(dist[s], delays[i]);
  });
  const f32 = Math.fround;
  for (let iter = 0; iter < N + 1; iter++) {
    let changed = false;
    edges.forEach((e, i) => {
      if (!enabled[i]) return;
      const w = f32(e.timeS) * mul[i];
      const [a, b] = reverse ? [e.to, e.from] : [e.from, e.to];
      const nd = dist[a] + w;
      if (nd < dist[b] && nd <= maxCost) {
        dist[b] = nd;
        changed = true;
      }
    });
    if (!changed) break;
  }
  // sources beyond maxCost are dropped by the workspace; mirror that
  sources.forEach((s, i) => {
    if (delays[i] > maxCost && dist[s] === delays[i]) dist[s] = Infinity;
  });
  return dist;
}


/** Serialise the harbor snapshot to the file set the pipeline writes, behind an in-memory SnapshotReader. */
export function harborReader(h: Harbor, extra: Record<string, unknown> = {}, omit: string[] = []): (file: string) => Promise<ArrayBuffer> {
  const hx = h.snap.hexes;
  const { raw, buffers } = pack([
    ["lat", "f32", hx.lat], ["lng", "f32", hx.lng], ["node", "u32", hx.node], ["snapS", "f32", hx.snapS],
    ["pop", "f32", hx.pop], ["zvh", "f32", hx.zvh], ["lowWage", "f32", hx.lowWage], ["jobs", "f32", hx.jobs],
    ["bg", "u16", hx.bg], ["shore", "u8", hx.shore],
  ]);
  const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).buffer as ArrayBuffer;
  const files: Record<string, ArrayBuffer> = {
    "graph.bin": h.graphRaw,
    "graph.meta.json": json(h.graphMeta),
    "hexes.bin": raw,
    "hexes.meta.json": json({ snapshotId: h.snap.id, count: hx.count, h3: hx.h3, buffers }),
    "facilities.json": json(h.snap.facilities),
    "destinations.json": json(h.snap.destinations),
    "candidates.json": json(h.snap.candidates),
    "assumptions.json": json([
      { id: "A-CALL-TO-WHEELS", label: "Call-processing and turnout delay", value: 90, unit: "s", status: "assumption", source: null },
      { id: "A-EMS-THRESHOLD", label: "threshold", value: 420, unit: "s", status: "assumption", source: null },
    ]),
    "manifest.json": json({ snapshotId: h.snap.id, pipelineVersion: "test" }),
    "blockgroups.json": json(h.snap.blockGroups),
    "trips.json": json({ anchors: h.snap.trips?.anchors, trips: h.snap.trips?.trips, classes: h.snap.trips?.classes, tolerance: { timeS: 0.5 } }),
  };
  for (const [k, v] of Object.entries(extra)) files[k] = v instanceof ArrayBuffer ? v : json(v);
  return async (file) => {
    const { SnapshotMissingError } = await import("../../lib/sim/snapshot");
    if (omit.includes(file) || !(file in files)) throw new SnapshotMissingError(file, "test reader");
    return files[file];
  };
}

/**
 * Schema policy: ADDITIVE fields are always tolerated (zod strips keys it does not know: assumptions min/max,
 * graph.meta candidateLinks, candidates kind/mechanism/refs/costSource/delayS, facilities ed/sources, extra
 * block-group fields, lens tag "xharbor", golden.xharbor, ...). A MISSING or WRONGLY TYPED required field
 * throws ContractError naming the file and field, and so does an unknown candidate effect `op`.
 *
 * Snapshot loading (contract sections 2.1 to 2.3). Environment-neutral: callers supply a
 * `SnapshotReader` (fetch in the browser, fs in Node tests via ./node.ts).
 *
 * Required: graph.bin, graph.meta.json, hexes.bin, hexes.meta.json, facilities.json, destinations.json.
 * Optional: manifest.json, assumptions.json, candidates.json, blockgroups.json (a missing optional file is reported through
 * `Snapshot`'s empty/null field, never invented).
 *
 * Every schema mismatch throws ContractError with the offending file and field.
 */
import { z } from "zod";
import { ContractError, bufferSpecSchema, parseGraph, sliceBuffer } from "./csr";
import type {
  AssumptionRecord,
  BlockGroup,
  Candidate,
  Destination,
  Facility,
  Graph,
  Hexes,
  Manifest,
  ModelParams,
  Snapshot,
  TripsMeta,
} from "./contract";

export type SnapshotReader = (file: string) => Promise<ArrayBuffer>;

export class SnapshotMissingError extends Error {
  readonly file: string;
  constructor(file: string, detail: string) {
    super(`snapshot file not found: ${file} (${detail})`);
    this.name = "SnapshotMissingError";
    this.file = file;
  }
}

/** fetch-based reader. `baseUrl` like "/snapshot/". 404 -> SnapshotMissingError. */
export function fetchReader(baseUrl: string): SnapshotReader {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return async (file) => {
    let res: Response;
    try {
      res = await fetch(base + file);
    } catch (e) {
      throw new Error(`could not fetch ${base + file}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status === 404) throw new SnapshotMissingError(file, `HTTP 404 at ${base + file}`);
    if (!res.ok) throw new Error(`GET ${base + file} failed: HTTP ${res.status}`);
    // A dev server may answer a missing static file with an HTML page and status 200.
    const type = res.headers.get("content-type") ?? "";
    if (file.endsWith(".json") && type.includes("text/html")) throw new SnapshotMissingError(file, `HTML instead of JSON at ${base + file}`);
    return res.arrayBuffer();
  };
}

async function readJson(read: SnapshotReader, file: string): Promise<unknown> {
  const buf = await read(file);
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch (e) {
    throw new ContractError(`${file} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function readOptionalJson(read: SnapshotReader, file: string): Promise<unknown | null> {
  try {
    return await readJson(read, file);
  } catch (e) {
    if (e instanceof SnapshotMissingError) return null;
    throw e;
  }
}

function parse<T extends z.ZodType>(schema: T, data: unknown, file: string): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new ContractError(`${file}: ${z.prettifyError(r.error)}`);
  return r.data;
}

// ---- schemas ---------------------------------------------------------------------------------------------

const hexMetaSchema = z.object({
  snapshotId: z.string().optional(),
  count: z.number().int().nonnegative(),
  h3: z.array(z.string()),
  buffers: z.record(z.string(), bufferSpecSchema),
});

const facilitySchema = z.array(z.object({
  id: z.string(),
  kind: z.enum(["fire_station", "ems_station", "hospital"]),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  node: z.number().int().nonnegative(),
  snapM: z.number().nullable().optional(),
  // Contract 2.3 says osm is a string; the pipeline writes null for stations that come only from Maryland iMAP.
  // Traceability only (the simulator never reads it), so null is tolerated here and reported in the handoff.
  osm: z.string().nullable().optional(),
  active: z.boolean(),
}));

const destinationSchema = z.array(z.object({
  id: z.string(),
  name: z.string(),
  node: z.number().int().nonnegative(),
  jobs: z.number().nonnegative(),
  shore: z.number().optional(),
}));

const effectSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("enable_edges"), edges: z.array(z.number().int().nonnegative()) }),
  z.object({ op: z.literal("corridor_speed"), corridor: z.string(), factor: z.number().positive() }),
  z.object({ op: z.literal("add_source"), facilityLike: z.object({ lat: z.number(), lng: z.number(), node: z.number().int().nonnegative() }), delayS: z.number().nonnegative().optional() }),
  z.object({
    op: z.literal("allow_class_on"),
    edges: z.array(z.number().int().nonnegative()),
    vehicleClass: z.literal("hazmat"),
    timePenaltyS: z.number().nonnegative(),
    // The edges that pay the penalty (tunnel bores); the rest of `edges` are allowed with no penalty.
    penaltyEdges: z.array(z.number().int().nonnegative()).optional(),
  }),
  z.object({ op: z.literal("congestion_sigma"), corridor: z.string(), scale: z.number().nonnegative() }),
]);

const candidateSchema = z.array(z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  // Contract: "access" | "ems". The pipeline also writes "xharbor"; kept as free tags (see contract.ts).
  lens: z.array(z.string()),
  costTier: z.string(),
  leadTime: z.string().optional(),
  hypothetical: z.boolean().optional(),
  effect: effectSchema,
  assumptions: z.array(z.string()).optional(),
  sources: z.array(z.unknown()).optional(),
  notes: z.string().optional(),
}));

const assumptionSchema = z.array(z.object({
  id: z.string(),
  label: z.string(),
  value: z.union([z.number(), z.string(), z.boolean()]),
  unit: z.string().nullable().optional(),
  status: z.enum(["assumption", "sourced"]),
  source: z.string().nullable().optional(),
  note: z.string().optional(),
  // Documented bounds, informational (the simulator uses `value`).
  min: z.number().optional(),
  max: z.number().optional(),
}));

// Block groups: required = id, index, county, whole-BG population and the hexes it owns.
const blockGroupSchema = z.array(z.object({
  geoid: z.string(),
  i: z.number().int().nonnegative(),
  county: z.string(),
  pop: z.number(),
  households: z.number().optional(),
  zvh: z.number().optional(),
  lowWageWorkers: z.number().optional(),
  centroid: z.tuple([z.number(), z.number()]).optional(),
  hexes: z.array(z.number().int().nonnegative()),
}));

const tripsSchema = z.object({
  anchors: z.array(z.object({
    id: z.string(),
    name: z.string(),
    shore: z.number().int().min(0).max(1),
    node: z.number().int().nonnegative(),
    lat: z.number(),
    lng: z.number(),
    osmNode: z.number().optional(),
  })).min(1),
  trips: z.array(z.object({
    id: z.string(),
    origin: z.string(),
    destination: z.string(),
    kind: z.enum(["cross_harbor", "same_shore_control"]),
    originNode: z.number().int().nonnegative(),
    destinationNode: z.number().int().nonnegative(),
  })).min(1),
  classes: z.record(z.string(), z.object({ removesFlag: z.string().nullable() })),
  tolerance: z.object({ timeS: z.number() }).optional(),
});

const manifestSchema = z.object({
  snapshotId: z.string().min(1),
  pipelineVersion: z.string().optional(),
  builtAt: z.string().optional(),
  osmDate: z.string().optional(),
  acsVintage: z.string().optional(),
  lodes: z.string().optional(),
  bbox: z.array(z.number()).optional(),
  h3Res: z.number().optional(),
  files: z.record(z.string(), z.object({ sha256: z.string(), bytes: z.number() })).optional(),
  sources: z.array(z.object({ name: z.string(), license: z.string().optional(), attribution: z.string().optional() })).optional(),
});

// ---- hexes -------------------------------------------------------------------------------------------------

export function parseHexes(metaJson: unknown, raw: ArrayBuffer): Hexes {
  const meta = parse(hexMetaSchema, metaJson, "hexes.meta.json");
  const H = meta.count;
  if (meta.h3.length !== H) throw new ContractError(`hexes.meta.json: h3 has ${meta.h3.length} entries, count is ${H}`);
  const b = meta.buffers;
  return {
    count: H,
    h3: meta.h3,
    lat: sliceBuffer(raw, b, "lat", "f32", H),
    lng: sliceBuffer(raw, b, "lng", "f32", H),
    node: sliceBuffer(raw, b, "node", "u32", H),
    snapS: sliceBuffer(raw, b, "snapS", "f32", H),
    pop: sliceBuffer(raw, b, "pop", "f32", H),
    zvh: sliceBuffer(raw, b, "zvh", "f32", H),
    lowWage: sliceBuffer(raw, b, "lowWage", "f32", H),
    jobs: sliceBuffer(raw, b, "jobs", "f32", H),
    bg: sliceBuffer(raw, b, "bg", "u16", H),
    shore: sliceBuffer(raw, b, "shore", "u8", H),
  };
}

// ---- model parameters from assumptions.json -------------------------------------------------------------------

/** Contract defaults (ARCHITECTURE.md 2.5): 60 s call-to-wheels, 8 min, 120 min cap, 5 min added, 10 min cut-off. */
export const CONTRACT_MODEL_DEFAULTS: ModelParams = {
  call_to_wheels_delay_min: 1,
  emsThresholdS: 480,
  accessCapS: 7200,
  accessAddedOkS: 300,
  accessCutoffS: 600,
};

const PARAM_IDS: { id: string; key: keyof ModelParams; toInternal: (v: number, unit: string | null | undefined) => number }[] = [
  {
    id: "A-CALL-TO-WHEELS",
    key: "call_to_wheels_delay_min",
    toInternal: (v, unit) => {
      if (unit === "s") return v / 60;
      if (unit === "min") return v;
      throw new ContractError(`assumptions.json A-CALL-TO-WHEELS has unit ${JSON.stringify(unit)}, expected "s" or "min"`);
    },
  },
  { id: "A-EMS-THRESHOLD", key: "emsThresholdS", toInternal: (v) => v },
  { id: "A-ACCESS-CAP", key: "accessCapS", toInternal: (v) => v },
  { id: "A-ACCESS-ADDED-OK", key: "accessAddedOkS", toInternal: (v) => v },
  { id: "A-ACCESS-CUTOFF", key: "accessCutoffS", toInternal: (v) => v },
];

/** Read the lens constants from assumptions.json; anything absent falls back to the contract default and is listed in `defaulted`. */
export function modelParamsFromAssumptions(list: AssumptionRecord[]): { params: ModelParams; fromSnapshot: string[]; defaulted: string[] } {
  const params: ModelParams = { ...CONTRACT_MODEL_DEFAULTS };
  const fromSnapshot: string[] = [];
  const defaulted: string[] = [];
  for (const spec of PARAM_IDS) {
    const rec = list.find((a) => a.id === spec.id);
    if (!rec) {
      defaulted.push(spec.id);
      continue;
    }
    if (typeof rec.value !== "number" || !Number.isFinite(rec.value)) {
      throw new ContractError(`assumptions.json ${spec.id} value must be a finite number, got ${JSON.stringify(rec.value)}`);
    }
    params[spec.key] = spec.toInternal(rec.value, rec.unit);
    fromSnapshot.push(spec.id);
  }
  return { params, fromSnapshot, defaulted };
}

// ---- assemble ---------------------------------------------------------------------------------------------------

export interface LoadedSnapshot {
  snapshot: Snapshot;
  params: ModelParams;
  /** Which lens constants came from assumptions.json and which fell back to the contract default. */
  paramSources: { fromSnapshot: string[]; defaulted: string[] };
}

export async function loadSnapshot(read: SnapshotReader): Promise<LoadedSnapshot> {
  const [graphMeta, graphBin, hexMeta, hexBin, facRaw, destRaw, candRaw, assumpRaw, manRaw, bgRaw, tripsRaw] = await Promise.all([
    readJson(read, "graph.meta.json"),
    read("graph.bin"),
    readJson(read, "hexes.meta.json"),
    read("hexes.bin"),
    readJson(read, "facilities.json"),
    readJson(read, "destinations.json"),
    readOptionalJson(read, "candidates.json"),
    readOptionalJson(read, "assumptions.json"),
    readOptionalJson(read, "manifest.json"),
    readOptionalJson(read, "blockgroups.json"),
    readTripsJson(read),
  ]);

  const graph = parseGraph(graphMeta, graphBin);
  const hexes = parseHexes(hexMeta, hexBin);
  const facilities: Facility[] = parse(facilitySchema, facRaw, "facilities.json");
  const destinations: Destination[] = parse(destinationSchema, destRaw, "destinations.json");
  const candidates: Candidate[] = candRaw === null ? [] : (parse(candidateSchema, candRaw, "candidates.json") as Candidate[]);
  const assumptions: AssumptionRecord[] = assumpRaw === null ? [] : (parse(assumptionSchema, assumpRaw, "assumptions.json") as AssumptionRecord[]);
  const blockGroups: BlockGroup[] = bgRaw === null ? [] : (parse(blockGroupSchema, bgRaw, "blockgroups.json") as BlockGroup[]);
  const tripsParsed = tripsRaw === null ? null : parse(tripsSchema, tripsRaw, "trips.json");
  const trips: TripsMeta | null = tripsParsed
    ? { anchors: tripsParsed.anchors, trips: tripsParsed.trips, classes: tripsParsed.classes, toleranceS: tripsParsed.tolerance?.timeS }
    : null;
  const manifest: Manifest | null = manRaw === null ? null : parse(manifestSchema, manRaw, "manifest.json");

  const N = graph.nodeCount;
  for (let h = 0; h < hexes.count; h++) {
    if (hexes.node[h] >= N) throw new ContractError(`hexes.bin: hex ${h} node ${hexes.node[h]} >= nodeCount ${N}`);
  }
  for (const f of facilities) if (f.node >= N) throw new ContractError(`facilities.json: ${f.id} node ${f.node} >= nodeCount ${N}`);
  for (const d of destinations) if (d.node >= N) throw new ContractError(`destinations.json: ${d.id} node ${d.node} >= nodeCount ${N}`);
  for (const b of blockGroups) {
    for (const h of b.hexes) if (h >= hexes.count) throw new ContractError(`blockgroups.json: ${b.geoid} references hex ${h} >= hex count ${hexes.count}`);
  }
  if (trips) validateTrips(trips, graph);
  for (const c of candidates) validateCandidate(c, graph.edgeCount, N, graph.corridorIndex);

  const id = manifest?.snapshotId ?? parse(hexMetaSchema, hexMeta, "hexes.meta.json").snapshotId;
  if (!id) throw new ContractError("no snapshotId in manifest.json or hexes.meta.json");

  const { params, fromSnapshot, defaulted } = modelParamsFromAssumptions(assumptions);
  return {
    snapshot: { id, manifest, graph, hexes, facilities, destinations, candidates, assumptions, blockGroups, trips },
    params,
    paramSources: { fromSnapshot, defaulted },
  };
}

/**
 * Trip definitions: `trips.json` when the pipeline (or the sync script) provides it, else the `trips` key of
 * golden.json (a development file that is not served to browsers, so there it is simply absent).
 */
async function readTripsJson(read: SnapshotReader): Promise<unknown | null> {
  const own = await readOptionalJson(read, "trips.json");
  if (own !== null) return own;
  const golden = (await readOptionalJson(read, "golden.json")) as { trips?: unknown } | null;
  return golden && typeof golden === "object" && golden.trips ? golden.trips : null;
}

function validateTrips(t: TripsMeta, g: Graph): void {
  const N = g.nodeCount;
  const anchors = new Map(t.anchors.map((a) => [a.id, a]));
  for (const a of t.anchors) if (a.node >= N) throw new ContractError(`trips.json: anchor ${a.id} node ${a.node} >= nodeCount ${N}`);
  for (const d of t.trips) {
    const o = anchors.get(d.origin);
    const e = anchors.get(d.destination);
    if (!o || !e) throw new ContractError(`trips.json: trip ${d.id} references an unknown anchor`);
    if (d.originNode !== o.node || d.destinationNode !== e.node) throw new ContractError(`trips.json: trip ${d.id} nodes do not match its anchors`);
    const cross = o.shore !== e.shore;
    if (cross !== (d.kind === "cross_harbor")) throw new ContractError(`trips.json: trip ${d.id} kind ${d.kind} disagrees with the anchors' shores`);
  }
  for (const [c, def] of Object.entries(t.classes)) {
    if (def.removesFlag !== null && !(def.removesFlag in g.flag)) throw new ContractError(`trips.json: class ${c} removes unknown flag ${def.removesFlag}`);
  }
  if (!("car" in t.classes)) throw new ContractError("trips.json: missing vehicle class car");
}

function validateCandidate(c: Candidate, E: number, N: number, corridors: Map<string, number>): void {
  const ef = c.effect;
  const edges = "edges" in ef ? ef.edges : [];
  for (const e of edges) if (e >= E) throw new ContractError(`candidates.json: ${c.id} references edge ${e} >= edgeCount ${E}`);
  if (ef.op === "allow_class_on" && ef.penaltyEdges) {
    const allowed = new Set(ef.edges);
    for (const e of ef.penaltyEdges) {
      if (e >= E) throw new ContractError(`candidates.json: ${c.id} penalty edge ${e} >= edgeCount ${E}`);
      if (!allowed.has(e)) throw new ContractError(`candidates.json: ${c.id} penalty edge ${e} is not in its allowed edges`);
    }
  }
  if ("corridor" in ef && !corridors.has(ef.corridor)) throw new ContractError(`candidates.json: ${c.id} references unknown corridor ${ef.corridor}`);
  if (ef.op === "add_source" && ef.facilityLike.node >= N) throw new ContractError(`candidates.json: ${c.id} source node out of range`);
}

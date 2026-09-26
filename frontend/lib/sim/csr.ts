/**
 * graph.bin + graph.meta.json -> typed arrays (contract section 2.2).
 *
 * Layout (as written by the pipeline): little-endian, buffers concatenated, each buffer starting at
 * `offset` bytes (a multiple of 8 in the current pipeline), `length` = ELEMENT count. Typed arrays are
 * views over the fetched ArrayBuffer whenever the offset is aligned, and copies otherwise.
 *
 * Every deviation from the contract throws a `ContractError` naming the field, so a pipeline change
 * is reported instead of silently adapted to.
 */
import { z } from "zod";
import { NO_CORRIDOR, type Graph, type GraphMeta, type LinkInfo } from "./contract";

/** Link ids the app uses for corridors the snapshot has only as corridors. */
export const CORRIDOR_LINK_ALIASES: Record<string, string> = { "L-HANOVER": "C-HANOVER", "L-BROENING": "C-BROENING" };

export class ContractError extends Error {
  constructor(message: string) {
    super(`snapshot contract violation: ${message}`);
    this.name = "ContractError";
  }
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

type BufType = "f32" | "f64" | "u32" | "u16" | "u8";

const BYTES: Record<BufType, number> = { f32: 4, f64: 8, u32: 4, u16: 2, u8: 1 };

interface TypedArrayMap {
  f32: Float32Array;
  f64: Float64Array;
  u32: Uint32Array;
  u16: Uint16Array;
  u8: Uint8Array;
}

export const bufferSpecSchema = z.object({
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
  type: z.enum(["f32", "f64", "u32", "u16", "u8"]),
});

const graphMetaSchema = z.object({
  nodeCount: z.number().int().positive(),
  edgeCount: z.number().int().positive(),
  classes: z.array(z.string()),
  flags: z.record(z.string(), z.number().int()),
  corridors: z.array(z.object({ id: z.string(), name: z.string() })),
  links: z.array(z.object({ id: z.string(), name: z.string(), edges: z.array(z.number().int().nonnegative()) })),
  candidateLinks: z.array(z.object({ id: z.string(), edges: z.array(z.number().int().nonnegative()), nodes: z.array(z.number().int().nonnegative()).optional() })).optional(),
  buffers: z.record(z.string(), bufferSpecSchema),
});

/** Slice one named buffer out of `raw`. */
export function sliceBuffer<T extends BufType>(
  raw: ArrayBuffer,
  buffers: GraphMeta["buffers"],
  name: string,
  type: T,
  expectedLength: number,
): TypedArrayMap[T] {
  const spec = buffers[name];
  if (!spec) throw new ContractError(`buffer "${name}" missing from meta.buffers`);
  if (spec.type !== type) throw new ContractError(`buffer "${name}" has type ${spec.type}, expected ${type}`);
  if (spec.length !== expectedLength) {
    throw new ContractError(`buffer "${name}" has length ${spec.length}, expected ${expectedLength}`);
  }
  const bytes = spec.length * BYTES[type];
  if (spec.offset + bytes > raw.byteLength) {
    throw new ContractError(`buffer "${name}" [${spec.offset}, ${spec.offset + bytes}) exceeds file size ${raw.byteLength}`);
  }
  const aligned = spec.offset % BYTES[type] === 0;
  const src = aligned ? raw : raw.slice(spec.offset, spec.offset + bytes);
  const off = aligned ? spec.offset : 0;
  switch (type) {
    case "f32": return new Float32Array(src, off, spec.length) as TypedArrayMap[T];
    case "f64": return new Float64Array(src, off, spec.length) as TypedArrayMap[T];
    case "u32": return new Uint32Array(src, off, spec.length) as TypedArrayMap[T];
    case "u16": return new Uint16Array(src, off, spec.length) as TypedArrayMap[T];
    default: return new Uint8Array(src, off, spec.length) as TypedArrayMap[T];
  }
}

export function assertLittleEndianHost(): void {
  if (!LITTLE_ENDIAN) throw new ContractError("host is big-endian; the snapshot binaries are little-endian");
}

/** Parse graph.meta.json (already JSON.parse'd) and graph.bin into typed arrays. */
export function parseGraph(metaJson: unknown, raw: ArrayBuffer): Graph {
  assertLittleEndianHost();
  const parsed = graphMetaSchema.safeParse(metaJson);
  if (!parsed.success) {
    throw new ContractError(`graph.meta.json: ${z.prettifyError(parsed.error)}`);
  }
  const meta = parsed.data as GraphMeta;
  const N = meta.nodeCount;
  const E = meta.edgeCount;
  const b = meta.buffers;

  const g = {
    meta,
    nodeCount: N,
    edgeCount: E,
    nodeLon: sliceBuffer(raw, b, "nodeLon", "f32", N),
    nodeLat: sliceBuffer(raw, b, "nodeLat", "f32", N),
    nodeOsmId: sliceBuffer(raw, b, "nodeOsmId", "f64", N),
    edgeFrom: sliceBuffer(raw, b, "edgeFrom", "u32", E),
    edgeTo: sliceBuffer(raw, b, "edgeTo", "u32", E),
    edgeTimeS: sliceBuffer(raw, b, "edgeTimeS", "f32", E),
    edgeLenM: sliceBuffer(raw, b, "edgeLenM", "f32", E),
    edgeClass: sliceBuffer(raw, b, "edgeClass", "u8", E),
    edgeFlags: sliceBuffer(raw, b, "edgeFlags", "u8", E),
    edgeCorridor: sliceBuffer(raw, b, "edgeCorridor", "u16", E),
    edgeOsmWay: sliceBuffer(raw, b, "edgeOsmWay", "f64", E),
    fwdOff: sliceBuffer(raw, b, "fwdOff", "u32", N + 1),
    fwdEdge: sliceBuffer(raw, b, "fwdEdge", "u32", E),
    revOff: sliceBuffer(raw, b, "revOff", "u32", N + 1),
    revEdge: sliceBuffer(raw, b, "revEdge", "u32", E),
    flag: { ...meta.flags },
    links: [] as LinkInfo[],
    linkIndex: new Map<string, number>(),
    corridorIndex: new Map<string, number>(),
    edgeLink: new Int32Array(E).fill(-1),
  } satisfies Graph;

  const all: LinkInfo[] = [
    ...meta.links.map((l) => ({ id: l.id, name: l.name, edges: l.edges, candidate: false })),
    ...(meta.candidateLinks ?? []).map((l) => ({ id: l.id, name: l.id, edges: l.edges, candidate: true })),
  ];
  g.links = all;
  all.forEach((l, i) => {
    if (g.linkIndex.has(l.id)) throw new ContractError(`duplicate link id ${l.id}`);
    g.linkIndex.set(l.id, i);
    for (const e of l.edges) {
      if (e >= E) throw new ContractError(`link ${l.id} references edge ${e} >= edgeCount ${E}`);
      if (l.candidate && (g.edgeFlags[e] & g.flag.CANDIDATE) === 0 && g.flag.CANDIDATE !== undefined) {
        throw new ContractError(`candidate link ${l.id} edge ${e} does not carry the CANDIDATE flag`);
      }
      if (g.edgeLink[e] < 0) g.edgeLink[e] = i;
    }
  });
  meta.corridors.forEach((c, i) => {
    if (g.corridorIndex.has(c.id)) throw new ContractError(`duplicate corridor id ${c.id}`);
    g.corridorIndex.set(c.id, i);
  });
  // Stress tests and random closures name "Hanover Street corridor" and "Broening Highway corridor" as links
  // (L-HANOVER, L-BROENING). The snapshot models them as corridors, so those two ids alias the corridor: closing
  // the alias closes every edge of the corridor. Real links of the same id win; edgeLink is not touched.
  for (const [alias, corridor] of Object.entries(CORRIDOR_LINK_ALIASES)) {
    const ci = g.corridorIndex.get(corridor);
    if (g.linkIndex.has(alias) || ci === undefined) continue;
    const edges: number[] = [];
    for (let e = 0; e < E; e++) if (g.edgeCorridor[e] === ci) edges.push(e);
    if (edges.length === 0) continue;
    g.linkIndex.set(alias, g.links.length);
    g.links.push({ id: alias, name: `${meta.corridors[ci].name} (whole corridor)`, edges, candidate: false, alias: true });
  }

  validateGraph(g);
  return g;
}

/** Structural checks. O(N + E). Throws ContractError on the first violation. */
export function validateGraph(g: Graph): void {
  const N = g.nodeCount;
  const E = g.edgeCount;
  for (const name of ["CANDIDATE", "TUNNEL", "BRIDGE"]) {
    if (!(name in g.flag)) throw new ContractError(`meta.flags is missing ${name}`);
  }
  if (g.fwdOff[0] !== 0 || g.fwdOff[N] !== E) throw new ContractError(`fwdOff must span [0, ${E}]`);
  if (g.revOff[0] !== 0 || g.revOff[N] !== E) throw new ContractError(`revOff must span [0, ${E}]`);
  const nClasses = g.meta.classes.length;
  const nCorr = g.meta.corridors.length;
  for (let e = 0; e < E; e++) {
    if (g.edgeFrom[e] >= N || g.edgeTo[e] >= N) throw new ContractError(`edge ${e} endpoint out of range`);
    if (g.edgeClass[e] >= nClasses) throw new ContractError(`edge ${e} class ${g.edgeClass[e]} >= classes.length`);
    const c = g.edgeCorridor[e];
    if (c !== NO_CORRIDOR && c >= nCorr) throw new ContractError(`edge ${e} corridor ${c} >= corridors.length`);
    const t = g.edgeTimeS[e];
    if (!(t >= 0) || !Number.isFinite(t)) throw new ContractError(`edge ${e} has non-finite or negative edgeTimeS`);
  }
  const seenF = new Uint8Array(E);
  const seenR = new Uint8Array(E);
  for (let u = 0; u < N; u++) {
    if (g.fwdOff[u] > g.fwdOff[u + 1]) throw new ContractError("fwdOff is not monotonic");
    if (g.revOff[u] > g.revOff[u + 1]) throw new ContractError("revOff is not monotonic");
    for (let i = g.fwdOff[u]; i < g.fwdOff[u + 1]; i++) {
      const e = g.fwdEdge[i];
      if (e >= E || g.edgeFrom[e] !== u || seenF[e]) throw new ContractError(`fwd CSR entry ${i} is inconsistent with edgeFrom`);
      seenF[e] = 1;
    }
    for (let i = g.revOff[u]; i < g.revOff[u + 1]; i++) {
      const e = g.revEdge[i];
      if (e >= E || g.edgeTo[e] !== u || seenR[e]) throw new ContractError(`rev CSR entry ${i} is inconsistent with edgeTo`);
      seenR[e] = 1;
    }
  }
}

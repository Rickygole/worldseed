/**
 * compile(world) -> CompiledWorld (ARCHITECTURE.md 1.1 / 2.4).
 *
 * Every world change is an edge-enabled mask, an edge-cost multiplier, a source set and a few masks over
 * the fixed CSR graph. Mutations apply in list order (last write wins for enabled flags; speed factors
 * and sigma scales multiply). Removing a mutation from the list and recompiling restores the previous
 * arrays exactly, because compile is a pure function of (snapshot, mutations).
 *
 * Guards: a record without `confirmedAt` is refused (nothing enters a world without a user action), a
 * `tavily` record must carry provenance, ids must be unique, and every referenced link, corridor,
 * facility, edge and candidate must exist. Violations throw CompileError, which the agent validator can
 * surface as-is.
 */
import { z } from "zod";
import {
  NO_CORRIDOR,
  type AppliedEffect,
  type Candidate,
  type CompiledWorld,
  type Facility,
  type Graph,
  type Mutation,
  type MutationRecord,
  type WorldState,
} from "./contract";

export class CompileError extends Error {
  readonly mutationId: string | null;
  constructor(message: string, mutationId: string | null = null) {
    super(message);
    this.name = "CompileError";
    this.mutationId = mutationId;
  }
}

export interface CompileContext {
  id: string;
  graph: Graph;
  facilities: Facility[];
  candidates: Candidate[];
}

// ---- zod schema for untrusted input (agent tool calls, persisted worlds) -----------------------

const mutationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("close_link"), linkId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("open_link"), linkId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("close_edges"), edges: z.array(z.number().int().nonnegative()).min(1), label: z.string() }).strict(),
  z.object({ kind: z.literal("scale_corridor_speed"), corridorId: z.string().min(1), factor: z.number().positive().finite() }).strict(),
  z.object({ kind: z.literal("add_source"), node: z.number().int().nonnegative(), delayS: z.number().nonnegative().finite().optional() }).strict(),
  z.object({ kind: z.literal("apply_candidate"), candidateId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("set_facility_active"), facilityId: z.string().min(1), active: z.boolean() }).strict(),
]);

export const worldStateSchema = z.object({
  snapshotId: z.string().min(1),
  mutations: z.array(
    z.object({
      id: z.string().min(1),
      m: mutationSchema,
      origin: z.enum(["user", "agent", "tavily", "tour"]),
      label: z.string(),
      provenance: z.object({ url: z.string().min(1), quote: z.string().min(1), retrievedAt: z.string().min(1) }).optional(),
      confirmedAt: z.string().min(1),
    }).strict(),
  ),
}).strict();

export function emptyWorld(snapshotId: string): WorldState {
  return { snapshotId, mutations: [] };
}

// ---- baseline templates (cached per graph + facility list) --------------------------------------

interface Template {
  enabled: Uint8Array;
  sourceMask: Uint8Array;
}
const templates = new WeakMap<Graph, { facilities: Facility[]; t: Template }>();

function template(ctx: CompileContext): Template {
  const hit = templates.get(ctx.graph);
  if (hit && hit.facilities === ctx.facilities) return hit.t;
  const g = ctx.graph;
  const cand = g.flag.CANDIDATE;
  const enabled = new Uint8Array(g.edgeCount);
  for (let e = 0; e < g.edgeCount; e++) enabled[e] = (g.edgeFlags[e] & cand) !== 0 ? 0 : 1;
  const sourceMask = new Uint8Array(ctx.facilities.length);
  ctx.facilities.forEach((f, i) => {
    sourceMask[i] = f.active && (f.kind === "fire_station" || f.kind === "ems_station") ? 1 : 0;
  });
  const t = { enabled, sourceMask };
  templates.set(g, { facilities: ctx.facilities, t });
  return t;
}

// ---- compile -------------------------------------------------------------------------------------

export function compile(world: WorldState, ctx: CompileContext): CompiledWorld {
  if (world.snapshotId !== ctx.id) {
    throw new CompileError(`world is for snapshot "${world.snapshotId}", loaded snapshot is "${ctx.id}"`);
  }
  const g = ctx.graph;
  const E = g.edgeCount;
  const t = template(ctx);
  const cw: CompiledWorld = {
    edgeEnabled: t.enabled.slice(),
    edgeCostMul: new Float32Array(E).fill(1),
    extraSources: [],
    sourceMask: t.sourceMask.slice(),
    hazmatAllowed: new Uint8Array(E),
    hazmatPenaltyS: new Float32Array(E),
    corridorSigmaScale: new Float32Array(g.meta.corridors.length).fill(1),
    applied: [],
  };
  const facilityIndex = new Map(ctx.facilities.map((f, i) => [f.id, i]));
  const candidateById = new Map(ctx.candidates.map((c) => [c.id, c]));
  const seenIds = new Set<string>();
  const seenCandidates = new Set<string>();

  for (const rec of world.mutations) {
    validateRecord(rec, seenIds);
    const m = rec.m;
    let touched = 0;
    switch (m.kind) {
      case "close_link":
        touched = setEnabled(cw, linkEdges(g, m.linkId, rec.id), 0);
        break;
      case "open_link":
        touched = setEnabled(cw, linkEdges(g, m.linkId, rec.id), 1);
        break;
      case "close_edges":
        touched = setEnabled(cw, checkEdges(g, m.edges, rec.id), 0);
        break;
      case "scale_corridor_speed":
        touched = scaleCorridor(g, cw, m.corridorId, m.factor, rec.id);
        break;
      case "add_source":
        addSource(g, cw, m.node, m.delayS ?? 0, rec.id);
        break;
      case "set_facility_active": {
        const i = facilityIndex.get(m.facilityId);
        if (i === undefined) throw new CompileError(`unknown facility "${m.facilityId}"`, rec.id);
        const f = ctx.facilities[i];
        cw.sourceMask[i] = m.active && (f.kind === "fire_station" || f.kind === "ems_station") ? 1 : 0;
        break;
      }
      case "apply_candidate": {
        const c = candidateById.get(m.candidateId);
        if (!c) throw new CompileError(`unknown candidate "${m.candidateId}"`, rec.id);
        if (seenCandidates.has(c.id)) throw new CompileError(`candidate "${c.id}" applied twice`, rec.id);
        seenCandidates.add(c.id);
        touched = applyEffect(g, cw, c, rec.id);
        break;
      }
      default: {
        const never: never = m;
        throw new CompileError(`unknown mutation kind ${JSON.stringify(never)}`, rec.id);
      }
    }
    const eff: AppliedEffect = {
      mutationId: rec.id,
      kind: m.kind,
      label: rec.label,
      origin: rec.origin,
      edgesTouched: touched,
    };
    if (rec.provenance) eff.provenance = rec.provenance;
    cw.applied.push(eff);
  }
  return cw;
}

function validateRecord(rec: MutationRecord, seen: Set<string>): void {
  if (!rec.id) throw new CompileError("mutation record without id");
  if (seen.has(rec.id)) throw new CompileError(`duplicate mutation id "${rec.id}"`, rec.id);
  seen.add(rec.id);
  if (!rec.confirmedAt || Number.isNaN(Date.parse(rec.confirmedAt))) {
    throw new CompileError("mutation is not confirmed (confirmedAt missing or not an ISO time)", rec.id);
  }
  if (rec.origin === "tavily" && (!rec.provenance || !rec.provenance.url || !rec.provenance.quote)) {
    throw new CompileError("a tavily mutation must carry provenance {url, quote, retrievedAt}", rec.id);
  }
}

function linkEdges(g: Graph, linkId: string, mid: string): number[] {
  const i = g.linkIndex.get(linkId);
  if (i === undefined) throw new CompileError(`unknown link "${linkId}"`, mid);
  return g.links[i].edges;
}

function checkEdges(g: Graph, edges: number[], mid: string): number[] {
  for (const e of edges) {
    if (!Number.isInteger(e) || e < 0 || e >= g.edgeCount) throw new CompileError(`edge index ${e} out of range`, mid);
  }
  return edges;
}

function setEnabled(cw: CompiledWorld, edges: number[], value: 0 | 1): number {
  let n = 0;
  for (const e of edges) {
    if (cw.edgeEnabled[e] !== value) n++;
    cw.edgeEnabled[e] = value;
  }
  return n;
}

function corridorIdx(g: Graph, id: string, mid: string): number {
  const c = g.corridorIndex.get(id);
  if (c === undefined) throw new CompileError(`unknown corridor "${id}"`, mid);
  return c;
}

function scaleCorridor(g: Graph, cw: CompiledWorld, corridorId: string, factor: number, mid: string): number {
  if (!(factor > 0) || !Number.isFinite(factor)) throw new CompileError(`speed factor must be a positive number, got ${factor}`, mid);
  const c = corridorIdx(g, corridorId, mid);
  let n = 0;
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.edgeCorridor[e] === c) {
      cw.edgeCostMul[e] = cw.edgeCostMul[e] / factor;
      n++;
    }
  }
  return n;
}

function addSource(g: Graph, cw: CompiledWorld, node: number, delayS: number, mid: string): void {
  if (!Number.isInteger(node) || node < 0 || node >= g.nodeCount) throw new CompileError(`source node ${node} out of range`, mid);
  if (!(delayS >= 0) || !Number.isFinite(delayS)) throw new CompileError(`source delay must be >= 0, got ${delayS}`, mid);
  cw.extraSources.push({ node, delayS });
}

function applyEffect(g: Graph, cw: CompiledWorld, c: Candidate, mid: string): number {
  const ef = c.effect;
  switch (ef.op) {
    case "enable_edges":
      return setEnabled(cw, checkEdges(g, ef.edges, mid), 1);
    case "corridor_speed":
      return scaleCorridor(g, cw, ef.corridor, ef.factor, mid);
    case "add_source":
      addSource(g, cw, ef.facilityLike.node, ef.delayS ?? 0, mid);
      return 0;
    case "allow_class_on": {
      checkEdges(g, ef.edges, mid);
      // Every listed edge is usable by hazmat vehicles; only `penaltyEdges` (the tunnel bores) pay the delay, once
      // per passage. Without `penaltyEdges` (older catalogs) every listed edge pays it.
      const pay = new Set(ef.penaltyEdges ?? ef.edges);
      for (const e of ef.edges) {
        cw.hazmatAllowed[e] = 1;
        cw.hazmatPenaltyS[e] = pay.has(e) ? ef.timePenaltyS : 0;
      }
      return ef.edges.length;
    }
    case "congestion_sigma": {
      const i = corridorIdx(g, ef.corridor, mid);
      if (!(ef.scale >= 0) || !Number.isFinite(ef.scale)) throw new CompileError(`sigma scale must be >= 0, got ${ef.scale}`, mid);
      cw.corridorSigmaScale[i] *= ef.scale;
      return 0;
    }
    default: {
      const never: never = ef;
      throw new CompileError(`unknown candidate effect ${JSON.stringify(never)}`, mid);
    }
  }
}

/** True when every edge of the named link is disabled in the compiled world. */
export function isLinkClosed(cw: CompiledWorld, g: Graph, linkId: string): boolean {
  const i = g.linkIndex.get(linkId);
  if (i === undefined) return false;
  const edges = g.links[i].edges;
  if (edges.length === 0) return false;
  for (const e of edges) if (cw.edgeEnabled[e] !== 0) return false;
  return true;
}

/** Corridor index of an edge, or -1. */
export function corridorOf(g: Graph, e: number): number {
  const c = g.edgeCorridor[e];
  return c === NO_CORRIDOR ? -1 : c;
}

export type { Mutation };

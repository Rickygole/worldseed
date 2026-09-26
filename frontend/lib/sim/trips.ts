/**
 * Point-to-point freight and hazmat trips (pipeline trips.py, docs/DATA_SOURCES.md section 10).
 *
 *   time     node-to-node shortest free-flow drive time in seconds between the trip's origin and destination
 *            nodes (no snap, dwell or loading time)
 *   car      every enabled edge
 *   hazmat_truck  every enabled edge except those with the HAZMAT_PROHIBITED flag, unless a hazmat window
 *            (allow_class_on) allows them; each edge in the window's `penaltyEdges` adds `timePenaltyS` once
 *            per use
 *
 * Trips share origins (7 anchors), so a run is one forward Dijkstra per (origin anchor, class): about 14 per
 * world, a few tens of milliseconds. The baseline is computed once per class and cached.
 */
import type { CompiledWorld, Graph, RunMeta, TripAnchor, TripDef, TripsMeta } from "./contract";
import { walkPred, type DijkstraWorkspace } from "./dijkstra";

/** The route a vehicle class takes in the world (only with `includeRoutes`). */
export interface TripRoute {
  edges: number[];
  nodes: number[];
  lengthM: number;
  viaLinks: string[];
  viaCorridors: string[];
  /** Edges on the route that carry the class's banned flag without a hazmat-window allowance. Always 0 (a check). */
  bannedEdgesUsed: number;
}

export interface TripClassResult {
  baselineS: number | null;
  currentS: number | null;
  baselineMinutes: number | null;
  currentMinutes: number | null;
  /** current - baseline, minutes; null when either is unreachable. Negative when the world is faster than the baseline. */
  addedMinutes: number | null;
  /** current / baseline; null when either is unreachable. */
  ratio: number | null;
  /** No route in this world (current). */
  unreachable: boolean;
  route?: TripRoute;
}

export interface TripResult {
  id: string;
  kind: TripDef["kind"];
  origin: TripAnchor;
  destination: TripAnchor;
  /** Anchor names, for display. */
  names: { origin: string; destination: string };
  classes: Record<string, TripClassResult>;
}

export interface TripsClassSummary {
  /** Cross-harbor trips only. */
  crossHarborTrips: number;
  crossHarborMeanBaselineMinutes: number;
  /** Mean over the cross-harbor trips that are reachable in the world. */
  crossHarborMeanAddedMinutes: number;
  /** Cross-harbor trips whose added time is more than 5 minutes. */
  crossHarborOver5Min: number;
  worstTripId: string | null;
  worstAddedMinutes: number;
  unreachableTrips: number;
  /** Same-shore controls: the largest |added| (they should not depend on the harbor crossings). */
  sameShoreMaxAbsAddedMinutes: number;
}

export interface TripsResult {
  snapshotId: string;
  classes: string[];
  trips: TripResult[];
  summary: Record<string, TripsClassSummary>;
  meta: Pick<RunMeta, "runner" | "workers" | "ms" | "snapshotId">;
}

export interface TripsRequest {
  classes?: string[];
  tripIds?: string[];
  /** Also return each class's route in the world (edges, links and corridors used). */
  includeRoutes?: boolean;
}

const OVER_MIN = 5;

export class TripsEngine {
  private readonly baseline = new Map<string, Map<string, number>>();

  constructor(
    private readonly graph: Graph,
    private readonly dj: DijkstraWorkspace,
    readonly meta: TripsMeta,
    private readonly baselineCw: CompiledWorld,
  ) {}

  private masks(cw: CompiledWorld, cls: string): { enabled: Uint8Array; add?: Float32Array } {
    const flagName = this.meta.classes[cls].removesFlag;
    if (flagName === null) return { enabled: cw.edgeEnabled };
    const g = this.graph;
    const bit = g.flag[flagName];
    const enabled = new Uint8Array(g.edgeCount);
    let anyPenalty = false;
    for (let e = 0; e < g.edgeCount; e++) {
      const banned = (g.edgeFlags[e] & bit) !== 0 && cw.hazmatAllowed[e] === 0;
      enabled[e] = cw.edgeEnabled[e] === 1 && !banned ? 1 : 0;
      if (cw.hazmatPenaltyS[e] > 0) anyPenalty = true;
    }
    return { enabled, add: anyPenalty ? cw.hazmatPenaltyS : undefined };
  }

  /** Shortest node-to-node time in seconds for every requested trip (Infinity = unreachable). */
  private times(cw: CompiledWorld, cls: string, trips: TripDef[], routes?: Map<string, TripRoute>): Map<string, number> {
    const { enabled, add } = this.masks(cw, cls);
    const g = this.graph;
    const flagName = this.meta.classes[cls].removesFlag;
    const bit = flagName === null ? 0 : g.flag[flagName];
    const byOrigin = new Map<number, TripDef[]>();
    for (const t of trips) {
      const a = byOrigin.get(t.originNode);
      if (a) a.push(t);
      else byOrigin.set(t.originNode, [t]);
    }
    const out = new Map<string, number>();
    for (const [node, ts] of byOrigin) {
      const dist = this.dj.run({ reverse: false, sources: [node], enabled, costMul: cw.edgeCostMul, costAdd: add, wantPred: routes !== undefined });
      for (const t of ts) {
        out.set(t.id, dist[t.destinationNode]);
        if (routes && Number.isFinite(dist[t.destinationNode])) {
          const p = walkPred(g, this.dj.pred, t.destinationNode, false); // destination -> origin
          const edges = p.edges.slice().reverse();
          const links: string[] = [];
          const corridors: string[] = [];
          let len = 0;
          let banned = 0;
          for (const e of edges) {
            len += g.edgeLenM[e];
            const li = g.edgeLink[e];
            if (li >= 0 && !links.includes(g.links[li].id)) links.push(g.links[li].id);
            const c = g.edgeCorridor[e];
            if (c !== 0xffff && !corridors.includes(g.meta.corridors[c].id)) corridors.push(g.meta.corridors[c].id);
            if ((g.edgeFlags[e] & bit) !== 0 && cw.hazmatAllowed[e] === 0) banned++;
          }
          routes.set(t.id, { edges, nodes: p.nodes.slice().reverse(), lengthM: len, viaLinks: links, viaCorridors: corridors, bannedEdgesUsed: bit === 0 ? 0 : banned });
        }
      }
    }
    return out;
  }

  private baselineTimes(cls: string, trips: TripDef[]): Map<string, number> {
    let cache = this.baseline.get(cls);
    if (!cache) {
      cache = this.times(this.baselineCw, cls, this.meta.trips);
      this.baseline.set(cls, cache);
    }
    const out = new Map<string, number>();
    for (const t of trips) out.set(t.id, cache.get(t.id) as number);
    return out;
  }

  run(cw: CompiledWorld, snapshotId: string, req: TripsRequest, runner: RunMeta["runner"]): TripsResult {
    const t0 = performance.now();
    const classes = req.classes ?? Object.keys(this.meta.classes);
    for (const c of classes) if (!(c in this.meta.classes)) throw new RangeError(`unknown vehicle class "${c}"`);
    let trips = this.meta.trips;
    if (req.tripIds) {
      const want = new Set(req.tripIds);
      for (const id of want) if (!trips.some((t) => t.id === id)) throw new RangeError(`unknown trip "${id}"`);
      trips = trips.filter((t) => want.has(t.id));
    }
    const anchors = new Map(this.meta.anchors.map((a) => [a.id, a]));
    const perClass = new Map<string, { base: Map<string, number>; cur: Map<string, number>; routes?: Map<string, TripRoute> }>();
    for (const c of classes) {
      const routes = req.includeRoutes ? new Map<string, TripRoute>() : undefined;
      perClass.set(c, { base: this.baselineTimes(c, trips), cur: this.times(cw, c, trips, routes), routes });
    }

    const min = (s: number | null) => (s === null ? null : s / 60);
    const results: TripResult[] = trips.map((t) => {
      const o = anchors.get(t.origin) as TripAnchor;
      const d = anchors.get(t.destination) as TripAnchor;
      const cr: Record<string, TripClassResult> = {};
      for (const c of classes) {
        const p = perClass.get(c) as { base: Map<string, number>; cur: Map<string, number>; routes?: Map<string, TripRoute> };
        const b = p.base.get(t.id) as number;
        const x = p.cur.get(t.id) as number;
        const bS = Number.isFinite(b) ? b : null;
        const xS = Number.isFinite(x) ? x : null;
        cr[c] = {
          baselineS: bS,
          currentS: xS,
          baselineMinutes: min(bS),
          currentMinutes: min(xS),
          addedMinutes: bS !== null && xS !== null ? (xS - bS) / 60 : null,
          ratio: bS !== null && xS !== null && bS > 0 ? xS / bS : null,
          unreachable: xS === null,
        };
        const route = p.routes?.get(t.id);
        if (route) cr[c].route = route;
      }
      return { id: t.id, kind: t.kind, origin: o, destination: d, names: { origin: o.name, destination: d.name }, classes: cr };
    });

    const summary: Record<string, TripsClassSummary> = {};
    for (const c of classes) {
      const cross = results.filter((r) => r.kind === "cross_harbor");
      const reach = cross.filter((r) => r.classes[c].addedMinutes !== null);
      let worst: TripResult | null = null;
      for (const r of reach) if (worst === null || (r.classes[c].addedMinutes as number) > (worst.classes[c].addedMinutes as number)) worst = r;
      const controls = results.filter((r) => r.kind === "same_shore_control" && r.classes[c].addedMinutes !== null);
      summary[c] = {
        crossHarborTrips: cross.length,
        crossHarborMeanBaselineMinutes: mean(cross.map((r) => r.classes[c].baselineMinutes).filter((v): v is number => v !== null)),
        crossHarborMeanAddedMinutes: mean(reach.map((r) => r.classes[c].addedMinutes as number)),
        crossHarborOver5Min: reach.filter((r) => (r.classes[c].addedMinutes as number) > OVER_MIN).length,
        worstTripId: worst ? worst.id : null,
        worstAddedMinutes: worst ? (worst.classes[c].addedMinutes as number) : 0,
        unreachableTrips: results.filter((r) => r.classes[c].unreachable).length,
        sameShoreMaxAbsAddedMinutes: controls.reduce((m, r) => Math.max(m, Math.abs(r.classes[c].addedMinutes as number)), 0),
      };
    }
    return { snapshotId, classes, trips: results, summary, meta: { runner, workers: 1, ms: performance.now() - t0, snapshotId } };
  }

  /** Raw seconds for a trip in a world and class (used by tests and by candidate-effect checks). */
  seconds(cw: CompiledWorld, cls: string, trips?: TripDef[]): Map<string, number> {
    return this.times(cw, cls, trips ?? this.meta.trips);
  }
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

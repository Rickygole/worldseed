/**
 * Freight lens: how much longer hazmat trucks take on the 24 cross-harbor trips than before the collapse.
 * Definition: see `FreightMetrics` in ../contract.ts.
 *
 *   trips      the snapshot's cross_harbor trips (12 anchor pairs x 2 directions) for the hazmat_truck class
 *   time       node-to-node shortest drive time. Edges carrying the class's banned flag (HAZMAT_PROHIBITED) are
 *              removed unless a hazmat window allows them (cw.hazmatAllowed); each allowed edge in the window's
 *              penaltyEdges adds timePenaltyS once per use (cw.hazmatPenaltyS). Under a future, the sampled
 *              congestion multipliers and random closure apply to every edge as for the other lenses.
 *   reference  the same trips in the pre-collapse network under the SAME future draws: the baseline field is
 *              computed with no sample; a future's reference is the empty world evaluated with that sample.
 *   cost       one forward Dijkstra per distinct origin anchor (7), about 25 ms per world.
 *   no terrain `size` is the trip count, not the hex count.
 */
import { FREIGHT_LONG_DETOUR_S, FREIGHT_UNREACHABLE_ADDED_S, type CompiledWorld, type LensMetrics, type TripDef } from "../contract";
import { quantileSortedRank } from "../metrics";
import { prepareEdges, type FutureSample } from "../sample";
import type { Lens, LensContext } from "./types";

export const FREIGHT_CLASS = "hazmat_truck";

export function freightTrips(ctx: LensContext): TripDef[] {
  const t = ctx.snap.trips;
  if (!t) throw new Error("the freight lens needs trip definitions (trips.json, or the trips key of golden.json)");
  if (!(FREIGHT_CLASS in t.classes)) throw new Error(`trip definitions have no ${FREIGHT_CLASS} class`);
  return t.trips.filter((x) => x.kind === "cross_harbor");
}

/** Signed added seconds for one trip. Times are seconds, Infinity = no route. */
export function freightAdded(cur: number, ref: number): number {
  if (!Number.isFinite(cur)) return Number.isFinite(ref) ? FREIGHT_UNREACHABLE_ADDED_S : 0;
  if (!Number.isFinite(ref)) return 0;
  return cur - ref;
}

export function createFreightLens(ctx: LensContext): Lens {
  const trips = freightTrips(ctx);
  const g = ctx.snap.graph;
  const T = trips.length;
  const flagName = (ctx.snap.trips as NonNullable<typeof ctx.snap.trips>).classes[FREIGHT_CLASS].removesFlag;
  const bit = flagName === null ? 0 : g.flag[flagName];
  const enabledH = new Uint8Array(g.edgeCount);
  const byOrigin = new Map<number, number[]>();
  trips.forEach((t, i) => {
    const a = byOrigin.get(t.originNode);
    if (a) a.push(i);
    else byOrigin.set(t.originNode, [i]);
  });
  const tripIds = trips.map((t) => t.id);

  return {
    id: "freight",
    label: "Hazmat freight",
    unitLabel: "min",
    variant: { mode: "standard", approximate: false, label: "Exact (one Dijkstra per origin anchor)" },
    size: T,
    hasAux: false,

    field(cw: CompiledWorld, sample: FutureSample | null, out: Float32Array): void {
      const { enabled, mul } = prepareEdges(g, ctx.futures, cw, sample, ctx.scratch);
      let anyPenalty = false;
      for (let e = 0; e < g.edgeCount; e++) {
        const banned = (g.edgeFlags[e] & bit) !== 0 && cw.hazmatAllowed[e] === 0;
        enabledH[e] = enabled[e] === 1 && !banned ? 1 : 0;
        if (cw.hazmatPenaltyS[e] > 0) anyPenalty = true;
      }
      for (const [node, idx] of byOrigin) {
        const dist = ctx.dj.run({ reverse: false, sources: [node], enabled: enabledH, costMul: mul, costAdd: anyPenalty ? cw.hazmatPenaltyS : undefined });
        for (const i of idx) out[i] = dist[trips[i].destinationNode];
      }
    },

    addedInto(field, baseline, out) {
      for (let i = 0; i < T; i++) out[i] = freightAdded(field[i], baseline[i]);
    },

    metrics(field, baseline): LensMetrics {
      const added = new Array<number>(T);
      let unreachable = 0;
      for (let i = 0; i < T; i++) {
        added[i] = baseline ? freightAdded(field[i], baseline[i]) : 0;
        if (!Number.isFinite(field[i])) unreachable++;
      }
      const sorted = added.slice().sort((a, b) => a - b);
      const long: number[] = [];
      let sum = 0;
      let worst = 0;
      added.forEach((a, i) => {
        sum += a;
        if (a > added[worst]) worst = i;
        if (a > FREIGHT_LONG_DETOUR_S) long.push(i);
      });
      return {
        lens: "freight",
        p50S: quantileSortedRank(sorted, 0.5),
        p90S: quantileSortedRank(sorted, 0.9),
        pctWithin: (100 * (T - long.length)) / T,
        isolatedBg: long,
        equityGapS: 0,
        freight: {
          vehicleClass: FREIGHT_CLASS,
          tripIds,
          tripAddedS: added,
          meanAddedS: sum / T,
          maxAddedS: added[worst],
          worstTripId: tripIds[worst],
          unreachableTrips: unreachable,
          longDetourS: FREIGHT_LONG_DETOUR_S,
          capS: FREIGHT_UNREACHABLE_ADDED_S,
        },
      };
    },
  };
}

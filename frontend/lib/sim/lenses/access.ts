/**
 * Access lens (hero): job-weighted driving time from every hex to the K destinations.
 *
 *   t_k[n]  = reverse Dijkstra from destination k over enabled edges (driving time n -> destination),
 *             capped at accessCapS (unreachable -> cap)
 *   hexT    = min(cap, sum_k w_k * t_k[node] + snapS),   w_k = jobs_k / sum(jobs)
 *
 * "Added" time is hexT in a world minus hexT in the baseline (or, in a future, in the reference world
 * under the same future).
 */
import type { CompiledWorld } from "../contract";
import { prepareEdges, type FutureSample } from "../sample";
import type { Lens, LensContext } from "./types";

/** Access weights w_k = jobs_k / sum(jobs). */
export function accessWeights(ctx: LensContext): number[] {
  const { destinations } = ctx.snap;
  const total = destinations.reduce((s, d) => s + d.jobs, 0);
  if (destinations.length === 0 || !(total > 0)) throw new Error("Access lens needs at least one destination with jobs > 0");
  return destinations.map((d) => d.jobs / total);
}

/** Reverse Dijkstra from destination k (time n -> destination), capped at accessCapS. Returns workspace distances. */
export function runAccessDijkstra(ctx: LensContext, cw: CompiledWorld, sample: FutureSample | null, k: number, wantPred = false): Float64Array {
  const { enabled, mul } = prepareEdges(ctx.snap.graph, ctx.futures, cw, sample, ctx.scratch);
  return ctx.dj.run({
    reverse: true,
    sources: [ctx.snap.destinations[k].node],
    enabled,
    costMul: mul,
    maxCost: ctx.params.accessCapS,
    wantPred,
  });
}

export function createAccessLens(ctx: LensContext): Lens {
  const { snap, mw, params } = ctx;
  const { hexes, destinations } = snap;
  const cap = params.accessCapS;
  const acc = new Float64Array(hexes.count);
  const weights = accessWeights(ctx);

  return {
    id: "access",
    label: "Cross-harbor access",
    unitLabel: "min",
    variant: { mode: "standard", approximate: false, label: "Exact (one Dijkstra per run)" },
    hasAux: false,

    field(cw: CompiledWorld, sample: FutureSample | null, out: Float32Array): void {
      acc.fill(0);
      for (let k = 0; k < destinations.length; k++) {
        const dist = runAccessDijkstra(ctx, cw, sample, k);
        const w = weights[k];
        for (let h = 0; h < hexes.count; h++) {
          const t = dist[hexes.node[h]];
          acc[h] += w * (t > cap ? cap : t);
        }
      }
      for (let h = 0; h < hexes.count; h++) {
        const v = acc[h] + hexes.snapS[h];
        out[h] = v > cap ? cap : v;
      }
    },

    metrics(field, baseline) {
      return mw.access(field, baseline ?? null, params);
    },
  };
}

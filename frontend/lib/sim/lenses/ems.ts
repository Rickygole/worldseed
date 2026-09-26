/**
 * EMS lens ("resilience check"): first-response time from the nearest active station.
 *
 *   sources = active fire_station / ems_station facilities (sourceMask) at their snapped node, start 0,
 *             plus extraSources (pre-positioned units) at their delay
 *   dist    = forward multi-source Dijkstra over enabled edges
 *   hexT    = call_to_wheels_delay + dist[node] + snapS          (unreachable -> Infinity)
 *
 * The delay is the call-processing and turnout delay (assumption A-CALL-TO-WHEELS), in minutes here.
 */
import type { CompiledWorld } from "../contract";
import { prepareEdges, type FutureSample } from "../sample";
import type { Lens, LensContext } from "./types";

/** Forward multi-source Dijkstra from the world's active sources. Returns the workspace distances. */
export function runEmsDijkstra(ctx: LensContext, cw: CompiledWorld, sample: FutureSample | null, wantPred = false): Float64Array {
  const { snap, dj } = ctx;
  const { facilities } = snap;
  const { enabled, mul } = prepareEdges(snap.graph, ctx.futures, cw, sample, ctx.scratch);
  const nodes: number[] = [];
  const delays: number[] = [];
  for (let i = 0; i < facilities.length; i++) {
    if (cw.sourceMask[i] === 1) {
      nodes.push(facilities[i].node);
      delays.push(0);
    }
  }
  for (const s of cw.extraSources) {
    nodes.push(s.node);
    delays.push(s.delayS);
  }
  return dj.run({ reverse: false, sources: nodes, sourceDelays: delays, enabled, costMul: mul, wantPred });
}

export function createEmsLens(ctx: LensContext): Lens {
  const { snap, mw, params } = ctx;
  const { hexes } = snap;

  return {
    id: "ems",
    label: "EMS response",
    unitLabel: "min",
    variant: { mode: "standard", approximate: false, label: "Exact (one Dijkstra per run)" },
    hasAux: false,

    field(cw: CompiledWorld, sample: FutureSample | null, out: Float32Array): void {
      const dist = runEmsDijkstra(ctx, cw, sample);
      const delayS = params.call_to_wheels_delay_min * 60;
      for (let h = 0; h < hexes.count; h++) out[h] = delayS + dist[hexes.node[h]] + hexes.snapS[h];
    },

    metrics(field, _baseline, sample) {
      return mw.ems(field, params, sample?.incidents ?? null);
    },
  };
}

/**
 * Causal chain for one hex: the baseline route versus the route in the world being explained.
 *
 * DATA ONLY. Every number comes from a Dijkstra run; `template` carries {{slot}} placeholders and `slots`
 * holds the computed values as strings, so the UI (or a narrator) fills text from results and never
 * invents a figure.
 *
 *  - EMS: the route from the fastest source to the hex (station -> hex), before and after.
 *  - Access: the hex time is a job-weighted mean over K destinations, so the chain focuses on the
 *    destination whose weighted time changed the most (or, if nothing changed, the heaviest one) and
 *    lists all destinations in `perDestination`.
 */
import { emptyWorld, compile, type CompileContext } from "./compile";
import { walkPred } from "./dijkstra";
import { accessWeights, runAccessDijkstra } from "./lenses/access";
import { runEmsDijkstra } from "./lenses/ems";
import type { LensContext } from "./lenses/types";
import type { CausalChain, CompiledWorld, Graph, LensId, RouteSummary, WorldState } from "./contract";

function summarize(g: Graph, edges: number[], nodes: number[], timeS: number, reachable: boolean): RouteSummary {
  const links: string[] = [];
  const corridors: string[] = [];
  let lengthM = 0;
  let tunnel = 0;
  let bridge = 0;
  for (const e of edges) {
    lengthM += g.edgeLenM[e];
    const li = g.edgeLink[e];
    if (li >= 0 && !links.includes(g.links[li].id)) links.push(g.links[li].id);
    const c = g.edgeCorridor[e];
    if (c !== 0xffff && !corridors.includes(g.meta.corridors[c].id)) corridors.push(g.meta.corridors[c].id);
    if ((g.edgeFlags[e] & g.flag.TUNNEL) !== 0) tunnel++;
    if ((g.edgeFlags[e] & g.flag.BRIDGE) !== 0) bridge++;
  }
  return { timeS, edges, nodes, lengthM, viaLinks: links, viaCorridors: corridors, tunnelEdges: tunnel, bridgeEdges: bridge, reachable };
}

const fmtMin = (s: number): string => (Number.isFinite(s) ? (s / 60).toFixed(1) : "unreachable");
const fmtSigned = (s: number): string => (Number.isFinite(s) ? `${s >= 0 ? "+" : "-"}${(Math.abs(s) / 60).toFixed(1)}` : "n/a");

function via(g: Graph, ids: string[]): string {
  if (ids.length === 0) return "no named link";
  return ids.map((id) => g.links[g.linkIndex.get(id) as number].name).join(", ");
}

export function explainHex(
  ctx: LensContext,
  cctx: CompileContext,
  lens: LensId,
  world: WorldState,
  hex: number,
): CausalChain {
  const { snap, params } = ctx;
  const g = snap.graph;
  const H = snap.hexes;
  if (!Number.isInteger(hex) || hex < 0 || hex >= H.count) throw new RangeError(`hex index ${hex} out of range`);
  const node = H.node[hex];
  const snapS = H.snapS[hex];
  const before = compile(emptyWorld(snap.id), cctx);
  const after = compile(world, cctx);

  let chain: CausalChain;
  if (lens === "ems") {
    const delayS = params.call_to_wheels_delay_min * 60;
    const run = (cw: CompiledWorld) => {
      const dist = runEmsDijkstra(ctx, cw, null, true);
      const d = dist[node];
      const reachable = Number.isFinite(d);
      const path = reachable ? walkPred(g, ctx.dj.pred, node, false) : { edges: [], nodes: [] };
      // forward pred walks hex -> source; present it station -> hex
      const edges = path.edges.slice().reverse();
      const nodes = path.nodes.slice().reverse();
      const hexT = delayS + d + snapS;
      return { hexT, route: summarize(g, edges, nodes, d, reachable), source: nodes.length > 0 ? nodes[0] : node };
    };
    const b = run(before);
    const a = run(after);
    const fac = (n: number, cw: CompiledWorld) => {
      const i = snap.facilities.findIndex((f, k) => cw.sourceMask[k] === 1 && f.node === n);
      return i >= 0 ? snap.facilities[i] : null;
    };
    const f = fac(a.source, after);
    const changed = !sameEdges(b.route.edges, a.route.edges);
    chain = {
      lens,
      hex,
      h3: H.h3[hex],
      snapshotId: snap.id,
      before: { timeS: b.hexT, viaLinks: b.route.viaLinks, route: b.route },
      after: { timeS: a.hexT, viaLinks: a.route.viaLinks, route: a.route },
      deltaS: a.hexT - b.hexT,
      routeChanged: changed,
      lostLinks: lost(b.route, after, g),
      focus: { kind: "station", facilityId: f ? f.id : null, name: f ? f.name : null, node: a.source },
      template: "",
      slots: {},
    };
  } else {
    const K = snap.destinations.length;
    const w = accessWeights(ctx);
    const cap = params.accessCapS;
    const times = (cw: CompiledWorld): number[] => {
      const out: number[] = [];
      for (let k = 0; k < K; k++) {
        const d = runAccessDijkstra(ctx, cw, null, k)[node];
        out.push(d > cap ? cap : d);
      }
      return out;
    };
    const tb = times(before);
    const ta = times(after);
    const hexT = (t: number[]) => Math.min(cap, t.reduce((s, x, k) => s + w[k] * x, 0) + snapS);
    let focus = 0;
    let best = -Infinity;
    for (let k = 0; k < K; k++) {
      const score = w[k] * (ta[k] - tb[k]);
      if (score > best) {
        best = score;
        focus = k;
      }
    }
    if (!(best > 0)) {
      focus = 0;
      let heavy = -Infinity;
      for (let k = 0; k < K; k++) {
        if (w[k] * tb[k] > heavy) {
          heavy = w[k] * tb[k];
          focus = k;
        }
      }
    }
    const route = (cw: CompiledWorld, t: number) => {
      runAccessDijkstra(ctx, cw, null, focus, true);
      const reachable = t < cap;
      const path = reachable ? walkPred(g, ctx.dj.pred, node, true) : { edges: [], nodes: [] };
      return summarize(g, path.edges, path.nodes, t, reachable);
    };
    const rb = route(before, tb[focus]);
    const ra = route(after, ta[focus]);
    const hb = hexT(tb);
    const ha = hexT(ta);
    const d = snap.destinations[focus];
    chain = {
      lens,
      hex,
      h3: H.h3[hex],
      snapshotId: snap.id,
      before: { timeS: hb, viaLinks: rb.viaLinks, route: rb },
      after: { timeS: ha, viaLinks: ra.viaLinks, route: ra },
      deltaS: ha - hb,
      routeChanged: !sameEdges(rb.edges, ra.edges),
      lostLinks: lost(rb, after, g),
      focus: { kind: "destination", id: d.id, name: d.name, weight: w[focus], deltaS: ta[focus] - tb[focus] },
      perDestination: snap.destinations.map((x, k) => ({ id: x.id, name: x.name, weight: w[k], beforeS: tb[k], afterS: ta[k] })),
      template: "",
      slots: {},
    };
  }

  chain.slots = {
    "before.via": via(g, chain.before.viaLinks),
    "after.via": via(g, chain.after.viaLinks),
    "before.min": fmtMin(chain.before.timeS),
    "after.min": fmtMin(chain.after.timeS),
    deltaMin: fmtSigned(chain.deltaS),
  };
  chain.template = chain.routeChanged
    ? "Fastest route used {{before.via}}; now via {{after.via}}. Change {{deltaMin}} min."
    : "Fastest route unchanged (via {{after.via}}). Change {{deltaMin}} min.";
  return chain;
}

function sameEdges(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Named links used by the baseline route where a used edge is disabled in the world. */
function lost(baseRoute: RouteSummary, world: CompiledWorld, g: Graph): string[] {
  const out: string[] = [];
  for (const e of baseRoute.edges) {
    const li = g.edgeLink[e];
    if (li >= 0 && world.edgeEnabled[e] === 0 && !out.includes(g.links[li].id)) out.push(g.links[li].id);
  }
  return out;
}

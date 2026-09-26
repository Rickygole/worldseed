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
import { buildAnchors, XHARBOR_T_MAIN_S, xharborStatic, type AnchorSet } from "./lenses/xharbor";
import { runEmsDijkstra } from "./lenses/ems";
import type { LensContext } from "./lenses/types";
import type { CausalChain, CompiledWorld, Graph, Hexes, LensId, RouteSummary, WorldState } from "./contract";
import { prepareEdges } from "./sample";

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
  } else if (lens === "access") {
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
  } else {
    chain = explainXharbor(ctx, hex, before, after);
  }

  chain.slots = {
    "before.via": via(g, chain.before.viaLinks),
    "after.via": via(g, chain.after.viaLinks),
    "before.min": fmtMin(chain.before.timeS),
    "after.min": fmtMin(chain.after.timeS),
    deltaMin: fmtSigned(chain.deltaS),
  };
  const across = lens === "xharbor" ? "Fastest route across the harbor" : "Fastest route";
  chain.template = chain.routeChanged
    ? `${across} used {{before.via}}; now via {{after.via}}. Change {{deltaMin}} min.`
    : `${across} unchanged (via {{after.via}}). Change {{deltaMin}} min.`;
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

// ---- cross-harbor -------------------------------------------------------------------------------------------

/** Coarse enough that a cluster reads as "a job center", fine enough to keep routes specific. */
export const EXPLAIN_CLUSTERS_PER_SHORE = 24;

const clusterCache = new WeakMap<Hexes, AnchorSet>();

function clusters(h: Hexes): AnchorSet {
  let a = clusterCache.get(h);
  if (!a) {
    a = buildAnchors(h, EXPLAIN_CLUSTERS_PER_SHORE);
    clusterCache.set(h, a);
  }
  return a;
}

/**
 * Cross-harbor chain for an origin hex. The opposite-shore jobs are grouped into job clusters (the same
 * deterministic clustering as the fast lens, coarser). One forward Dijkstra from the origin per world gives the
 * exact travel time to every destination hex, so per cluster we know the job-weighted time before and after.
 * The cluster whose job-weighted time grew the most is the focus (if nothing grew: the cluster with the most
 * jobs), and the routes returned are the baseline and world routes from the origin to that cluster's anchor.
 * `before.timeS` / `after.timeS` / `deltaS` are the hex's exact mean cross-harbor time (the lens value).
 */
function explainXharbor(ctx: LensContext, hex: number, before: CompiledWorld, after: CompiledWorld): CausalChain {
  const { snap, params } = ctx;
  const g = snap.graph;
  const H = snap.hexes;
  const shore = H.shore[hex];
  if (shore > 1) throw new RangeError(`hex ${hex} is on the ambiguous shore: it is not a cross-harbor origin`);
  const st = xharborStatic(H);
  const cap = params.accessCapS;
  const T = XHARBOR_T_MAIN_S;
  const dshore = 1 - shore;
  const A = clusters(H);
  const nodes = A.node[dshore];
  const members = A.members[dshore];
  const C = nodes.length;
  const node = H.node[hex];
  const snapS = H.snapS[hex];

  const run = (cw: CompiledWorld) => {
    const { enabled, mul } = prepareEdges(g, ctx.futures, cw, null, ctx.scratch);
    const dist = ctx.dj.run({ reverse: false, sources: [node], enabled, costMul: mul, maxCost: cap, wantPred: true });
    const sum = new Float64Array(C);
    let total = 0;
    let jobsW = 0;
    let within = 0;
    for (let c = 0; c < C; c++) {
      for (const k of members[c]) {
        const D = snapS + dist[st.destNode[k]] + st.destSnap[k];
        const t = D > cap ? cap : D;
        sum[c] += st.destJobs[k] * t;
        total += st.destJobs[k] * t;
        jobsW += st.destJobs[k];
        if (D <= T) within += st.destJobs[k];
      }
    }
    return { sum, mean: total / jobsW, within, pred: ctx.dj.pred.slice(), anchorDist: Float64Array.from(nodes, (n) => dist[n]) };
  };
  const b = run(before);
  const a = run(after);

  const W = Float64Array.from(A.jobs[dshore]);
  const totalJobs = W.reduce((x, y) => x + y, 0);
  let focus = 0;
  let best = -Infinity;
  for (let c = 0; c < C; c++) {
    const score = a.sum[c] - b.sum[c];
    if (score > best) {
      best = score;
      focus = c;
    }
  }
  if (!(best > 0)) {
    focus = 0;
    for (let c = 1; c < C; c++) if (W[c] > W[focus]) focus = c;
  }

  const route = (r: { pred: Int32Array; anchorDist: Float64Array }): RouteSummary => {
    const d = r.anchorDist[focus];
    if (!Number.isFinite(d)) return summarize(g, [], [], d, false);
    const p = walkPred(g, r.pred, nodes[focus], false);
    // forward pred walks anchor -> origin; present it origin -> anchor
    return summarize(g, p.edges.slice().reverse(), p.nodes.slice().reverse(), d, true);
  };
  const rb = route(b);
  const ra = route(a);

  // anchor hex of the focus cluster: its heaviest member on the anchor node (for lat/lng/h3)
  let anchorHex = st.destHex[members[focus][0]];
  let heavy = -1;
  for (const k of members[focus]) {
    if (st.destNode[k] === nodes[focus] && st.destJobs[k] > heavy) {
      heavy = st.destJobs[k];
      anchorHex = st.destHex[k];
    }
  }
  const clusterMean = (sum: Float64Array, c: number) => sum[c] / W[c];
  const order = Array.from({ length: C }, (_, c) => c).sort((x, y) => (a.sum[y] - b.sum[y]) - (a.sum[x] - b.sum[x]) || x - y);
  const shoreName = dshore === 0 ? "North/east" : "South/west";
  const idOf = (c: number) => `XH-${dshore}-${c}`;
  const nameOf = () => `${shoreName} shore job cluster`;
  const meanB = b.mean;
  const meanA = a.mean;
  return {
    lens: "xharbor",
    hex,
    h3: H.h3[hex],
    snapshotId: snap.id,
    before: { timeS: meanB, viaLinks: rb.viaLinks, route: rb },
    after: { timeS: meanA, viaLinks: ra.viaLinks, route: ra },
    deltaS: meanA - meanB,
    routeChanged: !sameEdges(rb.edges, ra.edges),
    lostLinks: lost(rb, after, g),
    focus: {
      kind: "destination",
      id: idOf(focus),
      name: nameOf(),
      weight: W[focus] / totalJobs,
      deltaS: clusterMean(a.sum, focus) - clusterMean(b.sum, focus),
      cluster: { shore: dshore, lat: H.lat[anchorHex], lng: H.lng[anchorHex], h3: H.h3[anchorHex], jobs: W[focus], hexes: members[focus].length },
    },
    perDestination: order.slice(0, 10).map((c) => ({ id: idOf(c), name: nameOf(), weight: W[c] / totalJobs, beforeS: clusterMean(b.sum, c), afterS: clusterMean(a.sum, c) })),
    crossHarbor: { originShore: shore, jobsWithinBefore: b.within, jobsWithinAfter: a.within, lossFrac: b.within > 0 ? (b.within - a.within) / b.within : 0 },
    template: "",
    slots: {},
  };
}

/**
 * Cross-harbor lens (`xharbor`): what happens to the jobs on the OTHER shore of the Patapsco.
 * Definition: pipeline xharbor.py docstring and assumptions A-XHARBOR-*.
 *
 *   origins       hexes with shore 0 or 1                 (shore 2 = ambiguous: neither origin nor destination)
 *   destinations  hexes with jobs > 0 on the OPPOSITE shore
 *   t(h, j)       snapS_h + drive(node_h -> node_j) + snapS_j            (free-flow, or a future's multipliers)
 *   jobsWithin(h) sum of opposite-shore jobs with t <= 1800 s            (primary measure)
 *   meanTimeS(h)  job-weighted mean of min(t, 7200 s) over ALL opposite-shore jobs   (companion)
 *
 * Two implementations of the same definition:
 *
 *  EXACT       one reverse Dijkstra per unique destination node (about 2,700 on the real graph) and every
 *              (origin hex, destination hex) pair. Matches golden.json. Roughly 10 s per world in Node, so it
 *              is the test oracle and an opt-in mode, not the interactive path.
 *
 *  FAST-ANCHORS  (interactive default). Destination hexes of each shore are clustered into K job-weighted
 *              anchors (deterministic weighted k-means on hex coordinates). One reverse Dijkstra per anchor
 *              gives every origin's drive time to that anchor. Then, per origin hex h and anchor c with total
 *              jobs W_c, member-snap mean s_c and spread sigma_c:
 *                 t_hc = snapS_h + drive(h -> anchor_c) + s_c
 *                 meanTimeS(h)  = sum_c W_c * min(t_hc, cap) / sum_c W_c
 *                 jobsWithin(h) = sum_c W_c * clamp((T - t_hc + g*sigma_c) / (2*g*sigma_c), 0, 1)
 *              i.e. a cluster's jobs count fully when its anchor is comfortably inside T, not at all when it
 *              is comfortably outside, and linearly in between (the cluster is spread over about +-g*sigma
 *              of drive time around its anchor). sigma_c is the job-weighted mean baseline drive time from
 *              the cluster's members to its anchor; g = RAMP_SCALE. Origins are exact hexes, so per-hex
 *              terrain stays smooth; only the destination side is approximated.
 *              Cost is (2 x K) Dijkstras per run instead of about 2,700.
 */
import type { CompiledWorld, Hexes, LensVariant } from "../contract";
import { originMaskedHexes, MetricsWorkspace } from "../metrics";
import { prepareEdges, type FutureSample } from "../sample";
import type { Lens, LensAux, LensContext } from "./types";

export const XHARBOR_T_MAIN_S = 1800;
export const XHARBOR_BOUND_S = 0.5;
/** Half-width of the jobs-within ramp, in units of the cluster spread sigma (see header). */
export const RAMP_SCALE = 1;
export const DEFAULT_ANCHORS_PER_SHORE = 64;
/** Futures run a world and its reference under every future, so they default to half the anchors (measured in xharborGolden.test.ts). */
export const FUTURES_ANCHORS_PER_SHORE = 32;

export interface XStatic {
  origins: Uint32Array[]; // [shore] -> origin hex indices
  destHex: Uint32Array;
  destNode: Uint32Array;
  destSnap: Float64Array;
  destJobs: Float64Array;
  destShore: Uint8Array;
  jobsByShore: [number, number];
}

const statics = new WeakMap<Hexes, XStatic>();

export function xharborStatic(h: Hexes): XStatic {
  const hit = statics.get(h);
  if (hit) return hit;
  const o: number[][] = [[], []];
  const d: number[] = [];
  for (let i = 0; i < h.count; i++) {
    if (h.shore[i] < 2) {
      o[h.shore[i]].push(i);
      if (h.jobs[i] > 0) d.push(i);
    }
  }
  const s: XStatic = {
    origins: [Uint32Array.from(o[0]), Uint32Array.from(o[1])],
    destHex: Uint32Array.from(d),
    destNode: Uint32Array.from(d, (i) => h.node[i]),
    destSnap: Float64Array.from(d, (i) => h.snapS[i]),
    destJobs: Float64Array.from(d, (i) => h.jobs[i]),
    destShore: Uint8Array.from(d, (i) => h.shore[i]),
    jobsByShore: [0, 0],
  };
  for (let k = 0; k < d.length; k++) s.jobsByShore[s.destShore[k]] += s.destJobs[k];
  statics.set(h, s);
  return s;
}

export interface XharborOut {
  mean: Float32Array;
  jobs: Float32Array;
  /** exact mode only: jobs within T-0.5 s and T+0.5 s, for the golden boundary rule. */
  lo?: Float64Array;
  hi?: Float64Array;
}

// ---- exact ---------------------------------------------------------------------------------------------

export function runXharborExact(ctx: LensContext, cw: CompiledWorld, sample: FutureSample | null, out: XharborOut): void {
  const { snap, dj, params } = ctx;
  const hx = snap.hexes;
  const st = xharborStatic(hx);
  const cap = params.accessCapS;
  const T = XHARBOR_T_MAIN_S;
  const { enabled, mul } = prepareEdges(snap.graph, ctx.futures, cw, sample, ctx.scratch);
  const H = hx.count;
  const meanSum = new Float64Array(H);
  const J = new Float64Array(H);
  const Jlo = new Float64Array(H);
  const Jhi = new Float64Array(H);

  // destination hexes grouped by node so each node is searched once
  const byNode = new Map<number, number[]>();
  for (let k = 0; k < st.destHex.length; k++) {
    const a = byNode.get(st.destNode[k]);
    if (a) a.push(k);
    else byNode.set(st.destNode[k], [k]);
  }
  for (const [node, ks] of byNode) {
    const dist = dj.run({ reverse: true, sources: [node], enabled, costMul: mul, maxCost: cap });
    for (const k of ks) {
      const sj = st.destSnap[k];
      const jobs = st.destJobs[k];
      const opp = 1 - st.destShore[k];
      const origins = st.origins[opp];
      for (let i = 0; i < origins.length; i++) {
        const h = origins[i];
        const D = hx.snapS[h] + dist[hx.node[h]] + sj;
        meanSum[h] += jobs * (D > cap ? cap : D);
        if (D <= T) J[h] += jobs;
        if (D <= T - XHARBOR_BOUND_S) Jlo[h] += jobs;
        if (D <= T + XHARBOR_BOUND_S) Jhi[h] += jobs;
      }
    }
  }
  finish(hx, st, meanSum, J, out);
  if (out.lo) out.lo.set(Jlo);
  if (out.hi) out.hi.set(Jhi);
}

function finish(hx: Hexes, st: XStatic, meanSum: Float64Array, J: Float64Array, out: XharborOut): void {
  for (let h = 0; h < hx.count; h++) {
    const s = hx.shore[h];
    if (s > 1) {
      out.mean[h] = NaN;
      out.jobs[h] = NaN;
    } else {
      out.mean[h] = meanSum[h] / st.jobsByShore[1 - s];
      out.jobs[h] = J[h];
    }
  }
}

// ---- fast anchors -----------------------------------------------------------------------------------------

export interface AnchorSet {
  k: number;
  /** anchors per destination shore */
  node: Uint32Array[];
  jobs: Float64Array[];
  snap: Float64Array[]; // job-weighted mean snapS of members
  spread: Float64Array[]; // sigma_c, filled from the baseline
  /** member hex lists, for diagnostics */
  members: number[][][];
}

const KM_PER_DEG_LAT = 110.57;

/** Deterministic weighted k-means on hex coordinates (weighted farthest-point init, fixed iterations). */
export function buildAnchors(hx: Hexes, k: number): AnchorSet {
  const st = xharborStatic(hx);
  const kmLng = 111.32 * Math.cos((39.2 * Math.PI) / 180);
  const set: AnchorSet = { k, node: [], jobs: [], snap: [], spread: [], members: [] };
  for (const shore of [0, 1]) {
    const idx: number[] = [];
    for (let i = 0; i < st.destHex.length; i++) if (st.destShore[i] === shore) idx.push(i);
    const n = idx.length;
    const x = Float64Array.from(idx, (i) => hx.lng[st.destHex[i]] * kmLng);
    const y = Float64Array.from(idx, (i) => hx.lat[st.destHex[i]] * KM_PER_DEG_LAT);
    const w = Float64Array.from(idx, (i) => st.destJobs[i]);
    const kk = Math.min(k, n);
    // init: heaviest hex, then repeatedly the hex maximising (distance to nearest center)^2 x jobs
    const cx = new Float64Array(kk);
    const cy = new Float64Array(kk);
    const near = new Float64Array(n).fill(Infinity);
    let pick = 0;
    for (let i = 1; i < n; i++) if (w[i] > w[pick]) pick = i;
    for (let c = 0; c < kk; c++) {
      cx[c] = x[pick];
      cy[c] = y[pick];
      let best = -1;
      let bi = 0;
      for (let i = 0; i < n; i++) {
        const d2 = (x[i] - cx[c]) ** 2 + (y[i] - cy[c]) ** 2;
        if (d2 < near[i]) near[i] = d2;
        const sc = near[i] * w[i];
        if (sc > best) {
          best = sc;
          bi = i;
        }
      }
      pick = bi;
    }
    const assign = new Int32Array(n);
    for (let it = 0; it < 12; it++) {
      for (let i = 0; i < n; i++) {
        let bc = 0;
        let bd = Infinity;
        for (let c = 0; c < kk; c++) {
          const d2 = (x[i] - cx[c]) ** 2 + (y[i] - cy[c]) ** 2;
          if (d2 < bd) {
            bd = d2;
            bc = c;
          }
        }
        assign[i] = bc;
      }
      const sw = new Float64Array(kk);
      const sx = new Float64Array(kk);
      const sy = new Float64Array(kk);
      for (let i = 0; i < n; i++) {
        sw[assign[i]] += w[i];
        sx[assign[i]] += w[i] * x[i];
        sy[assign[i]] += w[i] * y[i];
      }
      for (let c = 0; c < kk; c++) {
        if (sw[c] > 0) {
          cx[c] = sx[c] / sw[c];
          cy[c] = sy[c] / sw[c];
        }
      }
    }
    const nodes: number[] = [];
    const jobs: number[] = [];
    const snaps: number[] = [];
    const members: number[][] = [];
    for (let c = 0; c < kk; c++) {
      let W = 0;
      let S = 0;
      let bi = -1;
      let bd = Infinity;
      const mem: number[] = [];
      for (let i = 0; i < n; i++) {
        if (assign[i] !== c) continue;
        mem.push(idx[i]);
        W += w[i];
        S += w[i] * st.destSnap[idx[i]];
        const d2 = (x[i] - cx[c]) ** 2 + (y[i] - cy[c]) ** 2;
        if (d2 < bd) {
          bd = d2;
          bi = i;
        }
      }
      if (bi < 0) continue; // empty cluster
      nodes.push(st.destNode[idx[bi]]);
      jobs.push(W);
      snaps.push(S / W);
      members.push(mem);
    }
    set.node.push(Uint32Array.from(nodes));
    set.jobs.push(Float64Array.from(jobs));
    set.snap.push(Float64Array.from(snaps));
    set.spread.push(new Float64Array(nodes.length));
    set.members.push(members);
  }
  return set;
}

function runFast(ctx: LensContext, cw: CompiledWorld, sample: FutureSample | null, A: AnchorSet, out: XharborOut, scratch: { mean: Float64Array; jobs: Float64Array }, ramp: number, spread: Float64Array[], computeSpread: boolean): void {
  const { snap, dj, params } = ctx;
  const hx = snap.hexes;
  const st = xharborStatic(hx);
  const cap = params.accessCapS;
  const T = XHARBOR_T_MAIN_S;
  const { enabled, mul } = prepareEdges(snap.graph, ctx.futures, cw, sample, ctx.scratch);
  scratch.mean.fill(0);
  scratch.jobs.fill(0);
  for (const dshore of [0, 1]) {
    const origins = st.origins[1 - dshore];
    const nodes = A.node[dshore];
    for (let c = 0; c < nodes.length; c++) {
      const dist = dj.run({ reverse: true, sources: [nodes[c]], enabled, costMul: mul, maxCost: cap });
      const W = A.jobs[dshore][c];
      const sc = A.snap[dshore][c];
      if (computeSpread) {
        // sigma_c: job-weighted mean baseline drive time member -> anchor (dist is a reverse search from the anchor)
        let sum = 0;
        let ww = 0;
        for (const k of A.members[dshore][c]) {
          const d = dist[st.destNode[k]];
          sum += st.destJobs[k] * (Number.isFinite(d) ? d : 0);
          ww += st.destJobs[k];
        }
        spread[dshore][c] = ww > 0 ? sum / ww : 0;
      }
      const half = ramp * spread[dshore][c];
      for (let i = 0; i < origins.length; i++) {
        const h = origins[i];
        const t = hx.snapS[h] + dist[hx.node[h]] + sc;
        scratch.mean[h] += W * (t > cap ? cap : t);
        if (half > 0) {
          const f = (T - t + half) / (2 * half);
          if (f >= 1) scratch.jobs[h] += W;
          else if (f > 0) scratch.jobs[h] += W * f;
        } else if (t <= T) scratch.jobs[h] += W;
      }
    }
  }
  finish(hx, st, scratch.mean, scratch.jobs, out);
}

// ---- lens ------------------------------------------------------------------------------------------------

export interface XharborOptions {
  mode: "fast" | "exact";
  anchorsPerShore?: number;
  /** Ramp half-width in cluster spreads (default RAMP_SCALE). */
  rampScale?: number;
}

export function xharborVariant(o: XharborOptions): LensVariant {
  if (o.mode === "exact") return { mode: "exact", approximate: false, label: "Exact: every origin-destination pair" };
  const k = o.anchorsPerShore ?? DEFAULT_ANCHORS_PER_SHORE;
  return {
    mode: "fast-anchors",
    approximate: true,
    anchorsPerShore: k,
    label: `Fast approximation: ${2 * k} job-weighted destination anchors (${k} per shore); origins exact`,
  };
}

export function createXharborLens(ctx: LensContext, baselineCw: CompiledWorld, opts: XharborOptions): Lens {
  const { snap, params } = ctx;
  const hx = snap.hexes;
  const mw = new MetricsWorkspace(originMaskedHexes(hx));
  const scratch = { mean: new Float64Array(hx.count), jobs: new Float64Array(hx.count) };
  const auxScratch = new Float32Array(hx.count);
  let anchors: AnchorSet | null = null;
  let spreadReady = false;
  const ramp = opts.rampScale ?? RAMP_SCALE;

  /** Anchors and their baseline spreads. The baseline field call computes the spreads inline (one pass). */
  function ensureAnchors(cw: CompiledWorld, sample: FutureSample | null, o: XharborOut): AnchorSet {
    if (!anchors) anchors = buildAnchors(hx, opts.anchorsPerShore ?? DEFAULT_ANCHORS_PER_SHORE);
    if (!spreadReady) {
      if (cw === baselineCw && sample === null) {
        runFast(ctx, cw, null, anchors, o, scratch, ramp, anchors.spread, true);
        spreadReady = true;
        return anchors;
      }
      const tmp: XharborOut = { mean: new Float32Array(hx.count), jobs: new Float32Array(hx.count) };
      runFast(ctx, baselineCw, null, anchors, tmp, scratch, ramp, anchors.spread, true);
      spreadReady = true;
    }
    return anchors;
  }

  return {
    id: "xharbor",
    label: "Cross-harbor access",
    unitLabel: "min",
    variant: xharborVariant(opts),
    size: null,
    hasAux: true,

    field(cw, sample, out, aux) {
      const o: XharborOut = { mean: out, jobs: aux ?? auxScratch };
      if (opts.mode === "exact") {
        runXharborExact(ctx, cw, sample, o);
        return;
      }
      const wasReady = spreadReady;
      const A = ensureAnchors(cw, sample, o);
      if (wasReady || !(cw === baselineCw && sample === null)) runFast(ctx, cw, sample, A, o, scratch, ramp, A.spread, false);
    },

    metrics(field, baseline, _sample, aux: LensAux | null | undefined) {
      if (!aux) throw new Error("xharbor metrics need the jobs-within array (aux)");
      return mw.xharbor(field, aux.jobs, baseline ?? null, aux.baselineJobs, params, aux.blockGroups);
    },
  };
}

/** Exposed for tests and the accuracy study. */
export function xharborAnchorInfo(ctx: LensContext, baselineCw: CompiledWorld, k: number): AnchorSet {
  const a = buildAnchors(ctx.snap.hexes, k);
  const tmp: XharborOut = { mean: new Float32Array(ctx.snap.hexes.count), jobs: new Float32Array(ctx.snap.hexes.count) };
  runFast(ctx, baselineCw, null, a, tmp, { mean: new Float64Array(ctx.snap.hexes.count), jobs: new Float64Array(ctx.snap.hexes.count) }, RAMP_SCALE, a.spread, true);
  return a;
}

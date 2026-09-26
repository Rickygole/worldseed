/**
 * Dijkstra over the immutable CSR graph, on typed arrays.
 *
 *  - forward (edges followed tail -> head) or reverse (head -> tail, using the reverse CSR)
 *  - multi-source with optional per-source start offsets
 *  - edge cost = edgeTimeS[e] * costMul[e]; edges with enabled[e] === 0 are skipped
 *  - `maxCost` cutoff: nodes whose distance would exceed it stay Infinity
 *  - optional predecessor edge per node, for explain
 *
 * A workspace owns all scratch memory, so repeated runs allocate nothing. The binary heap is an
 * indexed min-heap (one slot per node, decrease-key in place), so it holds at most N entries.
 */
import type { Graph } from "./contract";

export interface DijkstraRun {
  /** true: follow edges backwards, i.e. dist[v] = time from v TO the sources. */
  reverse: boolean;
  /** Source nodes. */
  sources: ArrayLike<number>;
  /** Start offset per source in seconds (default 0). Same length as `sources`. */
  sourceDelays?: ArrayLike<number>;
  enabled: Uint8Array;
  /** Optional per-edge cost multiplier. */
  costMul?: Float32Array;
  /** Optional per-edge seconds added after the multiplier (e.g. an escort delay on a tunnel bore). */
  costAdd?: Float32Array;
  /** Do not settle nodes farther than this (seconds). Default Infinity. */
  maxCost?: number;
  /** Fill `pred`. */
  wantPred?: boolean;
}

export class DijkstraWorkspace {
  readonly graph: Graph;
  /** Result distances in seconds, Infinity = not reached. Owned by the workspace; overwritten by the next run. */
  readonly dist: Float64Array;
  /**
   * Edge used to reach each node (forward: the edge INTO the node; reverse: the edge OUT of the node,
   * toward the source). -1 for sources and unreached nodes. Only valid after a run with wantPred.
   */
  readonly pred: Int32Array;
  private readonly heap: Uint32Array;
  private readonly pos: Int32Array;
  private size = 0;

  constructor(graph: Graph) {
    this.graph = graph;
    const n = graph.nodeCount;
    this.dist = new Float64Array(n);
    this.pred = new Int32Array(n);
    this.heap = new Uint32Array(n);
    this.pos = new Int32Array(n);
  }

  run(opts: DijkstraRun): Float64Array {
    const g = this.graph;
    const { dist, pred, pos } = this;
    const n = g.nodeCount;
    const enabled = opts.enabled;
    const mul = opts.costMul;
    const add = opts.costAdd;
    const maxCost = opts.maxCost ?? Infinity;
    const wantPred = opts.wantPred === true;
    const off = opts.reverse ? g.revOff : g.fwdOff;
    const adj = opts.reverse ? g.revEdge : g.fwdEdge;
    const far = opts.reverse ? g.edgeFrom : g.edgeTo;
    const time = g.edgeTimeS;

    dist.fill(Infinity);
    pos.fill(-1);
    if (wantPred) pred.fill(-1);
    this.size = 0;

    const src = opts.sources;
    const delays = opts.sourceDelays;
    for (let i = 0; i < src.length; i++) {
      const s = src[i];
      if (s < 0 || s >= n) throw new RangeError(`source node ${s} out of range`);
      const d0 = delays ? delays[i] : 0;
      if (d0 < dist[s] && d0 <= maxCost) {
        dist[s] = d0;
        this.pushOrDecrease(s);
      }
    }

    while (this.size > 0) {
      const u = this.pop();
      const du = dist[u];
      const end = off[u + 1];
      for (let i = off[u]; i < end; i++) {
        const e = adj[i];
        if (enabled[e] === 0) continue;
        let w = mul ? time[e] * mul[e] : time[e];
        if (add) w += add[e];
        const nd = du + w;
        if (nd > maxCost) continue;
        const v = far[e];
        if (nd < dist[v]) {
          dist[v] = nd;
          if (wantPred) pred[v] = e;
          this.pushOrDecrease(v);
        }
      }
    }
    return dist;
  }

  // ---- indexed binary min-heap keyed by dist ------------------------------------------------

  private pushOrDecrease(v: number): void {
    const { heap, pos } = this;
    let i = pos[v];
    if (i < 0) {
      i = this.size++;
      heap[i] = v;
      pos[v] = i;
    }
    this.siftUp(i);
  }

  private siftUp(i: number): void {
    const { heap, pos, dist } = this;
    const v = heap[i];
    const dv = dist[v];
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pv = heap[p];
      if (dist[pv] <= dv) break;
      heap[i] = pv;
      pos[pv] = i;
      i = p;
    }
    heap[i] = v;
    pos[v] = i;
  }

  private pop(): number {
    const { heap, pos, dist } = this;
    const top = heap[0];
    pos[top] = -2; // settled
    const last = heap[--this.size];
    if (this.size > 0) {
      const dl = dist[last];
      let i = 0;
      const half = this.size >> 1;
      while (i < half) {
        let c = 2 * i + 1;
        const r = c + 1;
        if (r < this.size && dist[heap[r]] < dist[heap[c]]) c = r;
        const cv = heap[c];
        if (dist[cv] >= dl) break;
        heap[i] = cv;
        pos[cv] = i;
        i = c;
      }
      heap[i] = last;
      pos[last] = i;
    }
    return top;
  }
}

/** Walk `pred` from `node` back to a source. Returns edge indices in the order they are followed from `node`. */
export function walkPred(g: Graph, pred: Int32Array, node: number, reverse: boolean): { edges: number[]; nodes: number[] } {
  const edges: number[] = [];
  const nodes: number[] = [node];
  let v = node;
  // Path is at most nodeCount long; the bound only guards against a corrupted pred array.
  for (let guard = 0; guard <= g.nodeCount; guard++) {
    const e = pred[v];
    if (e < 0) break;
    edges.push(e);
    v = reverse ? g.edgeTo[e] : g.edgeFrom[e];
    nodes.push(v);
  }
  return { edges, nodes };
}

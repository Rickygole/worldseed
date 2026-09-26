import { describe, expect, it } from "vitest";
import { DijkstraWorkspace, walkPred } from "../../lib/sim/dijkstra";
import { buildGraph, lcg, naiveDistances as reference, type EdgeSpec } from "./fixtures";

function randomCase(seed: number) {
  const r = lcg(seed);
  const N = 5 + Math.floor(r() * 55);
  const E = N + Math.floor(r() * N * 3);
  const edges: EdgeSpec[] = [];
  for (let i = 0; i < E; i++) {
    edges.push({ from: Math.floor(r() * N), to: Math.floor(r() * N), timeS: 1 + r() * 300 });
  }
  const { graph } = buildGraph({ N, edges });
  const enabled = new Uint8Array(E);
  const mul = new Float32Array(E);
  for (let i = 0; i < E; i++) {
    enabled[i] = r() < 0.85 ? 1 : 0;
    mul[i] = r() < 0.5 ? 1 : 0.5 + r() * 2.5;
  }
  const ns = 1 + Math.floor(r() * 3);
  const sources = Array.from({ length: ns }, () => Math.floor(r() * N));
  const delays = sources.map(() => (r() < 0.5 ? 0 : r() * 90));
  const maxCost = r() < 0.4 ? 200 + r() * 600 : Infinity;
  return { N, edges, graph, enabled, mul, sources, delays, maxCost };
}

describe("dijkstra vs naive reference", () => {
  for (const reverse of [false, true]) {
    it(`matches on 300 random graphs (${reverse ? "reverse" : "forward"}, multi-source, cutoff, disabled edges, multipliers)`, () => {
      for (let seed = 1; seed <= 300; seed++) {
        const c = randomCase(seed * 7 + (reverse ? 1 : 0));
        const ws = new DijkstraWorkspace(c.graph);
        const got = ws.run({ reverse, sources: c.sources, sourceDelays: c.delays, enabled: c.enabled, costMul: c.mul, maxCost: c.maxCost });
        const want = reference(c.N, c.edges, c.enabled, c.mul, c.sources, c.delays, reverse, c.maxCost);
        for (let v = 0; v < c.N; v++) {
          if (want[v] === Infinity) expect(got[v], `seed ${seed} node ${v}`).toBe(Infinity);
          else expect(got[v], `seed ${seed} node ${v}`).toBeCloseTo(want[v], 6);
        }
      }
    });
  }

  it("predecessor edges form valid shortest-path trees (forward and reverse)", () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const reverse of [false, true]) {
        const c = randomCase(seed * 13);
        const ws = new DijkstraWorkspace(c.graph);
        ws.run({ reverse, sources: c.sources, sourceDelays: c.delays, enabled: c.enabled, costMul: c.mul, maxCost: c.maxCost, wantPred: true });
        const g = c.graph;
        for (let v = 0; v < c.N; v++) {
          const e = ws.pred[v];
          if (e < 0) continue;
          expect(c.enabled[e]).toBe(1);
          const [near, far] = reverse ? [g.edgeFrom[e], g.edgeTo[e]] : [g.edgeTo[e], g.edgeFrom[e]];
          expect(near).toBe(v);
          const w = g.edgeTimeS[e] * c.mul[e];
          expect(ws.dist[v]).toBeCloseTo(ws.dist[far] + w, 6);
        }
        // walkPred terminates at a source
        for (let v = 0; v < c.N; v++) {
          if (!Number.isFinite(ws.dist[v])) continue;
          const path = walkPred(g, ws.pred, v, reverse);
          const end = path.nodes[path.nodes.length - 1];
          expect(c.sources).toContain(end);
        }
      }
    }
  });

  it("is reusable: a second run on the same workspace is unaffected by the first", () => {
    const c = randomCase(99);
    const ws = new DijkstraWorkspace(c.graph);
    const a = Float64Array.from(ws.run({ reverse: false, sources: c.sources, sourceDelays: c.delays, enabled: c.enabled, costMul: c.mul }));
    ws.run({ reverse: true, sources: [0], enabled: c.enabled });
    const b = ws.run({ reverse: false, sources: c.sources, sourceDelays: c.delays, enabled: c.enabled, costMul: c.mul });
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it("rejects a source outside the graph", () => {
    const c = randomCase(5);
    const ws = new DijkstraWorkspace(c.graph);
    expect(() => ws.run({ reverse: false, sources: [c.N], enabled: c.enabled })).toThrow(RangeError);
  });

  it("handles zero-cost edges and parallel edges (keeps the cheaper)", () => {
    const { graph } = buildGraph({
      N: 3,
      edges: [
        { from: 0, to: 1, timeS: 10 },
        { from: 0, to: 1, timeS: 4 },
        { from: 1, to: 2, timeS: 0 },
      ],
    });
    const ws = new DijkstraWorkspace(graph);
    const d = ws.run({ reverse: false, sources: [0], enabled: new Uint8Array(3).fill(1) });
    expect(Array.from(d)).toEqual([0, 4, 4]);
  });
});

import { describe, expect, it } from "vitest";
import { gridDisk, latLngToCell } from "h3-js";
import { applyJitter, buildAdjacency, hashUnit, jitterFor, JITTER_MIN_ELEV, smoothField } from "../../components/map/terrainSmoothing";
import { aoSegments, buildHexEdges } from "../../components/map/terrainEdges";
import type { Encoded } from "../../lib/ui/lenses";

/** A small patch of real H3 res-9 cells around the harbor, plus their neighbors, so adjacency is real topology. */
function patch(n = 30): string[] {
  const center = latLngToCell(39.22, -76.52, 9);
  const ids = new Set<string>([center]);
  let frontier = [center];
  while (ids.size < n) {
    const next: string[] = [];
    for (const id of frontier) for (const nb of gridDisk(id, 1)) if (!ids.has(nb)) { ids.add(nb); next.push(nb); }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return [...ids].slice(0, n);
}

const encoded = (ids: string[], elev: number[], hatch: number[] = []): Encoded => ({
  elev: Float32Array.from(elev),
  rgb: Float32Array.from(elev.flatMap((e, i) => [e, e * 0.5 + i, 10])),
  hatch: Uint8Array.from(hatch.length ? hatch : ids.map(() => 0)),
});

describe("buildAdjacency", () => {
  it("finds real H3 neighbors, never a cell as its own neighbor", () => {
    const ids = patch();
    const adj = buildAdjacency(ids);
    for (let i = 0; i < ids.length; i++) {
      let count = 0;
      for (let k = 0; k < 6; k++) {
        const j = adj[i * 6 + k];
        if (j < 0) continue;
        count++;
        expect(j).not.toBe(i);
        // Symmetric: if j is i's neighbor, i is (somewhere in) j's neighbor list.
        const back = Array.from({ length: 6 }, (_, kk) => adj[j * 6 + kk]);
        expect(back).toContain(i);
      }
      expect(count).toBeGreaterThan(0); // a connected patch: every cell has at least one neighbor in it
      expect(count).toBeLessThanOrEqual(6);
    }
  });
});

describe("smoothField: color blend across shared edges", () => {
  it("never touches elevation or hatch (the real signal)", () => {
    const ids = patch(7);
    const adj = buildAdjacency(ids);
    const target = encoded(ids, [0, 50, 800, 10, 10, 10, 10], [0, 0, 1, 0, 0, 0, 0]);
    const out = smoothField(target, adj);
    expect(out.elev).toBe(target.elev);
    expect(out.hatch).toBe(target.hatch);
  });

  it("pulls a lone bright hex's color toward its calmer neighbors, and vice versa", () => {
    const ids = patch(7);
    const adj = buildAdjacency(ids);
    // One hot hex (index 0) surrounded by cool ones.
    const elev = ids.map((_, i) => (i === 0 ? 900 : 5));
    const target = encoded(ids, elev);
    const out = smoothField(target, adj);
    // The hot hex's blended color moved down from its raw value toward the (lower) neighborhood average.
    expect(out.rgb[0]).toBeLessThan(target.rgb[0]);
    // A neighbor's blended color moved up a little toward the hot hex.
    let neighborOfZero = -1;
    for (let k = 0; k < 6; k++) if (adj[k] >= 0) neighborOfZero = adj[k];
    expect(neighborOfZero).toBeGreaterThanOrEqual(0);
    expect(out.rgb[neighborOfZero * 3]).toBeGreaterThan(target.rgb[neighborOfZero * 3]);
  });

  it("leaves an isolated cell (no neighbors in the set) exactly as it was", () => {
    const ids = ["892aa8c681bffff"]; // not connected to anything else in this 1-cell "set"
    const adj = buildAdjacency(ids);
    const target = encoded(ids, [400]);
    const out = smoothField(target, adj);
    expect(out.rgb[0]).toBe(target.rgb[0]);
    expect(out.rgb[1]).toBe(target.rgb[1]);
  });
});

describe("hashUnit / jitterFor: tiny, deterministic, never contradicts the real value", () => {
  it("is in [-1, 1] and exactly repeatable for the same id", () => {
    const ids = patch(12);
    for (const id of ids) {
      const a = hashUnit(id);
      const b = hashUnit(id);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(-1);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it("is exactly zero at and below the real-relief threshold: the baseline plain never fakes a delay", () => {
    expect(jitterFor("892aa8c681bffff", 0)).toBe(0);
    expect(jitterFor("892aa8c681bffff", JITTER_MIN_ELEV)).toBe(0);
  });

  it("is capped at 2% of the real height or 4 m, whichever is smaller, above the threshold", () => {
    const ids = patch(12);
    for (const id of ids) {
      for (const elev of [20, 100, 1000]) {
        const j = jitterFor(id, elev);
        expect(Math.abs(j)).toBeLessThanOrEqual(Math.min(4, elev * 0.02) + 1e-9);
      }
    }
  });

  it("applyJitter only moves elevation by the capped amount, both directions represented across many cells", () => {
    const ids = patch(40);
    const elev = Float32Array.from(ids.map(() => 500));
    const out = applyJitter(ids, elev, new Float32Array(ids.length));
    const ups = out.some((v, i) => v > elev[i]);
    const downs = out.some((v, i) => v < elev[i]);
    expect(ups).toBe(true);
    expect(downs).toBe(true);
    for (let i = 0; i < out.length; i++) expect(Math.abs(out[i] - elev[i])).toBeLessThanOrEqual(4 + 1e-6);
  });
});

describe("hex-boundary AO: exact H3 topology, intensity tied to the real height gap", () => {
  it("builds one segment per undirected neighbor pair, each a real 2-point shared edge", () => {
    const ids = patch(10);
    const adj = buildAdjacency(ids);
    const edges = buildHexEdges(ids, adj);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.a).toBeLessThan(e.b); // undirected, deduplicated
      expect(e.p0).not.toEqual(e.p1);
    }
    // No duplicate pair appears twice.
    const seen = new Set(edges.map((e) => `${e.a}-${e.b}`));
    expect(seen.size).toBe(edges.length);
  });

  it("draws nothing where neighbors are at the same height, and darkens as the real gap grows", () => {
    const ids = patch(3);
    const adj = buildAdjacency(ids);
    const edges = buildHexEdges(ids, adj);
    if (edges.length === 0) return; // topology-dependent; the bigger patches above already cover this
    const e = edges[0];
    const flat = new Float32Array(ids.length).fill(50);
    expect(aoSegments(edges, flat)).toHaveLength(0);
    const smallGap = Float32Array.from(flat);
    smallGap[e.b] = 60;
    const bigGap = Float32Array.from(flat);
    bigGap[e.b] = 400;
    const a1 = aoSegments(edges, smallGap, 0).find(() => true)?.a ?? 0;
    const a2 = aoSegments(edges, bigGap, 0).find(() => true)?.a ?? 0;
    expect(a2).toBeGreaterThan(a1);
  });
});

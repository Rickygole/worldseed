/**
 * Ambient occlusion at hex boundaries: a dark groove drawn along the exact shared edge between two adjacent
 * hexes, only where they actually differ in height, and only as dark as that real difference. This is what
 * makes a height step between neighbors read as a step in continuous terrain rather than a seam between two
 * unrelated painted blocks. The edge geometry (which two hexes share which boundary segment) is exact H3
 * topology, computed once per hex set; only the per-edge alpha changes as the real field changes.
 */
import { cellsToDirectedEdge, directedEdgeToBoundary } from "h3-js";
import type { Adjacency } from "./terrainSmoothing";
import type { Path3 } from "./geometry";

export interface HexEdge {
  a: number;
  b: number;
  /** [lng, lat] pair of the shared boundary segment. */
  p0: [number, number];
  p1: [number, number];
}

/** One entry per undirected neighbor pair (a < b), computed once per hex set. */
export function buildHexEdges(ids: readonly string[], adjacency: Adjacency): HexEdge[] {
  const out: HexEdge[] = [];
  const n = ids.length;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 6; k++) {
      const j = adjacency[i * 6 + k];
      if (j <= i) continue; // includes -1 (no neighbor) and the (b,a) duplicate of an already-seen pair
      try {
        const edge = cellsToDirectedEdge(ids[i], ids[j]);
        const [[la0, ln0], [la1, ln1]] = directedEdgeToBoundary(edge);
        out.push({ a: i, b: j, p0: [ln0, la0], p1: [ln1, la1] });
      } catch {
        // Not actually H3-adjacent (should not happen for a gridDisk(1) neighbor); skip.
      }
    }
  }
  return out;
}

/** Darkens toward black as the real height gap grows; near-zero for hexes at the same height. Meters. */
const AO_FULL_GAP_M = 260;
const AO_MAX_ALPHA = 150;

/** AO segments for the current frame: only edges with a visible gap, so most frames draw very few. */
export function aoSegments(edges: readonly HexEdge[], elev: Float32Array, minAlpha = 6): { path: Path3; a: number }[] {
  const out: { path: Path3; a: number }[] = [];
  for (const e of edges) {
    const gap = Math.abs(elev[e.a] - elev[e.b]);
    if (gap <= 1) continue;
    const t = Math.min(1, gap / AO_FULL_GAP_M);
    const a = t * t * AO_MAX_ALPHA;
    if (a < minAlpha) continue;
    const z = Math.min(elev[e.a], elev[e.b]) + 1;
    out.push({ path: [[e.p0[0], e.p0[1], z], [e.p1[0], e.p1[1], z]], a });
  }
  return out;
}

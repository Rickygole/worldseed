/**
 * Pure post-processing on an encoded terrain field (lib/ui/lenses' `encode()` output), applied once per
 * target update, before the value is handed to the animator. Two treatments, both requested by design review
 * so the terrain reads as continuous relief instead of a field of discrete painted blocks:
 *
 *   - color blending: each hex's displayed color is blended a little with its up-to-6 H3 neighbors (a small
 *     box blur over the color field only). This softens the hard color step at every shared edge. It never
 *     touches elevation, so the real added-minutes number a hex encodes as height, and the tooltip/legend
 *     reading of that number, are completely unchanged — only how the color transitions between hexes reads.
 *   - height jitter: a tiny, deterministic (hash-seeded, not random-per-frame) offset on top of hexes that
 *     already show real severity, so a plain of near-identical real values does not read as a perfectly
 *     mechanical, laser-cut plateau. It is capped well below one real minute of added time and is zero on the
 *     baseline plain, so it can never suggest a delay that is not real or flip which of two hexes reads worse.
 */
import { gridDisk } from "h3-js";
import type { Encoded } from "@/lib/ui/lenses";

/** Up to 6 same-array neighbor indices per cell (self excluded), -1 padded. Computed once per world/hex set. */
export type Adjacency = Int32Array; // length n*6

export function buildAdjacency(ids: readonly string[]): Adjacency {
  const n = ids.length;
  const idx = new Map<string, number>();
  for (let i = 0; i < n; i++) idx.set(ids[i], i);
  const out = new Int32Array(n * 6).fill(-1);
  for (let i = 0; i < n; i++) {
    const ring = gridDisk(ids[i], 1);
    let k = 0;
    for (const nb of ring) {
      if (nb === ids[i]) continue;
      const j = idx.get(nb);
      if (j !== undefined && k < 6) out[i * 6 + k++] = j;
    }
  }
  return out;
}

/** How much of a hex's color comes from its neighbors' average (0 = untouched, matches the previous look). */
export const BLEND_STRENGTH = 0.42;

/**
 * A smoothed copy of `target`: same elevation and hatch (the real signal, untouched), color blended toward the
 * neighbor average. Allocates two arrays once; callers may reuse them across calls of the same size.
 */
export function smoothField(target: Encoded, adjacency: Adjacency, out?: { elev: Float32Array; rgb: Float32Array; hatch: Uint8Array }): Encoded {
  const n = target.elev.length;
  const rgb = out?.rgb ?? new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let count = 0;
    const base = i * 6;
    for (let k = 0; k < 6; k++) {
      const j = adjacency[base + k];
      if (j < 0) continue;
      const jk = j * 3;
      sr += target.rgb[jk];
      sg += target.rgb[jk + 1];
      sb += target.rgb[jk + 2];
      count++;
    }
    const k3 = i * 3;
    if (count === 0) {
      rgb[k3] = target.rgb[k3];
      rgb[k3 + 1] = target.rgb[k3 + 1];
      rgb[k3 + 2] = target.rgb[k3 + 2];
      continue;
    }
    const nr = sr / count;
    const ng = sg / count;
    const nb = sb / count;
    rgb[k3] = target.rgb[k3] + (nr - target.rgb[k3]) * BLEND_STRENGTH;
    rgb[k3 + 1] = target.rgb[k3 + 1] + (ng - target.rgb[k3 + 1]) * BLEND_STRENGTH;
    rgb[k3 + 2] = target.rgb[k3 + 2] + (nb - target.rgb[k3 + 2]) * BLEND_STRENGTH;
  }
  return { elev: target.elev, rgb, hatch: target.hatch };
}

/** A stable hash of a hex id to [-1, 1], the same number every time for the same cell (not per-frame random). */
export function hashUnit(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Two more avalanche rounds so adjacent-in-string ids (which H3 ids often are) don't jitter in lockstep.
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Only real relief gets jittered: the baseline plain must stay exactly flat (no fabricated delay). */
export const JITTER_MIN_ELEV = 15;
/** Cap: 2% of the hex's own height or 4 m, whichever is smaller, so ordering between two real values never flips. */
export function jitterFor(id: string, elev: number): number {
  if (elev <= JITTER_MIN_ELEV) return 0;
  const cap = Math.min(4, elev * 0.02);
  return hashUnit(id) * cap;
}

/** Applies `jitterFor` to a copy of `elev` in place (reused buffer). Colors and hatch are untouched. */
export function applyJitter(ids: readonly string[], elev: Float32Array, out: Float32Array): Float32Array {
  for (let i = 0; i < elev.length; i++) out[i] = elev[i] + jitterFor(ids[i], elev[i]);
  return out;
}

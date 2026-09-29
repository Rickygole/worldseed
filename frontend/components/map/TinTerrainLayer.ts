/**
 * PROTOTYPE, off by default (see MapStage: only used with `?terrain=tin` in the URL): a continuous triangulated
 * surface over the hex centers, as an alternative to the extruded-hex terrain, built for the design review's
 * side-by-side comparison ("prototype a continuous triangulated surface... compare it against the beveled-hex
 * approach; pick whichever reads better"). It renders the exact same per-hex numbers (one mesh vertex per hex
 * center, at that hex's real elevation and color) through a shared triangle mesh, so color and height are
 * genuinely interpolated across every shared edge by the GPU rasterizer — the most literal reading of "blend
 * across shared edges" there is. `hex` was picked as the shipped default; see the design report for why.
 *
 * Built on `@deck.gl/mesh-layers`' `SimpleMeshLayer` with `_instanced: false` (mesh positions are then read as
 * plain [lng, lat, meters] world coordinates instead of meter offsets from one instance anchor — exactly the
 * convention every other layer in this app already uses). Triangulated with `d3-delaunay` (a transitive
 * dependency of the `d3` package already in package.json; not a new install).
 */
import { Delaunay } from "d3-delaunay";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import type { Layer } from "@deck.gl/core";

import { toLocalKm } from "@/lib/geo";
import { TERRAIN_MATERIAL } from "./lighting";

export const TIN_OPTION_KEY = "terrain";

export interface TinMeshTopology {
  /** Triangle vertex indices, 3 per triangle, into the same hex-index space as `elev`/`rgb`. */
  indices: Uint32Array;
  /** Per-vertex smooth normal (accumulated face normals, normalized), 3 floats per vertex; refreshed per target. */
  normals: Float32Array;
  /** Cached local-meter [x,y] per cell (2 floats per vertex), needed to refresh normals against real elevation. */
  localXY: Float32Array;
}

/** Delaunay triangulation of the hex centers in local meters (stable, planar, matches lib/geo.ts's approximation). */
export function buildTinTopology(cells: readonly { lat: number; lng: number }[]): TinMeshTopology {
  const n = cells.length;
  const pts = new Float64Array(n * 2);
  const localXY = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [x, y] = toLocalKm(cells[i].lat, cells[i].lng);
    localXY[i * 2] = x;
    localXY[i * 2 + 1] = y;
    pts[i * 2] = x;
    pts[i * 2 + 1] = y;
  }
  const del = new Delaunay(pts);
  const indices = del.triangles;
  const normals = computeNormals(n, indices, localXY);
  return { indices, normals, localXY };
}

/**
 * Per-vertex smooth normals from the target elevation: one flat face normal per triangle (in local meters, z in
 * meters too), summed into its 3 vertices, then normalized. Recomputed once per target change (not per frame):
 * mid-animation shading reflects the arriving height, not the interpolated one, an accepted simplification for
 * a comparison prototype.
 */
function computeNormals(n: number, indices: Uint32Array, localXY: Float32Array, elev?: Float32Array): Float32Array {
  const normals = new Float32Array(n * 3);
  const ez = elev;
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    const ax = localXY[ia * 2];
    const ay = localXY[ia * 2 + 1];
    const az = ez ? ez[ia] : 0;
    const bx = localXY[ib * 2];
    const by = localXY[ib * 2 + 1];
    const bz = ez ? ez[ib] : 0;
    const cx = localXY[ic * 2];
    const cy = localXY[ic * 2 + 1];
    const cz = ez ? ez[ic] : 0;
    // Meters in x/y, meters in z: a real 3D face normal (1000x on x/y only if elev were km; both are meters here).
    const ux = (bx - ax) * 1000;
    const uy = (by - ay) * 1000;
    const uz = bz - az;
    const vx = (cx - ax) * 1000;
    const vy = (cy - ay) * 1000;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    normals[ia * 3] += nx;
    normals[ia * 3 + 1] += ny;
    normals[ia * 3 + 2] += nz;
    normals[ib * 3] += nx;
    normals[ib * 3 + 1] += ny;
    normals[ib * 3 + 2] += nz;
    normals[ic * 3] += nx;
    normals[ic * 3 + 1] += ny;
    normals[ic * 3 + 2] += nz;
  }
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    const len = Math.hypot(normals[k], normals[k + 1], normals[k + 2]) || 1;
    normals[k] /= len;
    normals[k + 1] /= len;
    normals[k + 2] /= len;
  }
  return normals;
}

/** Recomputes normals against the current (real) elevation — call on target change, not per animation frame. */
export function refreshTinNormals(topo: TinMeshTopology, n: number, elev: Float32Array): void {
  topo.normals.set(computeNormals(n, topo.indices, topo.localXY, elev));
}

export interface TinCells {
  lat: number;
  lng: number;
}

/**
 * The mesh layer itself. `elev`/`rgb` are the animator's live buffers (same convention as `terrainLayer`); the
 * mesh's position and color attributes are rebuilt from them on every `tick` — acceptable for a prototype
 * shown behind a debug flag, not the always-on production path.
 */
export function tinTerrainLayer(cells: readonly TinCells[], elev: Float32Array, rgb: Float32Array, topo: TinMeshTopology, opacity: number): Layer {
  const n = cells.length;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = cells[i].lng;
    positions[i * 3 + 1] = cells[i].lat;
    positions[i * 3 + 2] = elev[i];
    const k = i * 3;
    colors[i * 3] = rgb[k] / 255;
    colors[i * 3 + 1] = rgb[k + 1] / 255;
    colors[i * 3 + 2] = rgb[k + 2] / 255;
  }
  return new SimpleMeshLayer({
    id: "terrain-tin",
    data: [{}],
    mesh: {
      attributes: {
        positions: { value: positions, size: 3 },
        colors: { value: colors, size: 3 },
        normals: { value: topo.normals, size: 3 },
      },
      indices: { value: topo.indices, size: 1 },
    },
    _instanced: false,
    getPosition: () => [0, 0, 0],
    getColor: [255, 255, 255, 255],
    material: TERRAIN_MATERIAL,
    opacity,
    pickable: false,
  });
}

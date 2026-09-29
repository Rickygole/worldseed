/**
 * Pure geometry helpers for the map layers: hex outlines, hatch chords, dashed lines, the "draws itself"
 * prefix of an option's path. No React, no deck.gl.
 */
import { cellToBoundary } from "h3-js";
import { toLocalKm } from "../../lib/geo";

export type Path3 = [number, number, number][];
export type RGBA = [number, number, number, number];

/** Three diagonal chords per hex, [lng,lat] pairs, clipped to the hex outline. */
export function hatchChords(id: string): [number, number][][] {
  const ring = cellToBoundary(id); // [lat, lng][]
  const lat0 = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lng0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const [cx, cy] = toLocalKm(lat0, lng0);
  const SHRINK = 0.86;
  const poly = ring.map(([la, ln]) => {
    const [x, y] = toLocalKm(la, ln);
    return [cx + (x - cx) * SHRINK, cy + (y - cy) * SHRINK] as [number, number];
  });
  const r = Math.max(...poly.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  const kmLng = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const out: [number, number][][] = [];
  // Lines x - y = c (45 degrees), offsets across the hex.
  for (const k of [-0.5, 0, 0.5]) {
    const c = k * r * 1.2;
    const ts: { s: number; x: number; y: number }[] = [];
    for (let e = 0; e < poly.length; e++) {
      const [ax, ay] = poly[e];
      const [bx, by] = poly[(e + 1) % poly.length];
      const fa = ax - cx - (ay - cy) - c;
      const fb = bx - cx - (by - cy) - c;
      if (fa === fb || fa * fb > 0) continue;
      const t = fa / (fa - fb);
      ts.push({ s: ax + (bx - ax) * t + ay + (by - ay) * t, x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
    }
    if (ts.length < 2) continue;
    ts.sort((a, b) => a.s - b.s);
    const toLL = (x: number, y: number): [number, number] => [lng0 + (x - cx) / kmLng, lat0 + (y - cy) / 110.57];
    out.push([toLL(ts[0].x, ts[0].y), toLL(ts[ts.length - 1].x, ts[ts.length - 1].y)]);
  }
  return out;
}

/** Split a polyline into dashes (km lengths). Static markers only: a dashed line is a removed or hidden link. */
export function dashes(path: [number, number][], dashKm: number, gapKm: number, z: number): Path3[] {
  const pts = path.map(([lng, lat]) => ({ lng, lat, xy: toLocalKm(lat, lng) }));
  const out: Path3[] = [];
  let on = true;
  let left = dashKm;
  let cur: Path3 = [[pts[0].lng, pts[0].lat, z]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = Math.hypot(b.xy[0] - a.xy[0], b.xy[1] - a.xy[1]);
    if (seg === 0) continue;
    let t0 = 0;
    while (seg * (1 - t0) > left) {
      const t = t0 + left / seg;
      const p: [number, number, number] = [a.lng + (b.lng - a.lng) * t, a.lat + (b.lat - a.lat) * t, z];
      if (on) {
        cur.push(p);
        out.push(cur);
      } else cur = [p];
      on = !on;
      left = on ? dashKm : gapKm;
      t0 = t;
    }
    left -= seg * (1 - t0);
    if (on) cur.push([b.lng, b.lat, z]);
  }
  if (on && cur.length > 1) out.push(cur);
  return out;
}

export function hexRing(id: string, z: number): Path3 {
  const ring = cellToBoundary(id).map(([la, ln]) => [ln, la, z] as [number, number, number]);
  return [...ring, ring[0]];
}

/**
 * The "draws itself" effect: segments are revealed in order of distance from `from` (the option's centre), so
 * a corridor of many short pieces grows outward as one line instead of flickering everywhere at once.
 */
export function drawPrefix(paths: [number, number][][], t: number, z: number, from: [number, number]): Path3[] {
  const lift = (p: [number, number][]) => p.map(([x, y]) => [x, y, z] as [number, number, number]);
  if (t >= 1) return paths.map(lift);
  if (t <= 0) return [];
  const d = (p: [number, number][]) => Math.min(...p.map(([x, y]) => (x - from[0]) ** 2 + (y - from[1]) ** 2));
  const order = [...paths].sort((a, b) => d(a) - d(b));
  const k = t * order.length;
  const whole = Math.floor(k);
  const out = order.slice(0, whole).map(lift);
  const next = order[whole];
  if (next && k > whole) out.push(lift(next.slice(0, Math.max(2, Math.ceil(next.length * (k - whole))))));
  return out;
}

/** Cumulative fraction (0..1) along a lng/lat polyline by km distance, one per vertex. */
export function pathFractions(path: [number, number][]): number[] {
  const xy = path.map(([lng, lat]) => toLocalKm(lat, lng));
  const cum: number[] = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  return cum.map((c) => c / total);
}

/** Path length in km. */
export function pathKm(path: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) {
    const a = toLocalKm(path[i - 1][1], path[i - 1][0]);
    const b = toLocalKm(path[i][1], path[i][0]);
    s += Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  return s;
}

/** Linear mix of two RGB colors. */
export function mixRgb(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

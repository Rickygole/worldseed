/**
 * Map geometry for catalog options (apply animation, preview labels, stagger origin): temporary links from
 * links.geojson, corridor speed options from their corridor geometry, staging sites from their catalog point.
 */
import type { Catalog } from "../agent/catalog";

type LngLat = [number, number];

interface Feature {
  properties: { id: string; name: string; kind: string };
  geometry: { type: "LineString"; coordinates: LngLat[] } | { type: "MultiLineString"; coordinates: LngLat[][] };
}

let linksP: Promise<Map<string, LngLat[][]>> | null = null;
export function loadLinkGeometry(): Promise<Map<string, LngLat[][]>> {
  linksP ??= fetch("/snapshot/links.geojson")
    .then((r) => {
      if (!r.ok) throw new Error(`links.geojson: HTTP ${r.status}`);
      return r.json() as Promise<{ features: Feature[] }>;
    })
    .then((g) => {
      const m = new Map<string, LngLat[][]>();
      for (const f of g.features) m.set(f.properties.id, f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates);
      return m;
    })
    .catch((e) => {
      linksP = null;
      throw e;
    });
  return linksP;
}

export interface OptionGeo {
  candidateId: string;
  kind: "link" | "corridor" | "site";
  paths: LngLat[][];
  point: LngLat;
}

const centroid = (paths: LngLat[][]): LngLat => {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const p of paths) for (const [a, b] of p) {
    x += a;
    y += b;
    n++;
  }
  return n ? [x / n, y / n] : [0, 0];
};

export function optionGeo(catalog: Catalog, links: Map<string, LngLat[][]>, candidateId: string): OptionGeo | null {
  const c = catalog.byId.get(candidateId);
  if (!c) return null;
  const e = c.effect as { op: string; corridor?: string; facilityLike?: { lat: number; lng: number } };
  if (e.op === "add_source" && e.facilityLike) {
    const pt: LngLat = [e.facilityLike.lng, e.facilityLike.lat];
    return { candidateId, kind: "site", paths: [], point: pt };
  }
  if (e.op === "corridor_speed" && e.corridor) {
    const paths = links.get(e.corridor) ?? [];
    return paths.length ? { candidateId, kind: "corridor", paths, point: centroid(paths) } : null;
  }
  const paths = links.get(candidateId) ?? [];
  return paths.length ? { candidateId, kind: "link", paths, point: centroid(paths) } : null;
}

/** Where a set of options sits on the map (the ripple origin when it is applied). */
export function optionsOrigin(geos: readonly OptionGeo[]): { lat: number; lng: number } | null {
  if (geos.length === 0) return null;
  const [lng, lat] = centroid(geos.map((g) => [g.point]));
  return { lat, lng };
}

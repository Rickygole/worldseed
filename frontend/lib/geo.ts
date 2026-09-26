/** Geographic constants for the Key Bridge region. */

export const H3_RES = 9;

export const REGION_CENTER = { lat: 39.235, lng: -76.52 } as const;

/**
 * The Francis Scott Key Bridge (I-695) over the Patapsco River. `path` follows the L-KEYBRIDGE geometry in
 * data/snapshot/links.geojson (south-west abutment at Hawkins Point -> north-east abutment at Sollers
 * Point), thinned to its bends. Used only for the dashed map marker and the terrain stagger origin.
 */
export const BRIDGE = {
  id: "key_bridge",
  name: "Key Bridge",
  lat: 39.2181,
  lng: -76.5277,
  path: [
    [-76.5395, 39.20978],
    [-76.53643, 39.21096],
    [-76.53437, 39.21225],
    [-76.52973, 39.21584],
    [-76.52679, 39.21823],
    [-76.51593, 39.22653],
  ] as [number, number][],
} as const;

const KM_PER_DEG_LAT = 110.57;

/** Local equirectangular km offsets from REGION_CENTER (good enough at ~10 km). */
export function toLocalKm(lat: number, lng: number): [number, number] {
  const kmPerDegLng = 111.32 * Math.cos((REGION_CENTER.lat * Math.PI) / 180);
  return [
    (lng - REGION_CENTER.lng) * kmPerDegLng,
    (lat - REGION_CENTER.lat) * KM_PER_DEG_LAT,
  ];
}

export function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const [ax, ay] = toLocalKm(aLat, aLng);
  const [bx, by] = toLocalKm(bLat, bLng);
  return Math.hypot(ax - bx, ay - by);
}

export interface CameraView {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export const BASE_VIEW: CameraView = {
  longitude: REGION_CENTER.lng,
  latitude: REGION_CENTER.lat - 0.004,
  zoom: 10.9,
  pitch: 55,
  bearing: -18,
};

/**
 * Camera for a changed world: centered on where the change actually is, not on a fixed point.
 * Target = centroid of the hexes weighted by (added minutes above a small floor) squared, so a handful of
 * strongly affected hexes dominate a long tail of seconds. Falls back to the regional view when nothing
 * moved by more than the floor.
 */
export function focusView(cells: { lat: number; lng: number }[], addedMin: ArrayLike<number>, floorMin = 0.5): CameraView {
  let w = 0;
  let lat = 0;
  let lng = 0;
  for (let i = 0; i < cells.length; i++) {
    const a = addedMin[i] - floorMin;
    if (!(a > 0)) continue;
    const k = a * a;
    w += k;
    lat += k * cells[i].lat;
    lng += k * cells[i].lng;
  }
  if (w <= 0) return BASE_VIEW;
  // Frame the change together with the bridge gap that caused it: aim 70% of the way from the bridge to the
  // centroid, looking north-east across the river.
  const k = 0.7;
  return {
    longitude: BRIDGE.lng + (lng / w - BRIDGE.lng) * k,
    latitude: BRIDGE.lat + (lat / w - BRIDGE.lat) * k,
    zoom: 11.45,
    pitch: 56,
    bearing: 28,
  };
}

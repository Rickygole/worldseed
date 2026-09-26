/** Geographic constants for the Key Bridge region. */

export const H3_RES = 9;

export const REGION_CENTER = { lat: 39.235, lng: -76.52 } as const;

/** Approximate location of the Francis Scott Key Bridge (I-695, Patapsco River). */
export const BRIDGE = {
  id: "key_bridge",
  name: "Key Bridge",
  lat: 39.2175,
  lng: -76.5205,
  /** Simple marker line, [lng, lat] south shore -> north shore. Approximate. */
  path: [
    [-76.5195, 39.209],
    [-76.5205, 39.2175],
    [-76.5215, 39.226],
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
  zoom: 11.0,
  pitch: 58,
  bearing: -18,
};

/** Camera target after a disruption: closer, steeper, looking across the river. */
export const DISRUPTED_VIEW: CameraView = {
  longitude: -76.515,
  latitude: 39.222,
  zoom: 11.45,
  pitch: 62,
  bearing: -38,
};

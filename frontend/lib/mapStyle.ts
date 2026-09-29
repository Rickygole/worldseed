import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";

/**
 * Base map styles. Two hero looks share one vector overlay (roads, place and water labels, from OpenFreeMap
 * vector tiles, https://openfreemap.org, no API key, no OSM tile servers) and one Census-shapes fallback:
 *
 *   - `VECTOR_STYLE`: the original premium dark look. Land near-black slate, hairline roads, deep navy water
 *     with a shoreline depth band, faint high-zoom buildings, minimal labels, a sky/fog atmosphere.
 *   - `SATELLITE_STYLE`: real aerial/satellite imagery (Esri World Imagery, see below) under a dark scrim, with
 *     the same road and label overlay and the same sky. The scrim keeps the imagery from competing with the
 *     extruded terrain, glowing crossings and freight trails, which stay the thing the eye reads.
 *   - `FALLBACK_STYLE`: land shapes from the study area's own Census block groups (already in the snapshot),
 *     used only when even the vector tiles cannot be fetched.
 *
 * `SATELLITE_ENABLED` is the one switch between the two hero looks; `STYLE_CHAIN` is what actually loads,
 * falling further down the chain (never to a blank map) as each source proves unreachable. See DeckStage for
 * the runtime fallback logic; it is quality-tier aware (a low-tier session skips the heavier raster imagery
 * and starts on the vector style) and treats every style swap as an instant cut, never an animated crossfade,
 * so it stays correct under `prefers-reduced-motion` without any extra branching.
 *
 * Esri World Imagery (`SATELLITE_STYLE`'s source): `https://server.arcgisonline.com/ArcGIS/rest/services/
 * World_Imagery/MapServer`, tile pattern `.../MapServer/tile/{z}/{y}/{x}`. Free, keyless, no sign-in, CORS
 * open (`Access-Control-Allow-Origin: *`), served over CloudFront. Verified 2026-09-28:
 *   - `GET .../World_Imagery/MapServer?f=json` -> 200, `copyrightText`: "Source: Esri, Vantor, Earthstar
 *     Geographics, and the GIS User Community" (the live credit line, used in `SATELLITE_ATTRIBUTION` below).
 *   - A tile fetch -> 200 `image/jpeg`, `Access-Control-Allow-Origin: *`.
 *   - Esri's own basemap-citation guidance (support.esri.com/en/technical-article/000012040) says the
 *     acceptable way to attribute an ArcGIS Online basemap in a web map is to show the service's credit text
 *     near the map, which is what the always-on MapLibre attribution control does; it does not mandate one
 *     fixed string (the credit line changes as Esri's imagery providers change), so this uses the live value
 *     fetched on the verification date above rather than an older list quoted on that same page. Each source
 *     below carries its own `attribution`; MapLibre's built-in AttributionControl re-derives the visible
 *     credit list from whichever sources the *current* style actually uses every time the style changes (see
 *     `_updateAttributions` in maplibre-gl's `attribution_control.ts`), so the Esri credit is shown only while
 *     satellite imagery is the active source and drops on its own the moment the map falls back to the vector
 *     style — no extra code needed here to keep that correct.
 *   - ArcGIS Online's general terms describe this shared content as "typically available for your personal
 *     or noncommercial use" (doc.arcgis.com/en/arcgis-online/reference/terms-of-use.htm); this project is a
 *     $0, non-commercial hackathon demo (see docs/LEGAL.md), which fits. No rate limit is published for this
 *     specific keyless endpoint; this is the same endpoint leaflet-providers' `Esri.WorldImagery` entry and
 *     countless other free demo maps use without a key, as distinct from Esri's newer Location Platform APIs,
 *     which do require one. Re-check before any redeploy expecting heavy, sustained traffic.
 */

export const C = {
  land: "#0d131c",
  landuse: "#101823",
  park: "#0f1a1f",
  water: "#050b16",
  shallow: "#0b1c30",
  shore: "#1b3350",
  roadMinor: "#17212e",
  roadSecondary: "#222f42",
  roadPrimary: "#30405a",
  roadMotorway: "#4a5f82",
  building: "#141d2b",
  label: "#8492a6",
  labelWater: "#33557d",
  halo: "#070b12",
} as const;

const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

/** Layers of the vector style that the quality tier can hide: buildings first. Not present in the satellite style. */
export const BUILDING_LAYER_IDS = ["building-3d"] as const;

/** The ocean/bay polygon is one huge ring: its shoreline is drawn by the fill alone (a line layer over it exceeds the tile vertex limit). */
const NOT_OCEAN: ExpressionSpecification = ["!=", ["get", "class"], "ocean"];

const layers: LayerSpecification[] = [
  { id: "background", type: "background", paint: { "background-color": C.land } },
  {
    id: "landcover",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "landcover",
    paint: { "fill-color": C.landuse, "fill-opacity": 0.7 },
  },
  {
    id: "landuse",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "landuse",
    filter: ["in", ["get", "class"], ["literal", ["residential", "industrial", "commercial", "retail", "cemetery", "school", "hospital"]]],
    paint: { "fill-color": C.landuse, "fill-opacity": 0.85 },
  },
  {
    id: "park",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "landuse",
    filter: ["in", ["get", "class"], ["literal", ["park", "playground", "pitch", "stadium"]]],
    paint: { "fill-color": C.park },
  },
  {
    id: "water",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "water",
    paint: { "fill-color": C.water },
  },
  // Depth: a wide blurred band on the water side of the shoreline (lighter shallows), then a hairline coast.
  {
    id: "water-shallow-wide",
    type: "line",
    source: "openmaptiles",
    "source-layer": "water",
    filter: NOT_OCEAN,
    minzoom: 10,
    layout: { "line-join": "bevel" },
    paint: {
      "line-color": C.shallow,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 10, 12, 34, 15, 70],
      "line-offset": ["interpolate", ["linear"], ["zoom"], 8, 5, 12, 17, 15, 35],
      "line-blur": ["interpolate", ["linear"], ["zoom"], 8, 8, 12, 24, 15, 50],
      "line-opacity": 0.9,
    },
  },
  {
    id: "water-shallow-near",
    type: "line",
    source: "openmaptiles",
    "source-layer": "water",
    filter: NOT_OCEAN,
    minzoom: 10,
    layout: { "line-join": "bevel" },
    paint: {
      "line-color": "#10304f",
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 12, 10, 15, 22],
      "line-offset": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 12, 5, 15, 11],
      "line-blur": ["interpolate", ["linear"], ["zoom"], 8, 3, 12, 8, 15, 16],
      "line-opacity": 0.75,
    },
  },
  {
    id: "waterway",
    type: "line",
    source: "openmaptiles",
    "source-layer": "waterway",
    paint: { "line-color": C.shallow, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 14, 2] },
  },
  {
    id: "coast",
    type: "line",
    source: "openmaptiles",
    "source-layer": "water",
    filter: NOT_OCEAN,
    minzoom: 10,
    paint: { "line-color": C.shore, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 1], "line-opacity": 0.9 },
  },
  {
    id: "building-flat",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "building",
    minzoom: 12,
    maxzoom: 14.5,
    paint: { "fill-color": C.building, "fill-opacity": 0.6 },
  },
  {
    id: "road-minor",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    filter: ["in", ["get", "class"], ["literal", ["minor", "service", "track", "path"]]],
    minzoom: 12,
    paint: { "line-color": C.roadMinor, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.3, 16, 1.6], "line-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 1] },
  },
  {
    id: "road-secondary",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    filter: ["in", ["get", "class"], ["literal", ["secondary", "tertiary"]]],
    paint: { "line-color": C.roadSecondary, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.3, 16, 2.4] },
  },
  {
    id: "road-primary",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    filter: ["in", ["get", "class"], ["literal", ["primary", "trunk"]]],
    paint: { "line-color": C.roadPrimary, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 16, 3.2] },
  },
  {
    id: "road-motorway",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    filter: ["==", ["get", "class"], "motorway"],
    paint: { "line-color": C.roadMotorway, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 10, 0.9, 16, 4] },
  },
  {
    id: "building-3d",
    type: "fill-extrusion",
    source: "openmaptiles",
    "source-layer": "building",
    minzoom: 14.5,
    paint: {
      "fill-extrusion-color": C.building,
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 14.5, 0, 15.5, 0.72],
      "fill-extrusion-vertical-gradient": true,
    },
  },
  {
    id: "water-label",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "water_name",
    minzoom: 8,
    layout: {
      "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
      "text-font": ["Noto Sans Italic"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 13, 13],
      "text-letter-spacing": 0.18,
      "text-max-width": 8,
    },
    paint: { "text-color": C.labelWater, "text-halo-color": C.water, "text-halo-width": 1.2, "text-opacity": 0.9 },
  },
  {
    id: "place-label",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "place",
    filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
    maxzoom: 12.5,
    layout: {
      "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 12, 12],
      "text-transform": "uppercase",
      "text-letter-spacing": 0.14,
      "text-max-width": 8,
    },
    paint: {
      "text-color": C.label,
      "text-halo-color": C.halo,
      "text-halo-width": 1.6,
      "text-halo-blur": 0.5,
      "text-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.75, 11.5, 0.5, 12.5, 0],
    },
  },
];

const OPENMAPTILES_SOURCE = { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: OSM_ATTRIBUTION } as const;

/** The horizon fades into the background at high pitch instead of ending in a hard edge. Shared by both hero styles. */
const SKY: StyleSpecification["sky"] = {
  "sky-color": "#04070d",
  "horizon-color": "#0b1524",
  "fog-color": "#08101b",
  "sky-horizon-blend": 0.7,
  "horizon-fog-blend": 0.8,
  "fog-ground-blend": 0.85,
  "atmosphere-blend": 0,
};

/** The premium dark vector style: the original hero look, and the safety net under satellite imagery. */
export const VECTOR_STYLE: StyleSpecification = {
  version: 8,
  name: "worldseed-dark",
  glyphs: GLYPHS,
  sources: { openmaptiles: OPENMAPTILES_SOURCE },
  sky: SKY,
  layers,
};

// ---------------------------------------------------------------------------------------------------------
// Satellite
// ---------------------------------------------------------------------------------------------------------

/** See the file-level doc comment for the source, its terms and the verification date. */
export const SATELLITE_ATTRIBUTION = "Esri, Vantor, Earthstar Geographics, and the GIS User Community";
const SATELLITE_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/**
 * Dark scrim over the imagery so the extruded terrain, glowing crossings and freight trails still read as the
 * hero and real photographic clutter (parking lots, roofs, ship wakes) does not compete with them. Tunable
 * 0.45 to 0.65; raise it if a future imagery refresh comes in brighter.
 */
export const SATELLITE_SCRIM_OPACITY = 0.6;

/**
 * Config-level switch between the two hero looks. Flip to `false` to go back to the flat dark vector map (for
 * example if the owner prefers that look for the demo video's hero shot); nothing else in the map depends on
 * which one is active.
 */
export const SATELLITE_ENABLED = true;

const byId = new Map(layers.map((l) => [l.id, l]));
/** A subset of the vector style's own layers, reused as-is (same paint, same minzoom) as the road and label
 * overlay on top of the imagery. Land, water and building fills are dropped: the photograph already shows them. */
const pick = (...ids: string[]): LayerSpecification[] => ids.map((id) => byId.get(id)).filter((l): l is LayerSpecification => l !== undefined);
const satelliteOverlay = pick("road-minor", "road-secondary", "road-primary", "road-motorway", "water-label", "place-label");

const satelliteLayers: LayerSpecification[] = [
  // Shown only for an instant before the first imagery tiles paint (or outside their coverage, which is
  // effectively never for Web Mercator zoom 0-19).
  { id: "background", type: "background", paint: { "background-color": C.water } },
  {
    id: "satellite-imagery",
    type: "raster",
    source: "esri-imagery",
    paint: { "raster-opacity": 1, "raster-fade-duration": 0 },
  },
  {
    id: "satellite-scrim",
    type: "background",
    paint: { "background-color": "#04070d", "background-opacity": SATELLITE_SCRIM_OPACITY },
  },
  ...satelliteOverlay,
];

/** Esri World Imagery under a dark scrim, with the vector style's road and label overlay on top. */
export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  name: "worldseed-satellite",
  glyphs: GLYPHS,
  sources: {
    "esri-imagery": {
      type: "raster",
      tiles: [SATELLITE_TILE_URL],
      tileSize: 256,
      maxzoom: 19,
      attribution: SATELLITE_ATTRIBUTION,
    },
    openmaptiles: OPENMAPTILES_SOURCE,
  },
  sky: SKY,
  layers: satelliteLayers,
};

/**
 * The fallback when even the vector tiles cannot be fetched: land shapes from the study area's own Census
 * block groups (shoreline-clipped TIGER cartographic boundaries, already shipped in the snapshot) on the
 * water background. Roads and labels are missing; the terrain, crossings and labels the app draws itself
 * are unaffected.
 */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  name: "worldseed-dark-fallback",
  sources: {
    land: {
      type: "geojson",
      data: "/snapshot/blockgroups.geojson",
      attribution: "(c) OpenStreetMap contributors, US Census Bureau",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": C.water } },
    { id: "land", type: "fill", source: "land", paint: { "fill-color": C.landuse, "fill-opacity": 1 } },
    { id: "land-edge", type: "line", source: "land", paint: { "line-color": C.shore, "line-width": 0.6, "line-opacity": 0.5 } },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// The runtime fallback chain
// ---------------------------------------------------------------------------------------------------------

export interface MapStyleEntry {
  style: StyleSpecification;
  /** The source whose repeated failure means "this style is unusable"; null = the last resort (never falls further). */
  watchSourceId: string | null;
}

/**
 * What DeckStage actually tries, in order: the hero look first (satellite, if enabled), the dark vector map
 * next, and the Census-shapes style last. Each step only falls to the next on a real failure (a source that
 * never returned a single tile after repeated errors), never merely on slow loading.
 */
export const STYLE_CHAIN: readonly MapStyleEntry[] = SATELLITE_ENABLED
  ? [
      { style: SATELLITE_STYLE, watchSourceId: "esri-imagery" },
      { style: VECTOR_STYLE, watchSourceId: "openmaptiles" },
      { style: FALLBACK_STYLE, watchSourceId: null },
    ]
  : [
      { style: VECTOR_STYLE, watchSourceId: "openmaptiles" },
      { style: FALLBACK_STYLE, watchSourceId: null },
    ];

/** The style that loads first. Kept for callers that just want "the current hero look". */
export const MAP_STYLE: StyleSpecification = STYLE_CHAIN[0].style;

/** Ids of every layer in a style (used by tests). */
export const styleLayerIds = (s: StyleSpecification): string[] => s.layers.map((l) => l.id);

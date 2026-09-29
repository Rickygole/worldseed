import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";

/**
 * Premium dark MapLibre style on OpenFreeMap vector tiles (https://openfreemap.org, no API key, no OSM tile
 * servers). Colors are drawn from the WorldSeed tokens and stay in a blue-slate family so the data (teal,
 * amber, magenta) is the only color on screen.
 *
 *   - water is deep navy; a blurred, water-side shoreline band fakes depth (lighter shallows, darker deeps)
 *   - land is near-black slate, roads are hairlines, highways slightly brighter
 *   - labels are minimal: big places and the water names (the map's own deck layer labels the key places)
 *   - low-contrast extruded buildings appear only at high zoom, and are the first thing the quality tier drops
 *   - a sky/fog layer softens the horizon at high pitch
 *
 * Labels use OpenFreeMap's hosted glyphs. The attribution stays on (see MapStage): (c) OpenStreetMap
 * contributors, (c) OpenMapTiles, OpenFreeMap.
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

/** Layers of the live style that the quality tier can hide: buildings first. */
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

export const MAP_STYLE: StyleSpecification = {
  version: 8,
  name: "worldseed-dark",
  glyphs: GLYPHS,
  sources: {
    openmaptiles: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    },
  },
  // Atmosphere: the horizon fades into the background at high pitch instead of ending in a hard edge.
  sky: {
    "sky-color": "#04070d",
    "horizon-color": "#0b1524",
    "fog-color": "#08101b",
    "sky-horizon-blend": 0.7,
    "horizon-fog-blend": 0.8,
    "fog-ground-blend": 0.85,
    "atmosphere-blend": 0,
  },
  layers,
};

/**
 * The fallback when the tiles cannot be fetched: land shapes from the study area's own Census block groups
 * (shoreline-clipped TIGER cartographic boundaries, already shipped in the snapshot) on the water background.
 * Roads and labels are missing; the terrain, crossings and labels the app draws itself are unaffected.
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

/** Ids of every layer in a style (used by tests). */
export const styleLayerIds = (s: StyleSpecification): string[] => s.layers.map((l) => l.id);

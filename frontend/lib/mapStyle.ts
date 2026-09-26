import type { StyleSpecification } from "maplibre-gl";

/**
 * Small custom dark MapLibre style on OpenFreeMap vector tiles
 * (https://openfreemap.org, no API key, no OSM tile servers).
 * Colors are drawn from the WorldSeed tokens; everything is grayscale-blue.
 * Labels use OpenFreeMap's hosted glyphs.
 */
export const MAP_STYLE: StyleSpecification = {
  version: 8,
  name: "worldseed-dark",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    openmaptiles: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#0d131c" } },
    {
      id: "landcover",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      paint: { "fill-color": "#101822", "fill-opacity": 0.8 },
    },
    {
      id: "landuse",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      filter: ["in", ["get", "class"], ["literal", ["residential", "industrial", "commercial", "retail", "cemetery", "school", "hospital"]]],
      paint: { "fill-color": "#111a25", "fill-opacity": 0.9 },
    },
    {
      id: "park",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      filter: ["in", ["get", "class"], ["literal", ["park", "playground", "pitch", "stadium"]]],
      paint: { "fill-color": "#121d24" },
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      paint: { "fill-color": "#070b11" },
    },
    {
      id: "waterway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      paint: { "line-color": "#070b11", "line-width": 1.5 },
    },
    {
      id: "building",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 12,
      paint: { "fill-color": "#182232", "fill-opacity": 0.7 },
    },
    {
      id: "road-minor",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", ["minor", "service", "track", "path"]]],
      minzoom: 12,
      paint: { "line-color": "#1a2433", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.4, 16, 2] },
    },
    {
      id: "road-secondary",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", ["secondary", "tertiary"]]],
      paint: { "line-color": "#2a374b", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.4, 16, 3] },
    },
    {
      id: "road-primary",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", ["primary", "trunk"]]],
      paint: { "line-color": "#3a4a62", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 16, 4] },
    },
    {
      id: "road-motorway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["==", ["get", "class"], "motorway"],
      paint: { "line-color": "#51627d", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 16, 5] },
    },
    {
      id: "place-label",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: ["in", ["get", "class"], ["literal", ["city", "town", "suburb", "neighbourhood", "village", "hamlet"]]],
      layout: {
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 14, 13],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.08,
        "text-max-width": 8,
      },
      paint: {
        "text-color": "#8b98a9",
        "text-halo-color": "#0a0e14",
        "text-halo-width": 1.5,
        "text-opacity": 0.85,
      },
    },
  ],
};

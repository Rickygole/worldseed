import { describe, expect, it } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { BUILDING_LAYER_IDS, FALLBACK_STYLE, MAP_STYLE, styleLayerIds } from "../../lib/mapStyle";

describe("base map style", () => {
  it("is a valid MapLibre style", () => {
    expect(validateStyleMin(MAP_STYLE as never)).toEqual([]);
  });

  it("uses OpenFreeMap vector tiles and glyphs, never the OSM tile servers", () => {
    const json = JSON.stringify(MAP_STYLE);
    expect(json).toContain("tiles.openfreemap.org");
    expect(json).not.toMatch(/tile\.openstreetmap|a\.tile|b\.tile|c\.tile/);
  });

  it("has water, land, roads and the quiet labels, and 3D buildings the quality tier can hide", () => {
    const ids = styleLayerIds(MAP_STYLE);
    for (const id of ["background", "water", "coast", "road-motorway", "road-minor", "place-label", "water-label", "building-3d"]) expect(ids).toContain(id);
    for (const id of BUILDING_LAYER_IDS) expect(ids).toContain(id);
  });

  it("extrudes buildings only at high zoom", () => {
    const b = MAP_STYLE.layers.find((l) => l.id === "building-3d");
    expect(b?.minzoom).toBeGreaterThanOrEqual(14);
  });

  it("keeps every layer's source declared", () => {
    for (const l of MAP_STYLE.layers) if ("source" in l && l.source) expect(Object.keys(MAP_STYLE.sources)).toContain(l.source);
  });

  it("has an atmosphere so the horizon does not end in a hard edge", () => {
    expect(MAP_STYLE.sky).toBeDefined();
  });
});

describe("fallback style (tiles unavailable)", () => {
  it("is a valid MapLibre style with no network dependency beyond the snapshot", () => {
    expect(validateStyleMin(FALLBACK_STYLE as never)).toEqual([]);
    const json = JSON.stringify(FALLBACK_STYLE);
    expect(json).not.toContain("openfreemap");
    expect(json).toContain("/snapshot/blockgroups.geojson");
  });

  it("still carries the OpenStreetMap attribution", () => {
    const src = FALLBACK_STYLE.sources.land as { attribution?: string };
    expect(src.attribution).toMatch(/OpenStreetMap contributors/);
  });

  it("draws land on a water background", () => {
    expect(styleLayerIds(FALLBACK_STYLE)).toEqual(["background", "land", "land-edge"]);
  });
});

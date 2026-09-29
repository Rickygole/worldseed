import { describe, expect, it } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import {
  BUILDING_LAYER_IDS,
  FALLBACK_STYLE,
  MAP_STYLE,
  SATELLITE_ATTRIBUTION,
  SATELLITE_ENABLED,
  SATELLITE_SCRIM_OPACITY,
  SATELLITE_STYLE,
  STYLE_CHAIN,
  styleLayerIds,
  VECTOR_STYLE,
} from "../../lib/mapStyle";

describe("vector style (the dark hero look)", () => {
  it("is a valid MapLibre style", () => {
    expect(validateStyleMin(VECTOR_STYLE as never)).toEqual([]);
  });

  it("uses OpenFreeMap vector tiles and glyphs, never the OSM tile servers", () => {
    const json = JSON.stringify(VECTOR_STYLE);
    expect(json).toContain("tiles.openfreemap.org");
    expect(json).not.toMatch(/tile\.openstreetmap|a\.tile|b\.tile|c\.tile/);
  });

  it("has water, land, roads and the quiet labels, and 3D buildings the quality tier can hide", () => {
    const ids = styleLayerIds(VECTOR_STYLE);
    for (const id of ["background", "water", "coast", "road-motorway", "road-minor", "place-label", "water-label", "building-3d"]) expect(ids).toContain(id);
    for (const id of BUILDING_LAYER_IDS) expect(ids).toContain(id);
  });

  it("extrudes buildings only at high zoom", () => {
    const b = VECTOR_STYLE.layers.find((l) => l.id === "building-3d");
    expect(b?.minzoom).toBeGreaterThanOrEqual(14);
  });

  it("keeps every layer's source declared", () => {
    for (const l of VECTOR_STYLE.layers) if ("source" in l && l.source) expect(Object.keys(VECTOR_STYLE.sources)).toContain(l.source);
  });

  it("has an atmosphere so the horizon does not end in a hard edge", () => {
    expect(VECTOR_STYLE.sky).toBeDefined();
  });

  it("carries the OpenStreetMap attribution on its source", () => {
    const src = VECTOR_STYLE.sources.openmaptiles as { attribution?: string };
    expect(src.attribution).toMatch(/OpenStreetMap contributors/);
  });
});

describe("satellite style (the imagery hero look)", () => {
  it("is a valid MapLibre style", () => {
    expect(validateStyleMin(SATELLITE_STYLE as never)).toEqual([]);
  });

  it("uses the free, keyless Esri World Imagery REST tile service, z/y/x order, no API key in the URL", () => {
    const src = SATELLITE_STYLE.sources["esri-imagery"] as { type: string; tiles: string[] };
    expect(src.type).toBe("raster");
    expect(src.tiles).toHaveLength(1);
    expect(src.tiles[0]).toBe("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}");
    expect(src.tiles[0]).not.toMatch(/[?&](key|token|apikey)=/i);
  });

  it("names the exact attribution string used, and carries it on the source", () => {
    expect(SATELLITE_ATTRIBUTION).toMatch(/Esri/);
    const src = SATELLITE_STYLE.sources["esri-imagery"] as { attribution?: string };
    expect(src.attribution).toBe(SATELLITE_ATTRIBUTION);
  });

  it("keeps the OpenFreeMap vector source too, for the road and label overlay", () => {
    const src = SATELLITE_STYLE.sources.openmaptiles as { type: string; url: string };
    expect(src.type).toBe("vector");
    expect(src.url).toContain("tiles.openfreemap.org");
  });

  it("draws the imagery, then a dark scrim, then roads and labels (no land/water/building fills, which the photo already shows)", () => {
    const ids = styleLayerIds(SATELLITE_STYLE);
    const imgAt = ids.indexOf("satellite-imagery");
    const scrimAt = ids.indexOf("satellite-scrim");
    expect(imgAt).toBeGreaterThanOrEqual(0);
    expect(scrimAt).toBeGreaterThan(imgAt);
    for (const id of ["road-motorway", "road-primary", "road-secondary", "place-label", "water-label"]) expect(ids.indexOf(id)).toBeGreaterThan(scrimAt);
    for (const id of ["water", "landuse", "landcover", "park", "building-3d", "building-flat", "coast"]) expect(ids).not.toContain(id);
  });

  it("the scrim opacity is set and tunable within the documented range", () => {
    const scrim = SATELLITE_STYLE.layers.find((l) => l.id === "satellite-scrim");
    expect(scrim?.type).toBe("background");
    const paint = (scrim as { paint?: { "background-opacity"?: number } }).paint;
    expect(paint?.["background-opacity"]).toBe(SATELLITE_SCRIM_OPACITY);
    expect(SATELLITE_SCRIM_OPACITY).toBeGreaterThanOrEqual(0.4);
    expect(SATELLITE_SCRIM_OPACITY).toBeLessThanOrEqual(0.7);
  });

  it("keeps every layer's source declared", () => {
    for (const l of SATELLITE_STYLE.layers) if ("source" in l && l.source) expect(Object.keys(SATELLITE_STYLE.sources)).toContain(l.source);
  });

  it("shares the vector style's atmosphere", () => {
    expect(SATELLITE_STYLE.sky).toEqual(VECTOR_STYLE.sky);
  });
});

describe("fallback style (tiles unavailable)", () => {
  it("is a valid MapLibre style with no network dependency beyond the snapshot", () => {
    expect(validateStyleMin(FALLBACK_STYLE as never)).toEqual([]);
    const json = JSON.stringify(FALLBACK_STYLE);
    expect(json).not.toContain("openfreemap");
    expect(json).not.toContain("arcgisonline");
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

describe("the runtime fallback chain", () => {
  it("is a config-level switch: one flag decides whether satellite is first", () => {
    if (SATELLITE_ENABLED) {
      expect(STYLE_CHAIN.map((e) => e.style)).toEqual([SATELLITE_STYLE, VECTOR_STYLE, FALLBACK_STYLE]);
    } else {
      expect(STYLE_CHAIN.map((e) => e.style)).toEqual([VECTOR_STYLE, FALLBACK_STYLE]);
    }
    expect(MAP_STYLE).toBe(STYLE_CHAIN[0].style);
  });

  it("only the last style in the chain has no source to watch (never falls further)", () => {
    STYLE_CHAIN.slice(0, -1).forEach((e) => expect(e.watchSourceId).not.toBeNull());
    expect(STYLE_CHAIN[STYLE_CHAIN.length - 1].watchSourceId).toBeNull();
  });

  it("every watched source id is actually declared on its style", () => {
    for (const e of STYLE_CHAIN) if (e.watchSourceId) expect(Object.keys(e.style.sources)).toContain(e.watchSourceId);
  });
});

describe("attribution: every source declares its own, so MapLibre's own AttributionControl can show and drop credits per active style", () => {
  it("each style's sources all carry an attribution string (nothing relies on a hand-merged string)", () => {
    for (const s of [VECTOR_STYLE, SATELLITE_STYLE, FALLBACK_STYLE]) {
      for (const src of Object.values(s.sources)) expect((src as { attribution?: string }).attribution).toBeTruthy();
    }
  });

  it("only the satellite style's imagery source credits Esri; the vector and fallback styles do not", () => {
    const mentionsEsri = (s: typeof VECTOR_STYLE) => Object.values(s.sources).some((src) => (src as { attribution?: string }).attribution?.includes("Esri"));
    expect(mentionsEsri(SATELLITE_STYLE)).toBe(true);
    expect(mentionsEsri(VECTOR_STYLE)).toBe(false);
    expect(mentionsEsri(FALLBACK_STYLE)).toBe(false);
  });
});

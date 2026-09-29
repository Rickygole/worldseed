import { describe, expect, it } from "vitest";
import { dashes, drawPrefix, hatchChords, pathFractions, pathKm, smoothstep } from "../../components/map/geometry";
import { easeAlphas, labelBox, resolveLabels, type LabelDef } from "../../components/map/labelLayout";
import { buildTrailRoutes, cycleSeconds, MAX_TRAILS, MIN_PER_SEC, TRAIL_S, type TripLike } from "../../components/map/trailModel";
import { PLACES } from "../../lib/geo";

const def = (id: string, lng: number, over: Partial<LabelDef> = {}): LabelDef => ({ id, text: id.toUpperCase(), lng, lat: 0, z: 0, color: [255, 255, 255, 255], visible: 1, ...over });
// A trivial projector: x = lng * 100, y = 300.
const proj = (lng: number): [number, number] => [lng * 100, 300];
const pad = { left: 0, right: 0, top: 0, bottom: 0 };
const size = { width: 1000, height: 600 };

describe("label collision", () => {
  it("shows both labels when they are apart", () => {
    const r = resolveLabels([def("a", 2), def("b", 7)], proj, size, pad);
    expect(r.get("a")).toBe(1);
    expect(r.get("b")).toBe(1);
  });

  it("the higher-priority (earlier) label wins an overlap", () => {
    const r = resolveLabels([def("first", 5), def("second", 5.2)], proj, size, pad);
    expect(r.get("first")).toBe(1);
    expect(r.get("second")).toBe(0);
  });

  it("a hidden or invisible scene label takes no space", () => {
    const r = resolveLabels([def("gone", 5, { visible: 0 }), def("there", 5.1)], proj, size, pad);
    expect(r.get("gone")).toBe(0);
    expect(r.get("there")).toBe(1);
  });

  it("keeps labels out of the panels' safe-area padding and off the screen edge", () => {
    const withPanel = { left: 400, right: 0, top: 0, bottom: 0 };
    const r = resolveLabels([def("under", 3), def("clear", 7), def("off", 12)], proj, size, withPanel);
    expect(r.get("under")).toBe(0); // x = 300 is under a 400 px left panel
    expect(r.get("clear")).toBe(1);
    expect(r.get("off")).toBe(0); // x = 1200 is off screen
  });

  it("carries the scene's fade as the target alpha", () => {
    expect(resolveLabels([def("half", 5, { visible: 0.5 })], proj, size, pad).get("half")).toBe(0.5);
  });

  it("its box grows with the text", () => {
    const short = labelBox(100, 100, "AB");
    const long = labelBox(100, 100, "ABCDEFGHIJKLMNOP");
    expect(long.x1 - long.x0).toBeGreaterThan(short.x1 - short.x0);
  });

  it("eases alpha toward its target and reports when it has settled", () => {
    const shown = new Map<string, number>();
    const target = new Map([["a", 1]]);
    let moving = true;
    let n = 0;
    while (moving && n++ < 100) moving = easeAlphas(shown, target, 0.3);
    expect(shown.get("a")).toBe(1);
    expect(n).toBeGreaterThan(2); // never a pop
  });
});

describe("place labels", () => {
  it("has the key places, key crossings first, each once", () => {
    const ids = PLACES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["sparrows", "edgemere", "dundalk", "curtis", "hawkins", "keybridge", "fortmchenry", "harbortunnel"]) expect(ids).toContain(id);
    expect(ids[0]).toBe("keybridge");
    for (const p of PLACES) {
      expect(p.lat).toBeGreaterThan(39.1);
      expect(p.lat).toBeLessThan(39.4);
      expect(p.lng).toBeGreaterThan(-76.8);
      expect(p.lng).toBeLessThan(-76.3);
    }
  });
});

describe("geometry", () => {
  const line: [number, number][] = [
    [-76.54, 39.21],
    [-76.5, 39.23],
  ];
  it("dashes a line into short pieces that stay on it", () => {
    const d = dashes(line, 0.3, 0.2, 5);
    expect(d.length).toBeGreaterThan(3);
    for (const seg of d) for (const [x, y, z] of seg) {
      expect(z).toBe(5);
      expect(x).toBeGreaterThanOrEqual(-76.54 - 1e-9);
      expect(x).toBeLessThanOrEqual(-76.5 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(39.21 - 1e-9);
    }
  });

  it("path fractions run 0 to 1 along the length", () => {
    const p: [number, number][] = [[-76.5, 39.2], [-76.5, 39.21], [-76.5, 39.23]];
    const f = pathFractions(p);
    expect(f[0]).toBe(0);
    expect(f[2]).toBe(1);
    expect(f[1]).toBeCloseTo(1 / 3, 3);
    expect(pathKm(p)).toBeGreaterThan(3);
  });

  it("draws an option's path in from its centre, reveal by reveal", () => {
    const paths: [number, number][][] = [[[0, 0], [1, 0]], [[5, 0], [6, 0]], [[9, 0], [10, 0]]];
    expect(drawPrefix(paths, 0, 30, [0, 0])).toHaveLength(0);
    expect(drawPrefix(paths, 1, 30, [0, 0])).toHaveLength(3);
    const mid = drawPrefix(paths, 0.5, 30, [0, 0]);
    expect(mid.length).toBeGreaterThanOrEqual(1);
    expect(mid[0][0][0]).toBe(0); // nearest piece first
  });

  it("hatch chords stay inside a hex outline (3 diagonal lines)", () => {
    const ch = hatchChords("892a1008b9fffff");
    expect(ch.length).toBeGreaterThan(0);
    expect(ch.length).toBeLessThanOrEqual(3);
  });

  it("smoothstep clamps", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 5);
  });
});

describe("freight trail model: travel time is real minutes", () => {
  const coords = { lon: [0, 0.01, 0.02, 0.03], lat: [0, 0, 0, 0] };
  const trip = (id: string, kind: string, car: number, hazmat: number | null): TripLike => ({
    id,
    kind,
    classes: {
      car: { currentMinutes: car, route: { nodes: [0, 1, 2, 3] } },
      hazmat_truck: { currentMinutes: hazmat, route: hazmat === null ? undefined : { nodes: [0, 1, 2, 3] } },
    },
  });

  it("a route takes minutes / MIN_PER_SEC seconds on screen", () => {
    const r = buildTrailRoutes([trip("A", "cross_harbor", 15, 30)], coords);
    const car = r.find((x) => x.cls === "car")!;
    const hz = r.find((x) => x.cls === "hazmat_truck")!;
    expect(car.ts[car.ts.length - 1]).toBeCloseTo(15 / MIN_PER_SEC, 6);
    expect(hz.ts[hz.ts.length - 1]).toBeCloseTo(30 / MIN_PER_SEC, 6);
    expect(hz.ts[hz.ts.length - 1] / car.ts[car.ts.length - 1]).toBeCloseTo(2, 6); // twice the minutes, twice as long
    expect(car.ts[0]).toBe(0);
    for (let i = 1; i < car.ts.length; i++) expect(car.ts[i]).toBeGreaterThan(car.ts[i - 1]);
  });

  it("skips routes it does not have (unreachable) and marks same-shore controls", () => {
    const r = buildTrailRoutes([trip("A", "cross_harbor", 10, null), trip("B", "same_shore_control", 5, 5)], coords);
    expect(r.filter((x) => x.tripId === "A")).toHaveLength(1);
    expect(r.filter((x) => x.tripId === "B").every((x) => !x.crossHarbor)).toBe(true);
  });

  it("the loop is the slowest trip plus the trail and a pause", () => {
    const r = buildTrailRoutes([trip("A", "cross_harbor", 15, 38)], coords);
    expect(cycleSeconds(r)).toBeGreaterThan(38 / MIN_PER_SEC + TRAIL_S);
  });

  it("one vehicle per route: the cap is a route count, never a volume", () => {
    expect(MAX_TRAILS).toBeLessThanOrEqual(150);
    const r = buildTrailRoutes([trip("A", "cross_harbor", 15, 15)], coords);
    expect(r).toHaveLength(2); // one per class, no duplicated cars
  });
});

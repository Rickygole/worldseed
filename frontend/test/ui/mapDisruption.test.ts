import { describe, expect, it } from "vitest";
import { originPulseLayer, shockwaveLayers, travelingPulseLayer } from "../../components/map/disruption";
import { drawPrefix, tipOf, type Path3 } from "../../components/map/geometry";

const ORIGIN: [number, number] = [-76.5277, 39.2181];
const MAGENTA: [number, number, number] = [255, 61, 113];

describe("shockwaveLayers: a ring at a real distance, not a decorative animation with its own pace", () => {
  it("draws nothing before it starts, after it finishes, or with no real distance to normalize against", () => {
    expect(shockwaveLayers(ORIGIN, 0, 5, MAGENTA, true)).toHaveLength(0);
    expect(shockwaveLayers(ORIGIN, 1, 5, MAGENTA, true)).toHaveLength(0);
    expect(shockwaveLayers(ORIGIN, 0.5, 0, MAGENTA, true)).toHaveLength(0);
  });

  it("the ring's radius grows with progress: it is the real distance already driving the terrain stagger", () => {
    const radiusOf = (p: number) => {
      const [layer] = shockwaveLayers(ORIGIN, p, 10, MAGENTA, false).slice(-1);
      const path = (layer.props as { data: { path: Path3 }[] }).data[0].path;
      // Farthest ring point from the origin, in degrees (monotonic with the real km radius at this scale).
      return Math.max(...path.map(([lng, lat]) => Math.hypot(lng - ORIGIN[0], lat - ORIGIN[1])));
    };
    expect(radiusOf(0.8)).toBeGreaterThan(radiusOf(0.3));
  });

  it("the core ring is always present; the glow copy only renders when the quality tier allows it", () => {
    const withGlow = shockwaveLayers(ORIGIN, 0.5, 10, MAGENTA, true);
    const withoutGlow = shockwaveLayers(ORIGIN, 0.5, 10, MAGENTA, false);
    expect(withGlow.length).toBe(withoutGlow.length + 1);
  });
});

describe("originPulseLayer: a one-shot flash, gated by quality the same as other glow", () => {
  it("is empty when glow is off, or outside the pulse's own window", () => {
    expect(originPulseLayer(ORIGIN, 0.5, MAGENTA, false)).toHaveLength(0);
    expect(originPulseLayer(ORIGIN, 0, MAGENTA, true)).toHaveLength(0);
    expect(originPulseLayer(ORIGIN, 1, MAGENTA, true)).toHaveLength(0);
  });

  it("renders mid-flash", () => {
    expect(originPulseLayer(ORIGIN, 0.3, MAGENTA, true).length).toBeGreaterThan(0);
  });
});

describe("travelingPulseLayer: rides the leading tip of the option line as it draws in", () => {
  const paths: [number, number][][] = [
    [[0, 0], [1, 0]],
    [[1, 0], [2, 0]],
  ];
  const from: [number, number] = [0, 0];

  it("sits exactly at tipOf(drawPrefix(...)) for the same progress", () => {
    const t = 0.5;
    const revealed = drawPrefix(paths, t, 10, from);
    const layers = travelingPulseLayer(revealed, t, [45, 212, 191], true);
    expect(layers.length).toBeGreaterThan(0);
    const tip = tipOf(revealed);
    const data = (layers[0].props as { data: { p: Path3[number] }[] }).data;
    expect(data[0].p).toEqual(tip);
  });

  it("is empty once the line has fully drawn in or before it starts, and when glow is off", () => {
    expect(travelingPulseLayer(drawPrefix(paths, 1, 10, from), 1, [45, 212, 191], true)).toHaveLength(0);
    expect(travelingPulseLayer(drawPrefix(paths, 0, 10, from), 0, [45, 212, 191], true)).toHaveLength(0);
    expect(travelingPulseLayer(drawPrefix(paths, 0.5, 10, from), 0.5, [45, 212, 191], false)).toHaveLength(0);
  });
});

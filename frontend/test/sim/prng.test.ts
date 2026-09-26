import { describe, expect, it } from "vitest";
import { detExp, detLog, futureRng, normalFromUniform, Sfc32, STREAM } from "../../lib/sim/prng";

describe("portable exp / log", () => {
  it("detExp matches Math.exp to 1e-14 relative over [-40, 40]", () => {
    for (let x = -40; x <= 40; x += 0.0137) {
      const want = Math.exp(x);
      expect(Math.abs(detExp(x) - want) / want).toBeLessThan(1e-14);
    }
    expect(detExp(0)).toBe(1);
    expect(detExp(-800)).toBe(0);
    expect(detExp(800)).toBe(Infinity);
  });

  it("detLog matches Math.log to 1e-14 over 1e-300..1e300", () => {
    for (let e = -300; e <= 300; e += 3) {
      const x = 1.2345 * 10 ** e;
      const want = Math.log(x);
      expect(Math.abs(detLog(x) - want)).toBeLessThan(1e-14 * Math.max(1, Math.abs(want)));
    }
    for (let x = 1e-6; x < 5; x += 0.00731) expect(Math.abs(detLog(x) - Math.log(x))).toBeLessThan(1e-14 * Math.max(1, Math.abs(Math.log(x))));
    expect(detLog(1)).toBe(0);
    expect(detLog(0)).toBe(-Infinity);
    expect(detLog(-1)).toBeNaN();
  });
});

describe("normalFromUniform (AS241)", () => {
  it("reproduces published quantiles", () => {
    const table: [number, number][] = [
      [0.5, 0],
      [0.975, 1.959963984540054],
      [0.99, 2.3263478740408408],
      [0.999, 3.090232306167813],
      [0.9999, 3.7190164854556804],
      [0.84134474606854293, 1],
      [0.15865525393145707, -1],
      [1e-10, -6.361340902404056],
    ];
    for (const [p, z] of table) expect(normalFromUniform(p)).toBeCloseTo(z, 8);
  });

  it("is antisymmetric and monotone", () => {
    let prev = -Infinity;
    for (let p = 0.0005; p < 1; p += 0.0005) {
      const z = normalFromUniform(p);
      expect(z).toBeGreaterThan(prev);
      prev = z;
      expect(z + normalFromUniform(1 - p)).toBeCloseTo(0, 12);
    }
  });
});

describe("sfc32 / futureRng", () => {
  it("matches an independent BigInt transcription of canonical sfc32 (including the 15-round warm-up)", () => {
    const B = BigInt;
    const M = B(0xffffffff);
    const rotl = (x: bigint, k: number) => ((x << B(k)) | (x >> B(32 - k))) & M;
    function ref(seed: [number, number, number, number], count: number): number[] {
      let [a, b, c, d] = seed.map((x) => B(x) & M);
      const next = () => {
        let t = (a + b) & M;
        a = b ^ (b >> B(9));
        b = (c + (c << B(3))) & M;
        c = rotl(c, 21);
        d = (d + B(1)) & M;
        t = (t + d) & M;
        c = (c + t) & M;
        return Number(t);
      };
      for (let i = 0; i < 15; i++) next();
      return Array.from({ length: count }, next);
    }
    for (const seed of [[1, 2, 3, 4], [0, 0, 0, 0], [0xdeadbeef, 0x12345678, 0xffffffff, 7]] as [number, number, number, number][]) {
      const g = new Sfc32(...seed);
      expect(Array.from({ length: 200 }, () => g.nextU32())).toEqual(ref(seed, 200));
    }
  });

  it("futureRng is pinned (regression: any change to seeding breaks recorded tours)", () => {
    const f = futureRng(20261030, 7, STREAM.congestion);
    expect(Array.from({ length: 3 }, () => f.nextU32())).toEqual(PINNED_FUTURE);
  });

  it("streams and indices are independent and reproducible", () => {
    const a = (i: number, s: number) => {
      const r = futureRng(5, i, s);
      return [r.nextU32(), r.nextU32()];
    };
    expect(a(3, 1)).toEqual(a(3, 1));
    expect(a(3, 1)).not.toEqual(a(4, 1));
    expect(a(3, 1)).not.toEqual(a(3, 2));
    expect(a(3, 1)).not.toEqual(futureRngWithSeed(6, 3, 1));
  });

  it("uniforms are in the open interval and normals look standard", () => {
    const r = futureRng(1, 0, 1);
    let s = 0;
    let s2 = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
      const u = r.nextOpen();
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
      const z = normalFromUniform(u);
      s += z;
      s2 += z * z;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.01);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.02);
  });

  it("uses no engine-dependent math (source scan)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../../lib/sim/prng.ts", import.meta.url), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const banned of ["Math.exp", "Math.log", "Math.cos", "Math.sin", "Math.random", "Math.pow", "**"]) {
      expect(code.includes(banned), banned).toBe(false);
    }
  });
});

function futureRngWithSeed(seed: number, i: number, s: number) {
  const r = futureRng(seed, i, s);
  return [r.nextU32(), r.nextU32()];
}

// Produced by this implementation; pinned so any change to the seeding is caught.
const PINNED_FUTURE: number[] = [4002112810, 1164959614, 260435356];

/**
 * Seeded, deterministic, cross-platform random numbers.
 *
 * Cross-platform means bit-identical results on every JS engine, so nothing here calls Math.exp,
 * Math.log, Math.cos or Math.random (their last-ulp behaviour is implementation-defined). Only
 * integer ops, + - * / and Math.sqrt / Math.round / Math.floor are used, all exactly specified by
 * IEEE 754 and the ECMAScript spec.
 *
 *  - Sfc32: 128-bit state small fast counter generator.
 *  - futureRng(seed, index, stream): an independent stream per (seed, future index, stream id), so
 *    future i is the same no matter how many futures are run or which worker runs it.
 *  - detLog / detExp: portable log and exp, accurate to about 1e-15 relative.
 *  - normalFromUniform: Wichura AS241 (PPND16) inverse normal CDF, using detLog.
 */

const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const LN2 = 0.6931471805599453;
const SQRT2 = 1.4142135623730951;

const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const HI = LE ? 1 : 0;
const LO = LE ? 0 : 1;
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** Natural log for finite x > 0 (normal numbers). */
export function detLog(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return x === 0 ? -Infinity : NaN;
  f64[0] = x;
  let e = ((u32[HI] >>> 20) & 0x7ff) - 1023;
  u32[HI] = (u32[HI] & 0x000fffff) | 0x3ff00000;
  let m = f64[0]; // [1, 2)
  if (m > SQRT2) {
    m /= 2;
    e += 1;
  }
  const z = (m - 1) / (m + 1); // |z| <= 0.1716
  const z2 = z * z;
  // 2 * atanh(z) = 2 * (z + z^3/3 + z^5/5 + ...); terms through z^29 leave < 1e-23.
  let s = 1 / 29;
  for (let k = 27; k >= 1; k -= 2) s = s * z2 + 1 / k;
  return e * LN2 + 2 * z * s;
}

/** e^x for |x| <= 700. */
export function detExp(x: number): number {
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2_HI - k * LN2_LO; // |r| <= ~0.35
  // Taylor series to r^17 by Horner; the remainder is below 1e-19.
  let p = 1 / FACT[17];
  for (let i = 16; i >= 0; i--) p = p * r + 1 / FACT[i];
  // scale by 2^k, in two steps so |k| up to ~1000 stays representable
  const k1 = Math.trunc(k / 2);
  const k2 = k - k1;
  return p * pow2(k1) * pow2(k2);
}

const FACT: number[] = (() => {
  const out = [1];
  for (let i = 1; i <= 17; i++) out.push(out[i - 1] * i);
  return out;
})();

function pow2(k: number): number {
  // exact for -1022 <= k <= 1023
  u32[LO] = 0;
  u32[HI] = ((k + 1023) << 20) >>> 0;
  return f64[0];
}

// ---- inverse normal CDF, Wichura AS241 PPND16 -----------------------------------------------

const A = [3.387132872796366608, 133.14166789178437745, 1971.5909503065514427, 13731.693765509461125,
  45921.953931549871457, 67265.770927008700853, 33430.575583588128105, 2509.0809287301226727];
const B = [1, 42.313330701600911252, 687.1870074920579083, 5394.1960214247511077, 21213.794301586595867,
  39307.89580009271061, 28729.085735721942674, 5226.495278852854561];
const C = [1.4234371107496835773, 4.6303378461565452959, 5.769497221460691405, 3.6478483247632045965,
  1.2704582524523683826, 0.241780725177450611770, 0.0227238449892691845833, 0.00077454501427834140764];
const D = [1, 2.0531916266377588219, 1.6763848301838038494, 0.68976733498510000455, 0.14810397642748007459,
  0.015198666563616457, 5.475938084995344946e-4, 1.05075007164441684324e-9];
const EE = [6.657904643501103777, 5.4637849111641143699, 1.7848265399172913358, 0.29656057182850489123,
  0.026532189526576123093, 0.0012426609473880784386, 2.71155556874348757815e-5, 2.01033439929228813265e-7];
const F = [1, 0.59983220655588793769, 0.13692988092273580531, 0.014875361290850614997, 7.868691311456132591e-4,
  1.8463183175100546818e-5, 1.4215117583164458887e-7, 2.04426310338993978564e-15];

function poly(c: number[], x: number): number {
  let r = c[7];
  for (let i = 6; i >= 0; i--) r = r * x + c[i];
  return r;
}

/** Standard normal quantile for p in (0, 1). Relative accuracy about 1e-16. */
export function normalFromUniform(p: number): number {
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (q * poly(A, r)) / poly(B, r);
  }
  let r = q < 0 ? p : 1 - p;
  r = Math.sqrt(-detLog(r));
  let val: number;
  if (r <= 5) {
    r -= 1.6;
    val = poly(C, r) / poly(D, r);
  } else {
    r -= 5;
    val = poly(EE, r) / poly(F, r);
  }
  return q < 0 ? -val : val;
}

// ---- sfc32 ------------------------------------------------------------------------------------

/** 32-bit finalizer (murmur3 fmix32). */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class Sfc32 {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(a: number, b: number, c: number, d: number) {
    this.a = a | 0;
    this.b = b | 0;
    this.c = c | 0;
    this.d = d | 0;
    for (let i = 0; i < 15; i++) this.nextU32();
  }

  nextU32(): number {
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in the open interval (0, 1), 53 bits of resolution. */
  nextOpen(): number {
    const hi = this.nextU32() >>> 5; // 27 bits
    const lo = this.nextU32() >>> 6; // 26 bits
    return (hi * 67108864 + lo + 0.5) / 9007199254740992;
  }

  /** Standard normal draw. */
  nextNormal(): number {
    return normalFromUniform(this.nextOpen());
  }
}

/** Stream ids so congestion, closure and incident draws never share a sequence. */
export const STREAM = { congestion: 1, closure: 2, incidents: 3 } as const;

/**
 * Independent generator for (seed, future index, stream). `seed` may be any safe integer; both its
 * low and high 32 bits are mixed in.
 */
export function futureRng(seed: number, index: number, stream: number): Sfc32 {
  const s = Math.abs(Math.trunc(seed));
  const lo = s >>> 0;
  const hi = Math.floor(s / 4294967296) >>> 0;
  const i = index >>> 0;
  const a = fmix32(lo ^ 0x9e3779b9);
  const b = fmix32((hi + 0x85ebca6b) ^ Math.imul(i + 1, 0x27d4eb2f));
  const c = fmix32(i ^ Math.imul(stream + 1, 0x165667b1) ^ a);
  const d = fmix32(a ^ b ^ Math.imul(stream, 0xc2b2ae35) ^ 0x7f4a7c15);
  return new Sfc32(a, b, c, d);
}

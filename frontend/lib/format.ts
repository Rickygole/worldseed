/** toFixed that never prints "-0.0". */
const fixed = (v: number, d: number): string => {
  const s = v.toFixed(d);
  return Number(s) === 0 ? (0).toFixed(d) : s;
};

export const fmtMin = (v: number): string => fixed(v, 1);
export const fmtPct = (v: number): string => `${Math.round(v)}`;
export const fmtInt = (v: number): string => `${Math.round(v)}`;

export function fmtClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

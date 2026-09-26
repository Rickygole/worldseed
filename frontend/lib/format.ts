/** toFixed that never prints "-0.0". */
const fixed = (v: number, d: number): string => {
  const s = v.toFixed(d);
  return Number(s) === 0 ? (0).toFixed(d) : s;
};

export const fmtMin = (v: number): string => fixed(v, 1);
export const fmtPct = (v: number): string => `${Math.round(v)}`;
export const fmtInt = (v: number): string => `${Math.round(v)}`;

/** Percent with one decimal below 10, whole above: 1.9, 12, 0.0. */
export const fmtPct1 = (v: number): string => (Math.abs(v) < 10 ? fixed(v, 1) : `${Math.round(v)}`);

/**
 * Head counts (people, workers, jobs). Census-derived estimates do not support more than three
 * significant figures, so values of 1,000 and up are rounded to three: 19,705 -> 19,700.
 */
export function fmtCount(v: number): string {
  if (!Number.isFinite(v)) return "--";
  const a = Math.abs(v);
  if (a < 1000) return Math.round(v).toLocaleString("en-US");
  const mag = Math.pow(10, Math.floor(Math.log10(a)) - 2);
  return (Math.round(v / mag) * mag).toLocaleString("en-US");
}

/** A duration given in seconds: "3 s" below a minute, "4.6 min" above. */
export function fmtDur(s: number): { value: string; unit: "s" | "min" } {
  if (!Number.isFinite(s)) return { value: "--", unit: "s" };
  if (Math.abs(s) < 59.5) return { value: fixed(s, Math.abs(s) < 1 && s !== 0 ? 1 : 0), unit: "s" };
  return { value: fixed(s / 60, 1), unit: "min" };
}

export const fmtDurText = (s: number): string => {
  const d = fmtDur(s);
  return `${d.value} ${d.unit}`;
};

/** Signed version for delta chips: "+14 s", "-0.3 min". */
export function fmtSignedDur(s: number): string {
  const d = fmtDur(Math.abs(s));
  const sign = s > 0 ? "+" : s < 0 ? "-" : "";
  return `${sign}${d.value} ${d.unit}`;
}

export function fmtClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** "2024-03-01T00:00:00Z" -> "1 March 2024". */
export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

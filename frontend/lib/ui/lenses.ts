/**
 * What each lens looks like on the map. The simulator decides the numbers; this file only decides how a
 * number becomes a height and a color, and it uses ONE scale for the two "added time" lenses so the
 * regional lens looks exactly as small as it is next to the cross-harbor one.
 */
import type { LensId } from "../sim/contract";

export type { LensId };

export interface LensUi {
  id: LensId;
  /** Segmented-control label. */
  label: string;
  short: string;
  /** One line under the control: what height and color mean. */
  legend: string;
  hatchLegend: string | null;
}

export const LENSES: LensUi[] = [
  {
    id: "xharbor",
    label: "Cross-harbor access",
    short: "Cross-harbor",
    legend: "Height and color: minutes added to the average trip to jobs on the other shore, versus the baseline",
    hatchLegend: "over 25% fewer jobs across the harbor",
  },
  {
    id: "access",
    label: "Regional access",
    short: "Regional",
    legend: "Height and color: minutes added to the average drive to the region's main job centers (same scale as cross-harbor)",
    hatchLegend: null,
  },
  {
    id: "ems",
    label: "First response (EMS)",
    short: "EMS",
    legend: "Height and color: simulated first-response time from the nearest fire or EMS station. Edges look slower: stations outside the study area are not modeled",
    hatchLegend: "slower than the response threshold",
  },
];

export const lensUi = (id: LensId): LensUi => LENSES.find((l) => l.id === id) ?? LENSES[0];

// ---- color ramp (token colors) --------------------------------------------------------------------------

export type RGB = [number, number, number];
export const TEAL: RGB = [45, 212, 191];
export const AMBER: RGB = [245, 165, 36];
export const MAGENTA: RGB = [255, 61, 113];
/** The baseline plain: the teal token, dimmed toward the background. */
const PLAIN: RGB = [30, 110, 104];

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Added-minutes scale shared by the cross-harbor and regional lenses. Ramp stops in minutes. */
export const ADDED_STOPS = { amber: 2, magenta: 5 } as const;
/** Meters of extrusion per added minute. Tuned once for legibility at the default zoom; never per result. */
export const M_PER_ADDED_MIN = 95;

function addedColor(min: number): RGB {
  if (min <= 0.05) return PLAIN;
  if (min < ADDED_STOPS.amber) return mix(mix(PLAIN, TEAL, Math.min(1, min / 0.5)), AMBER, Math.max(0, (min - 0.5) / (ADDED_STOPS.amber - 0.5)));
  if (min < ADDED_STOPS.magenta) return mix(AMBER, MAGENTA, (min - ADDED_STOPS.amber) / (ADDED_STOPS.magenta - ADDED_STOPS.amber));
  return MAGENTA;
}

/** EMS: absolute response minutes. Floor so the plain stays low; heights are much smaller than the added scale. */
const EMS_FLOOR_MIN = 3;
const M_PER_EMS_MIN = 22;

function emsColor(min: number, thresholdMin: number): RGB {
  const soft = 0.5;
  // Within the threshold: the dim plain, brightening toward teal as the time approaches it.
  if (min <= thresholdMin - soft) return mix(PLAIN, TEAL, Math.max(0, (min - EMS_FLOOR_MIN) / (thresholdMin - soft - EMS_FLOOR_MIN)));
  if (min < thresholdMin + soft) return mix(TEAL, AMBER, (min - (thresholdMin - soft)) / (2 * soft));
  const far = thresholdMin * 1.75;
  if (min < far) return mix(AMBER, MAGENTA, (min - thresholdMin - soft) / Math.max(0.1, far - thresholdMin - soft));
  return MAGENTA;
}

/**
 * The story's "What held" scene shows the CHANGE in station time, not the absolute time: with nothing changed the
 * terrain is a flat, calm plain (an absolute-time map colors the study-area edges magenta, which reads as "worse"
 * on a scene that says "did not change"). Set with the baseline EMS minutes per hex; null returns to absolute
 * times (Expert mode). The story sets it before switching the lens, so the next encode picks it up.
 */
let emsChangeBase: Float32Array | null = null;
export function setEmsChangeBase(base: Float32Array | null): void {
  emsChangeBase = base;
}
export function emsShowsChange(): boolean {
  return emsChangeBase !== null;
}

export interface Encoded {
  elev: Float32Array;
  /** RGB triplets. */
  rgb: Float32Array;
  hatch: Uint8Array;
}

/**
 * Per-hex height (m), color and hatch for a lens field.
 *   xharbor / access: `minutes` = added minutes (xharbor already clipped at 0 by the simulator).
 *   ems:              `minutes` = response minutes.
 * `lossFrac` (xharbor only) drives the hatch; `isOrigin` 0 hexes are not scored and stay on the plain.
 */
export function encode(
  lens: LensId,
  minutes: Float32Array,
  opts: { lossFrac?: Float32Array; isOrigin?: Uint8Array; emsThresholdMin: number; hatchLoss?: number },
): Encoded {
  const n = minutes.length;
  const elev = new Float32Array(n);
  const rgb = new Float32Array(n * 3);
  const hatch = new Uint8Array(n);
  const hatchLoss = opts.hatchLoss ?? 0.25;
  for (let i = 0; i < n; i++) {
    const m = minutes[i];
    let c: RGB;
    if (lens === "ems" && emsChangeBase && emsChangeBase.length === n) {
      // Change in station time on the added-minutes scale: 0 is the flat plain, a slower hex rises and warms.
      const d = Math.max(0, m - emsChangeBase[i]);
      elev[i] = d * M_PER_ADDED_MIN;
      c = addedColor(d);
      hatch[i] = 0;
    } else if (lens === "ems") {
      elev[i] = Math.max(0, m - EMS_FLOOR_MIN) * M_PER_EMS_MIN;
      c = emsColor(m, opts.emsThresholdMin);
      hatch[i] = m > opts.emsThresholdMin ? 1 : 0;
    } else {
      const a = opts.isOrigin && opts.isOrigin[i] === 0 ? 0 : Math.max(0, m);
      elev[i] = a * M_PER_ADDED_MIN;
      c = addedColor(a);
      hatch[i] = lens === "xharbor" && opts.lossFrac && opts.lossFrac[i] > hatchLoss ? 1 : 0;
    }
    rgb[i * 3] = c[0];
    rgb[i * 3 + 1] = c[1];
    rgb[i * 3 + 2] = c[2];
  }
  return { elev, rgb, hatch };
}

/** CSS gradient for the legend, matching `addedColor` / `emsColor`. */
export function legendStops(lens: LensId, emsThresholdMin: number): { css: string; ticks: { at: number; label: string }[] } {
  const c = (x: RGB) => `rgb(${x.map(Math.round).join(" ")})`;
  if (lens === "ems") {
    const max = emsThresholdMin * 1.75;
    const pos = (m: number) => Math.round((100 * (m - EMS_FLOOR_MIN)) / (max - EMS_FLOOR_MIN));
    return {
      css: `linear-gradient(90deg, ${c(PLAIN)} 0%, ${c(TEAL)} ${pos(emsThresholdMin - 0.5)}%, ${c(AMBER)} ${pos(emsThresholdMin + 0.5)}%, ${c(MAGENTA)} 100%)`,
      ticks: [
        { at: 0, label: `${EMS_FLOOR_MIN}` },
        { at: pos(emsThresholdMin), label: `${Math.round(emsThresholdMin)}` },
        { at: 100, label: `${Math.round(max)}+ min` },
      ],
    };
  }
  const max = 7;
  const pos = (m: number) => Math.round((100 * m) / max);
  return {
    css: `linear-gradient(90deg, ${c(PLAIN)} 0%, ${c(TEAL)} ${pos(0.5)}%, ${c(AMBER)} ${pos(ADDED_STOPS.amber)}%, ${c(MAGENTA)} ${pos(ADDED_STOPS.magenta)}%, ${c(MAGENTA)} 100%)`,
    ticks: [
      { at: 0, label: "0" },
      { at: pos(ADDED_STOPS.amber), label: `+${ADDED_STOPS.amber}` },
      { at: pos(ADDED_STOPS.magenta), label: `+${ADDED_STOPS.magenta}` },
      { at: 100, label: `+${max} min` },
    ],
  };
}

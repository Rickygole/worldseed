/**
 * Label layout: pure screen-space collision and safe-area logic for the map's place labels (no GPU, no deck).
 *
 * Each label has an anchor (lng, lat, z), a priority (earlier wins) and a scene visibility (0..1 from the map
 * director). A label is shown only if its box is inside the free part of the map (outside the panels'
 * padding) and does not overlap a higher-priority label. Alpha eases toward its target so a label never pops.
 */
import type { Padding } from "../../lib/ui/mapDirector";
import type { RGBA } from "./geometry";

export interface LabelDef {
  id: string;
  text: string;
  lng: number;
  lat: number;
  /** Anchor height in meters (terrain top under the label). */
  z: number;
  color: RGBA;
  /** Scene visibility 0..1. */
  visible: number;
  /** Bold, for the crossing labels. */
  strong?: boolean;
}

export interface CameraLike {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
}

export const LABEL_SIZE = 12;
const CHAR_W = 0.68; // average glyph width / size for the uppercase sans at this weight
export const OFFSET_Y = -13; // pixels above the anchor
const MARGIN = 3;

/** Rough pixel box of a label (anchor center, text above the anchor). */
export function labelBox(x: number, y: number, text: string, size = LABEL_SIZE): { x0: number; y0: number; x1: number; y1: number } {
  const w = text.length * size * CHAR_W;
  const h = size + 4;
  const cy = y + OFFSET_Y;
  return { x0: x - w / 2 - MARGIN, x1: x + w / 2 + MARGIN, y0: cy - h / 2 - MARGIN, y1: cy + h / 2 + MARGIN };
}

const overlaps = (a: ReturnType<typeof labelBox>, b: ReturnType<typeof labelBox>) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/**
 * Target alpha per label id (0 or the scene visibility). Pure and deterministic: tested without a GPU.
 * `project` maps (lng, lat, z) to screen pixels.
 */
export function resolveLabels(
  defs: readonly LabelDef[],
  project: (lng: number, lat: number, z: number) => [number, number],
  size: { width: number; height: number },
  pad: Padding,
): Map<string, number> {
  const out = new Map<string, number>();
  const taken: ReturnType<typeof labelBox>[] = [];
  const safe = { x0: pad.left + 8, x1: size.width - pad.right - 8, y0: pad.top + 8, y1: size.height - pad.bottom - 8 };
  for (const d of defs) {
    if (d.visible <= 0.02) {
      out.set(d.id, 0);
      continue;
    }
    const [x, y] = project(d.lng, d.lat, d.z);
    const box = labelBox(x, y, d.text);
    const inside = box.x0 >= safe.x0 && box.x1 <= safe.x1 && box.y0 >= safe.y0 && box.y1 <= safe.y1 && Number.isFinite(x) && Number.isFinite(y);
    if (!inside || taken.some((t) => overlaps(t, box))) {
      out.set(d.id, 0);
      continue;
    }
    taken.push(box);
    out.set(d.id, d.visible);
  }
  return out;
}

/** Eases displayed alphas toward targets in place. Returns true while anything is still moving. */
export function easeAlphas(shown: Map<string, number>, target: Map<string, number>, k: number): boolean {
  let moving = false;
  for (const [id, t] of target) {
    const cur = shown.get(id) ?? 0;
    if (cur === t) continue;
    const next = Math.abs(t - cur) < 0.02 ? t : cur + (t - cur) * k;
    shown.set(id, next);
    if (next !== t) moving = true;
  }
  return moving;
}


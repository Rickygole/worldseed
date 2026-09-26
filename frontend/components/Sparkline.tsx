"use client";

import { line, scaleLinear } from "d3";

interface Props {
  values: number[];
  width?: number;
  height?: number;
}

/** Tiny session-history sparkline. Grayscale; the delta chip carries meaning. */
export default function Sparkline({ values, width = 72, height = 24 }: Props) {
  const pts = values.length === 1 ? [values[0], values[0]] : values;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const pad = 3;
  const x = scaleLinear().domain([0, pts.length - 1]).range([pad, width - pad]);
  const y = scaleLinear()
    .domain([lo, hi === lo ? lo + 1 : hi])
    .range([height - pad, pad]);
  const d = line<number>()
    .x((_, i) => x(i))
    .y((v) => y(v))(pts);
  const lastX = x(pts.length - 1);
  const lastY = y(pts[pts.length - 1]);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Session history">
      <path d={d ?? ""} fill="none" stroke="var(--color-muted)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill="var(--color-text)" />
    </svg>
  );
}

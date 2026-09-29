"use client";

import { useState } from "react";
import { line, scaleLinear } from "d3";
import { sparkTail } from "@/lib/ui/ribbon";

interface Props {
  values: number[];
  width?: number;
  height?: number;
  /** The current point's color: the tile's status tone. The line itself stays muted gray. */
  accent?: string;
  /** Formats one value for the hover readout and the accessible label. */
  format?: (v: number) => string;
  /** What the values are, for the accessible label ("People affected"). */
  label?: string;
}

/**
 * Tiny session-history sparkline: the last twelve runs as a muted 2 px line, the current value as an 8 px dot in
 * the tile's status color with a 2 px surface ring. Hover (or pointer drag) reads off any run.
 */
export default function Sparkline({ values, width = 64, height = 20, accent = "var(--color-text)", format = (v) => `${v}`, label = "Session history" }: Props) {
  const [hi, setHi] = useState<number | null>(null);
  const tail = sparkTail(values);
  const pts = tail.length === 1 ? [tail[0], tail[0]] : tail;
  const lo = Math.min(...pts);
  const top = Math.max(...pts);
  const pad = 5;
  const x = scaleLinear().domain([0, pts.length - 1]).range([pad, width - pad]);
  const y = scaleLinear()
    .domain([lo, top === lo ? lo + 1 : top])
    .range([height - pad, pad]);
  const d = line<number>()
    .x((_, i) => x(i))
    .y((v) => y(v))(pts);
  const last = pts.length - 1;
  const n = tail.length;
  return (
    <span className="relative block" onPointerLeave={() => setHi(null)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label}, last ${n} runs: from ${format(tail[0])} to ${format(tail[n - 1])}`}
        className="block overflow-visible"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(x.invert(((e.clientX - r.left) * width) / r.width));
          setHi(Math.min(last, Math.max(0, i)));
        }}
      >
        <path d={d ?? ""} fill="none" stroke="var(--color-muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.7} />
        {hi !== null && hi !== last && <circle cx={x(hi)} cy={y(pts[hi])} r={3} fill="var(--color-text-2)" stroke="var(--color-surface)" strokeWidth={2} />}
        <circle cx={x(last)} cy={y(pts[last])} r={4} fill={accent} stroke="var(--color-surface)" strokeWidth={2} />
      </svg>
      {hi !== null && (
        <span role="tooltip" className="pop num pointer-events-none absolute bottom-full right-0 z-20 mb-1.5 whitespace-nowrap px-2 py-1 text-xs text-text">
          <span className="text-muted">{hi === last ? "Now" : `Run ${hi + 1} of ${n}`}</span> {format(tail[Math.min(hi, n - 1)])}
        </span>
      )}
    </span>
  );
}

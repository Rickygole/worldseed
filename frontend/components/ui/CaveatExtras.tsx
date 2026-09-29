"use client";

import { ExternalLink } from "lucide-react";
import { ridge } from "@/lib/ui/futuresMath";
import type { CaveatVisual, SourceRef } from "@/lib/ui/storyCopy";

const host = (href: string) => {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
};

/** A real source as a clickable card: kind, title, publisher and date, domain. Same card language as the Expert evidence panel. */
export function SourceCards({ sources }: { sources: SourceRef[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {sources.map((s) => (
        <li key={s.href}>
          <a href={s.href} target="_blank" rel="noreferrer" className="card group block p-3 transition-colors duration-150 hover:bg-[rgb(148_163_184/0.12)]">
            <span className="block text-2xs uppercase tracking-[0.08em] text-muted">{s.kind}</span>
            <span className="mt-1 flex items-start justify-between gap-2 text-sm font-medium leading-5 text-text">
              {s.title}
              <ExternalLink size={13} className="mt-0.5 shrink-0 text-muted group-hover:text-text" aria-hidden />
            </span>
            <span className="mt-1 block text-xs text-text-2">
              {s.publisher}
              {s.date ? ` · ${s.date}` : ""}
            </span>
            <span className="num mt-0.5 block text-xs text-muted">{host(s.href)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Where the on-screen count sits inside the tested range, on a log scale (the range spans an order of magnitude). */
function RangeBar({ v }: { v: Extract<CaveatVisual, { kind: "range" }> }) {
  const at = (x: number) => (100 * (Math.log(x) - Math.log(v.lo))) / (Math.log(v.hi) - Math.log(v.lo));
  const p = Math.min(100, Math.max(0, at(Math.max(1, v.value))));
  return (
    <figure className="mt-3" aria-label={`${v.valueLabel}, inside a tested range from ${v.loLabel} to ${v.hiLabel}`}>
      <div className="relative h-6" aria-hidden>
        <div className="absolute inset-x-0 top-[11px] h-0.5 rounded-full bg-line-strong" />
        <div className="absolute left-0 top-[7px] h-2.5 w-px bg-line-strong" />
        <div className="absolute right-0 top-[7px] h-2.5 w-px bg-line-strong" />
        {/* The value on screen: a head count of people affected, so the critical tone of the scene's number. */}
        <div className="absolute top-[6px] size-3 -translate-x-1/2 rounded-full bg-critical ring-2 ring-[var(--color-bg)]" style={{ left: `${p}%` }} />
      </div>
      <figcaption className="flex justify-between text-2xs text-muted">
        <span>{v.loLabel}</span>
        <span className="text-text-2">{v.valueLabel}</span>
        <span>{v.hiLabel}</span>
      </figcaption>
    </figure>
  );
}

/** The spread of a finalist's change across the what-if runs (futuresMath ridge), dashed line at no change. */
function Ridge({ v }: { v: Extract<CaveatVisual, { kind: "ridge" }> }) {
  const lo = Math.min(0, v.values[0]);
  const hi = Math.max(0, v.values[v.values.length - 1]);
  const pad = Math.max(1, (hi - lo) * 0.08);
  const [a, b] = [lo - pad, hi + pad];
  const w = 280;
  const h = 56;
  const pts = ridge(v.values, a, b, 36);
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const d = `M0,${h} ` + pts.map((q, i) => `L${x(i).toFixed(1)},${(h - 2 - q * (h - 8)).toFixed(1)}`).join(" ") + ` L${w},${h} Z`;
  const zx = ((0 - a) / (b - a)) * w;
  const fmt = (s: number) => `${s > 0 ? "+" : s < 0 ? "-" : ""}${Math.round(Math.abs(s))} s`;
  return (
    <figure className="mt-3">
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Spread across ${v.values.length} what-if runs, from ${fmt(v.values[0])} to ${fmt(v.values[v.values.length - 1])}`}>
        <path d={d} fill="var(--color-future)" fillOpacity={0.1} stroke="var(--color-future)" strokeWidth={2} strokeLinejoin="round" />
        <line x1={zx} x2={zx} y1={0} y2={h} stroke="var(--color-text-2)" strokeDasharray="3 3" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-2xs text-muted">
        <span>{fmt(lo)}</span>
        <span>{v.caption}</span>
        <span>{fmt(hi)}</span>
      </figcaption>
    </figure>
  );
}

export function CaveatVisualView({ v }: { v: CaveatVisual }) {
  return v.kind === "range" ? <RangeBar v={v} /> : <Ridge v={v} />;
}

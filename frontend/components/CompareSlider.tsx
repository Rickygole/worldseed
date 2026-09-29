"use client";

import { useRef } from "react";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { useSearch } from "@/lib/ui/search";
import { fmtMin } from "@/lib/format";
import { fmtAbout } from "@/lib/ui/methodology";
import { deltaTone, ribbonValues, type RibbonValues } from "@/lib/ui/ribbon";

/** The compare stat group: the same three numbers on both sides, named as the ribbon names them. */
const STATS: { key: keyof RibbonValues; label: string; value: (v: RibbonValues) => number; fmt: (x: number) => string; unit: string; flat: number; prefix?: string }[] = [
  { key: "xhPeople", label: "People affected", value: (v) => v.xhPeople, fmt: fmtAbout, unit: "", flat: 0.5, prefix: "about" },
  { key: "xhTime", label: "Trip across the river", value: (v) => v.xhTime / 60, fmt: fmtMin, unit: "min", flat: 0.05 },
  { key: "ems", label: "Station time", value: (v) => v.ems / 60, fmt: fmtMin, unit: "min", flat: 1 / 60 },
];

/**
 * One side's numbers (rule of the ribbon tiles: label, proportional value, signed delta). Before and after are told
 * apart by position and the "Now" / "With" labels, not by color; only the delta takes a status tone.
 */
function StatGroup({ v, ref0, align }: { v: RibbonValues | null; ref0?: RibbonValues | null; align: "left" | "right" }) {
  return (
    <dl className={`pop mt-2 w-48 space-y-1.5 px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}>
      {STATS.map((s) => {
        const x = v ? s.value(v) : null;
        const d = x !== null && ref0 ? x - s.value(ref0) : null;
        const tone = d === null ? "flat" : deltaTone(d, s.flat);
        const color = tone === "worse" ? "var(--color-critical)" : tone === "better" ? "var(--color-ok)" : "var(--color-muted)";
        const Arrow = d !== null && d < 0 ? ArrowDown : ArrowUp;
        return (
          <div key={s.key}>
            <dt className="text-xs text-muted">{s.label}</dt>
            <dd className={`flex items-baseline gap-1 ${align === "right" ? "justify-end" : ""}`}>
              {x === null ? (
                <span className="skeleton inline-block h-5 w-16" aria-hidden />
              ) : (
                <>
                  {s.prefix && x >= 100 && <span className="text-xs text-muted">{s.prefix}</span>}
                  <span className="display text-base font-medium text-text" style={{ fontVariantNumeric: "proportional-nums", fontFeatureSettings: '"pnum" 1' }}>
                    {s.fmt(x)}
                  </span>
                  {s.unit && <span className="text-xs text-muted">{s.unit}</span>}
                  {d !== null && (
                    <span className="num ml-1 inline-flex items-center gap-0.5 text-xs" style={{ color }}>
                      {tone === "flat" ? (
                        "no change"
                      ) : (
                        <>
                          <Arrow size={11} aria-hidden />
                          {d > 0 ? "+" : "-"}
                          {s.fmt(Math.abs(d))}
                          {s.unit ? ` ${s.unit}` : ""}
                          <span className="sr-only"> versus now, {tone}</span>
                        </>
                      )}
                    </span>
                  )}
                </>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Split-screen swipe handle for Compare. Left of the line: the world on screen; right: the same world with
 * the option. Drag, or use the arrow keys (Home/End for the edges). Escape closes.
 */
export default function CompareSlider() {
  const compare = useSearch((s) => s.compare);
  const setSplit = useSearch((s) => s.setSplit);
  const close = useSearch((s) => s.setCompare);
  const current = useApp((s) => s.current);
  const ref = useRef<HTMLDivElement>(null);
  if (!compare) return null;
  const pct = compare.split * 100;
  const now = ribbonValues(current)?.v ?? null;
  const withV = compare.status === "ready" ? (ribbonValues(compare.out ?? null)?.v ?? null) : null;
  // The stat groups ride with the line; near an edge there is no room, so only the labels stay.
  const roomy = pct > 22 && pct < 78;

  const fromPointer = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (box) setSplit((clientX - box.left) / box.width);
  };

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-[5]">
      <div className="absolute inset-y-0 w-px bg-text/80" style={{ left: `${pct}%` }} aria-hidden />
      <section aria-label="Now" className="absolute top-[152px] flex -translate-x-full flex-col items-end pr-3" style={{ left: `${pct}%` }}>
        <span className="panel px-2 py-1 text-xs font-medium text-text">Now</span>
        {roomy && <StatGroup v={now} align="right" />}
      </section>
      <section aria-label={`With ${compare.bundleId}`} className="absolute top-[152px] flex flex-col items-start pl-3" style={{ left: `${pct}%` }}>
        <span className="panel px-2 py-1 text-xs font-medium text-text">
          With <span className="num">{compare.bundleId}</span>{" "}
          <span className="font-normal text-muted">{compare.status === "loading" ? "(computing...)" : compare.status === "error" ? "(failed)" : ""}</span>
        </span>
        {roomy && compare.status !== "error" && <StatGroup v={withV} ref0={now} align="left" />}
      </section>
      <button
        role="slider"
        aria-label={`Compare split: now on the left, with ${compare.bundleId} on the right`}
        aria-valuemin={5}
        aria-valuemax={95}
        aria-valuenow={Math.round(pct)}
        className="panel pointer-events-auto absolute top-1/2 flex h-12 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center"
        style={{ left: `${pct}%` }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          fromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) fromPointer(e.clientX);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          if (e.key === "ArrowLeft") setSplit(compare.split - step);
          else if (e.key === "ArrowRight") setSplit(compare.split + step);
          else if (e.key === "Home") setSplit(0.05);
          else if (e.key === "End") setSplit(0.95);
          else if (e.key === "Escape") void close(null);
          else return;
          e.preventDefault();
        }}
      >
        <GripVertical size={14} aria-hidden />
      </button>
      <button className="panel pointer-events-auto absolute right-[392px] top-[152px] btn-icon" aria-label="Close compare" onClick={() => void close(null)}>
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

"use client";

import { useApp, simInfo } from "@/lib/store";
import { legendStops, lensUi } from "@/lib/ui/lenses";

const TITLE: Record<string, string> = {
  xharbor: "Minutes added, trips to jobs across the river",
  access: "Minutes added, drive to the region's job centers",
  ems: "Minutes to the nearest station",
};

/** Compact legend for the terrain: what height and color mean, the ramp, and the hatch key. Mirrors lib/ui/lenses.ts. */
export default function MapLegend({ className = "" }: { className?: string }) {
  const lens = useApp((s) => s.lens);
  const busy = useApp((s) => s.busy);
  const view = useApp((s) => s.view);
  const thr = (simInfo()?.params.emsThresholdS ?? 480) / 60;
  const stops = legendStops(lens, thr);
  const ui = lensUi(lens);
  const pending = busy || (view?.detail?.lens !== undefined && view.detail.lens !== lens);
  return (
    <figure className={`w-full max-w-[248px] ${className}`} aria-label={`Map legend: ${ui.legend}`}>
      <figcaption className="flex items-center justify-between gap-2 text-xs text-text-2">
        <span className="truncate" title={ui.legend}>
          {TITLE[lens] ?? ui.label}
        </span>
        {pending && <span className="shrink-0 text-muted">updating</span>}
      </figcaption>
      <div className="relative mt-2 pb-6" aria-hidden>
        <div className="h-1.5 rounded-full" style={{ background: stops.css }} />
        {stops.ticks.map((t) => (
          <span
            key={t.at}
            className="num absolute top-3 whitespace-nowrap text-2xs text-muted"
            style={{ left: `${t.at}%`, transform: t.at === 0 ? "none" : t.at === 100 ? "translateX(-100%)" : "translateX(-50%)" }}
          >
            {t.label}
          </span>
        ))}
      </div>
      {ui.hatchLegend && (
        <p className="mt-1 flex items-center gap-2 text-2xs text-muted">
          <span className="hatch-critical inline-block size-2.5 shrink-0 rounded-[2px]" aria-hidden />
          Hatched: {lens === "ems" ? `slower than ${Math.round(thr)} min` : ui.hatchLegend}
        </p>
      )}
    </figure>
  );
}

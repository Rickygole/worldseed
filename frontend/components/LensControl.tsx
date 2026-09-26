"use client";

import { useRef } from "react";
import { useApp, simInfo } from "@/lib/store";
import { LENSES, legendStops, lensUi } from "@/lib/ui/lenses";

/**
 * Segmented control (radio group) for the terrain lens, with the legend for the active lens underneath.
 * Arrow keys move between options, as a radio group should.
 */
export default function LensControl() {
  const lens = useApp((s) => s.lens);
  const setLens = useApp((s) => s.setLens);
  const busy = useApp((s) => s.busy);
  const view = useApp((s) => s.view);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const ui = lensUi(lens);
  const thr = (simInfo()?.params.emsThresholdS ?? 480) / 60;
  const stops = legendStops(lens, thr);
  const pending = view?.detail?.lens !== undefined && view.detail.lens !== lens;

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (i + d + LENSES.length) % LENSES.length;
    refs.current[next]?.focus();
    void setLens(LENSES[next].id);
  };

  return (
    <div className="panel pointer-events-auto w-[600px] max-w-full p-2">
      <div role="radiogroup" aria-label="Map lens" className="grid grid-cols-3 gap-1 rounded-ctl bg-bg/60 p-1">
        {LENSES.map((l, i) => {
          const on = l.id === lens;
          return (
            <button
              key={l.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onKeyDown={(e) => onKey(e, i)}
              onClick={() => void setLens(l.id)}
              className="h-8 rounded-[6px] px-3 text-sm font-medium transition-colors duration-150"
              style={
                on
                  ? { background: "var(--color-surface-2)", color: "var(--color-text)", boxShadow: "inset 0 0 0 1px var(--color-border)" }
                  : { color: "var(--color-muted)" }
              }
            >
              {l.label}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-4 px-1" aria-live="polite">
        <p className="min-w-0 flex-1 text-xs leading-4 text-muted">
          {ui.legend}
          {(pending || busy) && <span className="ml-1 text-text">· computing</span>}
        </p>
      </div>
      <div className="mt-2 flex items-center gap-4 px-1">
        <div className="relative w-[240px] shrink-0 pb-4" aria-hidden>
          <div className="h-2 rounded-full" style={{ background: stops.css }} />
          {stops.ticks.map((t) => (
            <span
              key={t.at}
              className="num absolute top-3 whitespace-nowrap text-xs text-muted"
              style={{ left: `${t.at}%`, transform: t.at === 0 ? "none" : t.at === 100 ? "translateX(-100%)" : "translateX(-50%)" }}
            >
              {t.label}
            </span>
          ))}
        </div>
        {ui.hatchLegend && (
          <span className="flex min-w-0 items-center gap-2 pb-4 text-xs text-muted">
            <span className="hatch-critical inline-block size-3 shrink-0 rounded-sm" aria-hidden />
            <span className="truncate">Hatched: {lens === "ems" ? `slower than ${Math.round(thr)} min` : ui.hatchLegend}</span>
          </span>
        )}
      </div>
    </div>
  );
}

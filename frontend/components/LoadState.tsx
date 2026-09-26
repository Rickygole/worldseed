"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useApp } from "@/lib/store";

/** Loading and error states over the map. The basemap stays visible behind them; nothing reflows. */
export default function LoadState() {
  const status = useApp((s) => s.status);
  const stage = useApp((s) => s.loadStage);
  const err = useApp((s) => s.loadError);
  const retry = useApp((s) => s.retry);

  if (status === "loading" || status === "idle") {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <div className="panel w-[360px] p-4" role="status" aria-live="polite">
          <p className="text-sm font-medium">{stage === "baseline" ? "Computing the baseline" : "Loading the Key Bridge region"}</p>
          <p className="mt-1 text-xs text-muted">
            {stage === "baseline"
              ? "Running every lens on the road network, in your browser."
              : "Road network, hexagons and Census estimates. Downloaded once, then cached."}
          </p>
          <div className="progress-indeterminate mt-4" aria-hidden />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center">
        <div className="panel w-[440px] p-4" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium">{err?.title ?? "The simulator could not start."}</p>
              {err?.detail && <p className="num mt-2 break-words text-xs text-muted">{err.detail}</p>}
              <button className="btn mt-4" onClick={() => void retry()} data-autofocus>
                <RotateCcw size={14} aria-hidden />
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

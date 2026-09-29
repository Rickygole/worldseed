"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Eye } from "lucide-react";
import { useApp } from "@/lib/store";
import { useSearch } from "@/lib/ui/search";
import { median, seriesColor } from "@/lib/ui/futuresMath";
import { fmtMetricDelta } from "../planner/labels";

/**
 * Expert mode: the finalists side by side over the map, one click to preview each on the terrain. Every figure
 * is the search's (chance of meeting the goal; median change versus doing nothing). Options are hypothetical.
 */
export default function ComparisonStrip() {
  const m = useSearch((s) => s.m);
  const bundles = useSearch((s) => s.bundles);
  const refs = useSearch((s) => s.refs);
  const preview = useSearch((s) => s.preview);
  const setPreview = useSearch((s) => s.setPreview);
  const busy = useApp((s) => s.busy);
  const reduced = !!useReducedMotion();
  const finalists = m?.phase === "finalists" ? m.finalists : [];
  const metric = m?.mission?.goal.metric ?? "p90";
  const freight = m?.mission?.lens === "freight";
  const show = finalists.length > 0 && !freight;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="group"
          aria-label="Compare finalists on the map (hypothetical options)"
          className="panel pointer-events-auto flex items-stretch gap-1 !rounded-full p-1"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
        >
          <span className="flex items-center gap-2 px-3 text-xs text-muted">
            <Eye size={14} aria-hidden /> Preview
          </span>
          {refs && (
            <span className="flex flex-col justify-center whitespace-nowrap rounded-full px-3 py-1 text-left">
              <span className="text-xs text-text-2">Doing nothing</span>
              <span className="num text-xs text-muted">{refs.nothingPGoal === null ? "--" : `${Math.round(refs.nothingPGoal * 100)}%`} chance</span>
            </span>
          )}
          {finalists.map((f, i) => {
            const b = bundles[f.bundleId];
            const on = preview?.bundleId === f.bundleId;
            const pGoal = b?.pGoal == null ? "--" : `${Math.round(b.pGoal * 100)}%`;
            const med = b ? fmtMetricDelta(metric, median(b.vsNothing)) : "--";
            return (
              <button
                key={f.bundleId}
                type="button"
                aria-pressed={on}
                disabled={!b || busy}
                onClick={() => void setPreview(f.bundleId)}
                aria-label={`Preview finalist ${i + 1}, ${f.bundleId}, cost tier ${f.costTier}: ${pGoal} chance of meeting the goal, median change ${med}`}
                className={`flex flex-col justify-center rounded-full px-4 py-1 text-left transition-colors duration-150 ${on ? "bg-[rgb(167_139_250/0.18)] shadow-[inset_0_0_0_1px_rgb(167_139_250/0.6)]" : "hover:bg-[rgb(148_163_184/0.1)]"}`}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-text">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: seriesColor(i) ?? "var(--color-faint)" }} aria-hidden />
                  <span className="num">
                    #{i + 1} {f.bundleId}
                  </span>
                  <span className="num font-normal text-muted">{f.costTier}</span>
                </span>
                <span className="num whitespace-nowrap text-xs text-muted">
                  <span className="text-text-2">{pGoal}</span> chance · <span className="text-text-2">{med}</span>
                </span>
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

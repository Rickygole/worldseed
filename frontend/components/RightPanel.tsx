"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import { useSearch } from "@/lib/ui/search";
import MissionPanel from "./planner/MissionPanel";
import DecisionLog from "./planner/DecisionLog";
import Collapsible from "./ui/Collapsible";

// The charts (d3) load after the shell; they are empty until a search runs anyway.
const FuturesPanel = dynamic(() => import("./planner/FuturesPanel"), { ssr: false, loading: () => <div className="h-24" /> });
const FinalistCards = dynamic(() => import("./planner/FinalistCards"), { ssr: false });

const STEPS = ["Goal", "Search", "Finalists", "Apply"] as const;
type Step = 0 | 1 | 2 | 3;

function stepOf(phase: string): Step {
  if (phase === "planning" || phase === "evaluating" || phase === "critiquing" || phase === "finalizing") return 1;
  if (phase === "finalists") return 2;
  if (phase === "applying" || phase === "applied") return 3;
  return 0;
}

/**
 * Expert mode, right: the planner, one step at a time (goal, search, finalists, apply). The step follows the
 * search; earlier steps can be reopened from the stepper. The decision log folds underneath.
 */
export default function RightPanel() {
  const phase = useSearch((s) => s.m?.phase ?? "idle");
  const reduced = !!useReducedMotion();
  const live = stepOf(phase);
  const [view, setView] = useState<{ step: Step; at: Step } | null>(null);
  // A manual choice holds until the search moves to another step.
  const step = view && view.at === live ? view.step : live;

  return (
    <aside aria-label="Planner" className="panel flex h-full flex-col overflow-hidden" style={{ width: "var(--ws-right)" }}>
      <div className="shrink-0 px-5 pb-3 pt-4">
        <p className="label mb-3">Planner</p>
        <ol className="grid grid-cols-4 gap-1" aria-label="Planner steps">
          {STEPS.map((label, i) => {
            const done = i < live;
            const on = i === step;
            const reachable = i <= live;
            return (
              <li key={label}>
                <button
                  type="button"
                  disabled={!reachable}
                  aria-current={on ? "step" : undefined}
                  onClick={() => setView({ step: i as Step, at: live })}
                  className="group flex w-full flex-col gap-1.5 text-left disabled:cursor-default"
                >
                  <span className="h-0.5 w-full rounded-full transition-colors duration-200" style={{ background: on ? "var(--color-text)" : done ? "var(--color-text-2)" : "var(--color-border)" }} aria-hidden />
                  <span className={`flex items-center gap-1 text-xs ${on ? "font-medium text-text" : reachable ? "text-text-2 group-hover:text-text" : "text-faint"}`}>
                    {done && <Check size={11} aria-hidden />}
                    {label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ opacity: 0, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } }}
          >
            {step === 0 && <MissionPanel />}
            {step === 1 && <FuturesPanel />}
            {step === 2 && (
              <>
                <FinalistCards />
                <Collapsible title="Futures fan" className="mt-2 border-t border-border" headerClassName="py-3">
                  <FuturesPanel />
                </Collapsible>
              </>
            )}
            {step === 3 && (
              <>
                <MissionPanel />
                <div className="mt-4">
                  <FinalistCards />
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="shrink-0 border-t border-border px-5">
        <DecisionLog />
      </div>
    </aside>
  );
}

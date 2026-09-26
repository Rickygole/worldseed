"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useApp } from "@/lib/store";
import { useDialog } from "@/lib/ui/useDialog";

export const INTRO_SEEN_KEY = "worldseed.intro.seen";

interface Step {
  headline?: string;
  lead?: string;
  body?: string;
}

const STEPS: Step[] = [
  { lead: "March 26, 2024.", headline: "The Francis Scott Key Bridge fell into the Patapsco River." },
  {
    body: "It carried I-695 across the mouth of Baltimore's harbor. WorldSeed asks a planning question: when a link like that is gone, who is affected, and by how much?",
  },
  {
    body: "It models the region's roads as they were on March 1, 2024 (OpenStreetMap), with Census population and jobs data. Remove the bridge, and every number is recomputed on that network, in your browser.",
  },
  {
    body: "The answer is uneven. Across the whole region the change is small; for some neighborhoods it is not. WorldSeed shows both, side by side, with every assumption open to inspection.",
  },
  { headline: "In memory of the six construction workers who died.", body: "Planning simulation, not dispatch." },
];

export default function IntroOverlay() {
  const open = useApp((s) => s.introOpen);
  const setOpen = useApp((s) => s.setIntroOpen);

  // Show once per browser session.
  useEffect(() => {
    try {
      if (!sessionStorage.getItem(INTRO_SEEN_KEY)) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, [setOpen]);

  const close = () => {
    try {
      sessionStorage.setItem(INTRO_SEEN_KEY, "1");
    } catch {}
    setOpen(false);
  };

  return <AnimatePresence>{open && <IntroContent key="intro" onClose={close} />}</AnimatePresence>;
}

function IntroContent({ onClose }: { onClose: () => void }) {
  const reduced = !!useReducedMotion();
  const [step, setStep] = useState(0);
  const ref = useDialog<HTMLDivElement>(true, onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setStep((s) => Math.min(STEPS.length - 1, s + 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  return (
    <AnimatePresence>
      {(
        <motion.div
          key="intro"
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label="Introduction"
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgb(10 14 20 / 0.88)", backdropFilter: "blur(4px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          <button className="btn absolute right-6 top-6 h-8 px-3" onClick={onClose}>
            Skip intro
          </button>

          <div className="w-full max-w-[720px]">
            <div className="min-h-[220px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 0 }}
                  transition={{ duration: 0.45 }}
                >
                  {step === 0 && (
                    <p className="text-4xl font-medium leading-[1.15]" data-testid="intro-line">
                      <span className="num text-muted">{s.lead}</span> {s.headline}
                    </p>
                  )}
                  {step !== 0 && s.headline && <p className="text-4xl font-medium leading-[1.15]">{s.headline}</p>}
                  {step !== 0 && s.body && (
                    <p className={`${s.headline ? "mt-4 text-base text-muted" : "text-xl leading-8"}`}>{s.body}</p>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="mt-8 flex items-center justify-between">
              <div className="flex items-center gap-2" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
                {STEPS.map((_, i) => (
                  <span
                    key={i}
                    className="h-1 rounded-full"
                    style={{
                      width: i === step ? 24 : 8,
                      background: i === step ? "var(--color-text)" : "var(--color-border)",
                      transition: "width 200ms",
                    }}
                    aria-hidden
                  />
                ))}
                <span className="num ml-2 text-xs text-muted">
                  {step + 1} / {STEPS.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn" onClick={() => setStep((v) => Math.max(0, v - 1))} disabled={step === 0}>
                  Back
                </button>
                <button className="btn" data-autofocus onClick={() => (last ? onClose() : setStep((v) => v + 1))}>
                  {last ? "Enter the map" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

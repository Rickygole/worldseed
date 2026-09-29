"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useApp } from "@/lib/store";
import { goScene, nextScene, prevScene, stepIndex, STORY_STEPS } from "@/lib/ui/story";
import { STEPS, T } from "@/lib/ui/storyCopy";

/**
 * The story bar: six scenes, Back and Next. The current scene expands to show its label (a layout animation);
 * the others are numbers. Left/Right arrows work anywhere on the page (see StoryLayer).
 */
export default function StoryBar({ variant = "header" }: { variant?: "header" | "sheet" }) {
  const scene = useApp((s) => s.scene);
  const reduced = !!useReducedMotion();
  const cur = stepIndex(scene);
  const prev = prevScene();
  const next = nextScene();
  const sheet = variant === "sheet";

  return (
    <nav aria-label="Guided story" className="flex items-center gap-1">
      <button type="button" className="btn-icon shrink-0" aria-label={`${T.common.back} (Left arrow)`} disabled={!prev} onClick={() => prev && void goScene(prev)}>
        <ChevronLeft size={18} aria-hidden />
      </button>
      <ol className={`flex items-center ${sheet ? "gap-1.5" : "gap-1"}`}>
        {STORY_STEPS.map((id, i) => {
          const on = i === cur;
          const done = cur !== null && i < cur;
          const label = STEPS[id];
          return (
            <li key={id}>
              <motion.button
                layout={!reduced}
                type="button"
                onClick={() => void goScene(id)}
                aria-current={on ? "step" : undefined}
                aria-label={`Scene ${i + 1} of ${STORY_STEPS.length}: ${label}`}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className={
                  sheet
                    ? `block h-1.5 rounded-full ${on ? "w-6 bg-text" : done ? "w-3 bg-text-2" : "w-3 bg-faint"}`
                    : `flex h-8 items-center gap-2 rounded-full text-sm transition-colors duration-150 ${
                        on ? "bg-[rgb(238_242_247/0.12)] pl-2 pr-3 text-text shadow-[inset_0_0_0_1px_rgb(238_242_247/0.18)]" : "w-8 justify-center text-muted hover:bg-[rgb(148_163_184/0.12)] hover:text-text"
                      }`
                }
              >
                {!sheet && (
                  <>
                    <span className={`num flex size-5 shrink-0 items-center justify-center rounded-full text-xs ${on ? "bg-text text-[#0a0f18]" : done ? "text-text-2" : ""}`}>{i + 1}</span>
                    {on && (
                      <motion.span layout={!reduced ? "position" : false} className="whitespace-nowrap font-medium" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.08, duration: 0.2 } }}>
                        {label}
                      </motion.span>
                    )}
                  </>
                )}
              </motion.button>
            </li>
          );
        })}
      </ol>
      <button type="button" className="btn-icon shrink-0" aria-label={`${T.common.next} (Right arrow)`} disabled={!next} onClick={() => next && void goScene(next)}>
        <ChevronRight size={18} aria-hidden />
      </button>
      {sheet && cur !== null && (
        <span className="num ml-2 text-xs text-muted">
          {cur + 1} / {STORY_STEPS.length}
        </span>
      )}
    </nav>
  );
}

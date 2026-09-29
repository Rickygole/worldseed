"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useDialog } from "@/lib/ui/useDialog";
import { INTRO } from "@/lib/ui/storyCopy";
import { goScene } from "@/lib/ui/story";

export const INTRO_SEEN_KEY = "worldseed.intro.seen";

function markSeen() {
  try {
    sessionStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {}
}

/**
 * The first screen: the map, the name (header), the dedication line, ONE sentence and ONE button. Escape skips.
 * No auto-advance, no imagery, no numbers.
 */
export default function IntroCard() {
  const reduced = !!useReducedMotion();
  const start = () => {
    markSeen();
    void goScene("crossing");
  };
  const ref = useDialog<HTMLDivElement>(true, start, { trap: false });

  const item = (i: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.2, delay: 0.1 * i } } }
      : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const, delay: 0.2 + 0.15 * i } } };

  return (
    <motion.div
      ref={ref}
      role="region"
      aria-labelledby="intro-sentence"
      className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end px-6 pb-28 md:justify-center md:px-16 md:pb-0 lg:px-24"
      style={{ background: "linear-gradient(90deg, rgb(7 11 18 / 0.94) 0%, rgb(7 11 18 / 0.86) 38%, rgb(7 11 18 / 0.35) 62%, rgb(7 11 18 / 0) 85%)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3, ease: [0.4, 0, 1, 1] } }}
    >
      <div className="pointer-events-auto max-w-[640px]">
        <motion.p className="max-w-[46ch] text-sm text-muted md:text-base" {...item(0)}>
          {INTRO.dedication}
        </motion.p>
        <motion.h2 id="intro-sentence" className="display mt-6 text-[30px] font-medium leading-[38px] text-text md:text-[44px] md:leading-[52px]" {...item(1)}>
          {INTRO.sentence}
        </motion.h2>
        <motion.div className="mt-10" {...item(2)}>
          <button type="button" className="btn btn-light h-14 rounded-full px-8 text-lg" onClick={start} data-autofocus>
            {INTRO.primary}
            <ArrowRight size={20} aria-hidden />
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
}

"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useDialog } from "@/lib/ui/useDialog";
import { KEYS } from "@/lib/ui/storyCopy";
import { useStory } from "@/lib/ui/story";

/** "?" : the keyboard shortcuts. */
export default function KeysDialog() {
  const open = useStory((s) => s.keysOpen);
  return <AnimatePresence>{open && <Inner key="keys" onClose={() => useStory.setState({ keysOpen: false })} />}</AnimatePresence>;
}

function Inner({ onClose }: { onClose: () => void }) {
  const reduced = !!useReducedMotion();
  const ref = useDialog<HTMLDivElement>(true, onClose);
  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: "rgb(4 7 12 / 0.6)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keys-h"
        className="sheet w-[420px] max-w-full p-6"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="keys-h" className="text-lg font-medium">
            Keyboard shortcuts
          </h2>
          <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <dl className="divide-y divide-border">
          {KEYS.map((k) => (
            <div key={k.hint} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-sm text-text-2">{k.hint}</dt>
              <dd className="flex shrink-0 gap-1">
                {k.keys.map((x) => (
                  <kbd key={x} className="kbd min-w-6 text-center text-xs">
                    {x}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </motion.div>
    </motion.div>
  );
}

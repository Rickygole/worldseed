"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSearch } from "@/lib/ui/search";
import { useApp } from "@/lib/store";
import { useDialog } from "@/lib/ui/useDialog";
import { optionName } from "./labels";

/** The explicit confirmation before an option enters the world. Enter confirms, Escape cancels. */
export default function ApplyConfirm() {
  const id = useSearch((s) => s.confirmApply);
  const ask = useSearch((s) => s.askApply);
  return <AnimatePresence>{id && <Inner key={id} bundleId={id} onClose={() => ask(null)} />}</AnimatePresence>;
}

function Inner({ bundleId, onClose }: { bundleId: string; onClose: () => void }) {
  const reduced = !!useReducedMotion();
  const ref = useDialog<HTMLDivElement>(true, onClose);
  const m = useSearch((s) => s.m);
  const catalog = useSearch((s) => s.catalog);
  const apply = useSearch((s) => s.apply);
  const expert = useApp((s) => s.mode === "expert");
  const f = m?.finalists.find((x) => x.bundleId === bundleId);
  if (!f) return null;
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgb(4 7 12 / 0.6)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="apply-h"
        aria-describedby="apply-d"
        tabIndex={-1}
        className="sheet w-[480px] max-w-full p-6"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") {
            e.preventDefault();
            void apply(bundleId);
          }
        }}
      >
        <h2 id="apply-h" className="text-xl font-medium">
          Apply this idea to the simulation?
        </h2>
        {expert && <p className="num mt-1 text-xs text-muted">{bundleId} · {f.costTier}</p>}
        <ul className="mt-4 space-y-2 text-sm">
          {f.candidateIds.map((id) => (
            <li key={id}>
              {optionName(catalog, id)} {expert && <span className="num text-xs text-muted">{id}</span>}
            </li>
          ))}
        </ul>
        <p id="apply-d" className="mt-4 text-sm text-text-2">
          This is a what-if idea with an assumed effect. It is not an agency plan or advice. It changes only this simulation, and every number is recalculated. Reset removes it.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-light" data-autofocus onClick={() => void apply(bundleId)}>
            Apply in simulation
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

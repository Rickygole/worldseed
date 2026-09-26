"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSearch } from "@/lib/ui/search";
import { useDialog } from "@/lib/ui/useDialog";
import { stripHypothetical } from "./labels";

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
  const f = m?.finalists.find((x) => x.bundleId === bundleId);
  if (!f) return null;
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgb(10 14 20 / 0.6)" }}
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
        className="panel w-[480px] p-6"
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
          Apply {bundleId} to the world?
        </h2>
        <ul className="mt-3 space-y-1 text-sm">
          {f.candidateIds.map((id) => (
            <li key={id}>
              <span className="num text-xs text-muted">{id}</span>
              <br />
              {catalog?.byId.get(id) ? stripHypothetical(catalog.byId.get(id)!.title) : id}
            </li>
          ))}
        </ul>
        <p id="apply-d" className="mt-3 text-sm text-muted">
          This adds hypothetical options to the simulated road network and recomputes every lens. Nothing outside this simulation changes. Reset (R) removes it.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn border-ai text-text" data-autofocus onClick={() => void apply(bundleId)}>
            Apply {bundleId}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

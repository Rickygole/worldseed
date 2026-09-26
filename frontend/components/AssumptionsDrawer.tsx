"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useApp } from "@/lib/store";
import type { Assumption } from "@/lib/sim";

const NONE: Assumption[] = [];

export default function AssumptionsDrawer() {
  const open = useApp((s) => s.assumptionsOpen);
  const setOpen = useApp((s) => s.setAssumptionsOpen);
  const assumptions = useApp((s) => s.world?.assumptions ?? NONE);
  const reduced = !!useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-30"
            style={{ background: "rgb(10 14 20 / 0.5)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-label="Modeling assumptions"
            className="panel fixed bottom-4 right-4 top-4 z-40 flex w-[420px] flex-col overflow-hidden"
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 32 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <h2 className="text-base font-medium">Modeling assumptions</h2>
              <button className="btn-icon" aria-label="Close assumptions" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <p className="mb-4 text-sm text-muted">
                Values marked <span className="num text-warn">placeholder</span> are stand-ins until the snapshot is
                built. Nothing here is read from real data yet.
              </p>
              <dl className="space-y-4">
                {assumptions.map((a) => (
                  <div key={a.label} className="border-b border-border pb-4 last:border-0">
                    <div className="flex items-start justify-between gap-4">
                      <dt className="text-sm">{a.label}</dt>
                      <dd className="num text-right text-sm">{a.value}</dd>
                    </div>
                    {a.note && <p className="mt-1 text-xs text-muted">{a.note}</p>}
                    {a.placeholder && (
                      <span className="chip mt-2 h-5 px-2 text-warn" style={{ borderColor: "rgb(245 165 36 / 0.5)" }}>
                        placeholder until snapshot built
                      </span>
                    )}
                  </div>
                ))}
              </dl>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

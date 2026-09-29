"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useApp } from "@/lib/store";
import { useSearch } from "@/lib/ui/search";
import { navigate } from "@/lib/ui/nav";
import { setViewportPadding } from "@/lib/ui/mapDirector";
import { enterExpert, expertNoteSeen, markExpertNoteSeen, setUiMode } from "@/lib/ui/modes";
import { useStory } from "@/lib/ui/story";
import { TOGGLE } from "@/lib/ui/storyCopy";
import LoadState from "../LoadState";
import RightPanel from "../RightPanel";
import ExpertRail from "./ExpertRail";
import ComparisonStrip from "./ComparisonStrip";

function ExpertNote() {
  const [open, setOpen] = useState(false);
  const fromStory = useStory((s) => s.expertFromStory);
  useEffect(() => {
    // Storage is read after mount; the note only makes sense after leaving the story.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fromStory && !expertNoteSeen()) setOpen(true);
  }, [fromStory]);
  if (!open) return null;
  const close = () => {
    markExpertNoteSeen();
    setOpen(false);
  };
  return (
    <div role="status" className="pop pointer-events-auto flex items-center gap-3 !rounded-full py-1.5 pl-4 pr-1.5 text-sm">
      <span className="text-text-2">{TOGGLE.firstNote}</span>
      <button
        type="button"
        className="btn h-8 rounded-full px-3 text-xs"
        onClick={() => {
          close();
          void setUiMode("story");
        }}
      >
        {TOGGLE.back}
      </button>
      <button type="button" className="btn-icon !h-8 !w-8" aria-label="Dismiss" onClick={close}>
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

const NEEDS_SEARCH = "Run a search first: press Find a better future in the planner. Then this tool opens on its finalists.";

/**
 * /explore?open=<tool>: the scene-6 tiles land on one tool. Drawers open directly; the exhaustive check and the
 * compare slider need finalists, so without a search the planner stays on its goal step with a one-line note.
 */
function useOpenParam(setNote: (v: string | null) => void) {
  const params = useSearchParams();
  const open = params.get("open");
  const ready = useApp((s) => s.status === "ready");
  const machineReady = useSearch((s) => s.m !== null);
  useEffect(() => {
    if (!open || !ready || !machineReady) return;
    const app = useApp.getState();
    const search = useSearch.getState();
    const finalists = search.m?.phase === "finalists" ? search.m.finalists : [];
    if (open === "freight") app.setFreightOpen(true);
    else if (open === "closures") app.setClosuresOpen(true);
    else if (open === "command") app.setCommandOpen(true);
    else if (open === "exhaustive") {
      if (finalists.length > 0) void search.runExhaustive();
      else setNote(NEEDS_SEARCH);
    } else if (open === "compare") {
      if (finalists.length > 0) void search.setCompare(finalists[0].bundleId);
      else setNote(NEEDS_SEARCH);
    }
    navigate("/explore", { replace: true });
  }, [open, ready, machineReady, setNote]);
}

/** /explore: the analyst workspace over the persistent map (rail, planner, comparison strip; ribbon in the shell). */
export default function ExplorePage() {
  const presentation = useApp((s) => s.presentation);
  const reduced = !!useReducedMotion();
  const panels = !presentation;
  const [note, setNote] = useState<string | null>(null);
  useOpenParam(setNote);

  useEffect(() => {
    enterExpert();
  }, []);

  // Camera safe area between the rail and the planner; attribution just left of the planner, clear of the strip.
  useEffect(() => {
    const root = document.documentElement;
    setViewportPadding(panels ? { left: 312, right: 392, top: 16, bottom: 72 } : { left: 0, right: 0, top: 0, bottom: 0 });
    root.style.setProperty("--ws-attrib-right", panels ? "392px" : "12px");
    root.style.setProperty("--ws-attrib-bottom", panels ? "76px" : "12px");
  }, [panels]);

  const panelIn = (dir: -1 | 1) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, x: 24 * dir },
    animate: { opacity: 1, x: 0, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const } },
    exit: { ...(reduced ? { opacity: 0 } : { opacity: 0, x: 24 * dir }), transition: { duration: 0.16, ease: [0.4, 0, 1, 1] as const } },
  });

  return (
    <>
      <h1 className="sr-only">Expert mode: the full analyst workspace</h1>
      <LoadState />
      <AnimatePresence initial={false}>
        {panels && (
          <motion.div key="rail" className="pointer-events-none absolute bottom-4 left-4 top-4 z-10" {...panelIn(-1)}>
            <div className="pointer-events-auto h-full">
              <ExpertRail />
            </div>
          </motion.div>
        )}
        {panels && (
          <motion.div key="planner" className="pointer-events-none absolute bottom-4 right-4 top-4 z-10" {...panelIn(1)}>
            <div className="pointer-events-auto h-full">
              <RightPanel />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {panels && (
        <div className="pointer-events-none absolute bottom-4 z-10 flex flex-col items-center gap-2" style={{ left: 312, right: 392 }}>
          <ComparisonStrip />
        </div>
      )}
      {panels && (
        <div className="pointer-events-none absolute top-4 z-10 flex flex-col items-center gap-2" style={{ left: 312, right: 392 }}>
          <ExpertNote />
          {note && (
            <p role="status" className="pop pointer-events-auto flex items-center gap-3 !rounded-full py-1.5 pl-4 pr-1.5 text-sm text-text-2">
              {note}
              <button type="button" className="btn-icon !h-8 !w-8" aria-label="Dismiss" onClick={() => setNote(null)}>
                <X size={14} aria-hidden />
              </button>
            </p>
          )}
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { useApp } from "@/lib/store";
import TopBar from "./TopBar";
import DisclaimerBanner from "./DisclaimerBanner";
import LeftPanel from "./LeftPanel";
import RightPanel from "./RightPanel";
import MetricsRibbon from "./MetricsRibbon";
import Footer from "./Footer";
import IntroOverlay from "./IntroOverlay";
import AssumptionsDrawer from "./AssumptionsDrawer";
import CommandBar from "./CommandBar";
import AboutDialog from "./AboutDialog";
import LensControl from "./LensControl";
import Inspector from "./Inspector";
import LoadState from "./LoadState";

// WebGL + window access: client only.
const MapStage = dynamic(() => import("./MapStage"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-bg" />,
});

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setCommandOpen(!s.commandOpen);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (s.introOpen || s.commandOpen || s.aboutOpen || s.assumptionsOpen) return;
      const k = e.key.toLowerCase();
      if (k === "p") s.togglePresentation();
      else if (k === "r") void s.resetWorld();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export default function AppShell() {
  const init = useApp((s) => s.init);
  const leftOpen = useApp((s) => s.leftOpen);
  const rightOpen = useApp((s) => s.rightOpen);
  const presentation = useApp((s) => s.presentation);
  const setLeftOpen = useApp((s) => s.setLeftOpen);
  const setRightOpen = useApp((s) => s.setRightOpen);
  const inspecting = useApp((s) => s.selectedHex !== null);
  const reduced = !!useReducedMotion();

  useEffect(() => {
    void init();
  }, [init]);
  useHotkeys();

  // Reduced motion: crossfade only. Otherwise slide + fade. Entrances ease out, exits ease in and are quicker.
  const hidden = (dir: -1 | 1) => (reduced ? { opacity: 0 } : { opacity: 0, x: 24 * dir });
  const enter = { duration: 0.24, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };
  const exit = { duration: 0.16, ease: [0.4, 0, 1, 1] as [number, number, number, number] };
  const leftShown = !presentation && leftOpen;
  const rightShown = !presentation && (rightOpen || inspecting);

  return (
    <div className="flex h-screen min-h-[768px] min-w-[1366px] flex-col bg-bg">
      <TopBar />
      <DisclaimerBanner />

      <main className="relative min-h-0 flex-1 overflow-hidden">
        <MapStage />

        {/* Lens control + legend, centered over the visible map. */}
        <div
          className="pointer-events-none absolute top-4 z-10 flex justify-center transition-[left,right] duration-200"
          style={{ left: leftShown ? 332 : 16, right: rightShown ? 392 : 16 }}
        >
          <LensControl />
        </div>

        <LoadState />

        {/* Left panel */}
        <div className="pointer-events-none absolute bottom-12 left-4 top-4 z-10">
          <AnimatePresence initial={false}>
            {leftShown && (
              <motion.div
                key="left"
                className="pointer-events-auto h-full"
                initial={hidden(-1)}
                animate={{ opacity: 1, x: 0, transition: enter }}
                exit={{ ...hidden(-1), transition: exit }}
              >
                <LeftPanel />
              </motion.div>
            )}
          </AnimatePresence>
          {!presentation && !leftOpen && (
            <button className="panel pointer-events-auto btn-icon !h-10 !w-10" aria-label="Expand scenario panel" onClick={() => setLeftOpen(true)}>
              <PanelLeftOpen size={16} aria-hidden />
            </button>
          )}
        </div>

        {/* Right panel */}
        <div className="pointer-events-none absolute bottom-12 right-4 top-4 z-10 flex flex-col items-end">
          <AnimatePresence initial={false}>
            {!presentation && rightOpen && !inspecting && (
              <motion.div
                key="right"
                className="pointer-events-auto h-full"
                initial={hidden(1)}
                animate={{ opacity: 1, x: 0, transition: enter }}
                exit={{ ...hidden(1), transition: exit }}
              >
                <RightPanel />
              </motion.div>
            )}
          </AnimatePresence>
          {!presentation && !rightOpen && !inspecting && (
            <button className="panel pointer-events-auto btn-icon !h-10 !w-10" aria-label="Expand planner panel" onClick={() => setRightOpen(true)}>
              <PanelRightOpen size={16} aria-hidden />
            </button>
          )}
        </div>

        {/* Neighborhood inspector: over the planner panel while open. */}
        {!presentation && <Inspector />}

        <Footer />
      </main>

      <MetricsRibbon />

      {/* Below the designed minimum width: say so, once, instead of silently clipping. */}
      <p className="panel fixed inset-x-2 bottom-2 z-50 p-3 text-sm lg:hidden">
        WorldSeed is designed for screens 1366 px wide or more. Scroll sideways to see the rest of the workspace.
      </p>

      <AssumptionsDrawer />
      <CommandBar />
      <AboutDialog />
      <IntroOverlay />
    </div>
  );
}

"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { useApp } from "@/lib/store";
import TopBar from "./TopBar";
import LeftPanel from "./LeftPanel";
import RightPanel from "./RightPanel";
import MetricsRibbon from "./MetricsRibbon";
import Footer from "./Footer";
import IntroOverlay from "./IntroOverlay";
import AssumptionsDrawer from "./AssumptionsDrawer";
import CommandBar from "./CommandBar";

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
      if (s.introOpen || s.commandOpen) return;
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
  const status = useApp((s) => s.status);
  const leftOpen = useApp((s) => s.leftOpen);
  const rightOpen = useApp((s) => s.rightOpen);
  const presentation = useApp((s) => s.presentation);
  const setLeftOpen = useApp((s) => s.setLeftOpen);
  const setRightOpen = useApp((s) => s.setRightOpen);
  const reduced = !!useReducedMotion();

  useEffect(() => {
    void init();
  }, [init]);
  useHotkeys();

  // Reduced motion: crossfade only. Otherwise slide + fade.
  const slide = (dir: -1 | 1) => (reduced ? { opacity: 0 } : { opacity: 0, x: 24 * dir });
  const t = { duration: 0.28, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };

  return (
    <div className="flex h-screen min-h-[768px] min-w-[1366px] flex-col bg-bg">
      <TopBar />

      <main className="relative min-h-0 flex-1 overflow-hidden">
        <MapStage />

        {status === "loading" && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-muted">
            Loading world...
          </div>
        )}
        {status === "error" && (
          <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 panel px-4 py-2 text-sm text-critical">
            Failed to load the world. See the event log.
          </div>
        )}

        {/* Left panel */}
        <div className="pointer-events-none absolute bottom-12 left-4 top-4 z-10">
          <AnimatePresence initial={false}>
            {!presentation && leftOpen && (
              <motion.div
                key="left"
                className="pointer-events-auto h-full"
                initial={slide(-1)}
                animate={{ opacity: 1, x: 0 }}
                exit={slide(-1)}
                transition={t}
              >
                <LeftPanel />
              </motion.div>
            )}
          </AnimatePresence>
          {!presentation && !leftOpen && (
            <button className="panel pointer-events-auto btn-icon !h-10 !w-10" aria-label="Expand left panel" onClick={() => setLeftOpen(true)}>
              <PanelLeftOpen size={16} />
            </button>
          )}
        </div>

        {/* Right panel */}
        <div className="pointer-events-none absolute bottom-12 right-4 top-4 z-10 flex flex-col items-end">
          <AnimatePresence initial={false}>
            {!presentation && rightOpen && (
              <motion.div
                key="right"
                className="pointer-events-auto h-full"
                initial={slide(1)}
                animate={{ opacity: 1, x: 0 }}
                exit={slide(1)}
                transition={t}
              >
                <RightPanel />
              </motion.div>
            )}
          </AnimatePresence>
          {!presentation && !rightOpen && (
            <button className="panel pointer-events-auto btn-icon !h-10 !w-10" aria-label="Expand right panel" onClick={() => setRightOpen(true)}>
              <PanelRightOpen size={16} />
            </button>
          )}
        </div>

        <Footer />
      </main>

      <MetricsRibbon />

      <AssumptionsDrawer />
      <CommandBar />
      <IntroOverlay />
    </div>
  );
}

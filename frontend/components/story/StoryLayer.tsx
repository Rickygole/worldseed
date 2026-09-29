"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useApp } from "@/lib/store";
import { setViewportPadding } from "@/lib/ui/mapDirector";
import type { StoryScene } from "@/lib/ui/story";
import NoticeLine from "../DisclaimerBanner";
import IntroCard from "./IntroCard";
import StoryBar from "./StoryBar";
import StoryCard from "./StoryCard";

const CARD_W = 460;
const GAP = 24;

function useIsPhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const q = window.matchMedia("(max-width: 767px)");
      q.addEventListener("change", cb);
      return () => q.removeEventListener("change", cb);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );
}

/**
 * Story mode over the full-bleed map: the intro, then one card per scene (bottom-left on desktop, a bottom
 * sheet on phones), a compact legend, and the footer line. Tells the map director which part of the map the
 * card covers, so the camera frames the free area.
 */
export default function StoryLayer() {
  const scene = useApp((s) => s.scene);
  const status = useApp((s) => s.status);
  const phone = useIsPhone();
  const reduced = !!useReducedMotion();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Camera safe area and attribution placement follow the card / sheet.
  useEffect(() => {
    const root = document.documentElement;
    if (!phone) {
      setViewportPadding({ left: scene === "intro" ? 0 : CARD_W + GAP * 2, right: 0, top: 56, bottom: 32 });
      root.style.setProperty("--ws-attrib-bottom", "10px");
      root.style.setProperty("--ws-attrib-right", "16px");
      return;
    }
    const el = sheetRef.current;
    if (!el) {
      // The intro on a phone: the notice line sits at the bottom, the attribution just above it.
      setViewportPadding({ left: 0, right: 0, top: 56, bottom: 0 });
      root.style.setProperty("--ws-attrib-bottom", "44px");
      root.style.setProperty("--ws-attrib-right", "8px");
      return;
    }
    const apply = () => {
      const h = el?.getBoundingClientRect().height ?? 0;
      setViewportPadding({ left: 0, right: 0, top: 56, bottom: Math.round(h) });
      root.style.setProperty("--ws-attrib-bottom", `${Math.round(h) + 8}px`);
      root.style.setProperty("--ws-attrib-right", "8px");
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phone, scene, collapsed]);

  const intro = scene === "intro";
  const loading = status !== "ready";

  return (
    <>
      <AnimatePresence>{intro && <IntroCard key="intro" />}</AnimatePresence>

      {!intro && !phone && (
        <motion.div
          data-popover-edge
          className="panel story-card pointer-events-auto absolute left-6 z-20 flex max-h-[calc(100dvh-var(--story-top)-48px)] flex-col overflow-y-auto overscroll-contain !rounded-[24px] p-8"
          // A fixed top edge: the card grows downward, so it never jumps between scenes.
          style={{ width: CARD_W, top: "var(--story-top)" }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
        >
          {loading ? <LoadingCard /> : <StoryCard id={scene as StoryScene} />}
        </motion.div>
      )}

      {!intro && phone && (
        <motion.div
          ref={sheetRef}
          className="panel story-card pointer-events-auto fixed inset-x-0 bottom-0 z-20 flex max-h-[64dvh] flex-col !rounded-b-none !rounded-t-[24px]"
          initial={reduced ? { opacity: 0 } : { y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
        >
          <div className="flex items-center justify-between gap-2 px-4 pt-2">
            <StoryBar variant="sheet" />
            <button type="button" className="btn-icon !h-11 !w-11" aria-expanded={!collapsed} aria-label={collapsed ? "Expand the story card" : "Collapse the story card"} onClick={() => setCollapsed((v) => !v)}>
              <ChevronDown size={18} className="transition-transform duration-200" style={{ transform: collapsed ? "rotate(180deg)" : "none" }} aria-hidden />
            </button>
          </div>
          <div className={`min-h-0 overflow-y-auto overscroll-contain px-5 pb-3 pt-1 ${collapsed ? "max-h-[132px]" : ""}`}>{loading ? <LoadingCard /> : <StoryCard id={scene as StoryScene} />}</div>
          <div className="border-t border-border px-6 py-2">
            <NoticeLine compact />
          </div>
        </motion.div>
      )}

      {!phone && (
        <footer className="scrim-bottom pointer-events-none absolute inset-x-0 bottom-0 z-30 flex h-10 items-end px-6 pb-2.5">
          <div className="pointer-events-auto">
            <NoticeLine compact />
          </div>
        </footer>
      )}
      {phone && intro && (
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-6 pb-4">
          <div className="pointer-events-auto">
            <NoticeLine compact />
          </div>
        </footer>
      )}
    </>
  );
}

function LoadingCard() {
  const status = useApp((s) => s.status);
  const stage = useApp((s) => s.loadStage);
  const err = useApp((s) => s.loadError);
  const retry = useApp((s) => s.retry);
  if (status === "error") {
    return (
      <div role="alert">
        <p className="label">Could not start</p>
        <p className="mt-3 text-lg text-text">{err?.title ?? "The map data did not load. Check your connection, then try again."}</p>
        {err?.detail && <p className="num mt-2 break-words text-xs text-muted">{err.detail}</p>}
        <button type="button" className="btn btn-light mt-6 h-11 rounded-full px-5" onClick={() => void retry()}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <p className="label">{stage === "baseline" ? "Computing the baseline" : "Loading"}</p>
      <div className="mt-8 h-5" />
      <div className="skeleton h-[64px] w-56 md:h-[84px]" aria-hidden />
      <p className="mt-6 max-w-[40ch] text-lg text-text-2">
        {stage === "baseline" ? "Recomputing every lens in your browser." : "Loading roads, people and jobs. This runs in your browser."}
      </p>
      <div className="progress-indeterminate mt-6" aria-hidden />
    </div>
  );
}

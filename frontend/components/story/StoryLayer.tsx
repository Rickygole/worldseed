"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useApp } from "@/lib/store";
import { globeStage, setViewportPadding, subscribeGlobe } from "@/lib/ui/mapDirector";
import type { StoryScene } from "@/lib/ui/story";
import type { SceneId } from "@/lib/ui/mapDirector";
import NoticeLine from "../DisclaimerBanner";
import IntroCard from "./IntroCard";
import StoryBar from "./StoryBar";
import StoryCard from "./StoryCard";
import ExplorePreview from "./ExplorePreview";
import StressCard from "./StressCard";
import { useStory } from "@/lib/ui/story";

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
export default function StoryLayer({ scene }: { scene: SceneId }) {
  const status = useApp((s) => s.status);
  const phone = useIsPhone();
  const reduced = !!useReducedMotion();
  const sheetRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const globe = useSyncExternalStore(subscribeGlobe, globeStage, () => "off" as const);

  // Camera safe area and attribution placement follow the card / sheet.
  useEffect(() => {
    const root = document.documentElement;
    if (!phone) {
      // The globe sits right of the intro copy (about where the scene card will be, so the flight down starts
      // without a jump); the regional intro keeps the full width.
      const left = scene !== "intro" ? CARD_W + GAP * 2 : globe === "orbit" ? Math.round(window.innerWidth * 0.36) : 0;
      setViewportPadding({ left, right: 0, top: 56, bottom: 32 });
      root.style.setProperty("--ws-attrib-right", "16px");
      // The attribution shares the bottom edge with the notice (bottom-left) when there is room for both;
      // where they would meet (narrow windows, a long satellite credit) it steps up above the notice, and the
      // card and side panels (which follow `--ws-story-bottom`) step up with it so nothing covers it.
      const foot = footRef.current;
      const ro = new ResizeObserver(() => place());
      let attrib: HTMLElement | null = null;
      const place = () => {
        if (!attrib) {
          // The map control mounts after the map does; watch it once it exists (its text changes per style).
          attrib = document.querySelector<HTMLElement>(".ws-map .maplibregl-ctrl-attrib");
          if (attrib) ro.observe(attrib);
        }
        const f = foot?.getBoundingClientRect();
        // Not mounted yet: assume the longest (satellite) credit, about 600px, rather than a collision.
        const attribW = attrib?.offsetWidth ?? 600;
        const clear = !f || f.right + 24 <= window.innerWidth - 16 - attribW;
        // Stepped up: the footer's 10px bottom padding, the notice, then 8px of air; panels clear it by 12px.
        const lifted = f ? Math.round(f.height) + 18 : 10;
        root.style.setProperty("--ws-attrib-bottom", clear ? "10px" : `${lifted}px`);
        root.style.setProperty("--ws-story-bottom", clear ? "60px" : `${lifted + (attrib?.offsetHeight ?? 20) + 12}px`);
      };
      place();
      if (foot) ro.observe(foot);
      const poll = window.setInterval(() => (attrib ? window.clearInterval(poll) : place()), 500);
      window.addEventListener("resize", place);
      return () => {
        ro.disconnect();
        window.clearInterval(poll);
        window.removeEventListener("resize", place);
      };
    }
    const el = sheetRef.current;
    if (!el) {
      // The intro on a phone: the notice sits at the bottom (two or three lines), the attribution just above
      // it. The globe sits in the upper half, above the copy.
      setViewportPadding({ left: 0, right: 0, top: 56, bottom: globe === "orbit" ? Math.round(window.innerHeight * 0.42) : 0 });
      root.style.setProperty("--ws-attrib-right", "8px");
      const foot = footRef.current;
      // The footer's 16px bottom padding, then 8px of air above the notice.
      const place = () => root.style.setProperty("--ws-attrib-bottom", `${Math.round(foot?.getBoundingClientRect().height ?? 18) + 24}px`);
      place();
      const ro = new ResizeObserver(place);
      if (foot) ro.observe(foot);
      return () => ro.disconnect();
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
  }, [phone, scene, collapsed, globe]);

  const intro = scene === "intro";
  const note = useStory((s) => s.routeNote);
  const loading = status !== "ready";

  return (
    <>
      <AnimatePresence>{intro && <IntroCard key="intro" />}</AnimatePresence>
      {note && !intro && (
        <p role="status" className="pop pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 px-4 py-2 text-sm text-text-2">
          {note}
        </p>
      )}

      {!intro && !phone && (
        <motion.div
          data-popover-edge
          className="panel story-card pointer-events-auto absolute left-6 z-20 flex max-h-[calc(100dvh-var(--story-top)-var(--ws-story-bottom,60px))] flex-col overflow-y-auto overscroll-contain !rounded-[24px] p-8"
          // A fixed top edge: the card grows downward, so it never jumps between scenes.
          style={{ width: CARD_W, top: "var(--story-top)" }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
        >
          {loading ? <LoadingCard /> : <StoryCard id={scene as StoryScene} />}
        </motion.div>
      )}

      {/* Scene 5 after Apply, on wider screens: the stress test in its own panel beside the card. */}
      {scene === "fix" && !phone && !loading && (
        <div className="pointer-events-auto absolute bottom-[var(--ws-story-bottom,60px)] z-20" style={{ left: CARD_W + GAP * 2, width: 400 }}>
          <StressCard className="panel story-card !rounded-[24px] p-5" />
        </div>
      )}

      {/* Scene 6 on wider screens: what Expert mode offers, in its own panel beside the card. */}
      {scene === "explore" && !phone && !loading && (
        <motion.div
          className="panel story-card pointer-events-auto absolute bottom-[var(--ws-story-bottom,60px)] z-20 max-h-[calc(100dvh-var(--story-top)-var(--ws-story-bottom,60px))] overflow-y-auto !rounded-[24px] p-5"
          style={{ left: CARD_W + GAP * 2, width: 540 }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.2 } }}
        >
          <ExplorePreview />
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
          <div className={`min-h-0 overflow-y-auto overscroll-contain px-5 pb-3 pt-1 ${collapsed ? "max-h-[132px]" : ""}`}>{loading ? <LoadingCard /> : <StoryCard id={scene as StoryScene} inlinePreview />}</div>
          <div className="border-t border-border px-6 py-2">
            <NoticeLine variant="story" />
          </div>
        </motion.div>
      )}

      {!phone && (
        <footer
          className="scrim-bottom pointer-events-none absolute inset-x-0 bottom-0 z-30 px-6 pb-2.5 pt-5"
          // The scrim is for the notice only: it fades out past the notice's column, so it never dims the map
          // attribution (which carries its own backing) where the two share the bottom edge.
          style={{ maskImage: "linear-gradient(to right, #000 600px, transparent 760px)" }}
        >
          {/* About the card's width, so the notice reads as a two-line caption under it rather than a long rule. */}
          <div ref={footRef} className="pointer-events-auto w-fit max-w-[560px]">
            <NoticeLine variant="story" />
          </div>
        </footer>
      )}
      {phone && intro && (
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-6 pb-4">
          <div ref={footRef} className="pointer-events-auto">
            <NoticeLine variant="story" />
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

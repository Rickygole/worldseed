"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useApp } from "@/lib/store";
import { useSearch } from "@/lib/ui/search";
import { setViewportPadding, type SceneId } from "@/lib/ui/mapDirector";
import { goScene, nextScene, prevScene, useStory, STORY_STEPS } from "@/lib/ui/story";
import { expertNoteSeen, markExpertNoteSeen, setUiMode, toggleUiMode } from "@/lib/ui/modes";
import { TOGGLE } from "@/lib/ui/storyCopy";
import TopBar from "./TopBar";
import MetricsRibbon from "./MetricsRibbon";
import Footer from "./Footer";
import AssumptionsDrawer from "./AssumptionsDrawer";
import CommandBar from "./CommandBar";
import AboutDialog from "./AboutDialog";
import Inspector from "./Inspector";
import LoadState from "./LoadState";
import ClosuresDrawer from "./ClosuresDrawer";
import EvidenceDrawer from "./EvidenceDrawer";
import FreightPanel from "./FreightPanel";
import KeysDialog from "./KeysDialog";
import ApplyConfirm from "./planner/ApplyConfirm";
import StoryLayer from "./story/StoryLayer";
import ExpertRail from "./expert/ExpertRail";
import RightPanel from "./RightPanel";
import ComparisonStrip from "./expert/ComparisonStrip";
import { INTRO_SEEN_KEY } from "./story/IntroCard";

// WebGL + window access: client only.
const MapStage = dynamic(() => import("./MapStage"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-bg" />,
});

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

function anyDialogOpen(): boolean {
  const s = useApp.getState();
  return s.commandOpen || s.aboutOpen || s.assumptionsOpen || s.closuresOpen || s.evidenceOpen || useStory.getState().keysOpen || !!useSearch.getState().confirmApply || s.scene === "intro";
}

/** Keyboard: arrows move through the story; E toggles Expert mode; ? shows the shortcuts; R, P, Cmd/Ctrl+K as before. */
function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setCommandOpen(!s.commandOpen);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || e.defaultPrevented) return;
      if (anyDialogOpen()) return;
      const k = e.key;
      if (k === "?") {
        useStory.setState({ keysOpen: true });
      } else if (k === "e" || k === "E") {
        void toggleUiMode();
      } else if (k === "r" || k === "R") {
        void s.resetWorld();
      } else if ((k === "p" || k === "P") && s.mode === "expert") {
        s.togglePresentation();
      } else if (s.mode === "story" && (k === "ArrowRight" || k === "ArrowLeft")) {
        // Radio groups and sliders keep their own arrows.
        const role = (e.target as HTMLElement | null)?.getAttribute?.("role");
        if (role === "radio" || role === "slider" || role === "tab") return;
        const to = k === "ArrowRight" ? nextScene() : prevScene();
        if (to) {
          e.preventDefault();
          void goScene(to);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Where the app starts: ?mode=expert, ?scene=<id>, or the intro once per browser session. */
function initialRoute(): { mode: "story" | "expert"; scene: SceneId } {
  const q = new URLSearchParams(window.location.search);
  const sceneParam = q.get("scene") as SceneId | null;
  const valid = sceneParam && (sceneParam === "intro" || (STORY_STEPS as string[]).includes(sceneParam));
  let seen = false;
  try {
    seen = sessionStorage.getItem(INTRO_SEEN_KEY) === "1";
  } catch {}
  const scene: SceneId = valid ? sceneParam! : seen ? "crossing" : "intro";
  return { mode: q.get("mode") === "expert" ? "expert" : "story", scene };
}

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

export default function AppShell() {
  const init = useApp((s) => s.init);
  const mode = useApp((s) => s.mode);
  const presentation = useApp((s) => s.presentation);
  const ready = useApp((s) => s.status === "ready");
  const reduced = !!useReducedMotion();
  const bootSearch = useSearch((s) => s.boot);

  useEffect(() => {
    const r = initialRoute();
    useApp.getState().setMode(r.mode);
    void goScene(r.mode === "expert" ? "explore" : r.scene, { instant: true });
    if (r.mode === "expert") useApp.getState().setScene(r.scene === "intro" ? "crossing" : r.scene);
    void init();
  }, [init]);

  // Once the world is loaded, the scene on screen makes its world right (e.g. a deep link to a later scene).
  useEffect(() => {
    if (!ready) return;
    void bootSearch();
    const s = useApp.getState();
    if (s.mode === "story" && s.scene !== "intro") void goScene(s.scene);
  }, [ready, bootSearch]);
  useHotkeys();

  // Expert mode: camera safe area between the rail and the planner; attribution just left of the planner.
  const expertPanels = mode === "expert" && !presentation;
  useEffect(() => {
    if (mode !== "expert") return;
    const root = document.documentElement;
    setViewportPadding(expertPanels ? { left: 312, right: 392, top: 16, bottom: 72 } : { left: 0, right: 0, top: 0, bottom: 0 });
    root.style.setProperty("--ws-attrib-right", expertPanels ? "392px" : "12px");
    // Clear of the comparison strip at the bottom of the map.
    root.style.setProperty("--ws-attrib-bottom", expertPanels ? "76px" : "12px");
  }, [mode, expertPanels]);

  const panelIn = (dir: -1 | 1) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, x: 24 * dir },
    animate: { opacity: 1, x: 0, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const } },
    exit: { ...(reduced ? { opacity: 0 } : { opacity: 0, x: 24 * dir }), transition: { duration: 0.16, ease: [0.4, 0, 1, 1] as const } },
  });

  return (
    <div data-mode={mode} className={`relative flex h-dvh w-full flex-col overflow-hidden bg-bg ${mode === "expert" ? "min-h-[640px] min-w-[1280px]" : ""}`}>
      {mode === "story" ? (
        <div className="absolute inset-x-0 top-0 z-30">
          <TopBar />
        </div>
      ) : (
        <TopBar />
      )}

      <main className="relative min-h-0 flex-1 overflow-hidden" aria-label={mode === "story" ? "Guided story over the map" : "Map workspace"}>
        <MapStage />

        {mode === "story" && <StoryLayer />}

        {mode === "expert" && (
          <>
            <LoadState />
            <AnimatePresence initial={false}>
              {expertPanels && (
                <motion.div key="rail" className="pointer-events-none absolute bottom-4 left-4 top-4 z-10" {...panelIn(-1)}>
                  <div className="pointer-events-auto h-full">
                    <ExpertRail />
                  </div>
                </motion.div>
              )}
              {expertPanels && (
                <motion.div key="planner" className="pointer-events-none absolute bottom-4 right-4 top-4 z-10" {...panelIn(1)}>
                  <div className="pointer-events-auto h-full">
                    <RightPanel />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {expertPanels && (
              <div className="pointer-events-none absolute bottom-4 z-10 flex flex-col items-center gap-2" style={{ left: 312, right: 392 }}>
                <ComparisonStrip />
              </div>
            )}
            {expertPanels && (
              <div className="pointer-events-none absolute top-4 z-10 flex justify-center" style={{ left: 312, right: 392 }}>
                <ExpertNote />
              </div>
            )}
          </>
        )}

        {mode === "expert" && <Inspector />}
      </main>

      {mode === "expert" && !presentation && (
        <>
          <MetricsRibbon />
          <div className="shrink-0 border-t border-border bg-bg">
            <Footer />
          </div>
        </>
      )}
      {mode === "expert" && presentation && (
        <div className="scrim-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10">
          <Footer />
        </div>
      )}

      <AssumptionsDrawer />
      <ClosuresDrawer />
      <EvidenceDrawer />
      <FreightPanel />
      <ApplyConfirm />
      <CommandBar />
      <AboutDialog />
      <KeysDialog />
    </div>
  );
}

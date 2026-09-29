"use client";

import { useEffect, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { useSearch } from "@/lib/ui/search";
import { registerNav } from "@/lib/ui/nav";
import { routeOf } from "@/lib/ui/routes";
import { loadNodeCoords } from "@/lib/ui/snapshotAux";
import { nextScene, prevScene, useStory } from "@/lib/ui/story";
import { enterStoryMode, goToStory, toggleUiMode } from "@/lib/ui/modes";
import TopBar from "./TopBar";
import MetricsRibbon from "./MetricsRibbon";
import Footer from "./Footer";
import AssumptionsDrawer from "./AssumptionsDrawer";
import CommandBar from "./CommandBar";
import Inspector from "./Inspector";
import ClosuresDrawer from "./ClosuresDrawer";
import EvidenceDrawer from "./EvidenceDrawer";
import FreightPanel from "./FreightPanel";
import KeysDialog from "./KeysDialog";
import ApplyConfirm from "./planner/ApplyConfirm";

// WebGL + window access: client only. Mounted once here, in the root layout, so it never remounts between pages.
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
  return s.commandOpen || s.assumptionsOpen || s.closuresOpen || s.evidenceOpen || useStory.getState().keysOpen || !!useSearch.getState().confirmApply;
}

/** Keyboard on every page: arrows move through the story (by URL), E story/Expert, ? shortcuts, R reset, P presentation, Cmd/Ctrl+K. */
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
      const route = routeOf(window.location.pathname);
      const k = e.key;
      if (k === "?") {
        useStory.setState({ keysOpen: true });
      } else if (k === "e" || k === "E") {
        void toggleUiMode();
      } else if (k === "r" || k === "R") {
        void s.resetWorld();
      } else if ((k === "p" || k === "P") && route.kind === "explore") {
        s.togglePresentation();
      } else if ((route.kind === "story" || route.kind === "intro") && (k === "ArrowRight" || k === "ArrowLeft")) {
        // Radio groups and sliders keep their own arrows.
        const role = (e.target as HTMLElement | null)?.getAttribute?.("role");
        if (role === "radio" || role === "slider" || role === "tab") return;
        const to = k === "ArrowRight" ? nextScene() : prevScene();
        if (to) {
          e.preventDefault();
          goToStory(to);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * The persistent shell of every page (rendered by app/layout.tsx): the map, the simulator and the worker pool are
 * created once here and survive client-side navigation. Each page renders only its overlay as `children`: the
 * intro, one story scene, the Expert workspace, or a document.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const init = useApp((s) => s.init);
  const presentation = useApp((s) => s.presentation);
  const ready = useApp((s) => s.status === "ready");
  const bootSearch = useSearch((s) => s.boot);
  const router = useRouter();
  const pathname = usePathname();
  const route = routeOf(pathname);
  const expert = route.kind === "explore";

  useEffect(() => {
    registerNav({ push: (h) => router.push(h, { scroll: false }), replace: (h) => router.replace(h, { scroll: false }) });
    return () => registerNav(null);
  }, [router]);

  // The snapshot loads once per visit, whatever page the visitor lands on.
  useEffect(() => {
    void init();
  }, [init]);
  useEffect(() => {
    if (!ready) return;
    void bootSearch();
    // Road-node coordinates (routes and trails on the map) load once, while the visitor reads the first scene,
    // so no page later in the visit waits for them or fetches them again.
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const run = () => void loadNodeCoords().catch(() => {});
    if (w.requestIdleCallback) w.requestIdleCallback(run);
    else window.setTimeout(run, 1500);
  }, [ready, bootSearch]);
  useEffect(() => {
    if (!expert) enterStoryMode();
  }, [expert]);
  useHotkeys();

  return (
    <div data-mode={expert ? "expert" : "story"} data-page={route.kind} className={`relative flex h-dvh w-full flex-col overflow-hidden bg-bg ${expert ? "min-h-[640px] min-w-[1280px]" : ""}`}>
      {expert ? (
        <TopBar page={route.kind} />
      ) : (
        <div className="absolute inset-x-0 top-0 z-30">
          <TopBar page={route.kind} />
        </div>
      )}

      <main className="relative min-h-0 flex-1 overflow-hidden" aria-label={expert ? "Map workspace" : "Map"}>
        <MapStage />
        {children}
        {expert && <Inspector />}
      </main>

      {expert && !presentation && (
        <>
          <MetricsRibbon />
          <div className="shrink-0 border-t border-border bg-bg">
            <Footer />
          </div>
        </>
      )}
      {expert && presentation && (
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
      <KeysDialog />
    </div>
  );
}

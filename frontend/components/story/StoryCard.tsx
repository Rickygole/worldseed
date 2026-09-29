"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowRight, ArrowUp, Check, Eye, HelpCircle, LayoutPanelLeft, Loader2, Route, Search, ShieldCheck, Square, Unlink } from "lucide-react";
import { announceText, type ActionId, type Chip, type SceneView } from "@/lib/ui/storyFigures";
import { askApplyTop, nextScene, removeBridgeInStory, revealScene, runStorySearch, showRoute, stepIndex, STORY_STEPS, stopStorySearch, type StoryScene } from "@/lib/ui/story";
import { goToStory, setUiMode } from "@/lib/ui/modes";
import { HOW, SIMULATED, T } from "@/lib/ui/storyCopy";
import BigNumber, { TONE_COLOR } from "../ui/BigNumber";
import Popover, { CaveatBody } from "../ui/Popover";
import { useSceneView } from "./useSceneView";
import StressCard from "./StressCard";
import ExplorePreview from "./ExplorePreview";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_IN = [0.4, 0, 1, 1] as const;

const ACTION_ICON: Record<ActionId, typeof ArrowRight> = {
  removeBridge: Unlink,
  gate: Unlink,
  reveal: Eye,
  route: Route,
  search: Search,
  stop: Square,
  apply: Check,
  next: ArrowRight,
  expert: LayoutPanelLeft,
};

function runAction(id: ActionId): void {
  switch (id) {
    case "removeBridge":
    case "gate":
      void removeBridgeInStory();
      return;
    case "reveal":
      void revealScene();
      return;
    case "route":
      void showRoute();
      return;
    case "search":
      void runStorySearch();
      return;
    case "stop":
      stopStorySearch();
      return;
    case "apply":
      askApplyTop();
      return;
    case "next": {
      const n = nextScene();
      if (n) goToStory(n);
      return;
    }
    case "expert":
      void setUiMode("expert");
      return;
  }
}

const CHIP_ICON = { held: ShieldCheck, up: ArrowUp, down: ArrowDown, range: null } as const;

/** One quiet chip beside the number; when it carries a caveat it opens it. */
function ChipView({ c }: { c: Chip }) {
  const Icon = c.icon ? CHIP_ICON[c.icon] : null;
  const color = c.tone === "neutral" ? "var(--color-text-2)" : TONE_COLOR[c.tone];
  const inner = (
    <>
      {Icon && <Icon size={14} aria-hidden />}
      <span>{c.text}</span>
      {c.caveat && <HelpCircle size={14} className="opacity-60" aria-hidden />}
    </>
  );
  const cls = "inline-flex min-h-8 items-center gap-2 rounded-full px-3 py-1 text-left text-sm";
  const style = { color, background: c.tone === "neutral" ? "rgb(148 163 184 / 0.1)" : `color-mix(in srgb, ${TONE_COLOR[c.tone]} 12%, transparent)` };
  if (!c.caveat) return <span className={cls} style={style}>{inner}</span>;
  return (
    <Popover title={c.caveat.title} trigger={inner} triggerClassName={`${cls} transition-[filter] duration-150 hover:brightness-125`} triggerStyle={style}>
      <CaveatBody c={c.caveat} />
    </Popover>
  );
}

/** The number tile: "about" and the "Simulated" tag above it, the unit after it, the caption and one chip below. */
function FigureBlock({ v }: { v: SceneView }) {
  const f = v.figure;
  if (!f) {
    return v.pending ? (
      <div aria-hidden>
        <div className="h-6" />
        <div className="skeleton h-16 w-48 md:h-[84px] md:w-56" />
        <div className="skeleton mt-3 h-5 w-64" />
      </div>
    ) : null;
  }
  return (
    <div className={`transition-opacity duration-200 ${v.pending ? "opacity-40" : ""}`}>
      <p className="flex h-6 items-center justify-between text-base text-text-2">
        <span>{f.prefix ?? ""}</span>
        {f.simulated !== false && <span className="text-2xs uppercase tracking-[0.12em] text-muted">{SIMULATED}</span>}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={f.key} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.25, ease: EASE_OUT } }} exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE_IN } }}>
            <BigNumber rollKey={f.key} value={f.value} format={f.format} className="text-display-sm font-medium tracking-[-0.035em] md:text-display" style={{ color: TONE_COLOR[f.tone] }} />
          </motion.span>
        </AnimatePresence>
        {f.unit && <span className="text-lg text-text-2 md:text-xl">{f.unit}</span>}
      </p>
      {v.caption && <p className="mt-1 text-base text-text-2">{v.caption}</p>}
      {v.chip && (
        <div className="mt-3">
          <ChipView c={v.chip} />
        </div>
      )}
    </div>
  );
}

function HowDoWeKnow({ v }: { v: SceneView }) {
  if (v.how.length === 0) return null;
  return (
    <Popover title={HOW} triggerClassName="link text-sm text-text-2 transition-colors duration-150" trigger={HOW}>
      <div className="-mr-2 max-h-[52vh] space-y-4 overflow-y-auto pr-2">
        {v.how.map((c) => (
          <section key={c.id + c.title}>
            <h3 className="mb-1 text-sm font-medium text-text">{c.title}</h3>
            <CaveatBody c={c} />
          </section>
        ))}
      </div>
    </Popover>
  );
}

/** `inlinePreview`: scene 6's tool tiles inside the card (phones); on wider screens they sit in their own panel. */
export default function StoryCard({ id, inlinePreview = false }: { id: StoryScene; inlinePreview?: boolean }) {
  const v = useSceneView(id);
  const reduced = !!useReducedMotion();
  const heading = useRef<HTMLHeadingElement>(null);
  const idx = stepIndex(id) ?? 0;

  // Focus follows the scene: the heading takes focus on every scene change, and on first paint when nothing else
  // holds focus (right after the intro closes), so keyboard and screen-reader users land on the new scene.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      const t = window.setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) heading.current?.focus({ preventScroll: true });
      }, 50);
      return () => window.clearTimeout(t);
    }
    heading.current?.focus({ preventScroll: true });
  }, [id]);

  // One polite announcement per scene or state change (not per progress tick).
  const [announce, setAnnounce] = useState("");
  const stateKey = `${id}|${v.state}|${v.pending ? "p" : "r"}|${v.sentence ?? ""}`;
  useEffect(() => {
    if (v.pending) return;
    const t = window.setTimeout(() => setAnnounce(announceText(v, idx + 1, STORY_STEPS.length)), 300);
    return () => window.clearTimeout(t);
    // Announce on state changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);

  const Icon = ACTION_ICON[v.action.id];
  const busy = v.state === "searching";
  const enter = (i: number) => (reduced ? { opacity: 1, transition: { duration: 0.12 } } : { opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE_OUT, delay: 0.06 * i } });
  const from = reduced ? { opacity: 0 } : { opacity: 0, y: 12 };

  return (
    <section aria-labelledby="scene-h" aria-busy={v.pending}>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={id} exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, y: 8, transition: { duration: 0.15, ease: EASE_IN } }}>
          <motion.div initial={from} animate={enter(0)}>
            <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted">
              Scene {idx + 1} of {STORY_STEPS.length}
            </p>
            <h2 ref={heading} id="scene-h" tabIndex={-1} className="display mt-1.5 text-lg font-medium text-text outline-none md:text-xl">
              {v.headline}
            </h2>
          </motion.div>

          <motion.div className="mt-5" initial={from} animate={enter(1)}>
            <FigureBlock v={v} />
          </motion.div>

          <motion.div className="mt-5" initial={from} animate={enter(2)}>
            {v.pending && !v.sentence ? (
              <div>
                <div className="space-y-2.5" aria-hidden>
                  <div className="skeleton h-6 w-full" />
                  <div className="skeleton h-6 w-2/3" />
                </div>
                <p className="mt-4 text-sm text-muted" role="status">
                  {T.common.computing}
                </p>
                <div className="progress-indeterminate mt-2 w-40" aria-hidden />
              </div>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={v.sentence ?? "na"}
                  className="max-w-[30ch] text-lg text-text md:text-[26px] md:leading-[34px]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } }}
                  exit={{ opacity: 0, transition: { duration: 0.1, ease: EASE_IN } }}
                >
                  {v.sentence ?? <span className="text-text-2">{T.common.notAvailable}</span>}
                </motion.p>
              </AnimatePresence>
            )}
            {v.note && <p className="mt-3 text-sm text-muted">{v.note}</p>}
          </motion.div>

          <motion.div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4" initial={from} animate={enter(3)}>
            <button
              type="button"
              className={`btn h-14 rounded-full px-6 text-lg ${v.action.variant === "light" ? "btn-light" : ""}`}
              disabled={v.action.disabled}
              onClick={() => runAction(v.action.id)}
              data-story-action
            >
              {busy ? <Loader2 size={20} className="animate-spin motion-reduce:animate-none" aria-hidden /> : v.action.id !== "next" && <Icon size={20} aria-hidden />}
              {v.action.label}
              {v.action.id === "next" && <ArrowRight size={20} aria-hidden />}
            </button>
            <HowDoWeKnow v={v} />
          </motion.div>
          {id === "fix" && v.state === "applied" && inlinePreview && <StressCard />}
          {id === "explore" && inlinePreview && (
            <div className="mt-6">
              <ExplorePreview />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

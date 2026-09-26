"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Loader2, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { useSearch } from "@/lib/ui/search";
import { shortModel } from "@/lib/ui/agentBridge";
import type { LensId } from "@/lib/sim";

/**
 * Guided tour (?tour=keybridge). Five steps; each "Do it" performs the real action on the live simulator,
 * and a step also completes when the judge does the same thing by hand. No recording is played back: the
 * search runs now, labeled by what it is (deterministic search when the AI planner is unavailable).
 */

const noop = () => () => {};
const tourParam = () => new URLSearchParams(window.location.search).get("tour");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Tour() {
  const param = useSyncExternalStore(noop, tourParam, () => null);
  const [closed, setClosed] = useState(false);
  if (param !== "keybridge" || closed) return null;
  return <TourCard onClose={() => setClosed(true)} />;
}

function TourCard({ onClose }: { onClose: () => void }) {
  const reduced = !!useReducedMotion();
  const ready = useApp((s) => s.status === "ready");
  const introOpen = useApp((s) => s.introOpen);
  const removed = useApp((s) => s.scenario.removedLinks.includes("key_bridge"));
  const lens = useApp((s) => s.lens);
  const phase = useSearch((s) => s.m?.phase ?? "idle");
  const health = useSearch((s) => s.health);
  const finalistCount = useSearch((s) => s.m?.finalists.length ?? 0);
  const missionLens = useSearch((s) => s.m?.mission?.lens);
  const freightPhase = missionLens === "freight" ? phase : "idle";
  const freightApplied = missionLens === "freight" && phase === "applied";
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<LensId>(["xharbor"]));
  const [lensesSeen, setLensesSeen] = useState(1);
  // Remember that the cross-harbor finalist was applied, even after a later freight search resets the machine.
  const [xhApplied, setXhApplied] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (phase === "applied" && missionLens !== "freight") setXhApplied(true);
  }, [phase, missionLens]);

  useEffect(() => {
    if (!seen.current.has(lens)) {
      seen.current.add(lens);
      setLensesSeen(seen.current.size);
    }
  }, [lens]);

  const ai = health.status === "available";
  const modeLabel = ai ? `Live AI planner (${shortModel(health.info.roles.planner)})` : "Deterministic search, not AI";

  const steps = [
    {
      title: "Remove the Key Bridge link",
      body: "The road network as of 1 March 2024 loses I-695 over the Patapsco. Every lens is recomputed in your browser.",
      done: removed,
      act: async () => useApp.getState().removeBridge(),
    },
    {
      title: "Inspect the hardest-hit place, then compare the lenses",
      body: "Opens the populated hexagon with the largest added cross-harbor time, then shows regional access (barely moves) and first response (unchanged) before returning to cross-harbor.",
      done: lensesSeen >= 3,
      act: async () => {
        const s = useApp.getState();
        const hex = s.current?.detail?.xharbor?.headline.addedMaxPopulatedHex ?? -1;
        if (hex >= 0) await s.selectHex(hex);
        await sleep(reduced ? 1200 : 3500);
        await s.selectHex(null);
        for (const l of ["access", "ems", "xharbor"] as LensId[]) {
          await s.setLens(l);
          await sleep(reduced ? 1200 : 3000);
        }
      },
    },
    {
      title: "Find a better future",
      body: `${modeLabel}. Goal: keep the slow end (p90) of cross-harbor trips within 1 min of the pre-collapse network, options up to $$. Pressing "Do it" confirms that goal and runs the search.`,
      done: xhApplied || (missionLens !== "freight" && (phase === "finalists" || phase === "applied")),
      act: async () => {
        const app = useApp.getState();
        app.setRightOpen(true);
        const s = useSearch.getState();
        if (s.m?.phase !== "idle") s.resetSearch();
        s.setDraft({ lens: "access", metric: "p90", targetDelta: 60, maxCostTier: "$$" });
        useSearch.setState({ stage: "confirm" });
        await useSearch.getState().confirmAndRun();
      },
    },
    {
      title: "Apply a finalist",
      body: "Opens the confirmation for the top-ranked finalist. Nothing changes until you press Apply there. The terrain then sinks outward from the option.",
      done: xhApplied,
      act: async () => {
        const f = useSearch.getState().m?.finalists[0];
        if (f) useSearch.getState().askApply(f.bundleId);
      },
    },
    {
      title: "Optional: search the freight goal",
      body:
        freightPhase === "finalists" || freightPhase === "applied"
          ? "Freight finalists are ready. Do it opens the confirmation for the top one (an escorted hazmat window); nothing changes until you press Apply there."
          : `Hazmat trucks cannot use the harbor tunnels (MDTA), so they detour furthest. Do it confirms the goal "typical hazmat detour at most +10 min over pre-collapse, options up to $$" and runs the ${ai ? "search" : "deterministic search (no AI)"} over the freight options.`,
      done: freightApplied,
      act: async () => {
        const app = useApp.getState();
        const s = useSearch.getState();
        if (s.m?.mission?.lens === "freight" && s.m.phase === "finalists") {
          const f = s.m.finalists[0];
          if (f) s.askApply(f.bundleId);
          return;
        }
        app.setRightOpen(true);
        s.resetSearch();
        s.setDraft({ lens: "freight", metric: "p50", targetDelta: 600, maxCostTier: "$$" });
        useSearch.setState({ stage: "confirm" });
        await useSearch.getState().confirmAndRun();
      },
    },
  ];

  // Advance automatically when the current step is done (by the button or by hand).
  const cur = steps[Math.min(step, steps.length - 1)];
  useEffect(() => {
    if (cur.done && step < steps.length - 1) {
      const t = setTimeout(() => setStep((v) => v + 1), 600);
      return () => clearTimeout(t);
    }
  }, [cur.done, step, steps.length]);

  if (!ready || introOpen) return null;
  const blocked = step === 3 && finalistCount === 0 && !xhApplied;

  // A slim coach strip under the top bar: never over the map, always dismissible, fully keyboard reachable.
  return (
    <motion.section
      aria-label="Guided tour"
      className="flex shrink-0 items-center gap-4 border-b border-border bg-surface px-4 py-2"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex shrink-0 flex-col gap-1">
        <p className="label whitespace-nowrap">
          Guided tour <span className="num">{Math.min(step + 1, steps.length)} / {steps.length}</span>
        </p>
        <ol className="flex gap-1" aria-hidden>
          {steps.map((s, i) => (
            <li key={i} className="h-1 w-6 rounded-full" style={{ background: s.done ? "var(--color-ok)" : i === step ? "var(--color-text)" : "var(--color-border)" }} />
          ))}
        </ol>
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          {cur.done && <Check size={14} className="text-ok" aria-label="done" />}
          {cur.title}
          <span className="font-normal text-muted">· {modeLabel}; no recorded run is played</span>
        </h2>
        <p className="truncate text-xs text-muted" title={cur.body}>
          {blocked ? "Run step 3 first: there are no finalists yet." : cur.body}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          className="btn h-8 px-3 text-sm"
          style={{ borderColor: "rgb(76 141 255 / 0.6)" }}
          disabled={busy || cur.done || blocked}
          onClick={async () => {
            setBusy(true);
            try {
              await cur.act();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />}
          {cur.done ? "Done" : "Do it"}
        </button>
        {step < steps.length - 1 ? (
          <button className="btn h-8 px-3 text-sm" onClick={() => setStep((v) => v + 1)}>
            Skip step
          </button>
        ) : (
          cur.done && (
            <button className="btn h-8 px-3 text-sm" onClick={onClose}>
              Finish
            </button>
          )
        )}
        <button className="btn-icon !h-8 !w-8" aria-label="End the tour" onClick={onClose}>
          <X size={14} aria-hidden />
        </button>
      </div>
    </motion.section>
  );
}

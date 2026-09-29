"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft, Loader2, Search } from "lucide-react";
import { useApp } from "@/lib/store";
import { useDialog } from "@/lib/ui/useDialog";
import { useSearch } from "@/lib/ui/search";
import { createFetchAgentApi } from "@/lib/agent/api";
import { validateParseOutput } from "@/lib/agent/validator";
import { matchRoad } from "@/lib/server/gazetteerMatch";
import type { GazetteerEntry } from "@/lib/agent/catalog";
import type { MutationRecord } from "@/lib/sim";
import { lensLabel, metricLabel } from "./planner/labels";
import { setUiMode } from "@/lib/ui/modes";
import { goScene } from "@/lib/ui/story";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

/** A proposed action waiting for the user's explicit "Run". Nothing changes before that click. */
interface Pending {
  text: string;
  note?: string;
  run?: () => void;
}

const api = createFetchAgentApi();

/** Cmd-K: fixed commands, local shortcuts ("close <road or link>", "reset") and, when the AI planner is up, a goal in plain language. */
export default function CommandBar() {
  const open = useApp((s) => s.commandOpen);
  return <AnimatePresence>{open && <CommandBarInner key="cmd" />}</AnimatePresence>;
}

function closeMutation(e: GazetteerEntry): MutationRecord | null {
  const at = new Date().toISOString();
  if (e.kind === "link" && e.ref.link) return { id: `user-close-${e.id}`, m: { kind: "close_link", linkId: e.ref.link }, origin: "user", label: `Close ${e.name}`, confirmedAt: at };
  if (e.kind === "road" && e.ref.edges && e.ref.edges.length > 0) return { id: `user-close-${e.id}`, m: { kind: "close_edges", edges: e.ref.edges, label: `Close ${e.name}` }, origin: "user", label: `Close ${e.name}`, confirmedAt: at };
  return null;
}

function CommandBarInner() {
  const setOpen = useApp((s) => s.setCommandOpen);
  const ref = useDialog<HTMLDivElement>(true, () => setOpen(false));
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [parsing, setParsing] = useState(false);
  const catalog = useSearch((s) => s.catalog);
  const aiUp = useSearch((s) => s.health.status === "available");

  const cmds = useMemo<Cmd[]>(() => {
    const s = useApp.getState();
    const search = useSearch.getState();
    return [
      { id: "remove", label: "Remove Key Bridge link", run: () => void s.removeBridge() },
      { id: "restore", label: "Restore Key Bridge link", run: () => void s.restoreBridge() },
      { id: "reset", label: "Reset world", hint: "R", run: () => void s.resetWorld() },
      { id: "lens-x", label: "Lens: Cross-harbor access", run: () => void s.setLens("xharbor") },
      { id: "lens-a", label: "Lens: Regional access", run: () => void s.setLens("access") },
      { id: "lens-e", label: "Lens: First response (EMS)", run: () => void s.setLens("ems") },
      { id: "find", label: "Find a better future", run: () => { void setUiMode("expert"); void search.find(s.goal); } },
      { id: "closures", label: "Check live closure notices", run: () => s.setClosuresOpen(true) },
      { id: "evidence", label: "Reality check: news sources", run: () => s.setEvidenceOpen(true) },
      { id: "freight", label: "Freight and hazmat trips", run: () => s.setFreightOpen(true) },
      { id: "present", label: "Toggle presentation mode (Expert)", hint: "P", run: () => s.togglePresentation() },
      { id: "orbit", label: "Toggle camera orbit", run: () => s.toggleOrbit() },
      { id: "assume", label: "Open data and assumptions", run: () => s.setAssumptionsOpen(true) },
      { id: "about", label: "About and intended use", run: () => s.setAboutOpen(true) },
      { id: "story", label: "Guided story", hint: "E", run: () => void setUiMode("story") },
      { id: "expert", label: "Expert mode", hint: "E", run: () => void setUiMode("expert") },
      { id: "intro", label: "Replay intro", run: () => { s.setMode("story"); void goScene("intro"); } },
    ];
  }, []);

  const list = cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));

  const exec = (c: Cmd | undefined) => {
    if (!c || c.disabled) return;
    setOpen(false);
    c.run();
  };

  /** Local shortcuts first; then the AI parser for a goal in plain language (when available). */
  const interpret = async (text: string) => {
    const t = text.trim();
    const app = useApp.getState();
    if (/^reset( world)?$/i.test(t)) {
      setPending({ text: "Reset the world to the pre-collapse network. Run?", run: () => void app.resetWorld() });
      return;
    }
    const close = /^(?:close|remove)\s+(.+)$/i.exec(t);
    if (close) {
      // The road list loads after the world; wait for it rather than reporting "no match".
      if (!useSearch.getState().catalog) await useSearch.getState().boot();
      const cat = useSearch.getState().catalog;
      if (!cat) return setPending({ text: "The road list could not be loaded, so roads cannot be matched right now." });
      const r = matchRoad(cat.gazetteer, close[1]);
      if (r.status === "none") return setPending({ text: `No road or link in the model area matches "${close[1]}".` });
      if (r.status === "ambiguous") return setPending({ text: `"${close[1]}" matches ${r.entries.length} roads. Be more specific.`, note: r.entries.slice(0, 4).map((e) => e.name).join(", ") });
      const e = r.entry;
      if (e.ref.link === "L-KEYBRIDGE") return setPending({ text: "Close: Francis Scott Key Bridge (I-695). Run?", run: () => void app.removeBridge() });
      const mut = closeMutation(e);
      if (!mut) return setPending({ text: `${e.name} is a corridor; name one of its roads or links to close it.` });
      return setPending({
        text: `Close: ${e.name}. Run?`,
        note: "Adds a closure to the simulated road network. Reset (R) removes it.",
        run: () => {
          app.log("USER", `Close ${e.name} (command bar)`);
          void app.applyScenario({ removedLinks: app.scenario.removedLinks, mutations: [...(app.scenario.mutations ?? []), mut] });
        },
      });
    }
    if (!aiUp) {
      setPending({ text: "No command matches. Plain-language goals need the AI planner, which is unavailable; try \"close harbor tunnel\" or \"reset\"." });
      return;
    }
    if (!catalog || t.length < 3) return;
    setParsing(true);
    try {
      const out = await api.parse({ missionId: `cmdk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, text: t.slice(0, 300) });
      if (out.status !== "ok") return setPending({ text: out.message });
      const check = validateParseOutput(out.result, { catalog });
      if (!check.ok) return setPending({ text: "The goal could not be read from your text (parser output rejected). Rephrase it." });
      const p = check.value;
      setPending({
        text: `Mission: ${lensLabel(p.lens)}, lower the ${metricLabel(p.lens, p.goal.metric).toLowerCase()}, options up to ${p.constraints.maxCostTier}. Set it up?`,
        note: `Read by the AI parser (${out.model}). You pick the target and confirm before anything runs.`,
        run: () => {
          const s = useSearch.getState();
          s.setDraft({ lens: p.lens, metric: p.goal.metric, maxCostTier: p.constraints.maxCostTier, targetDelta: p.goal.metric === "isolatedCount" ? 0 : p.lens === "freight" ? 600 : 60 });
          app.setGoal(t);
          void setUiMode("expert");
          useSearch.setState({ stage: "confirm" });
        },
      });
    } finally {
      setParsing(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      style={{ background: "rgb(10 14 20 / 0.55)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.15 }}
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Command bar" className="sheet w-[560px] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4">
          {parsing ? <Loader2 size={16} className="animate-spin text-muted motion-reduce:animate-none" aria-hidden /> : <Search size={16} className="text-muted" aria-hidden />}
          <input
            data-autofocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
              setPending(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((v) => Math.min(list.length - 1, v + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((v) => Math.max(0, v - 1));
              } else if (e.key === "Enter") {
                if (pending?.run) {
                  setOpen(false);
                  pending.run();
                } else if (list.length > 0 && !/^(close|remove|reset)\b/i.test(q.trim())) exec(list[sel]);
                else void interpret(q);
              }
            }}
            placeholder={aiUp ? "Type a command, \"close harbor tunnel\", or a goal in plain language" : "Type a command, \"close harbor tunnel\", or \"reset\""}
            aria-label="Command"
            className="h-12 flex-1 bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
          />
          <span className="kbd">Esc</span>
        </div>
        {pending && (
          <div className="border-b border-border p-3" role="status">
            <p className="text-sm">{pending.text}</p>
            {pending.note && <p className="mt-1 text-xs text-muted">{pending.note}</p>}
            {pending.run && (
              <div className="mt-2 flex gap-2">
                <button
                  className="btn h-8 border-ai px-3 text-xs"
                  onClick={() => {
                    setOpen(false);
                    pending.run!();
                  }}
                >
                  Run <CornerDownLeft size={12} aria-hidden />
                </button>
                <button className="btn h-8 px-3 text-xs" onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
        <ul className="max-h-[320px] overflow-y-auto p-2">
          {list.length === 0 && !pending && (
            <li className="px-3 py-2 text-sm text-muted">
              No matching command. Press Enter to {/^(close|remove|reset)\b/i.test(q.trim()) || !aiUp ? "interpret it" : "read it as a goal with the AI parser"}.
            </li>
          )}
          {list.map((c, i) => (
            <li key={c.id}>
              <button
                disabled={c.disabled}
                onMouseEnter={() => setSel(i)}
                onClick={() => exec(c)}
                className="flex w-full items-center justify-between rounded-ctl px-3 py-2 text-left text-sm disabled:opacity-50"
                style={{ background: i === sel ? "var(--color-surface-2)" : "transparent" }}
              >
                <span>{c.label}</span>
                {c.hint && <span className="kbd">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

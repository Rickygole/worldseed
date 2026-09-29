"use client";

import { useEffect, useRef } from "react";
import { ChevronRight, Newspaper, RotateCcw, Scale, Truck, Undo2, Unlink } from "lucide-react";
import { useApp, isBridgeRemoved } from "@/lib/store";
import { fmtDate } from "@/lib/format";
import { LENSES } from "@/lib/ui/lenses";
import { loadManifest } from "@/lib/ui/snapshotAux";
import { useSnapshotFile } from "@/lib/ui/useSnapshotFile";
import type { LensId } from "@/lib/sim/contract";
import Collapsible from "../ui/Collapsible";
import MapLegend from "../MapLegend";
import Explainer from "../Explainer";

/** One line per lens: what the terrain shows. Tooltips carry the long form (lib/ui/lenses.ts). */
const LENS_HINT: Record<string, string> = {
  xharbor: "Trips to jobs on the other shore",
  access: "Drive to the region's main job centers",
  ems: "Nearest fire or ambulance station",
};

function ScenarioSection() {
  const removed = useApp(isBridgeRemoved);
  const ready = useApp((s) => s.status === "ready");
  const busy = useApp((s) => s.busy);
  const mutations = useApp((s) => s.scenario.mutations?.length ?? 0);
  const removeBridge = useApp((s) => s.removeBridge);
  const restoreBridge = useApp((s) => s.restoreBridge);
  const resetWorld = useApp((s) => s.resetWorld);
  const { data: manifest } = useSnapshotFile(loadManifest, ready);
  return (
    <section aria-labelledby="rail-scenario" className="px-4 pb-4 pt-4">
      <h2 id="rail-scenario" className="label mb-3">
        Scenario
      </h2>
      {removed ? (
        <button type="button" className="btn h-10 w-full justify-start" disabled={!ready || busy} onClick={() => void restoreBridge()}>
          <Undo2 size={16} aria-hidden />
          Restore Key Bridge link
        </button>
      ) : (
        <button type="button" className="btn h-10 w-full justify-start border-[rgb(255_61_113/0.55)]" disabled={!ready || busy} onClick={() => void removeBridge()}>
          <Unlink size={16} className="text-critical" aria-hidden />
          Remove Key Bridge link
        </button>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-muted" aria-live="polite">
          {busy ? "Recalculating in your browser." : mutations > 0 ? `${mutations} change${mutations === 1 ? "" : "s"} applied` : `Roads as of ${manifest?.osmDate ? fmtDate(manifest.osmDate) : "1 March 2024"}`}
        </p>
        <button type="button" className="btn btn-ghost h-8 shrink-0 px-2 text-xs" disabled={!ready || busy} onClick={() => void resetWorld()} title="Reset the scenario (R)">
          <RotateCcw size={12} aria-hidden />
          Reset <span className="kbd">R</span>
        </button>
      </div>
    </section>
  );
}

function LensSection() {
  const lens = useApp((s) => s.lens);
  const setLens = useApp((s) => s.setLens);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const next = (i + d + LENSES.length) % LENSES.length;
    refs.current[next]?.focus();
    void setLens(LENSES[next].id as LensId);
  };
  return (
    <section aria-labelledby="rail-lens" className="border-t border-border px-4 py-4">
      <h2 id="rail-lens" className="label mb-2">
        Map lens
      </h2>
      <div role="radiogroup" aria-labelledby="rail-lens" className="space-y-1">
        {LENSES.map((l, i) => {
          const on = l.id === lens;
          return (
            <button
              key={l.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              title={l.legend}
              onKeyDown={(e) => onKey(e, i)}
              onClick={() => void setLens(l.id)}
              className={`relative flex w-full flex-col rounded-[10px] px-3 py-2 text-left transition-colors duration-150 ${on ? "bg-[rgb(238_242_247/0.08)]" : "hover:bg-[rgb(148_163_184/0.08)]"}`}
            >
              <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-text transition-opacity duration-200" style={{ opacity: on ? 1 : 0 }} />
              <span className={`text-sm font-medium ${on ? "text-text" : "text-text-2"}`}>{l.label}</span>
              <span className="text-xs text-muted">{LENS_HINT[l.id]}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 px-1">
        <MapLegend />
      </div>
    </section>
  );
}

function ToolsSection() {
  const setFreightOpen = useApp((s) => s.setFreightOpen);
  const setClosuresOpen = useApp((s) => s.setClosuresOpen);
  const setEvidenceOpen = useApp((s) => s.setEvidenceOpen);
  const tools = [
    { label: "Hazmat and car trips", hint: "Freight detours around the tunnels", icon: Truck, run: () => setFreightOpen(true) },
    { label: "Closure notices", hint: "News reports, confirmed one at a time", icon: Newspaper, run: () => setClosuresOpen(true) },
    { label: "Reality check", hint: "Published sources about the 2024 detours (unverified)", icon: Scale, run: () => setEvidenceOpen(true) },
  ];
  return (
    <section aria-labelledby="rail-tools" className="border-t border-border px-2 py-3">
      <h2 id="rail-tools" className="label mb-1 px-2">
        Tools
      </h2>
      <ul>
        {tools.map((t) => (
          <li key={t.label}>
            <button type="button" onClick={t.run} className="group flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors duration-150 hover:bg-[rgb(148_163_184/0.08)]">
              <t.icon size={16} className="shrink-0 text-muted group-hover:text-text" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-text">{t.label}</span>
                <span className="block truncate text-xs text-muted">{t.hint}</span>
              </span>
              <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EventLog() {
  const events = useApp((s) => s.events);
  const open = useApp((s) => s.logOpen);
  const setOpen = useApp((s) => s.setLogOpen);
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [events.length, open]);
  return (
    <Collapsible title="Event log" meta={<span className="num">{events.length}</span>} open={open} onOpenChange={setOpen} className="border-t border-border px-4" headerClassName="py-3">
      <ol ref={ref} aria-live="polite" className="num max-h-[168px] space-y-2 overflow-y-auto pb-4 text-xs leading-4">
        {events.map((e) => (
          <li key={e.id} className="grid grid-cols-[56px_1fr] gap-x-2">
            <span className="text-muted">{e.time}</span>
            <span className={e.tag === "USER" ? "text-text" : "text-muted"}>{e.text}</span>
          </li>
        ))}
      </ol>
    </Collapsible>
  );
}

/** Expert mode, left rail: scenario, lens (with the legend), tools, the explainer and the event log. */
export default function ExpertRail() {
  return (
    <aside aria-label="Scenario and lenses" className="panel flex h-full flex-col overflow-hidden" style={{ width: "var(--ws-left)" }}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ScenarioSection />
        <LensSection />
        <ToolsSection />
        <Collapsible title="What this shows" defaultOpen className="border-t border-border px-4" headerClassName="py-3">
          <Explainer />
        </Collapsible>
      </div>
      <EventLog />
    </aside>
  );
}

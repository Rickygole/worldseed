"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, PanelLeftClose, RotateCcw, Undo2, Unlink } from "lucide-react";
import { useApp, isBridgeRemoved } from "@/lib/store";
import { fmtDate } from "@/lib/format";
import { loadManifest } from "@/lib/ui/snapshotAux";
import { useSnapshotFile } from "@/lib/ui/useSnapshotFile";
import Explainer from "./Explainer";

function EventLog() {
  const events = useApp((s) => s.events);
  const open = useApp((s) => s.logOpen);
  const setOpen = useApp((s) => s.setLogOpen);
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [events.length, open]);
  const last = events[events.length - 1];

  return (
    <section className="shrink-0 border-t border-border" aria-label="Event log">
      <button
        className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left hover:bg-surface-2"
        aria-expanded={open}
        aria-controls="event-log"
        onClick={() => setOpen(!open)}
      >
        <span className="label">Event log</span>
        <span className="flex items-center gap-2">
          <span className="num text-xs text-muted">{events.length}</span>
          <ChevronDown size={14} className="text-muted transition-transform duration-150" style={{ transform: open ? "rotate(180deg)" : "none" }} aria-hidden />
        </span>
      </button>
      {open ? (
        <ol id="event-log" ref={ref} aria-live="polite" className="num max-h-[168px] space-y-2 overflow-y-auto px-4 pb-4 text-xs leading-4">
          {events.map((e) => (
            <li key={e.id} className="grid grid-cols-[56px_32px_1fr] gap-x-2">
              <span className="text-muted">{e.time}</span>
              <span className={e.tag === "USER" ? "text-text" : "text-muted"}>{e.tag}</span>
              <span className={e.tag === "USER" ? "text-text" : "text-muted"}>{e.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        last && (
          <p id="event-log" className="num truncate px-4 pb-2 text-xs text-muted" title={last.text}>
            {last.text}
          </p>
        )
      )}
    </section>
  );
}

function ScenarioControls() {
  const removed = useApp(isBridgeRemoved);
  const ready = useApp((s) => s.status === "ready");
  const busy = useApp((s) => s.busy);
  const removeBridge = useApp((s) => s.removeBridge);
  const restoreBridge = useApp((s) => s.restoreBridge);
  const resetWorld = useApp((s) => s.resetWorld);
  const { data: manifest } = useSnapshotFile(loadManifest, ready);

  return (
    <section className="shrink-0 border-b border-border p-4" aria-label="Scenario">
      <h2 className="sr-only">Change the world</h2>
      {removed ? (
        <button className="btn w-full justify-start" disabled={!ready || busy} onClick={() => void restoreBridge()}>
          <Undo2 size={16} aria-hidden />
          Restore Key Bridge link
        </button>
      ) : (
        <button
          className="btn w-full justify-start"
          style={{ borderColor: "rgb(255 61 113 / 0.6)" }}
          disabled={!ready || busy}
          onClick={() => void removeBridge()}
        >
          <Unlink size={16} aria-hidden />
          Remove Key Bridge link
        </button>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted">{busy ? "Recomputing on the road network..." : `I-695 over the Patapsco.${manifest?.osmDate ? ` Roads as of ${fmtDate(manifest.osmDate)}.` : ""}`}</p>
        <button className="btn h-8 shrink-0 px-2 text-xs" disabled={!ready || busy} onClick={() => void resetWorld()} title="Reset world (R)">
          <RotateCcw size={12} aria-hidden />
          Reset <span className="kbd">R</span>
        </button>
      </div>
    </section>
  );
}

export default function LeftPanel() {
  const setLeftOpen = useApp((s) => s.setLeftOpen);
  const removed = useApp(isBridgeRemoved);
  return (
    <div className="panel flex h-full flex-col overflow-hidden" style={{ width: "var(--ws-left)" }}>
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium">Scenario</span>
          <span className="chip h-6 px-2 text-xs" style={removed ? { color: "var(--color-critical)", borderColor: "rgb(255 61 113 / 0.5)" } : undefined}>
            {removed ? "Key Bridge removed" : "Baseline"}
          </span>
        </span>
        <button className="btn-icon" aria-label="Collapse scenario panel" onClick={() => setLeftOpen(false)}>
          <PanelLeftClose size={16} aria-hidden />
        </button>
      </div>
      <ScenarioControls />
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-y-auto">
          <Explainer />
        </div>
        {/* Scroll hint: the story continues below. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-6" style={{ background: "linear-gradient(to bottom, rgb(17 23 34 / 0), rgb(17 23 34 / 0.95))" }} />
      </div>
      <EventLog />
    </div>
  );
}

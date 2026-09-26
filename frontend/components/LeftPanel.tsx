"use client";

import { useEffect, useRef } from "react";
import { PanelLeftClose, RotateCcw, Unlink } from "lucide-react";
import { useApp, isBridgeRemoved } from "@/lib/store";

function EventLog() {
  const events = useApp((s) => s.events);
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [events.length]);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Event log">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="label">Event log</h2>
        <span className="num text-xs text-muted">{events.length}</span>
      </div>
      <ol
        ref={ref}
        aria-live="polite"
        className="num min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4 text-xs leading-4"
      >
        {events.map((e) => (
          <li key={e.id} className="grid grid-cols-[56px_36px_1fr] gap-x-2">
            <span className="text-muted">{e.time}</span>
            <span className={e.tag === "USER" ? "text-text" : "text-muted"}>{e.tag}</span>
            <span className={e.tag === "USER" ? "text-text" : "text-muted"}>{e.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function VirtualTable() {
  const removed = useApp(isBridgeRemoved);
  const ready = useApp((s) => s.status === "ready");
  const removeBridge = useApp((s) => s.removeBridge);
  const restoreBridge = useApp((s) => s.restoreBridge);
  const resetWorld = useApp((s) => s.resetWorld);

  return (
    <section className="border-t border-border p-4" aria-label="Virtual table">
      <h2 className="label mb-2">Virtual table</h2>
      <div className="rounded-ctl border border-dashed border-border p-2">
        <p className="mb-2 text-xs text-muted">Palette. The only disruption in v1.</p>
        <button
          className="btn w-full justify-start"
          style={{ borderColor: removed ? undefined : "rgb(255 61 113 / 0.6)" }}
          disabled={!ready || removed}
          onClick={() => void removeBridge()}
        >
          <Unlink size={16} aria-hidden />
          Remove Key Bridge link
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button className="btn" disabled={!ready || !removed} onClick={() => void restoreBridge()}>
          Restore
        </button>
        <button className="btn" disabled={!ready} onClick={() => void resetWorld()} title="Reset world (R)">
          <RotateCcw size={14} aria-hidden />
          Reset <span className="kbd">R</span>
        </button>
      </div>
    </section>
  );
}

export default function LeftPanel() {
  const setLeftOpen = useApp((s) => s.setLeftOpen);
  return (
    <div className="panel flex h-full flex-col overflow-hidden" style={{ width: "var(--ws-left)" }}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium">Scenario</span>
        <button className="btn-icon" aria-label="Collapse left panel" onClick={() => setLeftOpen(false)}>
          <PanelLeftClose size={16} />
        </button>
      </div>
      <EventLog />
      <VirtualTable />
    </div>
  );
}

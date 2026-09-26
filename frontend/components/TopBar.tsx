"use client";

import { useEffect, useState } from "react";
import { Command, Cpu, FileText, GitBranch, Info, Presentation, Sprout, Unlink } from "lucide-react";
import { useApp, isBridgeRemoved } from "@/lib/store";

function ConnectionDot() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return (
    <span className="chip" title={online ? "Network connected (map tiles: OpenFreeMap)" : "Offline: map tiles unavailable; results already loaded still work"}>
      <span className="inline-block size-2 rounded-full" style={{ background: online ? "var(--color-ok)" : "var(--color-warn)" }} aria-hidden />
      <span className="text-muted">{online ? "Online" : "Offline"}</span>
    </span>
  );
}

export default function TopBar() {
  const runnerLabel = useApp((s) => s.runnerLabel);
  const runnerText = useApp((s) => s.current?.detail?.runnerText);
  const removed = useApp(isBridgeRemoved);
  const setAssumptionsOpen = useApp((s) => s.setAssumptionsOpen);
  const setCommandOpen = useApp((s) => s.setCommandOpen);
  const setAboutOpen = useApp((s) => s.setAboutOpen);
  const togglePresentation = useApp((s) => s.togglePresentation);

  return (
    <header className="z-20 flex shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4" style={{ height: "var(--ws-topbar)" }}>
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex items-center gap-2">
          <Sprout size={18} className="text-ok" aria-hidden />
          <h1 className="text-base font-bold tracking-[0.18em]">WORLDSEED</h1>
        </div>
        <span className="h-5 w-px bg-border max-[1439px]:hidden" aria-hidden />
        <span className="truncate text-sm text-muted max-[1439px]:hidden">Key Bridge Region</span>
        <span className="chip" title="Current scenario">
          {removed ? <Unlink size={12} className="text-critical" aria-hidden /> : <GitBranch size={12} aria-hidden />}
          <span className="text-muted">Scenario</span>
          <span>{removed ? "Key Bridge link removed" : "Baseline"}</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button className="chip hover:border-muted" onClick={() => setAboutOpen(true)} title="Simulated times on historical open data. Not affiliated with any agency or hospital.">
          <Info size={12} aria-hidden />
          <span>Planning simulation, not dispatch</span>
        </button>
        <span className="chip" title={runnerText ?? "Every result is computed on this device"}>
          <Cpu size={12} aria-hidden />
          <span className="text-muted">Runner</span>
          <span>{runnerLabel}</span>
        </span>
        <ConnectionDot />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <button className="btn h-8 px-3" onClick={() => setAssumptionsOpen(true)}>
          <FileText size={14} aria-hidden />
          Assumptions
        </button>
        <button className="btn h-8 px-3" onClick={() => setCommandOpen(true)} aria-label="Open command bar (Cmd or Ctrl + K)">
          <Command size={14} aria-hidden />
          <span className="kbd">K</span>
        </button>
        <button className="btn-icon" onClick={togglePresentation} aria-label="Presentation mode (P)" title="Presentation mode (P)">
          <Presentation size={16} aria-hidden />
        </button>
      </div>
    </header>
  );
}

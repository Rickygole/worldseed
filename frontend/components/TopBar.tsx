"use client";

import { useEffect, useState } from "react";
import { Clock, Command, Cpu, FileText, GitBranch, Presentation, Sprout, Unlink } from "lucide-react";
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
    <span
      className="chip"
      title={online ? "Network connected (map tiles: OpenFreeMap)" : "Offline: map tiles unavailable"}
    >
      <span
        className="inline-block size-2 rounded-full"
        style={{ background: online ? "var(--color-ok)" : "var(--color-warn)" }}
        aria-hidden
      />
      <span className="text-muted">{online ? "Online" : "Offline"}</span>
    </span>
  );
}

export default function TopBar() {
  const runnerLabel = useApp((s) => s.runnerLabel);
  const removed = useApp(isBridgeRemoved);
  const setAssumptionsOpen = useApp((s) => s.setAssumptionsOpen);
  const setCommandOpen = useApp((s) => s.setCommandOpen);
  const togglePresentation = useApp((s) => s.togglePresentation);

  return (
    <header
      className="z-20 flex shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4"
      style={{ height: "var(--ws-topbar)" }}
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex items-center gap-2">
          <Sprout size={18} className="text-ok" aria-hidden />
          <span className="text-base font-bold tracking-[0.18em]">WORLDSEED</span>
        </div>
        <span className="h-5 w-px bg-border" aria-hidden />
        <span className="truncate text-sm text-muted">Key Bridge Region</span>
        <span className="chip" title="Current scenario">
          {removed ? <Unlink size={12} aria-hidden /> : <GitBranch size={12} aria-hidden />}
          <span className="text-muted">Scenario</span>
          <span className="num">{removed ? "Key Bridge link removed" : "Baseline"}</span>
        </span>
        <span className="chip" title="Time-of-day assumption (fixed in this build)">
          <Clock size={12} aria-hidden />
          <span className="num">Weekday 08:00</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="chip" title="Where the simulation runs">
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
        <button className="btn h-8 px-3" onClick={() => setCommandOpen(true)} aria-label="Open command bar">
          <Command size={14} aria-hidden />
          <span className="kbd">K</span>
        </button>
        <button className="btn-icon" onClick={togglePresentation} aria-label="Presentation mode (P)" title="Presentation mode (P)">
          <Presentation size={16} />
        </button>
      </div>
    </header>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Command, Cpu, FileText, GitBranch, Info, Presentation, Sprout, Unlink } from "lucide-react";
import { useApp, isBridgeRemoved } from "@/lib/store";
import { useSearch } from "@/lib/ui/search";
import { shortModel } from "@/lib/ui/agentBridge";

/** Real system state from /api/health: whether the AI planner is available, and why not. */
function SystemState() {
  const h = useSearch((s) => s.health);
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
  let dot = "var(--color-muted)";
  let text = "Checking AI planner";
  let title = "Asking /api/health whether the AI planner is available.";
  if (!online) {
    dot = "var(--color-warn)";
    text = "Offline";
    title = "Offline: map tiles and the AI planner are unreachable. Results already computed still work.";
  } else if (h.status === "available") {
    dot = "var(--color-ok)";
    text = `AI planner: ${shortModel(h.info.roles.planner)}`;
    title = `AI planner available. Roles: ${Object.entries(h.info.roles).map(([k, v]) => `${k} ${shortModel(v)}`).join(", ")}.`;
  } else if (h.status === "unavailable") {
    dot = "var(--color-warn)";
    text = "AI planner unavailable";
    title = `${h.info.degradedReason === "budget_exhausted" ? "Daily AI budget reached." : h.info.providerConfigured ? "The model provider is not reachable." : "No model provider is configured for this deployment."} Deterministic search (no AI) is available.`;
  } else if (h.status === "unreachable") {
    dot = "var(--color-warn)";
    text = "AI planner unavailable";
    title = "The health check did not answer. Deterministic search (no AI) is available.";
  }
  return (
    <span className="chip" title={title} role="status">
      <span className="inline-block size-2 rounded-full" style={{ background: dot }} aria-hidden />
      <span className="text-muted">{text}</span>
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
        <span className="h-5 w-px bg-border max-[1535px]:hidden" aria-hidden />
        <span className="truncate text-sm text-muted max-[1535px]:hidden">Key Bridge Region</span>
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
        <SystemState />
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

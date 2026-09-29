"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Command, FileText, Keyboard, Sprout, Unlink, GitBranch } from "lucide-react";
import { useApp, isBridgeRemoved } from "@/lib/store";
import { useSearch } from "@/lib/ui/search";
import { shortModel } from "@/lib/ui/agentBridge";
import { useStory } from "@/lib/ui/story";
import ModeToggle from "./ui/ModeToggle";
import StoryBar from "./story/StoryBar";
import type { PageKind } from "@/lib/ui/routes";

/** Real system state from /api/health: whether the AI planner is available, and why not. */
export function SystemState() {
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
    dot = "var(--color-ai)";
    text = `AI planner: ${shortModel(h.info.roles.planner)}`;
    title = `AI planner available. Roles: ${Object.entries(h.info.roles).map(([k, v]) => `${k} ${shortModel(v)}`).join(", ")}.`;
  } else if (h.status === "unavailable" || h.status === "unreachable") {
    dot = "var(--color-muted)";
    text = "Deterministic search (no AI)";
    title =
      h.status === "unreachable"
        ? "The health check did not answer, so the AI planner is unavailable. Deterministic search (no AI) is available."
        : `${h.info.degradedReason === "budget_exhausted" ? "Daily AI budget reached." : h.info.providerConfigured ? "The model provider is not reachable." : "No model provider is configured for this deployment."} AI planner unavailable; deterministic search (no AI) is available.`;
  }
  return (
    <span className="chip max-w-[260px]" title={title} role="status">
      <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: dot }} aria-hidden />
      <span className="truncate text-text-2">{text}</span>
    </span>
  );
}

function Wordmark({ sub }: { sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Link href="/" className="flex items-center gap-2 rounded-md" aria-label="WorldSeed, start page">
        <Sprout size={18} className="text-ok" aria-hidden />
        <span className="display text-base font-semibold tracking-[0.02em]">WorldSeed</span>
      </Link>
      {sub}
    </div>
  );
}

/** Quiet links to the two documents. */
function DocLinks() {
  const pathname = usePathname();
  const cls = (href: string) => `rounded-full px-3 py-1.5 text-sm transition-colors duration-150 ${pathname === href ? "text-text" : "text-text-2 hover:text-text"}`;
  return (
    <nav aria-label="Documents" className="flex items-center">
      <Link href="/methodology" className={cls("/methodology")} aria-current={pathname === "/methodology" ? "page" : undefined}>
        Methodology
      </Link>
      <Link href="/about" className={cls("/about")} aria-current={pathname === "/about" ? "page" : undefined}>
        About
      </Link>
    </nav>
  );
}

/** The header: story bar on story pages; scenario, system state and tools in Expert mode; links everywhere. */
export default function TopBar({ page }: { page: PageKind }) {
  const presentation = useApp((s) => s.presentation);
  const removed = useApp(isBridgeRemoved);
  const mutated = useApp((s) => (s.scenario.mutations?.length ?? 0) > 0);
  const setAssumptionsOpen = useApp((s) => s.setAssumptionsOpen);
  const setCommandOpen = useApp((s) => s.setCommandOpen);

  if (page !== "explore") {
    return (
      <header className="scrim-top pointer-events-none relative z-30 flex h-14 shrink-0 items-center justify-between gap-4 px-4 md:px-6">
        <div className="pointer-events-auto">
          <Wordmark />
        </div>
        {page === "story" && (
          <div className="pointer-events-auto absolute left-1/2 hidden -translate-x-1/2 md:block">
            <StoryBar />
          </div>
        )}
        <div className="pointer-events-auto flex items-center gap-1">
          {page !== "intro" && (
            <div className="max-md:hidden">
              <DocLinks />
            </div>
          )}
          {page !== "intro" && <ModeToggle />}
        </div>
      </header>
    );
  }

  if (presentation) return null;
  return (
    <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface/90 px-4 backdrop-blur-md">
      <Wordmark
        sub={
          <span className="chip" title="Current scenario">
            {removed ? <Unlink size={12} className="text-critical" aria-hidden /> : <GitBranch size={12} aria-hidden />}
            <span className="text-muted">Scenario</span>
            <span>{removed ? (mutated ? "Key Bridge link removed + changes" : "Key Bridge link removed") : mutated ? "Pre-collapse + changes" : "Pre-collapse network"}</span>
          </span>
        }
      />
      <div className="flex items-center gap-2">
        <SystemState />
        <button type="button" className="btn h-8 px-3" onClick={() => setAssumptionsOpen(true)}>
          <FileText size={14} aria-hidden />
          Assumptions
        </button>
        <button type="button" className="btn h-8 px-3" onClick={() => setCommandOpen(true)} aria-label="Open command bar (Cmd or Ctrl + K)">
          <Command size={14} aria-hidden />
          <span className="kbd">K</span>
        </button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <DocLinks />
        <ModeToggle />
        <button type="button" className="btn-icon" aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)" onClick={() => useStory.setState({ keysOpen: true })}>
          <Keyboard size={16} aria-hidden />
        </button>
      </div>
    </header>
  );
}

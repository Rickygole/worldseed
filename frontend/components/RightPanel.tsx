"use client";

import dynamic from "next/dynamic";
import { PanelRightClose } from "lucide-react";
import { useApp } from "@/lib/store";
import MissionPanel from "./planner/MissionPanel";
import DecisionLog from "./planner/DecisionLog";

// The charts (d3) load after the shell; they are empty until a search runs anyway.
const FuturesPanel = dynamic(() => import("./planner/FuturesPanel"), { ssr: false, loading: () => <div className="h-24 border-t border-border" /> });
const FinalistCards = dynamic(() => import("./planner/FinalistCards"), { ssr: false });

export default function RightPanel() {
  const setRightOpen = useApp((s) => s.setRightOpen);
  return (
    <div className="panel flex h-full flex-col overflow-hidden" style={{ width: "var(--ws-right)" }}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium">Planner</span>
        <button className="btn-icon" aria-label="Collapse planner panel" onClick={() => setRightOpen(false)}>
          <PanelRightClose size={16} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MissionPanel />
        <FuturesPanel />
        <FinalistCards />
        <DecisionLog />
      </div>
    </div>
  );
}

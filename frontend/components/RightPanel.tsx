"use client";

import { Circle, PanelRightClose, Sparkles } from "lucide-react";
import { useApp, type BudgetTier } from "@/lib/store";

const EXAMPLES = [
  "Get every block group back within 8 minutes",
  "Halve the equity gap",
  "Cheapest fix for the south shore",
];

const TIERS: { id: BudgetTier; label: string; hint: string }[] = [
  { id: "low", label: "$", hint: "Low budget" },
  { id: "med", label: "$$", hint: "Medium budget" },
  { id: "high", label: "$$$", hint: "High budget" },
];

const STEPS = ["Read the goal", "Propose interventions", "Simulate each on the network", "Verify and rank"];

function Mission() {
  const goal = useApp((s) => s.goal);
  const setGoal = useApp((s) => s.setGoal);
  const budget = useApp((s) => s.budget);
  const setBudget = useApp((s) => s.setBudget);

  return (
    <section className="p-4" aria-label="Mission">
      <h2 className="label mb-2">Mission</h2>
      <label htmlFor="goal" className="sr-only">
        Goal
      </label>
      <textarea
        id="goal"
        rows={3}
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="Describe the outcome you want, in plain language."
        className="w-full resize-none rounded-ctl border border-border bg-surface p-2 text-sm text-text placeholder:text-muted focus:border-ai focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip text-muted hover:text-text" onClick={() => setGoal(ex)}>
            {ex}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="label">Budget tier</span>
        <div role="radiogroup" aria-label="Budget tier" className="flex rounded-ctl border border-border p-1">
          {TIERS.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={budget === t.id}
              title={t.hint}
              onClick={() => setBudget(t.id)}
              className="num h-6 min-w-10 rounded px-2 text-xs"
              style={
                budget === t.id
                  ? { background: "var(--color-border)", color: "var(--color-text)" }
                  : { color: "var(--color-muted)" }
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <button
        className="btn btn-primary mt-4 w-full"
        disabled
        title="Stub. The search agent arrives with the real simulator."
      >
        <Sparkles size={16} aria-hidden />
        Find a better future
      </button>
      <p className="mt-2 text-xs text-muted">Stub: the search agent is not wired up yet.</p>
    </section>
  );
}

function DecisionLog() {
  return (
    <section className="border-t border-border p-4" aria-label="Decision log">
      <h2 className="label mb-2">Decision log</h2>
      <ol className="relative space-y-3">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-start gap-2">
            <span className="relative flex flex-col items-center">
              <Circle size={14} className="mt-0.5 text-muted" aria-hidden />
              {i < STEPS.length - 1 && <span className="absolute top-5 h-5 w-px bg-border" aria-hidden />}
            </span>
            <span className="flex-1 text-sm">{s}</span>
            <span className="num text-xs text-muted">pending</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Futures() {
  return (
    <section className="border-t border-border p-4" aria-label="Futures">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="label">Futures</h2>
        <span className="chip h-6 px-2 text-future" style={{ borderColor: "rgb(167 139 250 / 0.5)" }}>
          not run
        </span>
      </div>

      <div className="rounded-ctl border border-dashed border-border p-2">
        <p className="label mb-2">Fan</p>
        <div className="flex h-16 items-center justify-center text-xs text-muted">Outcome fan chart slot</div>
      </div>
      <div className="mt-2 rounded-ctl border border-dashed border-border p-2">
        <p className="label mb-2">Job grid</p>
        <div className="grid grid-cols-8 gap-1" aria-hidden>
          {Array.from({ length: 16 }).map((_, i) => (
            <span key={i} className="h-4 rounded-sm bg-surface-2" />
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {["A", "B", "C"].map((k) => (
          <div key={k} className="card flex items-center justify-between p-3">
            <div>
              <div className="text-sm font-medium">Finalist {k}</div>
              <div className="text-xs text-muted">Awaiting search</div>
            </div>
            <span className="num text-xs text-muted">--</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function RightPanel() {
  const setRightOpen = useApp((s) => s.setRightOpen);
  return (
    <div className="panel flex h-full flex-col overflow-hidden" style={{ width: "var(--ws-right)" }}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium">Planner</span>
        <button className="btn-icon" aria-label="Collapse right panel" onClick={() => setRightOpen(false)}>
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Mission />
        <DecisionLog />
        <Futures />
      </div>
    </div>
  );
}

"use client";

import { GitFork, ListChecks, PanelRightClose, Sparkles, Trophy } from "lucide-react";
import { useApp, type BudgetTier } from "@/lib/store";

/**
 * Planner panel. Part 2 wires these sections to the agent machine; until then each one is an honest empty
 * state that says what will appear and why it is not here yet. No sample content.
 */

const EXAMPLES = [
  "Restore cross-harbor job access for the worst-hit block groups",
  "Halve the residents losing more than 10% of cross-harbor jobs",
  "Cheapest option that helps low-wage workers most",
];

const TIERS: { id: BudgetTier; label: string; hint: string }[] = [
  { id: "low", label: "$", hint: "Low relative cost tier" },
  { id: "med", label: "$$", hint: "Medium relative cost tier" },
  { id: "high", label: "$$$", hint: "High relative cost tier" },
];

export const PLANNER_UNAVAILABLE_REASON = "AI planner setup in progress. Explore scenarios by hand meanwhile.";

function Mission() {
  const goal = useApp((s) => s.goal);
  const setGoal = useApp((s) => s.setGoal);
  const budget = useApp((s) => s.budget);
  const setBudget = useApp((s) => s.setBudget);

  return (
    <section className="p-4" aria-labelledby="mission-h">
      <h2 id="mission-h" className="label mb-2">
        Mission
      </h2>
      <label htmlFor="goal" className="sr-only">
        Goal, in plain language
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
          <button key={ex} className="chip h-auto min-h-7 whitespace-normal py-1 text-left text-muted hover:text-text" onClick={() => setGoal(ex)}>
            {ex}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="label" id="budget-label">
          Cost tier
        </span>
        <div role="radiogroup" aria-labelledby="budget-label" className="flex rounded-ctl border border-border p-1">
          {TIERS.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={budget === t.id}
              title={t.hint}
              onClick={() => setBudget(t.id)}
              className="num h-6 min-w-10 rounded px-2 text-xs"
              style={budget === t.id ? { background: "var(--color-border)", color: "var(--color-text)" } : { color: "var(--color-muted)" }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <button className="btn btn-primary mt-4 w-full" disabled aria-describedby="find-reason">
        <Sparkles size={16} aria-hidden />
        Find a better future
      </button>
      <p id="find-reason" className="mt-2 text-xs text-muted">
        {PLANNER_UNAVAILABLE_REASON}
      </p>
    </section>
  );
}

function EmptySection({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon: typeof ListChecks;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border p-4" aria-labelledby={id}>
      <h2 id={id} className="label mb-2">
        {title}
      </h2>
      <div className="flex gap-3 rounded-ctl border border-dashed border-border p-3">
        <Icon size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
        <p className="text-xs leading-4 text-muted">{children}</p>
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
        <button className="btn-icon" aria-label="Collapse planner panel" onClick={() => setRightOpen(false)}>
          <PanelRightClose size={16} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Mission />
        <EmptySection id="decision-h" title="Decision log" icon={ListChecks}>
          No planner run yet. Each step the planner takes will be listed here, with every number filled in from the simulator.
        </EmptySection>
        <EmptySection id="futures-h" title="Futures" icon={GitFork}>
          Not run. Candidate options will be tested across many simulated stress futures, computed in your browser.
        </EmptySection>
        <EmptySection id="finalists-h" title="Finalists" icon={Trophy}>
          The three best options, with their trade-offs, appear here after a planner run.
        </EmptySection>
      </div>
    </div>
  );
}

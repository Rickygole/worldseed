"use client";

import { useEffect, useRef } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { useApp, type BudgetTier } from "@/lib/store";
import { useSearch } from "@/lib/ui/search";
import { shortModel, SEARCH_FUTURES, simLensFor } from "@/lib/ui/agentBridge";
import { goalMetricsFor } from "@/lib/agent/lenses";
import { eligibleCandidates } from "@/lib/agent/catalog";
import type { CostTier } from "@/lib/agent/catalog";
import type { GoalMetric } from "@/lib/agent/tools";
import { fmtMetric, isCountMetric, lensLabel, metricLabel, targetChoices } from "./labels";

const EXAMPLES = [
  "Restore cross-harbor job access for the worst-hit block groups",
  "Keep the slow end of cross-harbor trips close to before the collapse",
  "Cheapest option that still helps cross-harbor trips",
];

const TIERS: { id: CostTier; budget: BudgetTier; hint: string }[] = [
  { id: "$", budget: "low", hint: "Low relative cost tier" },
  { id: "$$", budget: "med", hint: "Medium relative cost tier" },
  { id: "$$$", budget: "high", hint: "High relative cost tier" },
];

const METRIC_ORDER: GoalMetric[] = ["p90", "p50", "equityGap", "isolatedCount"];
const metricsFor = (lens: Parameters<typeof goalMetricsFor>[0]) => METRIC_ORDER.filter((m) => goalMetricsFor(lens).includes(m));

export const AI_UNAVAILABLE = "AI planner unavailable. You can still explore scenarios manually.";

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={String(o.v)}
          role="radio"
          aria-checked={value === o.v}
          title={o.hint}
          onClick={() => onChange(o.v)}
          className="num h-7 rounded-ctl border px-2 text-xs transition-colors duration-150"
          style={
            value === o.v
              ? { background: "var(--color-surface-2)", color: "var(--color-text)", borderColor: "var(--color-muted)" }
              : { color: "var(--color-muted)", borderColor: "var(--color-border)" }
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function HealthLine() {
  const h = useSearch((s) => s.health);
  if (h.status === "checking") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted" role="status">
        <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden /> Checking whether the AI planner is available...
      </p>
    );
  }
  if (h.status === "available") {
    const r = h.info.roles;
    return (
      <p className="text-xs text-muted" role="status">
        <span className="text-text">AI planner available.</span> Planner {shortModel(r.planner)}
        {r.parser && r.parser !== r.planner ? `, parser ${shortModel(r.parser)}` : ""} via Nebius Token Factory.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted" role="status">
      <span className="text-text">{AI_UNAVAILABLE}</span>{" "}
      {h.status === "unreachable"
        ? "(The health check did not answer.)"
        : h.info.degradedReason === "budget_exhausted"
          ? "(Daily AI budget reached.)"
          : h.info.degradedReason === "protection_unavailable"
            ? "(Abuse protection is unavailable, so AI calls are paused.)"
            : ""}{" "}
      The same button runs a
      deterministic search instead: no AI, every option scored by the simulator.
    </p>
  );
}

function GoalChips() {
  const draft = useSearch((s) => s.draft);
  const setDraft = useSearch((s) => s.setDraft);
  const setBudget = useApp((s) => s.setBudget);
  const catalog = useSearch((s) => s.catalog);
  const tChoices = targetChoices(draft.metric, draft.lens);
  // How many catalog options the mission can use, from the catalog's own eligibility rule (never hard-coded).
  const eligible = catalog ? eligibleCandidates(catalog, { lens: draft.lens, maxCostTier: draft.maxCostTier, types: [] }) : [];
  return (
    <div className="space-y-2">
      <div>
        <p className="label mb-1">Lens</p>
        <Seg
          label="Mission lens"
          value={draft.lens}
          options={[
            { v: "access", label: "Cross-harbor access" },
            { v: "freight", label: "Hazmat truck detours (freight)" },
            { v: "ems", label: "First response (EMS)" },
          ]}
          onChange={(v) => {
            const metric = v === "freight" ? "p50" : goalMetricsFor(v).includes(draft.metric) ? draft.metric : "p90";
            setDraft({ lens: v, metric, targetDelta: metric === "isolatedCount" ? 0 : v === "freight" ? 600 : 60 });
          }}
        />
        {catalog && (
          <p className="mt-1 text-xs text-muted">
            <span className="num text-text">{eligible.length}</span> catalog option{eligible.length === 1 ? "" : "s"} eligible for this lens at {draft.maxCostTier}
            {draft.lens === "freight"
              ? ` (${eligible.map((c) => c.type === "hazmat_window" ? "escorted hazmat window" : c.type.replace(/_/g, " ")).filter((v, i, a) => a.indexOf(v) === i).join(", ")}). Corridor-flow options barely move hazmat trips, because hazmat trucks cannot use the tunnels those options speed up.`
              : "."}
          </p>
        )}
      </div>
      <div>
        <p className="label mb-1">Measure</p>
        <Seg
          label="Goal measure"
          value={draft.metric}
          options={metricsFor(draft.lens).map((m) => ({ v: m, label: metricLabel(draft.lens, m).replace(/ \(.*\)$/, "") }))}
          onChange={(v) => setDraft({ metric: v, targetDelta: isCountMetric(v) ? 0 : draft.lens === "freight" ? 600 : 60 })}
        />
      </div>
      <div>
        <p className="label mb-1">
          {draft.lens === "freight" ? "Target: at most this much added to the pre-collapse trip times, in the same future" : "Target: within this of the pre-collapse network, in the same future"}
        </p>
        <Seg label="Target" value={draft.targetDelta} options={tChoices.map((c) => ({ v: c.value, label: c.label }))} onChange={(v) => setDraft({ targetDelta: v })} />
      </div>
      <div className="flex items-center justify-between">
        <p className="label">Cost tier up to</p>
        <Seg
          label="Cost tier"
          value={draft.maxCostTier}
          options={TIERS.map((t) => ({ v: t.id, label: t.id, hint: t.hint }))}
          onChange={(v) => {
            setDraft({ maxCostTier: v });
            setBudget(TIERS.find((t) => t.id === v)!.budget);
          }}
        />
      </div>
    </div>
  );
}

/** The goal as one plain sentence, from the chips (application text). */
function goalSentence(d: ReturnType<typeof useSearch.getState>["draft"]): string {
  if (d.lens === "freight") {
    const t = isCountMetric(d.metric) ? (d.targetDelta === 0 ? "none" : `at most ${d.targetDelta}`) : `at most ${fmtMetric(d.metric, d.targetDelta)}`;
    return isCountMetric(d.metric)
      ? `Hazmat truck detours (freight): ${t} of the 24 cross-harbor hazmat trips with long detours (more than 5 min added) in each simulated future, using options up to ${d.maxCostTier}. Free-flow; hazmat truck = a vehicle carrying material the tunnels prohibit.`
      : `Hazmat truck detours (freight): keep the ${metricLabel(d.lens, d.metric).toLowerCase()} to ${t} over the pre-collapse trip times in each simulated future, using options up to ${d.maxCostTier}. Free-flow; hazmat truck = a vehicle carrying material the tunnels prohibit.`;
  }
  const target = isCountMetric(d.metric) ? `${d.targetDelta === 0 ? "no more than" : `at most ${d.targetDelta} more than`}` : `within ${fmtMetric(d.metric, d.targetDelta)} of`;
  return `${lensLabel(d.lens)}: keep the ${metricLabel(d.lens, d.metric).toLowerCase()} ${target} the pre-collapse network in each simulated future, using options up to ${d.maxCostTier}.`;
}

export default function MissionPanel() {
  const goal = useApp((s) => s.goal);
  const setGoal = useApp((s) => s.setGoal);
  const worldReady = useApp((s) => s.status === "ready");
  const removed = useApp((s) => s.scenario.removedLinks.length > 0 || (s.scenario.mutations?.length ?? 0) > 0);
  const health = useSearch((s) => s.health);
  const m = useSearch((s) => s.m);
  const stage = useSearch((s) => s.stage);
  const draft = useSearch((s) => s.draft);
  const catalogError = useSearch((s) => s.catalogError);
  const find = useSearch((s) => s.find);
  const confirmAndRun = useSearch((s) => s.confirmAndRun);
  const back = useSearch((s) => s.backToCompose);
  const cancel = useSearch((s) => s.cancel);
  const resetSearch = useSearch((s) => s.resetSearch);
  const ai = health.status === "available";
  const phase = m?.phase ?? "idle";
  const confirmRef = useRef<HTMLDivElement>(null);
  const confirming = stage === "confirm" && (phase === "idle" || phase === "confirmGoal");
  // The confirm step replaces the compose form: bring it into view and put focus on its button.
  useEffect(() => {
    if (!confirming) return;
    const el = confirmRef.current;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el?.querySelector<HTMLButtonElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, [confirming]);
  const busy = phase !== "idle" && phase !== "finalists" && phase !== "applied" && phase !== "confirmGoal";
  const needsText = ai && goal.trim().length < 3;
  const disabledReason = !worldReady
    ? "The simulation is still loading."
    : catalogError
      ? `The option catalog could not be loaded (${catalogError}).`
      : !m
        ? "Loading the option catalog..."
        : busy
          ? "A search is running."
          : phase === "finalists" || phase === "applied"
            ? "Start a new search to look again."
            : needsText
              ? "Describe the outcome you want first."
              : null;

  return (
    <section className="p-4" aria-labelledby="mission-h">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="mission-h" className="label">
          Mission
        </h2>
        <span className="chip h-6 px-2 text-xs">{ai ? "AI planner" : "Deterministic search (no AI)"}</span>
      </div>
      <HealthLine />

      {stage === "compose" && (phase === "idle" || phase === "parsing") && (
        <div className="mt-3 space-y-3">
          {ai ? (
            <>
              <label htmlFor="goal" className="sr-only">
                Goal, in plain language
              </label>
              <textarea
                id="goal"
                rows={3}
                value={goal}
                maxLength={300}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Describe the outcome you want, in plain language."
                className="w-full resize-none rounded-ctl border border-border bg-surface p-2 text-sm text-text placeholder:text-muted focus:border-ai focus:outline-none"
              />
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="chip h-auto min-h-7 whitespace-normal py-1 text-left text-muted hover:text-text" onClick={() => setGoal(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <GoalChips />
          )}
          {!removed && worldReady && (
            <p className="text-xs text-muted">Tip: remove the Key Bridge link first. The search scores options in the world on screen.</p>
          )}
          <button
            className="btn btn-primary h-auto w-full flex-col gap-0 py-2"
            disabled={disabledReason !== null || phase === "parsing"}
            aria-describedby="find-reason"
            onClick={() => void find(goal)}
          >
            <span className="flex items-center gap-2">
              {phase === "parsing" ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles size={16} aria-hidden />}
              Find a better future
            </span>
            <span className="text-xs font-medium opacity-80">{ai ? `Planned by ${shortModel((health as { info: { roles: Record<string, string> } }).info.roles.planner)}` : "Deterministic search (no AI)"}</span>
          </button>
          <p id="find-reason" className="text-xs text-muted">
            {phase === "parsing" ? "Reading your goal..." : disabledReason ?? `Next: confirm the goal. Nothing runs before you confirm.`}
          </p>
          {m?.degraded && phase === "idle" && (
            <p className="text-xs text-warn" role="status">
              {m.degraded.reason === "budget_exhausted"
                ? "Daily AI budget reached. Deterministic search (no AI) is still available." // no recorded run ships, so none is offered
                : m.degraded.message}
            </p>
          )}
        </div>
      )}

      {confirming && (
        <div ref={confirmRef} className="mt-3 space-y-3 rounded-ctl border border-border bg-bg/40 p-3" role="group" aria-labelledby="confirm-h">
          <h3 id="confirm-h" className="text-sm font-medium">
            Confirm the goal
          </h3>
          {phase === "confirmGoal" && <p className="text-xs text-muted">Read from your text by the AI parser. Check it; change anything before you confirm.</p>}
          <GoalChips />
          <p className="text-sm leading-5">{goalSentence(draft)}</p>
          <p className="text-xs text-muted">
            Each option is scored in the world on screen across {SEARCH_FUTURES.n[simLensFor(draft.lens)]} stress futures (seed {SEARCH_FUTURES.seed}), paired with the
            pre-collapse network and with doing nothing. {ai && phase === "confirmGoal" ? "" : "Deterministic search (no AI): screens every eligible bundle with one free-flow run, then scores the top 12 across the futures."}
          </p>
          <div className="flex gap-2">
            <button className="btn flex-1 border-ai text-text" onClick={() => void confirmAndRun()} data-autofocus>
              Confirm and search
            </button>
            <button className="btn" onClick={back}>
              Back
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-muted" role="status">
            {m?.mode === "ai" ? "AI planner" : "Deterministic search (no AI)"}: {phase === "evaluating" ? `scoring round ${m?.round}` : phase}...
          </p>
          <button className="btn h-8 px-3 text-xs" onClick={cancel}>
            <X size={12} aria-hidden /> Cancel
          </button>
        </div>
      )}

      {(phase === "finalists" || phase === "applied") && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-muted">{phase === "applied" ? `Applied ${m?.appliedBundleId}. Reset (R) removes it.` : "Finalists are below. You decide what to apply."}</p>
          <button className="btn h-8 shrink-0 whitespace-nowrap px-3 text-xs" onClick={resetSearch}>
            New search
          </button>
        </div>
      )}
    </section>
  );
}

"use client";

import { useMemo } from "react";
import { Columns2, Eye, ListOrdered, Trophy, Wand2, X, HelpCircle } from "lucide-react";
import { exhaustiveSummaryLine, rankOf } from "@/lib/agent/exhaustive";
import { fmtAbout } from "@/lib/ui/methodology";
import { scenarioKey, useApp } from "@/lib/store";
import { getMachine, useSearch } from "@/lib/ui/search";
import { dist3, median, ridge } from "@/lib/ui/futuresMath";
import type { BundleFutures } from "@/lib/ui/agentBridge";
import { fmtMetric, fmtMetricDelta, metricLabel, optionName, TIER_COLOR } from "./labels";
import Popover from "../ui/Popover";
import { GLOSSARY } from "@/lib/ui/storyCopy";

function Ridge({ values, lo, hi, color }: { values: number[]; lo: number; hi: number; color: string }) {
  const w = 120;
  const h = 28;
  const pts = ridge(values, lo, hi, 32);
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const d = `M0,${h} ` + pts.map((p, i) => `L${x(i).toFixed(1)},${(h - 2 - p * (h - 4)).toFixed(1)}`).join(" ") + ` L${w},${h} Z`;
  const zx = ((0 - lo) / (hi - lo)) * w;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      <path d={d} fill={color} opacity={0.35} stroke={color} strokeWidth={1} />
      {zx >= 0 && zx <= w && <line x1={zx} x2={zx} y1={0} y2={h} stroke="var(--color-muted)" strokeDasharray="2 2" />}
    </svg>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="num text-sm text-text">{value}</p>
      {note && <p className="num text-xs text-muted">{note}</p>}
    </div>
  );
}

/** "Does the pick hold up against trying everything?" Deterministic runs over every bundle of 1-3 options. */
function ExhaustiveCheck() {
  const ex = useSearch((s) => s.exhaustive);
  const count = useSearch((s) => s.exhaustiveCount)();
  const run = useSearch((s) => s.runExhaustive);
  const cancel = useSearch((s) => s.cancelExhaustive);
  const m = useSearch((s) => s.m);
  const catalog = useSearch((s) => s.catalog);
  const top = m?.finalists[0];
  if (!top || count === 0) return null;
  const title = (ids: string[]) => ids.map((id) => optionName(catalog, id)).join(" + ");
  let summary = "";
  if (ex.status === "done" && ex.result) {
    const r = rankOf(ex.result, top.candidateIds);
    if (r) summary = exhaustiveSummaryLine(r, m?.mode === "ai" ? "ai" : "deterministic");
  }
  return (
    <div className="card mb-4 p-3" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p
          className="text-xs leading-4 text-muted"
          title="Scores every bundle of one to three eligible options with one free-flow run each (no stress futures, so its ranking can differ from the search's). No AI."
        >
          Exhaustive check: all <span className="num text-text">{count}</span> bundles, one free-flow run each. No AI.
        </p>
        {ex.status === "running" ? (
          <button className="btn h-7 shrink-0 px-2 text-xs" onClick={cancel}>
            <X size={12} aria-hidden /> Cancel
          </button>
        ) : (
          <button className="btn h-7 shrink-0 px-2 text-xs" onClick={() => void run()}>
            <ListOrdered size={12} aria-hidden /> {ex.status === "done" ? "Run again" : "Run"}
          </button>
        )}
      </div>
      {ex.status === "running" && (
        <div className="mt-2">
          <div className="h-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={ex.total} aria-valuenow={ex.done} aria-label="Exhaustive check progress">
            <div className="h-full bg-future transition-[width] duration-200" style={{ width: `${ex.total ? (100 * ex.done) / ex.total : 0}%` }} />
          </div>
          <p className="num mt-1 text-xs text-muted">
            {ex.done} of {ex.total} bundles scored
          </p>
        </div>
      )}
      {ex.status === "cancelled" && <p className="mt-2 text-xs text-muted">Cancelled after {ex.done} of {ex.total} bundles.</p>}
      {ex.status === "error" && <p className="mt-2 text-xs text-critical">The check stopped: {ex.error}</p>}
      {ex.status === "done" && ex.result && (
        <div className="mt-2 space-y-1 text-xs">
          <p className="text-text">{summary}</p>
          {ex.result.optimum && (
            <p className="text-muted">
              Best on the goal metric: {title(ex.result.optimum.candidateIds)} ({ex.result.optimum.costTier}).{" "}
              <span className="num">
                {ex.result.evaluations} bundles in {((ex.ms ?? 0) / 1000).toFixed(0)} s.
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function FinalistCards() {
  const m = useSearch((s) => s.m);
  const bundles = useSearch((s) => s.bundles);
  const refs = useSearch((s) => s.refs);
  const catalog = useSearch((s) => s.catalog);
  const preview = useSearch((s) => s.preview);
  const compare = useSearch((s) => s.compare);
  const setPreview = useSearch((s) => s.setPreview);
  const setCompare = useSearch((s) => s.setCompare);
  const askApply = useSearch((s) => s.askApply);
  const applyError = useSearch((s) => s.applyError);
  const base = useSearch((s) => s.base);
  const scenario = useApp((s) => s.scenario);
  const worldBusy = useApp((s) => s.busy);
  const phase = m?.phase ?? "idle";
  const finalists = useMemo(() => m?.finalists ?? [], [m?.finalists]);
  const metric = m?.mission?.goal.metric ?? "p90";
  const lens = m?.mission?.lens ?? "access";
  const sameWorld = !!base && base.key === scenarioKey(scenario);
  const ex = useSearch((s) => s.exhaustive);
  const freight = useSearch((s) => s.freight);

  const range = useMemo(() => {
    const vals = finalists.flatMap((f) => bundles[f.bundleId]?.vsNothing ?? []);
    if (vals.length === 0) return { lo: -1, hi: 1 };
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    const pad = Math.max(1, (hi - lo) * 0.1);
    return { lo: lo - pad, hi: hi + pad };
  }, [finalists, bundles]);

  if (finalists.length === 0) {
    return (
      <section className="border-t border-border p-4" aria-labelledby="finalists-h">
        <h2 id="finalists-h" className="label mb-2">
          Finalists
        </h2>
        <div className="flex gap-3 rounded-ctl border border-dashed border-border p-3">
          <Trophy size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          <p className="text-xs leading-4 text-muted">The three best options, with their trade-offs, appear here after a search.</p>
        </div>
      </section>
    );
  }

  const machine = getMachine();
  return (
    <section aria-labelledby="finalists-h">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="finalists-h" className="text-base font-medium">
          Finalists
        </h2>
        <span className="flex items-center gap-1 text-xs text-muted">
          {m?.mode === "ai" ? "Chosen by the AI planner" : "Deterministic search (no AI)"}
          <Popover title="How to read the finalists" triggerClassName="btn-icon !h-6 !w-6" triggerLabel="How to read the finalists" trigger={<HelpCircle size={13} aria-hidden />}>
            <p>
              Every figure is computed by the simulator. Changes are paired future by future (what-if runs) against doing nothing in the same world. Stress futures add
              congestion and random closures, so their counts run higher than the free-flow map. All options are hypothetical.
            </p>
            <p className="mt-2">P(goal): {GLOSSARY.pGoal} Median: the typical change versus doing nothing. Worst 10%: the goal measure in the slowest tenth of runs.</p>
          </Popover>
        </span>
      </div>
      {!sameWorld && phase === "finalists" && (
        <p className="mb-3 text-xs text-warn">The world changed since this search ran. Preview works; to apply, run the search again.</p>
      )}
      {applyError && <p className="mb-3 text-xs text-critical" role="alert">{applyError}</p>}
      <table className="mb-4 w-full table-fixed text-xs" aria-label="Finalists side by side">
        <thead>
          <tr className="text-left text-muted">
            <th scope="col" className="pb-1.5 font-medium">Option</th>
            <th scope="col" className="w-14 pb-1.5 pl-2 text-right font-medium" title={GLOSSARY.pGoal}>P(goal)</th>
            <th scope="col" className="w-14 pb-1.5 pl-2 text-right font-medium" title="Median change versus doing nothing">Median</th>
            <th scope="col" className="w-[68px] whitespace-nowrap pb-1.5 pl-2 text-right font-medium" title="Goal measure in the slowest tenth of what-if runs">Worst 10%</th>
          </tr>
        </thead>
        <tbody>
          {finalists.map((f, rank) => {
            const b = bundles[f.bundleId];
            const name = f.candidateIds.map((id) => optionName(catalog, id)).join(" + ");
            return (
              <tr key={f.bundleId} className="border-t border-border">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  <a href={`#card-${f.bundleId}`} className="block truncate hover:text-text" title={name}>
                    <span className="num text-muted">#{rank + 1} {f.bundleId}</span> <span className="text-text">{name}</span>
                  </a>
                </th>
                <td className="num py-1 pl-2 text-right">{b?.pGoal == null ? "--" : `${Math.round(b.pGoal * 100)}%`}</td>
                <td className="num py-1 pl-2 text-right">{b ? fmtMetricDelta(metric, median(b.vsNothing)) : "--"}</td>
                <td className="num whitespace-nowrap py-1.5 pl-2 text-right">{b ? fmtMetric(metric, dist3(b.goal).p90) : "--"}</td>
              </tr>
            );
          })}
          {refs && (
            <tr className="border-t border-border text-muted">
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                Doing nothing
              </th>
              <td className="num py-1 pl-2 text-right">{refs.nothingPGoal == null ? "--" : `${Math.round(refs.nothingPGoal * 100)}%`}</td>
              <td className="num py-1 pl-2 text-right">0</td>
              <td className="num whitespace-nowrap py-1.5 pl-2 text-right">{fmtMetric(metric, dist3(refs.nothing.goal).p90)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <ExhaustiveCheck />
      <ol className="space-y-3">
        {finalists.map((f, rank) => {
          const b: BundleFutures | undefined = bundles[f.bundleId];
          const card = machine?.card(f.bundleId);
          const color = TIER_COLOR[f.costTier] ?? "var(--color-future)";
          const nothingGoal = refs?.nothing.goal ?? [];
          const worst = b ? dist3(b.goal).p90 : NaN;
          const worstNothing = nothingGoal.length ? dist3(nothingGoal).p90 : NaN;
          const eq = b && refs ? median(b.equity.map((v, i) => v - refs.nothing.equity[i])) : NaN;
          const gt10 = b?.gt10 && refs?.nothing.gt10 ? median(b.gt10) : null;
          const gt10n = refs?.nothing.gt10 ? median(refs.nothing.gt10) : null;
          const applied = phase === "applied" && m?.appliedBundleId === f.bundleId;
          const isPreview = preview?.bundleId === f.bundleId;
          const isCompare = compare?.bundleId === f.bundleId;
          return (
            <li
              key={f.bundleId}
              id={`card-${f.bundleId}`}
              className="card scroll-mt-2 p-3"
              style={rank === 0 ? { boxShadow: "0 0 0 1px rgb(76 141 255 / 0.45), 0 0 24px -6px rgb(76 141 255 / 0.45)" } : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="num text-xs text-muted">
                    #{rank + 1} · {f.bundleId}
                    {applied ? " · applied" : ""}
                  </p>
                  <h3 className="text-sm font-medium leading-5">{f.candidateIds.map((id) => optionName(catalog, id)).join(" + ")}</h3>
                </div>
                <span className="chip num h-6 shrink-0 px-2 text-xs" style={{ borderColor: color, color }}>
                  {f.costTier}
                </span>
              </div>

              {b && (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                  <Stat label="Chance of meeting the goal" value={b.pGoal === null ? "--" : `${Math.round(b.pGoal * 100)}%`} note={refs?.nothingPGoal != null ? `doing nothing: ${Math.round(refs.nothingPGoal * 100)}%` : undefined} />
                  <Stat label={`Change vs doing nothing (median)`} value={fmtMetricDelta(metric, median(b.vsNothing))} note={metricLabel(lens, metric).replace(/ \(.*\)$/, "").toLowerCase()} />
                  <Stat label="Worst 10% of futures" value={fmtMetric(metric, worst)} note={`doing nothing: ${fmtMetric(metric, worstNothing)}`} />
                  {lens !== "freight" && <Stat label="Equity gap change" value={lens === "ems" ? fmtMetricDelta("p90", eq) : fmtMetricDelta("equityGap", eq)} note={lens === "ems" ? "zero-vehicle households minus everyone" : "low-wage workers minus everyone"} />}
                  {gt10 !== null && gt10n !== null && (
                    <div className="col-span-2">
                      <Stat label="People reaching >10% fewer jobs across the river (median future)" value={`about ${fmtAbout(gt10)}`} note={`doing nothing: about ${fmtAbout(gt10n)}`} />
                    </div>
                  )}
                </div>
              )}

              {freight?.byBundle[f.bundleId] && freight.nothing && (
                <p className="num mt-2 text-xs leading-4 text-muted">
                  Hazmat truck trips: mean <span className="text-text">+{freight.byBundle[f.bundleId].hazmatMeanAdded.toFixed(1)} min</span> (doing nothing: +
                  {freight.nothing.hazmatMeanAdded.toFixed(1)} min); cars +{freight.byBundle[f.bundleId].carMeanAdded.toFixed(1)} min (doing nothing: +
                  {freight.nothing.carMeanAdded.toFixed(1)} min). Free-flow, {freight.nothing.trips} cross-harbor trips.
                </p>
              )}
              {b && (
                <div className="mt-2 flex items-center gap-2">
                  <Ridge values={b.vsNothing} lo={range.lo} hi={range.hi} color={color} />
                  <p className="text-xs leading-4 text-muted">
                    Change in each of the <span className="num">{b.vsNothing.length}</span> futures (dashed: no change; left is better).
                  </p>
                </div>
              )}

              {card && card.stressLines.length > 0 && (
                <div className="mt-2 rounded-ctl border border-border p-2">
                  <p className="label mb-1">Stress tests</p>
                  <ul className="space-y-1 text-xs leading-4 text-muted">
                    {card.stressLines.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </div>
              )}
              {ex.status === "done" && ex.result && (() => {
                const r = rankOf(ex.result, f.candidateIds);
                return r ? (
                  <p className="num mt-2 text-xs text-muted">
                    Exhaustive check (free-flow, no futures): rank {r.rank} of {r.of}
                  </p>
                ) : null;
              })()}
              {f.candidateIds.some((id) => catalog?.byId.get(id)?.type === "signal_priority") && (
                <p className="mt-2 text-xs leading-4 text-muted">
                  Corridor flow options apply an assumed speed factor (see Assumptions); the simulator shows where it would matter.
                </p>
              )}
              {card && card.commentary && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-muted hover:text-text">{card.commentaryLabel}</summary>
                  <div className="mt-1 space-y-1 text-muted">
                    <p>{card.commentary}</p>
                    <p>Hypothetical scenario option; not proposed, studied or endorsed by any agency.</p>
                  </div>
                </details>
              )}
              {card && card.lines.length > 0 && (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-muted hover:text-text">All figures (medians across futures; baseline = doing nothing in this world)</summary>
                  <ul className="num mt-1 space-y-0.5 text-muted">
                    {card.lines.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </details>
              )}

              <div className={`mt-3 grid gap-2 ${lens === "freight" ? "grid-cols-2" : "grid-cols-3"}`}>
                <button className="btn h-8 px-2 text-xs" aria-pressed={isPreview} disabled={!b || worldBusy || applied} onClick={() => void setPreview(f.bundleId)} style={isPreview ? { borderColor: "var(--color-future)", color: "var(--color-future)" } : undefined}>
                  <Eye size={14} aria-hidden /> {lens === "freight" ? (isPreview ? "Loading" : "Compare trips") : isPreview ? (preview?.status === "loading" ? "Loading" : "Hide") : "Preview"}
                </button>
                <button className={`btn h-8 px-2 text-xs ${lens === "freight" ? "hidden" : ""}`} aria-pressed={isCompare} disabled={!b || worldBusy || applied} onClick={() => void setCompare(f.bundleId)} style={isCompare ? { borderColor: "var(--color-future)", color: "var(--color-future)" } : undefined}>
                  <Columns2 size={14} aria-hidden /> {isCompare ? "Close" : "Compare"}
                </button>
                <button
                  className="btn h-8 px-2 text-xs"
                  style={{ borderColor: "rgb(76 141 255 / 0.6)" }}
                  disabled={phase !== "finalists" || !sameWorld || worldBusy}
                  onClick={() => askApply(f.bundleId)}
                  title={!sameWorld ? "The world changed since this search ran." : undefined}
                >
                  <Wand2 size={14} aria-hidden /> Apply
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

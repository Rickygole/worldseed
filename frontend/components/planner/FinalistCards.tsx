"use client";

import { useMemo, useRef, useState } from "react";
import { Columns2, Eye, ListOrdered, Trophy, Wand2, X, HelpCircle } from "lucide-react";
import { exhaustiveSummaryLine, rankOf } from "@/lib/agent/exhaustive";
import { fmtAbout } from "@/lib/ui/methodology";
import { scenarioKey, useApp } from "@/lib/store";
import { getMachine, useSearch } from "@/lib/ui/search";
import { dist3, durationTicks, median, niceTicks, ridge, seriesColor, shareAtOrBelow } from "@/lib/ui/futuresMath";
import type { GoalMetric } from "@/lib/agent/tools";
import type { BundleFutures } from "@/lib/ui/agentBridge";
import { fmtMetric, fmtMetricDelta, isCountMetric, metricLabel, optionName } from "./labels";
import Popover from "../ui/Popover";
import { GLOSSARY } from "@/lib/ui/storyCopy";

const RW = 300;
const ROW = 30;

/**
 * The spread of each finalist's change across the what-if runs, as stacked ridgelines: one row per finalist, the
 * same x domain for all (so they compare like small multiples), a 10% wash with its density outline and a 2 px
 * median tick in the finalist's fixed color. The name sits beside its ridge; a crosshair reads off, for every
 * finalist, the share of runs at least as good as the value under the pointer.
 */
function FinalistRidges({
  rows,
  lo,
  hi,
  metric,
}: {
  rows: { id: string; rank: number; name: string; values: number[]; color: string | null }[];
  lo: number;
  hi: number;
  metric: GoalMetric;
}) {
  const [px, setPx] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const xOf = (v: number) => ((v - lo) / (hi - lo)) * RW;
  const count = isCountMetric(metric);
  const t = count ? { unit: "count" as const, ticks: niceTicks(lo, hi, 4) } : durationTicks(lo, hi, 4);
  const unitWord = t.unit === "count" ? "block groups" : t.unit === "min" ? "min" : "s";
  const tick = (v: number) => {
    if (Math.abs(v) < 1e-9) return "0";
    const a = Number((Math.abs(v) / (t.unit === "min" ? 60 : 1)).toPrecision(3));
    return `${v > 0 ? "+" : "-"}${a}`;
  };
  const at = px === null ? null : lo + (px / 100) * (hi - lo);
  const zx = (100 * xOf(0)) / RW;
  return (
    <figure className="mb-4" aria-labelledby="ridges-cap">
      <figcaption id="ridges-cap" className="mb-2 flex items-baseline justify-between gap-2 text-xs text-muted">
        <span className="text-text-2">Spread across {rows[0]?.values.length ?? 0} what-if runs</span>
        <span className="shrink-0">{unitWord}, left is better</span>
      </figcaption>
      <div
        ref={box}
        className="relative cursor-crosshair"
        onPointerMove={(e) => {
          const r = box.current?.getBoundingClientRect();
          if (r) setPx(Math.min(100, Math.max(0, (100 * (e.clientX - r.left)) / r.width)));
        }}
        onPointerLeave={() => setPx(null)}
      >
        {rows.map((r) => {
          const pts = ridge(r.values, lo, hi, 48);
          const x = (i: number) => (i / (pts.length - 1)) * RW;
          const yv = (p: number) => ROW - 1 - p * (ROW - 6);
          const top = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yv(p).toFixed(1)}`).join(" ");
          const med = median(r.values);
          const mi = Math.round(((med - lo) / (hi - lo)) * (pts.length - 1));
          const c = r.color ?? "var(--color-faint)";
          const d = dist3(r.values);
          return (
            <div key={r.id} className="mb-1.5">
              <p className="flex items-center gap-1.5 text-xs leading-4">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: c }} aria-hidden />
                <span className="num shrink-0 text-muted">#{r.rank + 1}</span>
                <span className="min-w-0 truncate text-text-2" title={r.name}>
                  {r.name}
                </span>
                <span className="num ml-auto shrink-0 text-text">{fmtMetricDelta(metric, med)}</span>
              </p>
              <svg
                width="100%"
                height={ROW}
                viewBox={`0 0 ${RW} ${ROW}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`Finalist ${r.rank + 1}: median ${fmtMetricDelta(metric, med)}, middle 80% of runs ${fmtMetricDelta(metric, d.p10)} to ${fmtMetricDelta(metric, d.p90)}, ${r.values.length} runs`}
                className="block chart-fade"
              >
                <path d={`${top} L${RW},${ROW - 0.5} L0,${ROW - 0.5} Z`} fill={c} opacity={0.1} />
                <path d={top} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                <line x1={0} x2={RW} y1={ROW - 0.5} y2={ROW - 0.5} stroke="var(--color-border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                {zx >= 0 && zx <= 100 && <line x1={xOf(0)} x2={xOf(0)} y1={0} y2={ROW} stroke="var(--color-muted)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
                <line x1={xOf(med)} x2={xOf(med)} y1={ROW - 0.5} y2={yv(pts[Math.min(pts.length - 1, Math.max(0, mi))])} stroke={c} strokeWidth={2} vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          );
        })}
        {px !== null && at !== null && (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-text-2" style={{ left: `${px}%` }} />
            <div
              role="tooltip"
              className="pop pointer-events-none absolute top-0 z-10 w-52 px-3 py-2 text-xs leading-4"
              style={px > 50 ? { right: `calc(${100 - px}% + 8px)` } : { left: `calc(${px}% + 8px)` }}
            >
              <p className="num text-text">
                {tick(at)} {unitWord} or better
              </p>
              <ul className="mt-1 space-y-0.5">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center gap-1.5 text-text-2">
                    <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: r.color ?? "var(--color-faint)" }} aria-hidden />
                    <span className="num">#{r.rank + 1}</span>
                    <span className="num ml-auto text-text">{Math.round(100 * shareAtOrBelow(r.values, at))}% of runs</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
      {/* shared x axis */}
      <div className="relative mt-0.5 h-4 text-2xs text-muted" aria-hidden>
        {t.ticks.map((v) => {
          const p = (100 * xOf(v)) / RW;
          return p < 0 || p > 100 ? null : (
            <span key={v} className="num absolute top-0 -translate-x-1/2" style={{ left: `${Math.min(96, Math.max(4, p))}%` }}>
              {tick(v)}
            </span>
          );
        })}
      </div>
    </figure>
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
    if (vals.length === 0) return { lo: -1, hi: 1, has: false };
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    const pad = Math.max(1, (hi - lo) * 0.1);
    return { lo: lo - pad, hi: hi + pad, has: true };
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
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] align-[-1px]" style={{ background: seriesColor(rank) ?? "var(--color-faint)" }} aria-hidden />
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
      {range.has && (
        <FinalistRidges
          rows={finalists.flatMap((f, rank) => {
            const b = bundles[f.bundleId];
            return b ? [{ id: f.bundleId, rank, name: f.candidateIds.map((id) => optionName(catalog, id)).join(" + "), values: b.vsNothing, color: seriesColor(rank) }] : [];
          })}
          lo={range.lo}
          hi={range.hi}
          metric={metric}
        />
      )}
      <ExhaustiveCheck />
      <ol className="space-y-3">
        {finalists.map((f, rank) => {
          const b: BundleFutures | undefined = bundles[f.bundleId];
          const card = machine?.card(f.bundleId);
          const color = seriesColor(rank) ?? "var(--color-faint)";
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
              // The top pick: a neutral ring (text token), never the ai blue, which would misattribute a no-AI result
              // and sit next to finalist 1's identity blue.
              style={rank === 0 ? { boxShadow: "0 0 0 1px rgb(238 242 247 / 0.32), 0 0 24px -6px rgb(255 255 255 / 0.18)" } : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="num flex items-center gap-1.5 text-xs text-muted">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} aria-hidden />
                    #{rank + 1} · {f.bundleId}
                    {applied ? " · applied" : ""}
                  </p>
                  <h3 className="text-sm font-medium leading-5">{f.candidateIds.map((id) => optionName(catalog, id)).join(" + ")}</h3>
                </div>
                <span className="chip num h-6 shrink-0 px-2 text-xs text-text-2" title="Cost tier">
                  <span className="sr-only">Cost tier </span>
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

"use client";

import { useMemo } from "react";
import { scaleLinear } from "d3";
import { GitFork, Zap } from "lucide-react";
import { shortModel, simLensFor } from "@/lib/ui/agentBridge";
import { useReducedMotion } from "framer-motion";
import { FUTURES_MODEL_LABEL } from "@/lib/sim/sample";
import { useSearch } from "@/lib/ui/search";
import { SEARCH_FUTURES } from "@/lib/ui/agentBridge";
import { dist3, dominatedIds, median, rate } from "@/lib/ui/futuresMath";
import { fmtMetricDelta, metricLabel, TIER_COLOR } from "./labels";

const W = 328;
const H = 196;
const M = { l: 8, r: 104, t: 16, b: 22 };

function ProgressGrid() {
  const f = useSearch((s) => s.futures);
  const phase = useSearch((s) => s.m?.phase ?? "idle");
  const running = phase === "planning" || phase === "evaluating" || phase === "critiquing" || phase === "finalizing";
  const total = f.roundTotal;
  if (total === 0) return null;
  const cols = Math.min(40, total);
  const cell = Math.floor((W - (cols - 1) * 2) / cols);
  const fps = rate(f.done, f.lastAt - f.startedAt);
  return (
    <div className="mt-3">
      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: `repeat(${cols}, ${cell}px)` }}
        role="progressbar"
        aria-label="Futures completed in this round"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={f.roundDone}
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className="rounded-[2px] transition-colors duration-200"
            style={{ height: cell, background: i < f.roundDone ? "var(--color-future)" : "var(--color-surface-2)" }}
          />
        ))}
      </div>
      <p className="num mt-1 text-xs text-muted" role="status">
        {f.roundDone} of {total} futures completed this round{running && f.label ? ` (${f.label})` : ""} · {f.done} in this search
        {fps ? ` · ${fps.toFixed(1)} futures/s` : ""}
      </p>
    </div>
  );
}

/** Stage 1 of the no-AI search: every eligible bundle, one free-flow run each, then the shortlist goes to futures. */
function ScreenBeat() {
  const phase = useSearch((s) => s.m?.phase ?? "idle");
  const progress = useSearch((s) => s.m?.progress);
  const screened = useSearch((s) => s.m?.screened);
  const mode = useSearch((s) => s.m?.mode);
  const screening = phase === "planning" && mode === "deterministic" && !!progress && !screened;
  if (!screening && !screened) return null;
  const pct = progress && progress.total > 0 ? (100 * progress.done) / progress.total : 0;
  return (
    <div className="mt-3 rounded-ctl border border-border p-2 text-xs leading-4" aria-live="polite">
      {screening && progress ? (
        <>
          <p className="text-text">
            Screening <span className="num">{progress.total}</span> bundles: one free-flow run each (no AI)
          </p>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Screening progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div className="h-full bg-future transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
          <p className="num mt-1 text-muted">
            {progress.done} of {progress.total} scored
          </p>
        </>
      ) : screened ? (
        <p className="text-muted">
          Screened <span className="num text-text">{screened.scored}</span> of <span className="num">{screened.enumerated}</span> bundles with one free-flow run each, then scored the top{" "}
          <span className="num text-text">{screened.shortlisted}</span> across stress futures (no AI).
        </p>
      ) : null}
    </div>
  );
}

/**
 * The stress step as its own beat: the critic (AI or the deterministic critic) picks the closure or time of day
 * that hurts the leaders most, and the simulator re-scores them under it. Every figure is in the decision log.
 */
function StressBeats() {
  const stresses = useSearch((s) => s.m?.stresses);
  const label = useSearch((s) => s.futures.label);
  const phase = useSearch((s) => s.m?.phase ?? "idle");
  const running = (phase === "critiquing" || phase === "evaluating") && label.startsWith("stress:");
  if (!running && (!stresses || stresses.length === 0)) return null;
  return (
    <ol className="mt-3 space-y-2" aria-label="Stress tests">
      {(stresses ?? []).map((st) => (
        <li key={st.id} className="flex gap-2 rounded-ctl border p-2 text-xs leading-4" style={{ borderColor: "rgb(245 165 36 / 0.45)" }}>
          <Zap size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <div>
            <p className="text-text">
              Stress test: <span className="font-medium">{st.label}</span>
            </p>
            <p className="text-muted">
              {st.source === "ai" ? `Chosen by the AI critic${st.model ? ` (${shortModel(st.model)})` : ""}` : "Deterministic stress test (no AI)"} · {st.rows.length} leading options re-scored under
              it. Results are in the decision log and on the finalist cards.
            </p>
          </div>
        </li>
      ))}
      {running && (
        <li className="flex gap-2 rounded-ctl border border-dashed p-2 text-xs" style={{ borderColor: "rgb(245 165 36 / 0.45)" }}>
          <Zap size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <p className="text-muted" role="status">
            Re-scoring the leaders: {label.replace(/^stress:\s*/, "")}
          </p>
        </li>
      )}
    </ol>
  );
}

export default function FuturesPanel() {
  const refs = useSearch((s) => s.refs);
  const bundles = useSearch((s) => s.bundles);
  const m = useSearch((s) => s.m);
  const f = useSearch((s) => s.futures);
  const draft = useSearch((s) => s.draft);
  const reduced = !!useReducedMotion();
  const phase = m?.phase ?? "idle";
  const running = phase === "planning" || phase === "evaluating" || phase === "critiquing" || phase === "finalizing";
  const mission = m?.mission;
  const lens = mission?.lens ?? draft.lens;
  const metric = mission?.goal.metric ?? draft.metric;
  const finalistIds = useMemo(() => new Set((m?.finalists ?? []).map((x) => x.bundleId)), [m?.finalists]);

  const chart = useMemo(() => {
    if (!refs) return null;
    const list = Object.values(bundles);
    const branches = list.map((b) => ({ b, d: dist3(b.vsNothing), med: median(b.vsNothing) }));
    const dominated = dominatedIds(branches.map((x) => ({ id: x.b.bundleId, median: x.med, pGoal: x.b.pGoal, costTier: x.b.costTier })));
    const pre = -median(refs.nothingVsPre);
    // Scale to the options (and zero), not to the pre-collapse line: the options' effects are seconds while
    // the disruption is minutes. The pre-collapse level is drawn as an off-scale marker when it does not fit.
    const vals = [0];
    for (const x of branches) if (!dominated.has(x.b.bundleId)) vals.push(x.d.p10, x.d.p90);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1) {
      lo -= 0.5;
      hi += 0.5;
    }
    const pad = (hi - lo) * 0.12;
    const y = scaleLinear().domain([hi + pad, lo - pad]).range([M.t, H - M.b]);
    const preOn = pre >= lo - pad && pre <= hi + pad;
    return { branches, dominated, pre, preOn, y };
  }, [refs, bundles]);

  const x0 = M.l + 4;
  const x1 = W - M.r;
  const curve = (ya: number, yb: number, xe: number) => `M${x0},${ya} C${x0 + (xe - x0) * 0.45},${ya} ${x0 + (xe - x0) * 0.55},${yb} ${xe},${yb}`;

  // label positions without overlap: sort by y, push apart by 13 px
  const labels = useMemo(() => {
    if (!chart) return [] as { id: string; y: number; ly: number }[];
    // Label the options still in contention and the finalists; other dominated options are dimmed, folded and unlabeled.
    const items = chart.branches
      .filter((x) => !chart.dominated.has(x.b.bundleId) || finalistIds.has(x.b.bundleId))
      .map((x) => ({ id: x.b.bundleId, y: chart.y(x.med), ly: chart.y(x.med) }));
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) items[i].ly = Math.max(items[i].ly, items[i - 1].ly + 13);
    const over = items.length ? items[items.length - 1].ly - (H - M.b) : 0;
    if (over > 0) for (const it of items) it.ly -= over;
    return items;
  }, [chart, finalistIds]);

  const nPer = SEARCH_FUTURES.n[simLensFor(lens)];
  const runningFrac = f.roundTotal > 0 && running ? (f.roundDone % nPer) / nPer : 0;

  return (
    <section className="border-t border-border p-4" aria-labelledby="futures-h">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="futures-h" className="label">
          Futures
        </h2>
        <span className="chip h-6 px-2 text-xs" style={{ color: "var(--color-future)", borderColor: "rgb(167 139 250 / 0.5)" }}>
          {running ? "running" : refs ? `${Object.keys(bundles).length} options scored` : "not run"}
        </span>
      </div>

      {!refs && !running && (
        <div className="flex gap-3 rounded-ctl border border-dashed border-border p-3">
          <GitFork size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          <p className="text-xs leading-4 text-muted">
            Not run. Each option is tested across simulated stress futures, computed in your browser. {FUTURES_MODEL_LABEL}.
          </p>
        </div>
      )}

      {!refs && running && f.roundTotal > 0 && (
        <div className="rounded-ctl border border-border p-3">
          <p className="text-xs text-muted">Scoring the pre-collapse network and doing nothing under the same futures first...</p>
        </div>
      )}

      {chart && refs && (
        <figure>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="fan-cap" className="block overflow-visible">
            {/* zero = doing nothing */}
            <line x1={x0} x2={x1} y1={chart.y(0)} y2={chart.y(0)} stroke="var(--color-muted)" strokeDasharray="3 3" strokeWidth={1} />
            <text x={x0} y={chart.y(0) - 4} className="num" fontSize={11} fill="var(--color-muted)">
              doing nothing
            </text>
            {chart.preOn ? (
              <>
                <line x1={x0} x2={x1} y1={chart.y(chart.pre)} y2={chart.y(chart.pre)} stroke="var(--color-ok)" strokeDasharray="2 4" strokeWidth={1} opacity={0.8} />
                <text x={x0} y={chart.y(chart.pre) + 12} className="num" fontSize={11} fill="var(--color-ok)">
                  pre-collapse {fmtMetricDelta(metric, chart.pre)}
                </text>
              </>
            ) : (
              <text x={x0} y={chart.pre < 0 ? H - 4 : M.t - 4} className="num" fontSize={11} fill="var(--color-ok)">
                {chart.pre < 0 ? "↓" : "↑"} pre-collapse {fmtMetricDelta(metric, chart.pre)} (off this scale)
              </text>
            )}
            {/* branches */}
            {chart.branches.map(({ b, d, med }) => {
              const dom = chart.dominated.has(b.bundleId);
              const color = TIER_COLOR[b.costTier] ?? "var(--color-future)";
              const xe = dom ? x0 + (x1 - x0) * 0.62 : x1;
              const y0 = chart.y(0);
              const w = 1.5 + 6 * (b.pGoal ?? 0);
              const fin = finalistIds.has(b.bundleId);
              return (
                <g key={b.bundleId} opacity={dom ? 0.28 : 1} style={{ transition: reduced ? undefined : "opacity 250ms ease-out" }}>
                  {!dom && (
                    <path
                      d={`M${x0},${y0} C${x0 + (xe - x0) * 0.45},${y0} ${x0 + (xe - x0) * 0.55},${chart.y(d.p90)} ${xe},${chart.y(d.p90)} L${xe},${chart.y(d.p10)} C${x0 + (xe - x0) * 0.55},${chart.y(d.p10)} ${x0 + (xe - x0) * 0.45},${y0} ${x0},${y0} Z`}
                      fill={color}
                      opacity={0.14}
                    />
                  )}
                  <path
                    d={curve(y0, chart.y(med), xe)}
                    fill="none"
                    stroke={color}
                    strokeWidth={w}
                    strokeLinecap="round"
                    className={reduced ? undefined : "fan-draw"}
                  />
                  {fin && <circle cx={xe} cy={chart.y(med)} r={3.5} fill="var(--color-bg)" stroke="var(--color-text)" strokeWidth={1.5} />}
                </g>
              );
            })}
            {/* in-progress option: grows with the real completed-futures count */}
            {running && runningFrac > 0 && f.label.startsWith("option") && (
              <line
                x1={x0}
                x2={x0 + (x1 - x0) * runningFrac}
                y1={chart.y(0)}
                y2={chart.y(0)}
                stroke="var(--color-future)"
                strokeWidth={2}
                strokeDasharray="4 3"
              />
            )}
            {/* end labels */}
            {labels.map((l) => {
              const x = chart.branches.find((q) => q.b.bundleId === l.id)!;
              const dom = chart.dominated.has(l.id);
              return (
                <g key={l.id} opacity={dom ? 0.45 : 1}>
                  {Math.abs(l.ly - l.y) > 2 && <line x1={x1 + 2} x2={x1 + 8} y1={l.y} y2={l.ly} stroke="var(--color-border)" />}
                  <text x={x1 + 10} y={l.ly + 4} className="num" fontSize={11} fill={finalistIds.has(l.id) ? "var(--color-text)" : "var(--color-muted)"}>
                    {l.id} {x.b.costTier} {x.b.pGoal === null ? "--" : `${Math.round(x.b.pGoal * 100)}%`}
                  </text>
                </g>
              );
            })}
          </svg>
          <figcaption id="fan-cap" className="mt-1 text-xs leading-4 text-muted">
            Change in the {metricLabel(lens, metric).toLowerCase()} versus doing nothing, paired future by future across {refs.n} stress futures (seed {SEARCH_FUTURES.seed}). Line: median; band:
            10th to 90th percentile; thickness and % label: chance of meeting the goal; shade and $ label: cost tier. Lower is better.{" "}
            {chart.dominated.size > 0 ? `${chart.dominated.size} dominated options (another option is at least as good on chance, change and cost) are dimmed. ` : ""} Doing nothing meets the goal in{" "}
            <span className="num">{refs.nothingPGoal === null ? "--" : `${Math.round(refs.nothingPGoal * 100)}%`}</span> of futures. {FUTURES_MODEL_LABEL}.
          </figcaption>
        </figure>
      )}

      <ScreenBeat />
      <StressBeats />
      <ProgressGrid />
    </section>
  );
}

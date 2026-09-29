"use client";

import { useMemo, useRef, useState } from "react";
import { scaleLinear } from "d3";
import { GitFork, HelpCircle, Zap } from "lucide-react";
import Popover from "../ui/Popover";
import { GLOSSARY } from "@/lib/ui/storyCopy";
import { shortModel, simLensFor } from "@/lib/ui/agentBridge";
import { useReducedMotion } from "framer-motion";
import { FUTURES_MODEL_LABEL } from "@/lib/sim/sample";
import { useSearch } from "@/lib/ui/search";
import { SEARCH_FUTURES } from "@/lib/ui/agentBridge";
import { dist3, dominatedIds, durationTicks, median, niceTicks, rate, seriesColor, type Dist3 } from "@/lib/ui/futuresMath";
import type { GoalMetric } from "@/lib/agent/tools";
import { fmtMetricDelta, isCountMetric, metricLabel, optionName } from "./labels";

const W = 320;
const H = 200;
/** Left: tick labels. Right: the direct value label at each finalist's line end. */
const M = { l: 36, r: 72, t: 22, b: 10 };

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

interface Series {
  id: string;
  /** Finalist rank (0-based), or -1 for an option that did not make the final three. */
  rank: number;
  color: string | null;
  d: Dist3;
  med: number;
  pGoal: number | null;
  costTier: string;
  name: string;
  dominated: boolean;
}

const pct = (p: number | null) => (p === null ? "--" : `${Math.round(p * 100)}%`);

/** One axis, one unit: tick text without the unit (the axis title carries it), signed because it is a change. */
function tickText(v: number, unit: "s" | "min" | "count"): string {
  if (Math.abs(v) < 1e-9) return "0";
  const k = unit === "min" ? 60 : 1;
  const a = Number((Math.abs(v) / k).toPrecision(3));
  return `${v > 0 ? "+" : "-"}${a}`;
}

/** A line key: the band as a wash, the median as a 2 px line, in the series color (never the text). */
function Swatch({ color }: { color: string | null }) {
  const c = color ?? "var(--color-faint)";
  return (
    <svg width={16} height={10} viewBox="0 0 16 10" aria-hidden className="shrink-0">
      {color && <rect x={0} y={1} width={16} height={8} rx={2} fill={c} opacity={0.22} />}
      <line x1={1} x2={15} y1={5} y2={5} stroke={c} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

/**
 * The futures fan. One axis: the goal measure's change versus doing nothing (lower is better). Each finalist is a
 * 10th-to-90th percentile band (a 10% wash) and a 2 px median line in its fixed categorical color, direct-labeled
 * with its median at the line's end. Options that did not make the final three are gray context lines. Cost tier
 * is a text badge in the legend, never a second color dimension or a second axis.
 */
function Fan({ metric, lens }: { metric: GoalMetric; lens: Parameters<typeof metricLabel>[0] }) {
  const refs = useSearch((s) => s.refs)!;
  const bundles = useSearch((s) => s.bundles);
  const m = useSearch((s) => s.m);
  const catalog = useSearch((s) => s.catalog);
  const f = useSearch((s) => s.futures);
  const reduced = !!useReducedMotion();
  const phase = m?.phase ?? "idle";
  const running = phase === "planning" || phase === "evaluating" || phase === "critiquing" || phase === "finalizing";
  const [hover, setHover] = useState<string | null>(null);
  const [py, setPy] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const series = useMemo<Series[]>(() => {
    const rankOf = new Map((m?.finalists ?? []).map((x, i) => [x.bundleId, i]));
    const list = Object.values(bundles).map((b) => ({ b, med: median(b.vsNothing) }));
    const dom = dominatedIds(list.map((x) => ({ id: x.b.bundleId, median: x.med, pGoal: x.b.pGoal, costTier: x.b.costTier })));
    return list.map(({ b, med }) => {
      const rank = rankOf.get(b.bundleId) ?? -1;
      return {
        id: b.bundleId,
        rank,
        color: rank >= 0 ? seriesColor(rank) : null,
        d: dist3(b.vsNothing),
        med,
        pGoal: b.pGoal,
        costTier: b.costTier,
        name: b.candidateIds.map((id) => optionName(catalog, id)).join(" + "),
        dominated: dom.has(b.bundleId),
      };
    });
  }, [bundles, m?.finalists, catalog]);

  // Finalists last so their bands and lines sit on top of the gray context.
  const drawOrder = useMemo(() => [...series].sort((a, b) => (a.rank >= 0 ? 1 : 0) - (b.rank >= 0 ? 1 : 0) || b.rank - a.rank), [series]);
  const finalists = useMemo(() => series.filter((x) => x.rank >= 0).sort((a, b) => a.rank - b.rank), [series]);
  const others = series.length - finalists.length;

  const chart = useMemo(() => {
    const pre = -median(refs.nothingVsPre);
    // Scale to the options (and zero), not to the pre-collapse level: the options' effects are seconds while the
    // disruption is minutes. The pre-collapse level is a reference line only when it fits, else a caption note.
    const vals = [0];
    for (const x of series) {
      vals.push(x.med);
      if (x.rank >= 0 || (finalists.length === 0 && !x.dominated)) vals.push(x.d.p10, x.d.p90);
    }
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1) {
      lo -= 0.5;
      hi += 0.5;
    }
    const pad = (hi - lo) * 0.1;
    const y = scaleLinear().domain([hi + pad, lo - pad]).range([M.t, H - M.b]);
    const count = isCountMetric(metric);
    const t = count ? { unit: "count" as const, ticks: niceTicks(lo - pad, hi + pad, 4) } : durationTicks(lo - pad, hi + pad, 4);
    const preOn = pre >= lo - pad && pre <= hi + pad;
    return { pre, preOn, y, unit: t.unit, ticks: t.ticks.filter((v) => y(v) >= M.t - 0.5 && y(v) <= H - M.b + 0.5) };
  }, [refs, series, finalists.length, metric]);

  const x0 = M.l;
  const x1 = W - M.r;
  const y0 = chart.y(0);
  const cx = (t: number) => x0 + (x1 - x0) * t;
  const curve = (yb: number) => `M${x0},${y0} C${cx(0.45)},${y0} ${cx(0.55)},${yb} ${x1},${yb}`;
  const band = (d: Dist3) =>
    `M${x0},${y0} C${cx(0.45)},${y0} ${cx(0.55)},${chart.y(d.p90)} ${x1},${chart.y(d.p90)} L${x1},${chart.y(d.p10)} C${cx(0.55)},${chart.y(d.p10)} ${cx(0.45)},${y0} ${x0},${y0} Z`;

  // Direct labels at the line ends, pushed apart by 14 px and kept inside the plot.
  const ends = useMemo(() => {
    const items = finalists.map((x) => ({ id: x.id, y: chart.y(x.med), ly: chart.y(x.med) }));
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) items[i].ly = Math.max(items[i].ly, items[i - 1].ly + 14);
    const over = items.length ? items[items.length - 1].ly - (H - M.b - 2) : 0;
    if (over > 0) for (const it of items) it.ly -= over;
    for (const it of items) it.ly = Math.max(M.t + 2, it.ly);
    return items;
  }, [finalists, chart]);

  const unitTitle = chart.unit === "count" ? "Block groups" : chart.unit === "min" ? "Minutes" : "Seconds";
  const nPer = SEARCH_FUTURES.n[simLensFor(lens)];
  const runningFrac = f.roundTotal > 0 && running ? (f.roundDone % nPer) / nPer : 0;
  const hovered = hover ? series.find((x) => x.id === hover) ?? null : null;
  const dim = (id: string) => (hover && hover !== id ? 0.3 : 1);
  const enter = reduced ? "chart-fade" : "fan-draw";

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const yy = ((e.clientY - r.top) * H) / r.height;
    setPy(yy >= M.t && yy <= H - M.b ? yy : null);
  };

  return (
    <figure className="relative">
      {finalists.length > 0 && (
        <ul className="mb-2 flex flex-nowrap items-center gap-x-3 whitespace-nowrap text-xs text-text-2" aria-label="Legend">
          {finalists.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                className="flex h-6 items-center gap-1.5 rounded-sm px-0.5 hover:text-text"
                onPointerEnter={() => setHover(x.id)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(x.id)}
                onBlur={() => setHover(null)}
                aria-label={`Finalist ${x.rank + 1}, ${x.id}: ${x.name}. Cost tier ${x.costTier}. Median ${fmtMetricDelta(metric, x.med)}.`}
              >
                <Swatch color={x.color} />
                <span className="num">
                  #{x.rank + 1} {x.id}
                </span>
                <span className="num rounded-sm px-1 text-2xs text-muted shadow-[inset_0_0_0_1px_var(--color-border)]">{x.costTier}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <svg
        ref={svgRef}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby="fan-cap"
        className="block overflow-visible"
        onPointerMove={onMove}
        onPointerLeave={() => {
          setPy(null);
          setHover(null);
        }}
      >
        {/* axis title and ticks: one axis only */}
        <text x={0} y={10} fontSize={11} fill="var(--color-muted)">
          {unitTitle} vs doing nothing · lower is better
        </text>
        {chart.ticks.map((t) => (
          <g key={t}>
            <line x1={x0} x2={x1} y1={chart.y(t)} y2={chart.y(t)} stroke="var(--color-border)" strokeWidth={1} shapeRendering="crispEdges" />
            <text x={x0 - 6} y={chart.y(t) + 4} textAnchor="end" className="num" fontSize={11} fill="var(--color-muted)">
              {tickText(t, chart.unit)}
            </text>
          </g>
        ))}
        {/* zero = doing nothing: the reference, one step stronger than the grid */}
        <line x1={x0} x2={x1} y1={y0} y2={y0} stroke="var(--color-line-strong)" strokeWidth={1} shapeRendering="crispEdges" />
        <text x={x0 + 4} y={y0 - 5} fontSize={11} fill="var(--color-text-2)">
          Doing nothing
        </text>
        {chart.preOn && (
          <>
            <line x1={x0} x2={x1} y1={chart.y(chart.pre)} y2={chart.y(chart.pre)} stroke="var(--color-ok)" strokeDasharray="2 4" strokeWidth={1} />
            <text x={x0 + 4} y={chart.y(chart.pre) + 13} fontSize={11} fill="var(--color-text-2)">
              Before the collapse
            </text>
          </>
        )}
        {/* bands, then lines; finalists drawn last */}
        {drawOrder.map((x) =>
          x.color ? (
            <path key={`b-${x.id}`} d={band(x.d)} fill={x.color} opacity={0.1 * dim(x.id)} className="chart-fade" style={{ transition: "opacity 150ms ease-out" }} />
          ) : null,
        )}
        {drawOrder.map((x) => (
          <path
            key={`l-${x.id}`}
            d={curve(chart.y(x.med))}
            fill="none"
            stroke={x.color ?? "var(--color-faint)"}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={(x.color ? 1 : x.dominated ? 0.35 : 0.6) * dim(x.id)}
            className={enter}
            style={{ transition: "opacity 150ms ease-out, stroke 200ms ease-out" }}
          />
        ))}
        {/* in-progress option: grows with the real completed-futures count */}
        {running && runningFrac > 0 && f.label.startsWith("option") && (
          <line x1={x0} x2={cx(runningFrac)} y1={y0} y2={y0} stroke="var(--color-future)" strokeWidth={2} strokeDasharray="4 3" />
        )}
        {/* end dots (2 px surface ring where lines meet) and the median value, in text color */}
        {ends.map((l) => {
          const x = finalists.find((q) => q.id === l.id)!;
          return (
            <g key={`e-${l.id}`} opacity={dim(l.id)} style={{ transition: "opacity 150ms ease-out" }}>
              {Math.abs(l.ly - l.y) > 2 && <line x1={x1 + 6} x2={x1 + 10} y1={l.y} y2={l.ly} stroke="var(--color-line-strong)" />}
              <circle cx={x1} cy={l.y} r={4} fill={x.color ?? "var(--color-faint)"} stroke="var(--color-surface)" strokeWidth={2} />
              <text x={x1 + 12} y={l.ly + 4} className="num" fontSize={11} fill="var(--color-text)">
                {fmtMetricDelta(metric, x.med)}
              </text>
            </g>
          );
        })}
        {/* crosshair on the one axis */}
        {py !== null && (
          <g pointerEvents="none">
            <line x1={x0} x2={x1} y1={py} y2={py} stroke="var(--color-text-2)" strokeWidth={1} strokeDasharray="2 2" />
            <rect x={0} y={py - 8} width={x0 - 2} height={16} rx={3} fill="var(--color-surface-2)" />
            <text x={x0 - 6} y={py + 4} textAnchor="end" className="num" fontSize={11} fill="var(--color-text)">
              {tickText(chart.y.invert(py), chart.unit)}
            </text>
          </g>
        )}
        {/* hit targets, wider than the marks */}
        {drawOrder.map((x) => (
          <path
            key={`h-${x.id}`}
            d={curve(chart.y(x.med))}
            fill="none"
            stroke="transparent"
            strokeWidth={14}
            pointerEvents="stroke"
            onPointerEnter={() => setHover(x.id)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
        {finalists.map((x) => (
          <circle key={`hc-${x.id}`} cx={x1} cy={chart.y(x.med)} r={10} fill="transparent" onPointerEnter={() => setHover(x.id)} onPointerLeave={() => setHover(null)} />
        ))}
      </svg>
      {hovered && (
        <div
          className="pop pointer-events-none absolute z-10 w-64 px-3 py-2 text-xs leading-4"
          style={{ left: x1 - 8, top: (finalists.length > 0 ? 32 : 0) + chart.y(hovered.med), transform: "translate(-100%, -50%)" }}
          role="tooltip"
        >
          <p className="flex items-center gap-1.5 text-text">
            <Swatch color={hovered.color} />
            <span className="num">{hovered.rank >= 0 ? `#${hovered.rank + 1} ` : ""}{hovered.id}</span>
            <span className="num text-muted">{hovered.costTier}</span>
          </p>
          <p className="mt-0.5 line-clamp-2 text-text-2">{hovered.name}</p>
          <dl className="num mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-muted">Median</dt>
            <dd className="text-right text-text">{fmtMetricDelta(metric, hovered.med)}</dd>
            <dt className="text-muted">10th to 90th</dt>
            <dd className="whitespace-nowrap text-right text-text">
              {fmtMetricDelta(metric, hovered.d.p10)} to {fmtMetricDelta(metric, hovered.d.p90)}
            </dd>
            <dt className="text-muted">Meets goal</dt>
            <dd className="text-right text-text">{pct(hovered.pGoal)}</dd>
          </dl>
        </div>
      )}
      <table className="sr-only">
        <caption>Futures fan data: change versus doing nothing across {refs.n} what-if runs, lower is better</caption>
        <thead>
          <tr>
            <th scope="col">Option</th>
            <th scope="col">Median</th>
            <th scope="col">10th percentile</th>
            <th scope="col">90th percentile</th>
            <th scope="col">Chance of meeting the goal</th>
            <th scope="col">Cost tier</th>
          </tr>
        </thead>
        <tbody>
          {[...finalists, ...series.filter((x) => x.rank < 0)].map((x) => (
            <tr key={x.id}>
              <th scope="row">
                {x.rank >= 0 ? `Finalist ${x.rank + 1}, ` : ""}
                {x.id} {x.name}
              </th>
              <td>{fmtMetricDelta(metric, x.med)}</td>
              <td>{fmtMetricDelta(metric, x.d.p10)}</td>
              <td>{fmtMetricDelta(metric, x.d.p90)}</td>
              <td>{pct(x.pGoal)}</td>
              <td>{x.costTier}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption id="fan-cap" className="mt-2 flex items-start justify-between gap-2 text-xs leading-4 text-muted">
        <span>
          Change versus doing nothing across {refs.n} what-if runs. Line: median; band: middle 80% of runs.
          {others > 0 ? ` Gray: the other ${others} options scored.` : ""} Doing nothing meets the goal in{" "}
          <span className="num text-text-2">{pct(refs.nothingPGoal)}</span>.
          {!chart.preOn && (
            <>
              {" "}
              Before the collapse: <span className="num text-text-2">{fmtMetricDelta(metric, chart.pre)}</span> ({chart.pre < 0 ? "below" : "above"} this scale).
            </>
          )}
        </span>
        <Popover title="Reading the futures fan" triggerClassName="btn-icon !h-6 !w-6 shrink-0" triggerLabel="Reading the futures fan" trigger={<HelpCircle size={13} aria-hidden />}>
          <p>
            Change in the {metricLabel(lens, metric).toLowerCase()} versus doing nothing, paired future by future across {refs.n} stress futures (seed {SEARCH_FUTURES.seed}). Each finalist
            has its own color (see the legend): the line is its median, the band the 10th to 90th percentile, and the number at the line&apos;s end its median. Gray lines are the other
            options scored. The badge next to each legend entry is its cost tier. Lower is better.
            {series.some((x) => x.dominated) ? ` Faint gray lines are dominated options (another option is at least as good on chance, change and cost).` : ""}
          </p>
          <p className="mt-2">{FUTURES_MODEL_LABEL}.</p>
          <p className="mt-2">{GLOSSARY.future}</p>
        </Popover>
      </figcaption>
    </figure>
  );
}

export default function FuturesPanel() {
  const refs = useSearch((s) => s.refs);
  const bundles = useSearch((s) => s.bundles);
  const m = useSearch((s) => s.m);
  const f = useSearch((s) => s.futures);
  const draft = useSearch((s) => s.draft);
  const phase = m?.phase ?? "idle";
  const running = phase === "planning" || phase === "evaluating" || phase === "critiquing" || phase === "finalizing";
  const mission = m?.mission;
  const lens = mission?.lens ?? draft.lens;
  const metric = mission?.goal.metric ?? draft.metric;

  return (
    <section aria-labelledby="futures-h">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="futures-h" className="text-base font-medium" title={GLOSSARY.future}>
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

      {refs && <Fan metric={metric} lens={lens} />}

      <ScreenBeat />
      <StressBeats />
      <ProgressGrid />
    </section>
  );
}

"use client";

import { ArrowDown, ArrowUp, Minus, ScanLine } from "lucide-react";
import { useApp } from "@/lib/store";
import { fmtInt, fmtMin, fmtPct } from "@/lib/format";
import type { MetricKey } from "@/lib/sim";
import RollingNumber from "./RollingNumber";
import Sparkline from "./Sparkline";

interface Def {
  key: MetricKey;
  label: string;
  unit: string;
  fmt: (v: number) => string;
  /** true: an increase is bad (times, isolation, gaps). false: an increase is good. */
  worseWhenUp: boolean;
  signed: (d: number) => string;
  hatch?: boolean;
}

const sign = (d: number, s: string) => `${d > 0 ? "+" : d < 0 ? "-" : ""}${s}`;

const DEFS: Def[] = [
  { key: "p50", label: "p50 response", unit: "min", fmt: fmtMin, worseWhenUp: true, signed: (d) => sign(d, Math.abs(d).toFixed(1)) },
  { key: "p90", label: "p90 response", unit: "min", fmt: fmtMin, worseWhenUp: true, signed: (d) => sign(d, Math.abs(d).toFixed(1)) },
  { key: "pctWithin8", label: "Within 8 min", unit: "%", fmt: fmtPct, worseWhenUp: false, signed: (d) => sign(d, Math.abs(d).toFixed(0)) },
  { key: "isolated", label: "Isolated block groups", unit: "", fmt: fmtInt, worseWhenUp: true, signed: (d) => sign(d, Math.abs(d).toFixed(0)), hatch: true },
  { key: "equityGap", label: "Equity gap", unit: "min", fmt: fmtMin, worseWhenUp: true, signed: (d) => sign(d, Math.abs(d).toFixed(1)) },
];

function DeltaChip({ delta, def }: { delta: number; def: Def }) {
  const flat = Math.abs(delta) < (def.key === "isolated" ? 0.5 : 0.05);
  if (flat) {
    return (
      <span className="chip num h-6 px-2 text-muted" aria-label="No change">
        <Minus size={12} /> 0
      </span>
    );
  }
  const worse = def.worseWhenUp ? delta > 0 : delta < 0;
  const Arrow = delta > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      className="chip num h-6 px-2 font-medium"
      style={{
        color: worse ? "var(--color-critical)" : "var(--color-ok)",
        borderColor: worse ? "rgb(255 61 113 / 0.5)" : "rgb(45 212 191 / 0.5)",
        background: worse ? "rgb(255 61 113 / 0.10)" : "rgb(45 212 191 / 0.10)",
      }}
      aria-label={`${worse ? "Worse" : "Better"} by ${def.signed(delta)} ${def.unit}`}
    >
      <Arrow size={12} />
      {def.signed(delta).replace(/^[+-]/, "")}
      <span className="sr-only">{worse ? "worse" : "better"}</span>
    </span>
  );
}

export default function MetricsRibbon() {
  const baseline = useApp((s) => s.baseline);
  const current = useApp((s) => s.current);
  const history = useApp((s) => s.history);

  return (
    <section
      aria-label="Metrics"
      className="grid shrink-0 grid-cols-5 border-t border-border bg-surface"
      style={{ height: "var(--ws-ribbon)" }}
    >
      {DEFS.map((def, idx) => {
        const b = baseline?.metrics[def.key];
        const c = current?.metrics[def.key];
        const ready = b !== undefined && c !== undefined;
        return (
          <div
            key={def.key}
            className={`flex min-w-0 flex-col justify-center gap-1 px-5 ${idx > 0 ? "border-l border-border" : ""}`}
          >
            <div className="label flex items-center gap-2 truncate">
              {def.hatch && <ScanLine size={12} aria-hidden />}
              {def.label}
            </div>
            <div className="flex items-end justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="num text-sm text-muted" title="Baseline">
                  {ready ? def.fmt(b) : "--"}
                </span>
                <span className="text-muted" aria-hidden>
                  &rarr;
                </span>
                <span className="text-2xl font-medium leading-none">
                  {ready ? <RollingNumber value={c} format={def.fmt} /> : <span className="num">--</span>}
                </span>
                {def.unit && <span className="num text-xs text-muted">{def.unit}</span>}
              </div>
              <div className="flex flex-col items-end gap-1">
                {ready ? <DeltaChip delta={c - b} def={def} /> : <span className="h-6" />}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">baseline &rarr; current</span>
              <Sparkline values={history[def.key]} width={72} height={20} />
            </div>
          </div>
        );
      })}
    </section>
  );
}

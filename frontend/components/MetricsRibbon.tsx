"use client";

import { ArrowDown, ArrowUp, Minus, ScanLine } from "lucide-react";
import { useApp, simInfo } from "@/lib/store";
import { fmtCount, fmtDur, fmtMin, fmtPct1, fmtSignedDur } from "@/lib/format";
import { RIBBON_KEYS, RIBBON_LENS, ribbonValues, type RibbonExtras, type RibbonKey, type RibbonValues } from "@/lib/ui/ribbon";
import RollingNumber from "./RollingNumber";
import Sparkline from "./Sparkline";

interface Def {
  key: RibbonKey;
  label: string;
  /** Group tag above the label: which lens this number belongs to. */
  group: string;
  /** Value -> big number text + unit. */
  show: (v: number) => { value: string; unit: string };
  /** Signed delta text for the chip. */
  delta: (d: number) => string;
  /** Below this absolute change the chip reads "unchanged". */
  flat: number;
  /** One secondary line, from the same result. */
  sub: (v: RibbonValues, x: RibbonExtras, b: RibbonValues, emsThresholdMin: number | null) => string;
  hatch?: boolean;
}

const people = (v: number) => ({ value: fmtCount(v), unit: "" });
const signedCount = (d: number) => `${d > 0 ? "+" : d < 0 ? "-" : ""}${fmtCount(Math.abs(d))}`;
const dur = (s: number) => {
  const d = fmtDur(s);
  return { value: d.value, unit: d.unit };
};

const DEFS: Def[] = [
  {
    key: "xhTime",
    group: "Cross-harbor",
    label: "Avg trip to jobs across the harbor",
    show: (s) => ({ value: fmtMin(s / 60), unit: "min" }),
    delta: fmtSignedDur,
    flat: 0.5,
    sub: (_v, x) => (x.xhAddedP99S < 3 ? "no added time for the worst-off 1% of residents" : `worst-off 1% of residents: +${fmtMin(x.xhAddedP99S / 60)} min or more`),
  },
  {
    key: "xhPeople",
    group: "Cross-harbor",
    label: "Residents losing >10% of those jobs",
    show: people,
    delta: signedCount,
    flat: 0.5,
    sub: (_v, x) => `${fmtPct1(x.peopleSharePct)}% of residents · >25%: ${fmtCount(x.xhPeopleGt25)}`,
    hatch: true,
  },
  {
    key: "xhLowWage",
    group: "Equity",
    label: "Low-wage workers losing >10%",
    show: people,
    delta: signedCount,
    flat: 0.5,
    sub: (_v, x) => `${fmtPct1(x.lowWageSharePct)}% of low-wage vs ${fmtPct1(x.peopleSharePct)}% of all residents`,
  },
  {
    key: "regional",
    group: "Regional",
    label: "Added to avg drive to job centers",
    show: dur,
    delta: fmtSignedDur,
    flat: 0.5,
    sub: (_v, x) => `p90 drive ${fmtMin(x.regionalP90S / 60)} min`,
  },
  {
    key: "ems",
    group: "First response",
    label: "EMS p90 response time",
    show: (s) => ({ value: fmtMin(s / 60), unit: "min" }),
    delta: fmtSignedDur,
    flat: 1,
    sub: (_v, x, _b, thr) => `${fmtPct1(x.emsPctWithin)}% of residents within ${thr !== null ? `${Math.round(thr)} min` : "threshold"}`,
  },
];

/** Every ribbon number is "higher is worse": up = worse (magenta), down = better (teal), flat = muted. */
function DeltaChip({ d, def }: { d: number; def: Def }) {
  if (Math.abs(d) < def.flat) {
    return (
      <span className="chip num h-6 shrink-0 px-2 text-muted" aria-label="Unchanged from baseline">
        <Minus size={12} aria-hidden /> unchanged
      </span>
    );
  }
  const worse = d > 0;
  const Arrow = worse ? ArrowUp : ArrowDown;
  return (
    <span
      className="chip num h-6 shrink-0 px-2 font-medium"
      style={{
        color: worse ? "var(--color-critical)" : "var(--color-ok)",
        borderColor: worse ? "rgb(255 61 113 / 0.5)" : "rgb(45 212 191 / 0.5)",
        background: worse ? "rgb(255 61 113 / 0.10)" : "rgb(45 212 191 / 0.10)",
      }}
    >
      <Arrow size={12} aria-hidden />
      {def.delta(d).replace(/^[+-]/, "")}
      <span className="sr-only">{worse ? " worse" : " better"} than baseline</span>
    </span>
  );
}

function Tile({ def, idx }: { def: Def; idx: number }) {
  const baseline = useApp((s) => s.baseline);
  const current = useApp((s) => s.current);
  const history = useApp((s) => s.history[def.key]);
  const lens = useApp((s) => s.lens);
  const setLens = useApp((s) => s.setLens);
  const status = useApp((s) => s.status);
  const b = ribbonValues(baseline);
  const c = ribbonValues(current);
  const active = RIBBON_LENS[def.key] === lens;
  const ready = !!(b && c);
  const info = simInfo();
  const thr = info ? info.params.emsThresholdS / 60 : null;

  const bv = b?.v[def.key] ?? 0;
  const cv = c?.v[def.key] ?? 0;
  const base = def.show(bv);
  const cur = def.show(cv);

  return (
    <button
      type="button"
      onClick={() => void setLens(RIBBON_LENS[def.key])}
      aria-pressed={active}
      aria-label={`${def.group}: ${def.label}. ${ready ? `Baseline ${base.value} ${base.unit}, now ${cur.value} ${cur.unit}.` : "Loading."} Show this lens on the map.`}
      className={`group relative flex min-w-0 flex-col justify-center gap-1 px-4 text-left transition-colors duration-150 hover:bg-surface-2 ${idx > 0 ? "border-l border-border" : ""}`}
    >
      {/* Active-lens marker: a bar plus the brighter label, never color alone. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5 transition-opacity duration-200"
        style={{ background: "var(--color-text)", opacity: active ? 1 : 0 }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className={`label truncate ${active ? "!text-text" : ""}`}>{def.group}</span>
        {ready ? <DeltaChip d={cv - bv} def={def} /> : <span className="h-6" />}
      </div>
      <div className={`truncate text-xs ${active ? "text-text" : "text-muted"}`}>
        {def.hatch && <ScanLine size={12} className="mr-1 inline align-[-2px]" aria-hidden />}
        {def.label}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          {ready ? (
            <>
              <span className="num shrink-0 text-sm text-muted" title="Baseline">
                {base.value}
                {base.unit && base.unit !== cur.unit ? ` ${base.unit}` : ""}
              </span>
              <span className="text-muted" aria-hidden>
                &rarr;
              </span>
              <span className="text-2xl font-medium leading-none">
                <RollingNumber value={cv} format={(v) => def.show(v).value} />
              </span>
              {cur.unit && <span className="num text-xs text-muted">{cur.unit}</span>}
            </>
          ) : status === "error" ? (
            <span className="num text-2xl text-muted">--</span>
          ) : (
            <span className="skeleton h-7 w-32" aria-hidden />
          )}
        </div>
        {ready && history.length > 0 && <Sparkline values={history} width={48} height={16} />}
      </div>
      <p className="truncate text-xs text-muted">{ready ? def.sub(c!.v, c!.x, b!.v, thr) : "\u00a0"}</p>
    </button>
  );
}

export default function MetricsRibbon() {
  return (
    <section
      aria-label="Headline numbers, baseline to current"
      className="grid shrink-0 grid-cols-[1.1fr_1fr_1fr_1fr_1fr] border-t border-border bg-surface"
      style={{ height: "var(--ws-ribbon)" }}
    >
      {RIBBON_KEYS.map((k, i) => (
        <Tile key={k} def={DEFS.find((d) => d.key === k)!} idx={i} />
      ))}
    </section>
  );
}

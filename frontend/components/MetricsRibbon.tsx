"use client";

import { ArrowDown, ArrowUp, Minus, ScanLine, ShieldCheck } from "lucide-react";
import { useApp, simInfo } from "@/lib/store";
import { fmtCount, fmtDur, fmtMin, fmtPct1, fmtSignedDur } from "@/lib/format";
import { fmtAbout, PEOPLE_GT10_RANGE } from "@/lib/ui/methodology";
import { equityWording, RIBBON_KEYS, RIBBON_LENS, ribbonValues, type RibbonExtras, type RibbonKey, type RibbonValues } from "@/lib/ui/ribbon";
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

/** Counts from a cliff-edge measure (jobs within a fixed budget): two significant figures, read "about". */
const people = (v: number) => ({ value: fmtAbout(v), unit: "" });
const signedCount = (d: number) => `${d > 0 ? "+" : d < 0 ? "-" : ""}${fmtAbout(Math.abs(d))}`;
const dur = (s: number) => {
  const d = fmtDur(s);
  return { value: d.value, unit: d.unit };
};

const DEFS: Def[] = [
  {
    key: "xhPeople",
    group: "Cross-harbor",
    label: "Residents losing >10% of cross-harbor jobs",
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
  {
    key: "xhTime",
    group: "Cross-harbor",
    label: "Avg trip to jobs across the harbor",
    show: (s) => ({ value: fmtMin(s / 60), unit: "min" }),
    delta: fmtSignedDur,
    flat: 0.5,
    sub: (_v, x) => (x.xhAddedMaxPopS < 3 ? "no added time where people live" : `worst populated place +${fmtMin(x.xhAddedMaxPopS / 60)} min`),
  },
];

/**
 * Every ribbon number is "higher is worse": up = worse (magenta), down = better (teal), flat = muted.
 * `neutral` keeps the arrow but drops the alarm color (a change that is not a gap, e.g. equity at the same rate);
 * `held` marks a resilience finding: nothing moved although the world changed.
 */
function DeltaChip({ d, def, tone }: { d: number; def: Def; tone?: "neutral" | "held" }) {
  if (Math.abs(d) < def.flat) {
    if (tone === "held") {
      return (
        <span className="chip num h-6 shrink-0 px-2 font-medium" style={{ color: "var(--color-ok)", borderColor: "rgb(45 212 191 / 0.5)", background: "rgb(45 212 191 / 0.10)" }} aria-label="Held: unchanged from baseline">
          <ShieldCheck size={12} aria-hidden /> held
        </span>
      );
    }
    return (
      <span className="chip num h-6 shrink-0 px-2 text-muted" aria-label="Unchanged from baseline">
        <Minus size={12} aria-hidden /> unchanged
      </span>
    );
  }
  const worse = d > 0;
  const Arrow = worse ? ArrowUp : ArrowDown;
  const neutral = tone === "neutral";
  return (
    <span
      className="chip num h-6 shrink-0 px-2 font-medium"
      style={
        neutral
          ? { color: "var(--color-text)", borderColor: "var(--color-border)" }
          : {
              color: worse ? "var(--color-critical)" : "var(--color-ok)",
              borderColor: worse ? "rgb(255 61 113 / 0.5)" : "rgb(45 212 191 / 0.5)",
              background: worse ? "rgb(255 61 113 / 0.10)" : "rgb(45 212 191 / 0.10)",
            }
      }
    >
      <Arrow size={12} aria-hidden />
      {def.delta(d).replace(/^[+-]/, "")}
      <span className="sr-only">{worse ? " higher" : " lower"} than baseline</span>
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
  const changed = useApp((s) => s.scenario.removedLinks.length > 0 || (s.scenario.mutations?.length ?? 0) > 0);
  // Tile-specific wording and tone, all from computed values.
  const eq = ready && def.key === "xhLowWage" && c!.v.xhLowWage > 0.5 ? equityWording(c!.x.lowWageSharePct, c!.x.peopleSharePct) : null;
  const held = def.key === "ems" && changed;
  // The study's range covers the Key Bridge-removed world only; other worlds get the general caution.
  const onlyBridge = useApp((s) => s.scenario.removedLinks.length === 1 && s.scenario.removedLinks[0] === "key_bridge" && !(s.scenario.mutations?.length));
  const sensitive = def.key === "xhPeople" && ready && changed;
  const tone: "neutral" | "held" | undefined = held ? "held" : eq && eq.tone === "neutral" ? "neutral" : undefined;
  const sub = !ready
    ? "\u00a0"
    : sensitive
      ? onlyBridge
        ? `Range ${fmtAbout(PEOPLE_GT10_RANGE.lo)}–${fmtAbout(PEOPLE_GT10_RANGE.hi)} (assumptions)`
        : "Depends on assumptions"
      : eq
      ? eq.text.replace(" as all residents", " as everyone").replace(" than all residents", " than everyone")
      : held && Math.abs(c!.v.ems - b!.v.ems) < def.flat
        ? "Both shores have their own stations"
        : def.sub(c!.v, c!.x, b!.v, thr);

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
        {ready ? <DeltaChip d={cv - bv} def={def} tone={tone} /> : <span className="h-6" />}
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
              {(def.key === "xhPeople" || def.key === "xhLowWage") && cv > 0.5 && <span className="text-xs text-muted">about</span>}
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
        {ready && history.length > 0 && <span className="shrink-0 max-[1439px]:hidden"><Sparkline values={history} width={48} height={16} /></span>}
      </div>
      <p
        className="truncate text-xs text-muted"
        title={
          held && ready
            ? `First response held: both shores have their own fire and EMS stations and hospitals. ${def.sub(c!.v, c!.x, b!.v, thr)}.`
            : sensitive
              ? `This count depends on speed and time-budget assumptions${onlyBridge ? ` (range about ${fmtAbout(PEOPLE_GT10_RANGE.lo)} to ${fmtAbout(PEOPLE_GT10_RANGE.hi)}; see Methodology)` : " (see Methodology)"}. ${def.sub(c!.v, c!.x, b!.v, thr)}.`
              : sub
        }
      >
        {sub}
      </p>
    </button>
  );
}

/** Freight: hazmat truck mean added minutes over the cross-harbor trips (runTrips), car beside it. Opens the freight panel. */
function FreightTile() {
  const trips = useApp((s) => s.trips);
  const history = useApp((s) => s.tripsHistory);
  const setFreightOpen = useApp((s) => s.setFreightOpen);
  const hz = trips?.summary.hazmat_truck;
  const car = trips?.summary.car;
  const status = useApp((s) => s.status);
  const d = hz?.crossHarborMeanAddedMinutes ?? 0;
  const def: Def = { key: "xhTime", group: "Freight", label: "", show: (v) => ({ value: fmtMin(v), unit: "min" }), delta: (v) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${fmtMin(Math.abs(v))} min`, flat: 0.05, sub: () => "" };
  return (
    <button
      type="button"
      onClick={() => setFreightOpen(true)}
      aria-label={hz ? `Freight: hazmat trucks add ${fmtMin(d)} minutes on average across the harbor; cars ${fmtMin(car?.crossHarborMeanAddedMinutes ?? 0)}. Open freight and hazmat trips.` : "Freight and hazmat trips"}
      className="group relative flex min-w-0 flex-col justify-center gap-1 border-l border-border px-4 text-left transition-colors duration-150 hover:bg-surface-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label truncate">Freight</span>
        {hz ? <DeltaChip d={d} def={def} /> : <span className="h-6" />}
      </div>
      <div className="truncate text-xs text-muted">Hazmat trucks, per cross-harbor trip</div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          {hz ? (
            <>
              <span className="num shrink-0 text-sm text-muted">+0.0</span>
              <span className="text-muted" aria-hidden>
                &rarr;
              </span>
              <span className="text-2xl font-medium leading-none">
                <RollingNumber value={d} format={(v) => `+${fmtMin(v)}`} />
              </span>
              <span className="num text-xs text-muted">min</span>
            </>
          ) : status === "loading" || status === "idle" ? (
            <span className="skeleton h-7 w-24" aria-hidden />
          ) : (
            <span className="num text-2xl text-muted">--</span>
          )}
        </div>
        {hz && history.length > 0 && <span className="shrink-0 max-[1439px]:hidden"><Sparkline values={history} width={48} height={16} /></span>}
      </div>
      <p className="truncate text-xs text-muted">{hz && car ? `cars +${fmtMin(car.crossHarborMeanAddedMinutes)} · ${hz.crossHarborOver5Min}/${hz.crossHarborTrips} over 5 min` : "\u00a0"}</p>
    </button>
  );
}

export default function MetricsRibbon() {
  return (
    <section
      aria-label="Headline numbers, baseline to current"
      className="grid shrink-0 grid-cols-[1.1fr_1fr_0.9fr_1fr_1fr_1fr] border-t border-border bg-surface"
      style={{ height: "var(--ws-ribbon)" }}
    >
      {RIBBON_KEYS.map((k, i) => (
        <Tile key={k} def={DEFS.find((d) => d.key === k)!} idx={i} />
      ))}
      <FreightTile />
    </section>
  );
}

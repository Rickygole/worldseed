"use client";

import { ArrowDown, ArrowUp, Minus, ShieldCheck } from "lucide-react";
import { useApp, simInfo } from "@/lib/store";
import { fmtDur, fmtMin, fmtPct1 } from "@/lib/format";
import { fmtAbout, PEOPLE_GT10_RANGE } from "@/lib/ui/methodology";
import { equityWording, RIBBON_LENS, ribbonValues, type RibbonKey } from "@/lib/ui/ribbon";
import { isBridgeOnly } from "@/lib/ui/storyFigures";
import RollingNumber from "./RollingNumber";
import Sparkline from "./Sparkline";

type Tone = "worse" | "better" | "flat" | "held" | "neutral";

interface TileModel {
  id: string;
  label: string;
  /** Long explanation (STORY.md section 8), read by screen readers and shown on hover. */
  tip: string;
  value: number | null;
  format: (v: number) => string;
  prefix?: string;
  unit?: string;
  base: string | null;
  delta: string | null;
  tone: Tone;
  caption: string;
  history?: number[];
  onClick: () => void;
  active: boolean;
}

function DeltaChip({ text, tone }: { text: string | null; tone: Tone }) {
  if (tone === "held") {
    return (
      <span className="chip h-6 shrink-0 px-2 text-xs font-medium text-ok" style={{ background: "rgb(45 212 191 / 0.12)" }}>
        <ShieldCheck size={12} aria-hidden /> Held
      </span>
    );
  }
  if (tone === "flat" || !text) {
    return (
      <span className="chip h-6 shrink-0 px-2 text-xs text-muted">
        <Minus size={12} aria-hidden /> Unchanged
      </span>
    );
  }
  const worse = tone === "worse";
  const Arrow = text.startsWith("-") ? ArrowDown : ArrowUp;
  const color = tone === "neutral" ? "var(--color-text-2)" : worse ? "var(--color-critical)" : "var(--color-ok)";
  const bg = tone === "neutral" ? "rgb(148 163 184 / 0.08)" : worse ? "rgb(255 61 113 / 0.12)" : "rgb(45 212 191 / 0.12)";
  return (
    <span className="chip num h-6 shrink-0 px-2 text-xs font-medium" style={{ color, background: bg }}>
      <Arrow size={12} aria-hidden />
      {text.replace(/^[+-]/, "")}
      <span className="sr-only">{text.startsWith("-") ? " lower" : " higher"} than baseline</span>
    </span>
  );
}

function Tile({ t, first }: { t: TileModel; first: boolean }) {
  const status = useApp((s) => s.status);
  const tipId = `tip-${t.id}`;
  return (
    <button
      type="button"
      onClick={t.onClick}
      aria-pressed={t.active}
      aria-describedby={tipId}
      title={t.tip}
      className={`group relative flex min-w-0 flex-col justify-center gap-1 px-5 text-left transition-colors duration-150 hover:bg-[rgb(148_163_184/0.06)] ${first ? "" : "border-l border-border"}`}
    >
      <span id={tipId} className="sr-only">
        {t.tip}
      </span>
      <span aria-hidden className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-text transition-opacity duration-200" style={{ opacity: t.active ? 1 : 0 }} />
      <span className="flex items-center justify-between gap-2">
        <span className={`label truncate ${t.active ? "!text-text" : ""}`}>{t.label}</span>
        {t.value !== null && <DeltaChip text={t.delta} tone={t.tone} />}
      </span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          {t.value !== null ? (
            <>
              {t.prefix && <span className="text-xs text-muted">{t.prefix}</span>}
              <span className="display text-xl font-medium leading-none text-text">
                <RollingNumber value={t.value} format={t.format} mono={false} duration={0.9} delay={0.1} />
              </span>
              {t.unit && <span className="text-xs text-muted">{t.unit}</span>}
              {t.base !== null && <span className="num ml-1 truncate text-xs text-muted">from {t.base}</span>}
            </>
          ) : status === "error" ? (
            <span className="display text-xl text-muted">--</span>
          ) : (
            <span className="skeleton h-6 w-28" aria-hidden />
          )}
        </span>
        {t.history && t.history.length > 1 && (
          <span className="shrink-0 max-[1439px]:hidden">
            <Sparkline values={t.history} width={40} height={16} />
          </span>
        )}
      </span>
      <span className="truncate text-xs text-muted">{t.value !== null ? t.caption : " "}</span>
    </button>
  );
}

const signedDur = (s: number) => {
  const d = fmtDur(Math.abs(s));
  return `${s > 0 ? "+" : s < 0 ? "-" : ""}${d.value} ${d.unit}`;
};

/** Expert mode: one ribbon of five numbers, baseline to now. Every value from ribbon.ts or runTrips; the long form is a tooltip. */
export default function MetricsRibbon() {
  const baseline = useApp((s) => s.baseline);
  const current = useApp((s) => s.current);
  const history = useApp((s) => s.history);
  const lens = useApp((s) => s.lens);
  const setLens = useApp((s) => s.setLens);
  const scenario = useApp((s) => s.scenario);
  const trips = useApp((s) => s.trips);
  const tripsHistory = useApp((s) => s.tripsHistory);
  const setFreightOpen = useApp((s) => s.setFreightOpen);
  const b = ribbonValues(baseline);
  const c = ribbonValues(current);
  const changed = scenario.removedLinks.length > 0 || (scenario.mutations?.length ?? 0) > 0;
  const info = simInfo();
  const delay = info ? info.params.call_to_wheels_delay_min : null;
  const hz = trips?.summary.hazmat_truck;
  const car = trips?.summary.car;

  const tone = (d: number, flat: number): Tone => (Math.abs(d) < flat ? "flat" : d > 0 ? "worse" : "better");
  const lensTile = (key: RibbonKey) => ({ onClick: () => void setLens(RIBBON_LENS[key]), active: RIBBON_LENS[key] === lens, history: history[key] });

  const tiles: TileModel[] = [
    (() => {
      const d = c && b ? c.v.xhPeople - b.v.xhPeople : 0;
      const eq = c && c.v.xhLowWage > 0.5 ? equityWording(c.x.lowWageSharePct, c.x.peopleSharePct) : null;
      const range = changed ? (isBridgeOnly(scenario) ? `about ${fmtAbout(PEOPLE_GT10_RANGE.lo)} to ${fmtAbout(PEOPLE_GT10_RANGE.hi)}, depending on assumptions` : "range not tested for this scenario") : "";
      return {
        id: "people",
        label: "People affected",
        tip: "People who can reach over 10% fewer jobs across the river within a 30-minute drive. It can change a lot with assumptions; see the range.",
        value: c ? c.v.xhPeople : null,
        format: (v: number) => fmtAbout(v),
        prefix: c && c.v.xhPeople >= 100 ? "about" : undefined,
        base: b && changed ? fmtAbout(b.v.xhPeople) : null,
        delta: `${d > 0 ? "+" : d < 0 ? "-" : ""}${fmtAbout(Math.abs(d))}`,
        tone: tone(d, 0.5),
        caption: [range, eq ? `low-wage: ${eq.text.toLowerCase().replace("all residents", "everyone")}` : ""].filter(Boolean).join(" · ") || (c ? `${fmtPct1(c.x.peopleSharePct)}% of residents` : ""),
        ...lensTile("xhPeople"),
      };
    })(),
    (() => {
      const d = c && b ? c.v.regional - b.v.regional : 0;
      return {
        id: "regional",
        label: "Regional drive",
        tip: "Change in the average drive from home areas to the region's main job centers, with no traffic jams.",
        value: c ? c.v.regional : null,
        format: (v: number) => signedDur(v).replace(/ (s|min)$/, ""),
        unit: c ? fmtDur(Math.abs(c.v.regional)).unit : undefined,
        base: null,
        delta: signedDur(d),
        tone: tone(d, 0.5),
        caption: c ? `slow end (p90) ${fmtMin(c.x.regionalP90S / 60)} min` : "",
        ...lensTile("regional"),
      };
    })(),
    (() => {
      const d = c && b ? c.v.ems - b.v.ems : 0;
      const t = tone(d, 1);
      return {
        id: "ems",
        label: "Station time",
        tip: `Simulated time to the nearest fire or ambulance station for 90% of people${delay !== null ? `, including a ${Number.isInteger(delay) ? delay : fmtMin(delay)}-minute delay to get moving` : ""}.`,
        value: c ? c.v.ems / 60 : null,
        format: (v: number) => fmtMin(v),
        unit: "min",
        base: b && changed && t !== "flat" ? fmtMin(b.v.ems / 60) : null,
        delta: signedDur(d),
        tone: changed && t === "flat" ? "held" : t,
        caption: c ? `${fmtPct1(c.x.emsPctWithin)}% of people within ${info ? Math.round(info.params.emsThresholdS / 60) : 8} min` : "",
        ...lensTile("ems"),
      };
    })(),
    (() => {
      const d = c && b ? c.v.xhTime - b.v.xhTime : 0;
      return {
        id: "xhtime",
        label: "Trip across the river",
        tip: "Average drive from home to jobs on the other side of the river, weighted by number of jobs, compared with before.",
        value: c ? c.v.xhTime / 60 : null,
        format: (v: number) => fmtMin(v),
        unit: "min",
        base: b && changed ? fmtMin(b.v.xhTime / 60) : null,
        delta: signedDur(d),
        tone: tone(d, 0.5),
        caption: c ? (c.x.xhAddedMaxPopS < 3 ? "no added time where people live" : `worst spot +${fmtMin(c.x.xhAddedMaxPopS / 60)} min`) : "",
        ...lensTile("xhTime"),
      };
    })(),
    {
      id: "hazmat",
      label: "Dangerous cargo",
      tip: `Simulated extra minutes for a truck carrying certain hazardous materials to cross the river, averaged over ${hz?.crossHarborTrips ?? "the"} set trips, with no traffic jams. Simulation, not route guidance.`,
      value: hz ? hz.crossHarborMeanAddedMinutes : null,
      format: (v: number) => `+${fmtMin(v)}`,
      unit: "min",
      base: null,
      delta: hz ? `${hz.crossHarborMeanAddedMinutes >= 0 ? "+" : "-"}${fmtMin(Math.abs(hz.crossHarborMeanAddedMinutes))} min` : null,
      tone: hz ? tone(hz.crossHarborMeanAddedMinutes, 0.05) : "flat",
      caption: hz && car ? `cars +${fmtMin(car.crossHarborMeanAddedMinutes)} min · ${hz.crossHarborOver5Min} of ${hz.crossHarborTrips} trips over 5 min` : "",
      history: tripsHistory,
      onClick: () => setFreightOpen(true),
      active: false,
    },
  ];

  return (
    <section aria-label="Headline numbers, baseline to now" className="grid shrink-0 grid-cols-5 border-t border-border bg-surface" style={{ height: "var(--ws-ribbon)" }}>
      {tiles.map((t, i) => (
        <Tile key={t.id} t={t} first={i === 0} />
      ))}
    </section>
  );
}

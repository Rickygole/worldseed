/**
 * What each story scene shows: one big number, one sentence, one button; everything else behind "How do we
 * know?" (docs/STORY.md, plain-language rules). Pure functions of the simulator results (ribbon.ts
 * selectors, runTrips summaries, the search machine state) and, only in the exact Key Bridge-removed
 * reference world, the documented sensitivity study (methodology.ts). No figure is typed in here. A sentence
 * whose slots cannot be resolved is not shown ("Not available for this scenario").
 */
import { FAST_ERR, fmtAbout, MEAN_ADDED_RANGE_S, PEOPLE_GT10_RANGE, REPORTED_DETOUR, SPEED_VARIANT_PCT } from "./methodology";
import { ribbonValues } from "./ribbon";
import { blockGroupAt, placesFor, type AuxIndex } from "./snapshotAux";
import { CAVEATS, fill, fillOrNull, HEADLINES, STEPS, T, type CaveatCopy } from "./storyCopy";
import { fmtDate, fmtMin } from "../format";
import type { Scenario, SimOutput } from "../sim/types";
import type { TripsResult } from "../sim/trips";
import type { SceneId } from "./mapDirector";

export type Tone = "neutral" | "ok" | "warn" | "critical" | "ai" | "future";

/** Definitions of the lens measures (not results): the cross-harbor "affected" threshold and the first-response quantile. */
export const DEF = { lossPct: 10, emsPct: 90, severePct: 25 } as const;

export interface Figure {
  /** Same key on two consecutive screens = the number rolls from one to the other; otherwise it fades in. */
  key: string;
  value: number;
  format: (v: number) => string;
  prefix?: string;
  unit?: string;
  tone: Tone;
  /** False for counts that are not simulation results (catalog size, search progress): no "Simulated" tag. */
  simulated?: boolean;
}

export type ActionId = "removeBridge" | "reveal" | "route" | "search" | "stop" | "apply" | "next" | "expert" | "gate";

export interface Action {
  id: ActionId;
  label: string;
  variant: "light" | "secondary";
  disabled?: boolean;
}

export interface Chip {
  text: string;
  tone: Tone;
  icon?: "held" | "up" | "down" | "range";
  /** Opens this "How do we know?" section when activated. */
  caveat?: CaveatCopy;
}

export interface SceneView {
  id: Exclude<SceneId, "intro">;
  /** Sub-state ("before" / "after", "ready" / "searching" / "finalists" / "applied", "gate"...). */
  state: string;
  step: string;
  headline: string;
  figure: Figure | null;
  /** The number's caption (at most eight words). */
  caption: string | null;
  /** At most one quiet chip next to the number (the assumption range, "Unchanged", "Still affected"). */
  chip: Chip | null;
  /** Null when a slot could not be resolved: show "Not available for this scenario". */
  sentence: string | null;
  /** One small muted line under the sentence (the planner in use, a progress count, the escort note). */
  note: string | null;
  action: Action;
  /** "How do we know?": ranges, sources, methods. Opened on purpose. */
  how: CaveatCopy[];
  /** The world on screen is not yet the one this scene describes: skeletons, never stale numbers. */
  pending: boolean;
}

export interface SearchSnapshot {
  phase: string;
  mode: "ai" | "deterministic" | null;
  aiAvailable: boolean;
  plannerModel: string | null;
  /** Screening stage of the deterministic search: bundles scored of total. */
  screening: { done: number; total: number } | null;
  futuresDone: number;
  /** Futures planned so far (done in earlier rounds + this round's total). */
  futuresPlanned: number;
  futuresPerOption: number;
  seed: number;
  catalogCount: number | null;
  targetDeltaS: number;
  costTier: string;
  finalists: { bundleId: string; title: string; costTier: string; pGoal: number | null }[];
  appliedBundleId: string | null;
  /** The shown finalist's change in the goal measure versus doing nothing, one value per what-if run (seconds). */
  bestVsNothing: number[] | null;
  /** The last search was stopped before finalists. */
  stopped: boolean;
}

export interface StoryFacts {
  /** Shores (0 north/east, 1 south/west) that have at least one active fire station. */
  shoresWithStations: number | null;
  fireStations: number | null;
  ambulanceStations: number | null;
  /** Road anchors the freight trips connect. */
  anchorCount: number | null;
  /** Cross-harbor time budget, minutes (assumption A-XHARBOR-T). */
  budgetMin: number | null;
}

export interface StoryInput {
  baseline: SimOutput | null;
  current: SimOutput | null;
  scenario: Scenario;
  trips: TripsResult | null;
  aux: AuxIndex | null;
  params: { emsThresholdS: number; call_to_wheels_delay_min: number } | null;
  osmDate: string | null;
  facts: StoryFacts;
  /** Scenes whose map reveal (the scene's action) has been done. */
  revealed: ReadonlySet<SceneId>;
  /** The Key Bridge-removed world without options (the "without the fix" count). */
  bridgeOnly: SimOutput | null;
  /** The world with the top finalist (before apply), or null while computing. */
  topWorld: SimOutput | null;
  routeShown: boolean;
  settling: boolean;
  search: SearchSnapshot;
  /** Label of the next scene, for the "Next" action. */
  nextStep: string | null;
}

export const isBridgeOnly = (s: Scenario): boolean => s.removedLinks.length === 1 && s.removedLinks[0] === "key_bridge" && !(s.mutations?.length);
export const isBaseline = (s: Scenario): boolean => s.removedLinks.length === 0 && !(s.mutations?.length);
const bridgeRemoved = (s: Scenario): boolean => s.removedLinks.includes("key_bridge");

// ------------------------------------------------------------------------------------------------ slot formats

/** "a, b and c" */
export function list(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Whole minutes with "about" (the story's freight figures). */
export function fmtMinutesAbout(min: number): string {
  const n = Math.round(min);
  return `about ${n} minute${n === 1 ? "" : "s"}`;
}

/** People count: two significant figures, "about" at 100 and above (fmtAbout). */
export function fmtPeople(v: number): string {
  return Math.abs(v) >= 100 ? `about ${fmtAbout(v)}` : `${Math.round(v)}`;
}

/** 60 -> "1 minute", 30 -> "30 seconds", 120 -> "2 minutes". */
export function fmtDurLong(s: number): string {
  if (s < 60) return `${Math.round(s)} seconds`;
  const m = s / 60;
  const t = Number.isInteger(m) ? String(m) : m.toFixed(1);
  return `${t} minute${t === "1" ? "" : "s"}`;
}

/** Two significant figures, clamped to 0..100, for a recovered share. */
export function fmtPct2(v: number): string {
  const c = Math.min(100, Math.max(0, v));
  if (c < 0.5) return "0";
  if (c < 10) return `${Math.round(c)}`;
  const mag = Math.pow(10, Math.floor(Math.log10(c)) - 1);
  return `${Math.round(c / mag) * mag}`;
}

/**
 * Share of the added cross-harbor loss an option recovers, on the count of residents reaching over 10% fewer
 * jobs: (removed - withOption) / (removed - intact), percent. Null when the bridge removal itself changes nothing.
 */
export function recoveredPct(intact: number, removed: number, withOption: number): number | null {
  const lost = removed - intact;
  if (!(lost > 0)) return null;
  return (100 * (removed - withOption)) / lost;
}

/**
 * The stress test after an idea is applied: how much of the idea's benefit survives when a tunnel also closes. The
 * benefit is the drop in people affected (the same measure as the recovery): without and with the idea, in the
 * bridge-removed world and in the same world with the stress link closed. Null when the idea has no benefit to keep.
 */
export function stressKeep(p: { base: number; withIdea: number; stressBase: number; stressWithIdea: number }): { keepPct: number; benefit: number; stressedBenefit: number } | null {
  const benefit = p.base - p.withIdea;
  if (!(benefit >= 0.5)) return null;
  const stressedBenefit = p.stressBase - p.stressWithIdea;
  return { keepPct: (100 * stressedBenefit) / benefit, benefit, stressedBenefit };
}

/**
 * Reviewed place-label table for the hardest-hit block groups. The OSM place nearest to each block group is
 * mapped to a reviewed area name when it lies on the Sparrows Point and Edgemere peninsula (east of Bear
 * Creek, south of North Point Boulevard); other names pass through unchanged.
 */
const PENINSULA_PLACES = new Set([
  "Sparrows Point",
  "Edgemere",
  "Water View",
  "Lodge Forest",
  "Fort Howard",
  "Fitzell",
  "Chesapeake Terrace",
  "Lynch Point",
  "Bear Creek Junction",
  "Beachwood Estates",
  "Swan Point",
  "Ramona Beach",
  "Porters Park",
]);
/** STORY.md slot table: no "the" and no "peninsula". */
export const PENINSULA_LABEL = "Sparrows Point and Edgemere";

/** xharbor.worstAreaLabel: up to three names, the peninsula collapsed into its reviewed label. Empty = no place. */
export function worstAreaLabel(names: string[]): string {
  const out: string[] = [];
  for (const n of names) {
    const label = PENINSULA_PLACES.has(n) ? PENINSULA_LABEL : n;
    if (!out.includes(label)) out.push(label);
    if (out.length === 3) break;
  }
  return list(out);
}

/** Top place per block group, heaviest-hit block group first (one entry per block group; "" when it has no place). */
function worstPlaces(aux: AuxIndex, bgs: number[]): string[] {
  return bgs.map((bg) => {
    const row = blockGroupAt(aux, bg);
    return (row ? placesFor(aux, row.hexes)[0] : undefined) ?? "";
  });
}

/**
 * Where the worst-hit spots are, computed: the reviewed area label that most of them share ("most"), or,
 * when no label covers more than half, up to two labels. Empty when no spot has a place name.
 */
export function worstArea(names: string[]): { label: string; most: boolean } {
  const labels = names.filter(Boolean).map((n) => worstAreaLabel([n]));
  if (labels.length === 0) return { label: "", most: false };
  const count = new Map<string, number>();
  for (const l of labels) count.set(l, (count.get(l) ?? 0) + 1);
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 1) return { label: ranked[0][0], most: false };
  if (ranked[0][1] > names.length / 2) return { label: ranked[0][0], most: true };
  return { label: list(ranked.slice(0, 2).map((r) => r[0])), most: false };
}

// ------------------------------------------------------------------------------------------------ "How do we know?"

function lowerBound(reference: boolean): CaveatCopy {
  if (!reference) return CAVEATS.lowerBound;
  const c = CAVEATS.lowerBoundStudy;
  return {
    ...c,
    body: fill(c.body, {
      before: String(REPORTED_DETOUR.beforeMin),
      after: String(REPORTED_DETOUR.afterMin),
      modelAdded: String(REPORTED_DETOUR.modelAddedMin),
      bothTunnels: String(Math.round(REPORTED_DETOUR.modelAddedBothTunnelsClosedMin)),
    }),
  };
}

function range(reference: boolean, value?: number): CaveatCopy {
  if (!reference) return CAVEATS.rangeNotTested;
  const c = CAVEATS.range;
  return {
    ...c,
    body: fill(c.body, { speedPct: String(SPEED_VARIANT_PCT), lo: fmtAbout(PEOPLE_GT10_RANGE.lo), hi: fmtAbout(PEOPLE_GT10_RANGE.hi) }),
    visual:
      value === undefined
        ? undefined
        : { kind: "range", lo: PEOPLE_GT10_RANGE.lo, hi: PEOPLE_GT10_RANGE.hi, value, loLabel: `about ${fmtAbout(PEOPLE_GT10_RANGE.lo)}`, hiLabel: `about ${fmtAbout(PEOPLE_GT10_RANGE.hi)}`, valueLabel: `this map: about ${fmtAbout(value)}` },
  };
}

/** "How do we know?" for a finalist: its spread across the what-if runs, drawn (futuresMath ridge). */
function spread(values: number[] | null): CaveatCopy | null {
  if (!values || values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const better = values.filter((v) => v < -0.5).length;
  return {
    id: "spread",
    label: "Across the what-if runs",
    title: "The best idea across the what-if runs",
    body: `Each what-if run adds its own jams and closures. The shape shows how much the slowest trips across the river change with the idea, compared with doing nothing in the same run: left of the dashed line is faster. It is faster in ${better} of ${values.length} runs.`,
    visual: { kind: "ridge", values: sorted, unit: "s", caption: "change in the slowest trips, seconds" },
  };
}

/** The range chip: study range in the reference world only; elsewhere "Range not tested for this scenario". */
function rangeChip(reference: boolean): Chip {
  return reference
    ? { text: fill(T.averages.rangeChip, { lo: fmtAbout(PEOPLE_GT10_RANGE.lo), hi: fmtAbout(PEOPLE_GT10_RANGE.hi) }), tone: "neutral", icon: "range", caveat: range(true) }
    : { text: T.averages.rangeNotTested, tone: "neutral", icon: "range", caveat: CAVEATS.rangeNotTested };
}

function fast(): CaveatCopy {
  const c = CAVEATS.fastVariant;
  return { ...c, body: fill(c.body, { defaultPct: String(FAST_ERR.defaultPct), futLo: String(FAST_ERR.futuresPct.lo), futHi: String(FAST_ERR.futuresPct.hi) }) };
}

function present<X>(xs: (X | null | undefined | false | "")[]): X[] {
  return xs.filter(Boolean) as X[];
}

/** Study-derived constants appear only in the reference world; MEAN_ADDED_RANGE_S is Expert-only (kept for the test). */
export const STUDY = { PEOPLE_GT10_RANGE, MEAN_ADDED_RANGE_S };

// ------------------------------------------------------------------------------------------------ scenes

const nextAction = (inp: StoryInput): Action => ({ id: "next", label: inp.nextStep ? `${T.common.next}: ${inp.nextStep}` : T.common.next, variant: "light" });

function shell(id: SceneView["id"], state: string, pending: boolean, action: Action): SceneView {
  return { id, state, step: STEPS[id], headline: HEADLINES[id], figure: null, caption: null, chip: null, sentence: null, note: null, action, how: [], pending };
}

function gate(id: SceneView["id"]): SceneView {
  return { ...shell(id, "gate", false, { id: "gate", label: T.common.gateAction, variant: "light" }), sentence: T.fix.gate };
}

function waiting(id: SceneView["id"], action: Action): SceneView {
  return shell(id, "pending", true, { ...action, disabled: true });
}

const peopleFigure = (v: number, unit: string): Figure => ({ key: "people", value: v, format: (x) => (x >= 100 ? fmtAbout(x) : `${Math.round(x)}`), prefix: v >= 100 ? "about" : undefined, unit, tone: "critical" });

export function sceneView(id: SceneView["id"], inp: StoryInput): SceneView {
  const b = ribbonValues(inp.baseline);
  const c = ribbonValues(inp.current);
  const reference = isBridgeOnly(inp.scenario);
  const budgetMin = inp.facts.budgetMin;
  const revealed = inp.revealed.has(id);

  switch (id) {
    case "crossing": {
      if (!b || !c) return waiting(id, { id: "removeBridge", label: T.crossing.action, variant: "light" });
      const d = c.v.regional - b.v.regional;
      const secs = Math.abs(d) < 0.5 ? 0 : Math.round(Math.abs(d));
      const figure: Figure = { key: "regional", value: secs, format: (v) => `${Math.round(v)}`, prefix: secs > 0 ? "about" : undefined, unit: secs === 1 ? "second" : T.crossing.unit, tone: "neutral" };
      const base = { figure, caption: T.crossing.caption, how: [lowerBound(reference)] };
      if (isBaseline(inp.scenario)) {
        return { ...shell(id, "before", inp.settling, { id: "removeBridge", label: T.crossing.action, variant: "light" }), ...base, sentence: T.crossing.before };
      }
      const added = secs === 0 ? "under 1 second" : `about ${secs} second${secs === 1 ? "" : "s"}`;
      const tpl = d <= -0.5 ? T.crossing.afterShorter : d < 0.5 ? T.crossing.afterNone : reference ? T.crossing.afterLonger : T.crossing.afterLonger.replace("On average, a drive", "In this scenario, a drive");
      return { ...shell(id, "after", inp.settling, nextAction(inp)), ...base, sentence: fill(tpl, { regionalAdded: added }) };
    }

    case "averages": {
      if (!bridgeRemoved(inp.scenario)) return inp.settling ? waiting(id, nextAction(inp)) : gate(id);
      const xd = inp.current?.detail?.xharbor;
      if (!c || !xd || budgetMin === null) return waiting(id, nextAction(inp));
      const worst = (xd.worstBlockGroups.byLossPct ?? []).filter((w) => w.meanLossPct > DEF.severePct);
      let sentence: string;
      let worstLossRange: string | undefined;
      if (worst.length === 0) sentence = T.averages.none;
      else {
        const lo = Math.round(Math.min(...worst.map((w) => w.meanLossPct)));
        const hi = Math.round(Math.max(...worst.map((w) => w.meanLossPct)));
        worstLossRange = lo === hi ? `${hi}%` : `${lo}-${hi}%`;
        if (!inp.aux) return waiting(id, nextAction(inp));
        const area = worstArea(worstPlaces(inp.aux, worst.map((w) => w.bg)));
        sentence = area.label ? fill(area.most ? T.averages.sentenceMost : T.averages.sentence, { worstArea: area.label }) : T.averages.noPlace;
      }
      const worstBody = worstLossRange ? fill(CAVEATS.worstSpots.body, { worstLossRange, budgetMin: String(budgetMin) }) : null;
      return {
        ...shell(id, revealed ? "revealed" : "ready", inp.settling, revealed ? nextAction(inp) : { id: "reveal", label: T.averages.action, variant: "light" }),
        figure: peopleFigure(c.v.xhPeople, T.averages.unit),
        caption: fill(T.averages.caption, { lossPct: String(DEF.lossPct) }),
        chip: rangeChip(reference),
        sentence,
        how: present<CaveatCopy>([range(reference, c.v.xhPeople), worstBody && { ...CAVEATS.worstSpots, body: worstBody }, lowerBound(reference), CAVEATS.places, reference && fast()]),
      };
    }

    case "held": {
      if (!bridgeRemoved(inp.scenario)) return inp.settling ? waiting(id, nextAction(inp)) : gate(id);
      if (!b || !c) return waiting(id, nextAction(inp));
      const dEms = c.v.ems - b.v.ems;
      const dWithin = c.x.emsPctWithin - b.x.emsPctWithin;
      const same = Math.abs(dEms) < 1 && Math.abs(dWithin) < 0.05;
      const sentence = same ? (inp.facts.shoresWithStations === 2 ? T.held.both : T.held.unchanged) : fill(T.held.moved, { emsBefore: fmtMin(b.v.ems / 60), emsAfter: fmtMin(c.v.ems / 60) });
      const delay = inp.params ? (Number.isInteger(inp.params.call_to_wheels_delay_min) ? String(inp.params.call_to_wheels_delay_min) : inp.params.call_to_wheels_delay_min.toFixed(1)) : undefined;
      const lensBody = fillOrNull(CAVEATS.emsLens.body, {
        fire: inp.facts.fireStations === null ? undefined : String(inp.facts.fireStations),
        ambulance: inp.facts.ambulanceStations === null ? undefined : String(inp.facts.ambulanceStations),
        delay,
      });
      return {
        ...shell(id, revealed ? "revealed" : same ? "unchanged" : "moved", inp.settling, revealed ? nextAction(inp) : { id: "reveal", label: T.held.action, variant: "light" }),
        figure: { key: "ems", value: c.v.ems / 60, format: (v) => fmtMin(v), unit: T.held.unit, tone: same ? "ok" : dEms > 0 ? "critical" : "ok" },
        caption: fill(T.held.caption, { emsPct: String(DEF.emsPct) }),
        chip: same ? { text: T.held.chipUnchanged, tone: "ok", icon: "held" } : { text: dEms > 0 ? T.held.chipHigher : T.held.chipLower, tone: dEms > 0 ? "critical" : "ok", icon: dEms > 0 ? "up" : "down" },
        sentence,
        how: present<CaveatCopy>([lensBody && { ...CAVEATS.emsLens, body: lensBody }, same ? CAVEATS.emsUnchanged : CAVEATS.emsChanged, CAVEATS.heldMapKey]),
      };
    }

    case "freight": {
      if (!bridgeRemoved(inp.scenario)) return inp.settling ? waiting(id, nextAction(inp)) : gate(id);
      const hz = inp.trips?.summary.hazmat_truck;
      const car = inp.trips?.summary.car;
      if (!inp.trips && !inp.settling && inp.current) return { ...shell(id, "unavailable", false, nextAction(inp)), sentence: T.freight.unavailable };
      if (!hz || !car) return waiting(id, nextAction(inp));
      const slots = { carAdded: fmtMinutesAbout(car.crossHarborMeanAddedMinutes), hazmatAdded: fmtMinutesAbout(hz.crossHarborMeanAddedMinutes), trips: String(hz.crossHarborTrips) };
      const mechanism = reference && hz.crossHarborMeanAddedMinutes - car.crossHarborMeanAddedMinutes >= 0.5;
      const snapshotDate = inp.osmDate ? fmtDate(inp.osmDate) : undefined;
      const guidance = fillOrNull(CAVEATS.notGuidance.body, { snapshotDate });
      const hzMin = Math.round(hz.crossHarborMeanAddedMinutes);
      return {
        ...shell(id, inp.routeShown ? "route" : "ready", inp.settling, inp.routeShown ? nextAction(inp) : { id: "route", label: T.freight.action, variant: "light" }),
        figure: { key: "hazmat", value: hz.crossHarborMeanAddedMinutes, format: (v) => `${Math.round(v)}`, prefix: "about", unit: hzMin === 1 ? "minute" : T.freight.unit, tone: "warn" },
        caption: fill(T.freight.caption, slots),
        sentence: fill(mechanism ? T.freight.detour : T.freight.plain, slots),
        note: T.freight.note,
        how: present<CaveatCopy>([
          CAVEATS.hazmatWhat,
          guidance && { ...CAVEATS.notGuidance, body: guidance },
          reference ? CAVEATS.hazmatAssumption : CAVEATS.hazmatAssumptionNoRoute,
          CAVEATS.escorts,
          CAVEATS.routeKey,
          lowerBound(false),
        ]),
      };
    }

    case "fix":
      return fixView(inp, b);

    case "explore":
      return {
        ...shell(id, "ready", !c, { id: "expert", label: T.explore.action, variant: "light" }),
        figure: c ? peopleFigure(c.v.xhPeople, T.explore.unit) : null,
        caption: T.explore.caption,
        chip: c && bridgeRemoved(inp.scenario) ? rangeChip(reference) : null,
        sentence: T.explore.sentence,
        how: present<CaveatCopy>([c && bridgeRemoved(inp.scenario) && range(reference), lowerBound(false)]),
      };
  }
}

function fixView(inp: StoryInput, b: ReturnType<typeof ribbonValues>): SceneView {
  const s = inp.search;
  const id = "fix" as const;
  const budgetMin = inp.facts.budgetMin;
  const ai = s.mode === "ai" || (s.mode === null && s.aiAvailable);
  const modeLine = ai ? fill(T.fix.ai, { model: s.plannerModel ?? "Nemotron" }) : T.fix.deterministic;
  const hypothetical: CaveatCopy = {
    ...CAVEATS.hypothetical,
    body: s.catalogCount === null ? CAVEATS.hypothetical.body.replace("All {{catalogCount}} ideas", "All ideas") : fill(CAVEATS.hypothetical.body, { catalogCount: String(s.catalogCount) }),
  };
  const goal: CaveatCopy = { ...CAVEATS.goal, body: fill(CAVEATS.goal.body, { target: fmtDurLong(s.targetDeltaS), tier: s.costTier, mode: modeLine }) };
  const baseHow: CaveatCopy[] = [goal, hypothetical, CAVEATS.speedFactors, fast()];
  const phase = s.phase;

  if (!bridgeRemoved(inp.scenario) && phase !== "applied") return inp.settling ? waiting(id, { id: "search", label: T.fix.actionReady, variant: "light" }) : gate(id);

  if ((phase === "finalists" || phase === "applied" || phase === "applying") && s.finalists.length > 0) {
    const applied = phase === "applied";
    const action: Action = applied ? { id: "next", label: T.fix.actionApplied, variant: "light" } : { id: "apply", label: T.fix.actionFinalists, variant: "light", disabled: phase === "applying" };
    const w = ribbonValues(applied ? inp.current : inp.topWorld);
    const before = ribbonValues(inp.bridgeOnly);
    if (!w || !before || !b) return { ...shell(id, applied ? "applied" : "finalists", true, action), sentence: T.fix.computing, note: modeLine, how: baseHow };
    const rec = recoveredPct(b.v.xhPeople, before.v.xhPeople, w.v.xhPeople);
    const residual = fmtPeople(w.v.xhPeople);
    const chosen = applied && !!s.appliedBundleId && s.finalists[0]?.bundleId !== s.appliedBundleId;
    let sentence: string;
    if (w.v.xhPeople < 0.5) sentence = T.fix.zero;
    else if (rec === null || rec <= 0) sentence = T.fix.noHelp;
    else if (rec >= 100) sentence = fill(T.fix.undoes, { residual });
    else sentence = chosen ? T.fix.chosenHelps : applied ? T.fix.helps : T.fix.wouldHelp;
    const measure: CaveatCopy = {
      ...CAVEATS.measure,
      body: fill(CAVEATS.measure.body, { lossPct: String(DEF.lossPct), budgetMin: budgetMin === null ? "30" : String(budgetMin), before: fmtAbout(before.v.xhPeople) }),
    };
    const pureOption = inp.scenario.removedLinks.length === 1 && inp.scenario.removedLinks[0] === "key_bridge" && (inp.scenario.mutations ?? []).every((m) => m.m.kind === "apply_candidate");
    return {
      ...shell(id, applied ? "applied" : "finalists", false, action),
      figure: rec === null ? null : { key: "recovered", value: Math.min(100, Math.max(0, rec)), format: (v) => `${fmtPct2(v)}%`, prefix: "about", tone: "future" },
      caption: T.fix.caption,
      chip: { text: fill(T.fix.stillAffected, { residual }), tone: "neutral", caveat: measure },
      sentence,
      note: modeLine,
      how: present<CaveatCopy>([spread(s.bestVsNothing), measure, (!applied || !pureOption) && CAVEATS.rangeNotTested, ...baseHow, lowerBound(false)]),
    };
  }

  const running = phase !== "idle" && phase !== "finalists" && phase !== "confirmGoal" && phase !== "applied";
  if (running) {
    const scr = s.screening;
    return {
      ...shell(id, "searching", false, { id: "stop", label: T.fix.actionSearching, variant: "secondary" }),
      figure: scr
        ? { key: "screen", value: scr.done, format: (v) => `${Math.round(v)}`, unit: T.fix.screenUnit, tone: "future", simulated: false }
        : { key: "futures", value: s.futuresDone, format: (v) => `${Math.round(v)}`, unit: T.fix.searchUnit, tone: "future", simulated: false },
      sentence: scr ? T.fix.screening : T.fix.searching,
      note: scr ? modeLine : `${fill(T.fix.progress, { done: String(s.futuresDone), total: String(Math.max(s.futuresPlanned, s.futuresDone)) })} · ${modeLine}`,
      how: baseHow,
    };
  }

  return {
    ...shell(id, s.stopped ? "stopped" : "ready", inp.settling, { id: "search", label: T.fix.actionReady, variant: "light", disabled: s.catalogCount === null }),
    figure: s.catalogCount === null ? null : { key: "options", value: s.catalogCount, format: (v) => `${Math.round(v)}`, unit: T.fix.readyUnit, tone: "neutral", simulated: false },
    sentence: s.stopped ? fill(T.fix.stopped, { done: String(s.futuresDone) }) : T.fix.ready,
    note: modeLine,
    how: baseHow,
  };
}

/** Plain text of a scene for the polite live region: "Simulated", the number with its unit and caption, the sentence. */
export function announceText(v: SceneView, step: number | null, total: number): string {
  const n = v.figure ? `${v.figure.simulated === false ? "" : "Simulated: "}${v.figure.prefix ? `${v.figure.prefix} ` : ""}${v.figure.format(v.figure.value)} ${v.figure.unit ?? ""}`.trim() : "";
  const headline = /[.?!]$/.test(v.headline) ? v.headline : `${v.headline}.`;
  return [step !== null ? `Scene ${step} of ${total}. ${headline}` : headline, n && `${n}${v.caption ? `, ${v.caption.charAt(0).toLowerCase()}${v.caption.slice(1)}` : ""}.`, v.chip?.text && `${v.chip.text}.`, v.sentence ?? T.common.notAvailable]
    .filter(Boolean)
    .join(" ");
}

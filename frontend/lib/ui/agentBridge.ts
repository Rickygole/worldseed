/**
 * The bridge between the planner machine (lib/agent) and the browser simulator (lib/sim).
 *
 * `createEvaluator` implements the machine's EvaluateFn with the worker pool's runFutures:
 *  - every option is scored UNDER THE WORLD ON SCREEN when the search started (normally: Key Bridge removed),
 *    as that world plus the option's catalog candidates;
 *  - the pre-collapse network and "do nothing" run under the SAME futures (same seed, same draws), once per
 *    search, so every comparison is paired future by future;
 *  - each row carries the number of futures that were actually run for it (samples.length);
 *  - progress is the pool's real completed-futures count; the AbortSignal cancels the pool job.
 *
 * Mission lens -> simulator lens: the agent's "access" mission is scored on the cross-harbor lens (the
 * question the bridge answers; its finalist cards already say "Cross-harbor travel time"), "ems" on EMS.
 */
import type { Catalog } from "../agent/catalog";
import { bundleCostTier } from "../agent/catalog";
import type { EvaluateFn } from "../agent/evaluate";
import type { BundleSpec, ConfirmedMission, GoalMetric } from "../agent/tools";
import type { FuturesOptions, LensId, LensMetrics, MutationRecord } from "../sim/contract";
import type { RealSimulator } from "../sim/real";
import type { Scenario } from "../sim/types";
import { baselineFromSamples, goalValue, paired, pairedPGoal, rowFromSamples } from "./futuresMath";

/** Fixed stress-futures settings for a search. Shown in the UI next to the results. */
export const SEARCH_FUTURES = {
  seed: 7,
  tod: "am" as const,
  closureProb: 0.1,
  /** Futures per world. Cross-harbor futures cost about 0.1 s each per worker; EMS about 5 ms. */
  n: { xharbor: 24, ems: 60, access: 24 } as Record<LensId, number>,
  /** Destination anchors per shore for cross-harbor futures (the deterministic map uses 64). */
  xharborAnchors: 16,
};

export const simLensFor = (missionLens: ConfirmedMission["lens"]): LensId => (missionLens === "ems" ? "ems" : "xharbor");

export function futuresOptions(lens: LensId): FuturesOptions {
  return {
    n: SEARCH_FUTURES.n[lens],
    seed: SEARCH_FUTURES.seed,
    tod: SEARCH_FUTURES.tod,
    closureProb: SEARCH_FUTURES.closureProb,
    ...(lens === "xharbor" ? { xharborAnchors: SEARCH_FUTURES.xharborAnchors } : {}),
  };
}

/** Catalog candidates as world mutations (hypothetical options, confirmed at the moment of the call). */
export function candidateMutations(bundleId: string, candidateIds: readonly string[], origin: "user" | "agent", catalog: Catalog | null): MutationRecord[] {
  const at = new Date().toISOString();
  return candidateIds.map((cid) => ({
    id: `option-${bundleId}-${cid}`,
    m: { kind: "apply_candidate" as const, candidateId: cid },
    origin,
    label: `Hypothetical option ${cid}${catalog?.byId.get(cid) ? `: ${catalog.byId.get(cid)!.title.replace(/^Hypothetical scenario option:\s*/i, "")}` : ""}`,
    confirmedAt: at,
  }));
}

export function withBundle(base: Scenario, bundleId: string, candidateIds: readonly string[], origin: "user" | "agent", catalog: Catalog | null): Scenario {
  return { removedLinks: base.removedLinks, mutations: [...(base.mutations ?? []), ...candidateMutations(bundleId, candidateIds, origin, catalog)] };
}

/** Per-future values the futures panel draws. Everything is from the pool's per-future samples. */
export interface WorldFutures {
  /** Goal metric per future. */
  goal: number[];
  /** Cross-harbor only: residents losing more than 10% of cross-harbor jobs, per future. */
  gt10?: number[];
  /** Equity gap per future (seconds). */
  equity: number[];
  ms: number;
  workers: number;
}

export interface BundleFutures extends WorldFutures {
  bundleId: string;
  candidateIds: string[];
  costTier: "$" | "$$" | "$$$";
  round: number;
  /** Goal metric minus "do nothing", future by future (lower is better). */
  vsNothing: number[];
  /** Goal metric minus the pre-collapse network, future by future. */
  vsPre: number[];
  pGoal: number | null;
}

export interface SearchRefs {
  lens: LensId;
  metric: GoalMetric;
  n: number;
  pre: WorldFutures;
  nothing: WorldFutures;
  /** "Do nothing" minus pre-collapse, future by future: what the disruption costs in each future. */
  nothingVsPre: number[];
  /** P(goal) for doing nothing. */
  nothingPGoal: number | null;
}

export interface EvaluatorHooks {
  /** A round (one evaluate call) starts: `total` futures will run in it. */
  onRoundStart?: (total: number) => void;
  onRefs?: (r: SearchRefs) => void;
  onBundle?: (b: BundleFutures) => void;
  /** Completed futures in this round (real pool count) out of the round's total; `label` names the world running. */
  onProgress?: (done: number, total: number, label: string) => void;
}

function summarize(samples: readonly LensMetrics[], metric: GoalMetric, ms: number, workers: number): WorldFutures {
  return {
    goal: samples.map((s) => goalValue(s, metric)),
    gt10: samples.every((s) => s.xharbor) ? samples.map((s) => s.xharbor!.popLossGt10pct) : undefined,
    equity: samples.map((s) => s.equityGapS),
    ms,
    workers,
  };
}

/**
 * An EvaluateFn bound to one search: the world on screen at the start (`base`) and the catalog.
 *
 * Normal rounds: each option is scored as `base` + its candidates. Reference worlds, run once per search
 * under the same futures: the pre-collapse network (for P(goal)) and "doing nothing" (`base`, the planner's
 * baseline row: its "benefit" is baseline minus option).
 *
 * Stress rounds (`ctx.stress`, chosen by the critic or the deterministic critic): the same, with the named
 * links closed and, if given, a different time of day, in EVERY world compared (pre-collapse, doing nothing,
 * each option), so the stressed baseline is like for like. A stress naming a link the snapshot does not
 * have cannot be run, so no rows are returned for it (never unstressed rows under a stress label).
 */
export function createEvaluator(opts: {
  sim: RealSimulator;
  catalog: Catalog;
  base: Scenario;
  origin: () => "user" | "agent";
  /** Link ids the snapshot has (a stress may only close these). */
  knownLinks: ReadonlySet<string>;
  hooks?: EvaluatorHooks;
}): EvaluateFn {
  const { sim, catalog, base, hooks = {} } = opts;
  /** Reference futures per (lens, stress key). */
  const refCache = new Map<string, { pre: LensMetrics[]; nothing: LensMetrics[] }>();

  return async (bundles: BundleSpec[], ctx) => {
    const lens = simLensFor(ctx.mission.lens);
    const metric = ctx.mission.goal.metric;
    const stress = ctx.stress;
    if (stress && stress.closedLinks.some((l) => !opts.knownLinks.has(l))) return { rows: [] };
    const tod = stress?.tod === "midday" ? "mid" : (stress?.tod as FuturesOptions["tod"] | undefined);
    const fo = { ...futuresOptions(lens), ...(tod ? { tod } : {}) };
    const stressMuts: MutationRecord[] = (stress?.closedLinks ?? []).map((linkId) => ({
      id: `stress-close-${linkId}`,
      m: { kind: "close_link" as const, linkId },
      origin: "user" as const,
      label: `Stress test: ${linkId} closed`,
      confirmedAt: new Date().toISOString(),
    }));
    const withStress = (sc: Scenario): Scenario => ({ removedLinks: sc.removedLinks, mutations: [...(sc.mutations ?? []), ...stressMuts] });
    const key = `${lens}|${stress ? `${stress.closedLinks.join(",")}|${stress.tod ?? ""}` : "none"}`;
    const noMut = base.removedLinks.length === 0 && (base.mutations?.length ?? 0) === 0;
    const needRefs = !refCache.has(key);
    const worlds = (needRefs ? (noMut ? 1 : 2) : 0) + bundles.length;
    const total = worlds * fo.n;
    let doneBefore = 0;
    hooks.onRoundStart?.(total);
    const tag = stress ? `stress: ${stress.label}, ` : "";
    const report = (d: number, label: string) => {
      ctx.onProgress?.(doneBefore + d, total);
      hooks.onProgress?.(doneBefore + d, total, `${tag}${label}`);
    };
    const run = async (scenario: Scenario, label: string) => {
      report(0, label);
      const r = await sim.runFutures(withStress(scenario), lens, fo, { signal: ctx.signal, onProgress: (d) => report(d, label) });
      doneBefore += r.samples.length;
      report(0, label);
      return r;
    };

    if (needRefs) {
      const pre = await run({ removedLinks: [] }, "pre-collapse network");
      // With nothing changed on screen, "doing nothing" IS the pre-collapse network: reuse it, and count
      // the futures that were really run (one world, not two).
      const nothing = noMut ? pre : await run(base, "doing nothing");
      refCache.set(key, { pre: pre.samples, nothing: nothing.samples });
      if (!stress) {
        const preV = summarize(pre.samples, metric, pre.meta.ms, pre.meta.workers);
        const nothingV = summarize(nothing.samples, metric, nothing.meta.ms, nothing.meta.workers);
        hooks.onRefs?.({
          lens,
          metric,
          n: pre.samples.length,
          pre: preV,
          nothing: nothingV,
          nothingVsPre: paired(nothingV.goal, preV.goal),
          nothingPGoal: pairedPGoal(nothingV.goal, preV.goal, ctx.mission.goal.targetDelta),
        });
      }
    }
    const R = refCache.get(key)!;
    const preGoal = R.pre.map((s) => goalValue(s, metric));
    const nothingGoal = R.nothing.map((s) => goalValue(s, metric));

    const rows = [];
    for (const b of bundles) {
      const scen = withBundle(base, b.id, b.candidateIds, opts.origin(), catalog);
      const r = await run(scen, `option ${b.id}`);
      const costTier = bundleCostTier(catalog, b.candidateIds);
      const row = rowFromSamples({
        bundleId: b.id,
        candidateIds: b.candidateIds,
        costTier,
        samples: r.samples,
        preCollapse: R.pre,
        metric,
        targetDelta: ctx.mission.goal.targetDelta,
      });
      rows.push(stress ? { ...row, stressLabel: stress.label } : row);
      // The fan and the cards show the normal (unstressed) scoring; stress results live in the decision log.
      if (!stress) {
        const v = summarize(r.samples, metric, r.meta.ms, r.meta.workers);
        hooks.onBundle?.({
          ...v,
          bundleId: b.id,
          candidateIds: b.candidateIds,
          costTier,
          round: ctx.round,
          vsNothing: paired(v.goal, nothingGoal),
          vsPre: paired(v.goal, preGoal),
          pGoal: row.pGoal,
        });
      }
    }
    // The planner's baseline is the no-intervention world (doing nothing), under the same stress if any.
    return { rows, baseline: baselineFromSamples(R.nothing) };
  };
}

/* ------------------------------------------------------------------------------------------------ health */

export interface HealthInfo {
  planner: boolean;
  degradedReason: string | null;
  roles: Record<string, string>;
  tavily: boolean;
  providerConfigured: boolean;
}

/** GET /api/health. Resolves to null when the route cannot be reached or answers something unexpected. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthInfo | null> {
  try {
    const res = await fetch("/api/health", { cache: "no-store", signal });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      planner?: { available?: boolean };
      degradedReason?: string | null;
      roles?: Record<string, string>;
      tavily?: { configured?: boolean };
      provider?: { configured?: boolean };
    };
    if (!j || typeof j !== "object" || !j.planner) return null;
    return {
      planner: j.planner.available === true,
      degradedReason: j.degradedReason ?? null,
      roles: j.roles ?? {},
      tavily: j.tavily?.configured === true,
      providerConfigured: j.provider?.configured === true,
    };
  } catch {
    return null;
  }
}

/** "nvidia/Nemotron-3-Ultra-550b-a55b" -> "Nemotron-3-Ultra-550b-a55b": the model id without its vendor prefix. */
export function shortModel(id: string | undefined): string {
  if (!id || id === "unavailable") return "unavailable";
  return id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
}

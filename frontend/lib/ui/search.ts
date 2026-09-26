/**
 * Search state: the planner machine, the AI health check, the per-option futures the panels draw, and the
 * preview / compare / apply flow. The machine owns the mission (lib/agent); this store mirrors it for React
 * and supplies its evaluator (lib/ui/agentBridge) and its apply hook (lib/store applyScenario).
 *
 * Honesty rules kept here:
 *  - AI is used only when /api/health says the planner is available. Otherwise the same button runs the
 *    deterministic search, labeled "Deterministic search (no AI)", with no model calls at all.
 *  - Nothing reaches the world without an explicit confirmation (goal confirm before a search; apply confirm).
 *  - A finalist computed for another world cannot be applied to this one.
 */
import { create } from "zustand";
import { buildCatalog, type Catalog, type CostTier } from "../agent/catalog";
import { createFetchAgentApi } from "../agent/api";
import { AgentMachine, type MachineState } from "../agent/machine";
import type { ConfirmedMission, GoalMetric, ParsedMission } from "../agent/tools";
import type { LensName } from "../agent/lenses";
import type { SimOutput } from "../sim/types";
import { scenarioKey, snapshotSimulator, useApp } from "../store";
import {
  createEvaluator,
  fetchHealth,
  SEARCH_FUTURES,
  simLensFor,
  withBundle,
  type BundleFutures,
  type HealthInfo,
  type SearchRefs,
} from "./agentBridge";
import { loadLinkGeometry, optionGeo, optionsOrigin } from "./candidateGeo";
import type { Scenario } from "../sim/types";
import type { EvaluateFn } from "../agent/evaluate";
import { enumerateBundles, exhaustiveSearch, type DeterministicEvaluateFn, type DeterministicRow, type ExhaustiveResult } from "../agent/exhaustive";

export type HealthState =
  | { status: "checking" }
  | { status: "available"; info: HealthInfo; checkedAt: number }
  | { status: "unavailable"; info: HealthInfo; checkedAt: number }
  | { status: "unreachable"; checkedAt: number };

export interface GoalDraft {
  lens: LensName;
  metric: GoalMetric;
  /** Seconds for time metrics, block groups for isolatedCount. */
  targetDelta: number;
  maxCostTier: CostTier;
}

export const DEFAULT_DRAFT: GoalDraft = { lens: "access", metric: "p90", targetDelta: 60, maxCostTier: "$$" };

export type Stage = "compose" | "confirm";

export interface FreightLine {
  hazmatMeanAdded: number;
  carMeanAdded: number;
  hazmatOver5: number;
  trips: number;
}

interface ViewRun {
  bundleId: string;
  status: "loading" | "ready" | "error";
  out?: SimOutput;
  error?: string;
}

interface SearchState {
  health: HealthState;
  catalog: Catalog | null;
  /** Hazmat-window options from candidates.json. The agent catalog drops them (their only lens is "freight"). */
  hazmatOptions: { id: string; title: string; costTier: string }[];
  catalogError: string | null;
  m: MachineState | null;
  stage: Stage;
  draft: GoalDraft;
  /** The world the running (or last) search was scored in. */
  base: { key: string; scenario: Scenario } | null;
  refs: SearchRefs | null;
  bundles: Record<string, BundleFutures>;
  /** Real completed futures (whole search) and the running world. */
  futures: { done: number; before: number; roundDone: number; roundTotal: number; label: string; startedAt: number; lastAt: number };
  preview: ViewRun | null;
  compare: (ViewRun & { split: number }) | null;
  confirmApply: string | null;
  applyError: string | null;
  /** runTrips summaries in each finalist's world and in doing nothing (the search's base world). */
  freight: { nothing: FreightLine | null; byBundle: Record<string, FreightLine> } | null;
  /** Exhaustive check over every bundle of 1-3 eligible options (deterministic runs, no futures). */
  exhaustive: {
    status: "idle" | "running" | "done" | "cancelled" | "error";
    done: number;
    total: number;
    startedAt: number;
    ms?: number;
    result?: ExhaustiveResult;
    error?: string;
  };

  boot: () => Promise<void>;
  checkHealth: () => Promise<void>;
  setDraft: (patch: Partial<GoalDraft>) => void;
  /** First click on "Find a better future": parse (AI) or open the confirm step (deterministic). */
  find: (text: string) => Promise<void>;
  /** The explicit goal confirmation that starts the search. */
  confirmAndRun: () => Promise<void>;
  backToCompose: () => void;
  cancel: () => void;
  resetSearch: () => void;
  setPreview: (bundleId: string | null) => Promise<void>;
  setCompare: (bundleId: string | null) => Promise<void>;
  setSplit: (v: number) => void;
  askApply: (bundleId: string | null) => void;
  apply: (bundleId: string) => Promise<void>;
  /** True when the finalists were scored in the world on screen. */
  sameWorld: () => boolean;
  /** How many bundles the exhaustive check would score for the current mission (0 before a search). */
  exhaustiveCount: () => number;
  runExhaustive: () => Promise<void>;
  cancelExhaustive: () => void;
}

const api = createFetchAgentApi();
let machine: AgentMachine | null = null;
let evaluate: EvaluateFn | null = null;
let screen: DeterministicEvaluateFn | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let bootPromise: Promise<void> | null = null;
let exhaustiveAbort: AbortController | null = null;

/**
 * One free-flow deterministic run per bundle (no futures) in `base`, on the mission's lens only, fanned out over the
 * worker pool by the simulator (runDeterministicMany: 32 destination anchors per shore for the cross-harbor lens).
 * Used by the machine's stage-1 screen and by the separate exhaustive-check audit. Honors ctx.signal.
 */
function deterministicEvaluator(base: Scenario): DeterministicEvaluateFn {
  return async (bundles, ctx) => {
    const sim = snapshotSimulator();
    if (!sim) throw new Error("the simulator is not loaded");
    const res = await sim.runDeterministicMany(
      base,
      bundles.map((b) => ({ id: b.id, candidateIds: b.candidateIds })),
      { lens: simLensFor(ctx.mission.lens), signal: ctx.signal, onProgress: ctx.onProgress },
    );
    const rows: DeterministicRow[] = res.rows.map((r) => ({ bundleId: r.bundleId, candidateIds: r.candidateIds, p50S: r.p50S, p90S: r.p90S, isolatedCount: r.isolatedCount, equityGapS: r.equityGapS }));
    return { rows };
  };
}

export function getMachine(): AgentMachine | null {
  return machine;
}

function missionFrom(d: GoalDraft, parsed?: ParsedMission): ConfirmedMission {
  return {
    lens: d.lens,
    goal: { metric: d.metric, op: "<=", targetDelta: d.targetDelta },
    constraints: { maxCostTier: d.maxCostTier, types: parsed?.constraints.types ?? [], areas: parsed?.constraints.areas ?? [] },
  };
}

export const useSearch = create<SearchState>((set, get) => {
  /** Freight trips for doing nothing and each finalist, in the world the search ran in (a few tens of ms each). */
  async function computeFreight(finalists: { bundleId: string; candidateIds: string[] }[]) {
    const sim = snapshotSimulator();
    const base = get().base;
    const catalog = get().catalog;
    if (!sim || !base) return;
    const line = (r: Awaited<ReturnType<typeof sim.runTrips>> | null): FreightLine | null => {
      const hz = r?.summary.hazmat_truck;
      const car = r?.summary.car;
      return hz && car ? { hazmatMeanAdded: hz.crossHarborMeanAddedMinutes, carMeanAdded: car.crossHarborMeanAddedMinutes, hazmatOver5: hz.crossHarborOver5Min, trips: hz.crossHarborTrips } : null;
    };
    try {
      const nothing = line(await sim.runTrips(base.scenario));
      const byBundle: Record<string, FreightLine> = {};
      for (const f of finalists) {
        const l = line(await sim.runTrips(withBundle(base.scenario, f.bundleId, f.candidateIds, "user", catalog)));
        if (l) byBundle[f.bundleId] = l;
      }
      set({ freight: { nothing, byBundle } });
    } catch {
      set({ freight: null });
    }
  }

  function bindMachine(catalog: Catalog) {
    machine = new AgentMachine({
      api,
      catalog,
      // The evaluator runs exactly this many futures per row; anything else is refused by the machine.
      maxFutures: Math.max(...Object.values(SEARCH_FUTURES.n)),
      // Two-stage no-AI search: screen every eligible bundle with one free-flow run, then paired futures on the top 12.
      screen: (bundles, ctx) => {
        if (!screen) return Promise.reject(new Error("no search is running"));
        return screen(bundles, ctx);
      },
      shortlist: 12,
      evaluate: (bundles, ctx) => {
        if (!evaluate) return Promise.reject(new Error("no search is running"));
        return evaluate(bundles, ctx);
      },
      onApply: async ({ bundleId, candidateIds }) => {
        const app = useApp.getState();
        const s = get();
        if (!s.base || s.base.key !== scenarioKey(app.scenario)) {
          throw new Error("The world changed since this search ran. Run the search again before applying.");
        }
        const origin = s.m?.mode === "ai" ? "agent" : "user";
        const scenario = withBundle(app.scenario, bundleId, candidateIds, origin, catalog);
        let from: { lat: number; lng: number } | undefined;
        try {
          const links = await loadLinkGeometry();
          from = optionsOrigin(candidateIds.map((c) => optionGeo(catalog, links, c)).filter((g) => g !== null)) ?? undefined;
        } catch {
          from = undefined;
        }
        app.log("USER", `Apply finalist ${bundleId}: ${candidateIds.join(" + ")}`);
        await app.applyScenario(scenario, { strict: true, staggerFrom: from, fx: { candidateIds } });
        const out = useApp.getState().current;
        if (out?.detail?.runnerText) app.log("SIM", out.detail.runnerText);
        set({ preview: null, compare: null });
      },
    });
    let freightKey = "";
    machine.subscribe(() => {
      const m = machine!.getState();
      set({ m });
      const key = m.phase === "finalists" ? m.finalists.map((f) => f.bundleId).join(",") : "";
      if (key && key !== freightKey) {
        freightKey = key;
        void computeFreight(m.finalists.map((f) => ({ bundleId: f.bundleId, candidateIds: f.candidateIds })));
      }
    });
    set({ m: machine.getState() });
  }

  return {
    health: { status: "checking" },
    catalog: null,
    hazmatOptions: [],
    catalogError: null,
    m: null,
    stage: "compose",
    draft: DEFAULT_DRAFT,
    base: null,
    refs: null,
    bundles: {},
    futures: { done: 0, before: 0, roundDone: 0, roundTotal: 0, label: "", startedAt: 0, lastAt: 0 },
    preview: null,
    compare: null,
    confirmApply: null,
    applyError: null,
    freight: null,
    exhaustive: { status: "idle", done: 0, total: 0, startedAt: 0 },

    boot() {
      // One boot per page: concurrent callers share the same promise (never two machines).
      bootPromise ??= (async () => {
        void get().checkHealth();
        if (!healthTimer) healthTimer = setInterval(() => void get().checkHealth(), 90_000);
        try {
          const [cands, gaz] = await Promise.all([
            fetch("/snapshot/candidates.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`candidates.json: HTTP ${r.status}`)))),
            fetch("/snapshot/gazetteer.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`gazetteer.json: HTTP ${r.status}`)))),
          ]);
          const catalog = buildCatalog(cands, gaz);
          const hazmatOptions = (Array.isArray(cands) ? cands : [])
            .filter((c: { type?: string }) => c && c.type === "hazmat_window")
            .map((c: { id: string; title: string; costTier: string }) => ({ id: c.id, title: c.title, costTier: c.costTier }));
          set({ catalog, hazmatOptions, catalogError: null });
          bindMachine(catalog);
        } catch (e) {
          bootPromise = null; // allow a retry
          set({ catalogError: e instanceof Error ? e.message : String(e) });
        }
      })();
      return bootPromise;
    },

    async checkHealth() {
      const info = await fetchHealth();
      const at = Date.now();
      if (!info) set({ health: { status: "unreachable", checkedAt: at } });
      else set({ health: info.planner ? { status: "available", info, checkedAt: at } : { status: "unavailable", info, checkedAt: at } });
    },

    setDraft(patch) {
      set((s) => ({ draft: { ...s.draft, ...patch } }));
    },

    async find(text) {
      const m = machine;
      if (!m) return;
      const aiUp = get().health.status === "available";
      if (m.getState().phase !== "idle") return;
      if (aiUp && text.trim().length >= 3) {
        set({ stage: "compose" });
        await m.start(text.trim());
        const st = m.getState();
        if (st.phase === "confirmGoal" && st.parsed) {
          const p = st.parsed;
          set((s) => ({
            stage: "confirm",
            draft: { ...s.draft, lens: p.lens, metric: p.goal.metric, maxCostTier: p.constraints.maxCostTier },
          }));
        }
        return;
      }
      set({ stage: "confirm" });
    },

    async confirmAndRun() {
      const m = machine;
      const sim = snapshotSimulator();
      const catalog = get().catalog;
      if (!m || !sim || !catalog) return;
      const app = useApp.getState();
      if (app.status !== "ready") return;
      const st = m.getState();
      const base = { key: scenarioKey(app.scenario), scenario: app.scenario };
      const now = performance.now();
      exhaustiveAbort?.abort();
      set({ base, refs: null, bundles: {}, preview: null, compare: null, applyError: null, stage: "compose", exhaustive: { status: "idle", done: 0, total: 0, startedAt: 0 }, futures: { done: 0, before: 0, roundDone: 0, roundTotal: 0, label: "", startedAt: now, lastAt: now } });
      screen = deterministicEvaluator(base.scenario);
      evaluate = createEvaluator({
        sim,
        catalog,
        base: base.scenario,
        knownLinks: new Set(sim.info().links.map((l) => l.id)),
        origin: () => (machine?.getState().mode === "ai" ? "agent" : "user"),
        hooks: {
          onRefs: (refs) => set({ refs }),
          onBundle: (b) => set((s) => ({ bundles: { ...s.bundles, [b.bundleId]: b } })),
          onRoundStart: (total) => set((s) => ({ futures: { ...s.futures, before: s.futures.done, roundDone: 0, roundTotal: total } })),
          // Cumulative = futures finished in earlier rounds + this round's real pool count.
          onProgress: (done, total, label) =>
            set((s) => ({ futures: { ...s.futures, done: s.futures.before + done, roundDone: done, roundTotal: total, label, lastAt: performance.now() } })),
        },
      });
      // The map follows the mission's lens so the terrain shows what is being scored.
      // Freight has no terrain: the map keeps its lens and the freight panel shows the trips.
      const mapLens = simLensFor(get().draft.lens);
      if (mapLens === "freight") app.setFreightOpen(false);
      else if (app.lens !== mapLens) void app.setLens(mapLens);
      const mission = missionFrom(get().draft, st.parsed);
      if (st.phase === "confirmGoal") await m.confirmGoal(mission);
      else if (st.phase === "idle") await m.runDeterministic(mission);
    },

    backToCompose() {
      const m = machine;
      if (m && m.getState().phase === "confirmGoal") m.cancel();
      set({ stage: "compose" });
    },

    cancel() {
      machine?.cancel();
      set({ stage: "compose" });
    },

    resetSearch() {
      machine?.reset();
      evaluate = null;
      exhaustiveAbort?.abort();
      set({ exhaustive: { status: "idle", done: 0, total: 0, startedAt: 0 }, freight: null });
      set({ stage: "compose", base: null, refs: null, bundles: {}, preview: null, compare: null, confirmApply: null, applyError: null, futures: { done: 0, before: 0, roundDone: 0, roundTotal: 0, label: "", startedAt: 0, lastAt: 0 } });
    },

    async setPreview(bundleId) {
      if (!bundleId || get().preview?.bundleId === bundleId) {
        set({ preview: null });
        return;
      }
      const b = get().bundles[bundleId];
      const app = useApp.getState();
      if (!b) return;
      // A freight option has no terrain: compare its trips (runTrips in the option's world) in the freight panel.
      if (get().m?.mission?.lens === "freight") {
        const sim = snapshotSimulator();
        if (!sim) return;
        const scenario = withBundle(app.scenario, bundleId, b.candidateIds, "user", get().catalog);
        set({ preview: { bundleId, status: "loading" }, compare: null });
        try {
          const res = await sim.runTrips(scenario);
          app.setFreightCompare({ bundleId, scenario, res });
          set({ preview: null });
        } catch (e) {
          set({ preview: { bundleId, status: "error", error: e instanceof Error ? e.message : String(e) } });
        }
        return;
      }
      set({ preview: { bundleId, status: "loading" }, compare: null });
      try {
        const out = await app.peek(withBundle(app.scenario, bundleId, b.candidateIds, "user", get().catalog), app.lens);
        if (get().preview?.bundleId === bundleId) set({ preview: { bundleId, status: "ready", out } });
      } catch (e) {
        if (get().preview?.bundleId === bundleId) set({ preview: { bundleId, status: "error", error: e instanceof Error ? e.message : String(e) } });
      }
    },

    async setCompare(bundleId) {
      if (!bundleId || get().compare?.bundleId === bundleId) {
        set({ compare: null });
        return;
      }
      const b = get().bundles[bundleId];
      const app = useApp.getState();
      if (!b) return;
      set({ compare: { bundleId, status: "loading", split: 0.5 }, preview: null });
      try {
        const out = await app.peek(withBundle(app.scenario, bundleId, b.candidateIds, "user", get().catalog), app.lens);
        set((s) => (s.compare?.bundleId === bundleId ? { compare: { ...s.compare, status: "ready", out } } : {}));
      } catch (e) {
        set((s) => (s.compare?.bundleId === bundleId ? { compare: { ...s.compare, status: "error", error: e instanceof Error ? e.message : String(e) } } : {}));
      }
    },

    setSplit(v) {
      set((s) => (s.compare ? { compare: { ...s.compare, split: Math.min(0.95, Math.max(0.05, v)) } } : {}));
    },

    askApply(bundleId) {
      set({ confirmApply: bundleId, applyError: null });
    },

    async apply(bundleId) {
      const m = machine;
      if (!m) return;
      set({ confirmApply: null, applyError: null, preview: null, compare: null });
      try {
        await m.apply(bundleId);
      } catch (e) {
        set({ applyError: e instanceof Error ? e.message : String(e) });
      }
    },

    exhaustiveCount() {
      const m = get().m;
      const catalog = get().catalog;
      return m?.mission && catalog ? enumerateBundles(catalog, m.mission).length : 0;
    },

    async runExhaustive() {
      const m = get().m;
      const catalog = get().catalog;
      const sim = snapshotSimulator();
      const world = useApp.getState().world;
      const base = get().base;
      if (!m?.mission || !catalog || !sim || !world || !base) return;
      exhaustiveAbort?.abort();
      const ac = new AbortController();
      exhaustiveAbort = ac;
      const mission = m.mission;
      const t0 = performance.now();
      set({ exhaustive: { status: "running", done: 0, total: get().exhaustiveCount(), startedAt: t0 } });
      // The same deterministic evaluator the search's screen uses, in the world the finalists were scored in.
      const evaluate = deterministicEvaluator(base.scenario);
      try {
        const result = await exhaustiveSearch({
          catalog,
          mission,
          evaluate,
          signal: ac.signal,
          batchSize: 12,
          onProgress: (done, total) => set((s) => ({ exhaustive: { ...s.exhaustive, done, total } })),
        });
        if (exhaustiveAbort === ac) set((s) => ({ exhaustive: { ...s.exhaustive, status: "done", result, ms: performance.now() - t0 } }));
      } catch (e) {
        if (exhaustiveAbort !== ac) return;
        const aborted = ac.signal.aborted || (e instanceof Error && e.name === "AbortError");
        set((s) => ({ exhaustive: { ...s.exhaustive, status: aborted ? "cancelled" : "error", error: aborted ? undefined : e instanceof Error ? e.message : String(e) } }));
      }
    },

    cancelExhaustive() {
      exhaustiveAbort?.abort();
    },

    sameWorld() {
      const b = get().base;
      return !!b && b.key === scenarioKey(useApp.getState().scenario);
    },
  };
});

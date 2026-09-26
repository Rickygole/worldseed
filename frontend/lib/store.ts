import { create } from "zustand";
import { fmtClock } from "./format";
import {
  createSimulator,
  type MetricKey,
  type Metrics,
  type Scenario,
  type SimOutput,
  type Simulator,
  type World,
} from "./sim";

export interface LogEvent {
  id: number;
  time: string;
  tag: "SYS" | "USER" | "SIM";
  text: string;
}

export type BudgetTier = "low" | "med" | "high";

const METRIC_KEYS: MetricKey[] = ["p50", "p90", "pctWithin8", "isolated", "equityGap"];

const simulator: Simulator = createSimulator();

let eventSeq = 0;
const mkEvent = (tag: LogEvent["tag"], text: string): LogEvent => ({
  id: ++eventSeq,
  time: fmtClock(new Date()),
  tag,
  text,
});

const histFrom = (m: Metrics): Record<MetricKey, number[]> =>
  Object.fromEntries(METRIC_KEYS.map((k) => [k, [m[k]]])) as Record<MetricKey, number[]>;

interface AppState {
  // ---- world / sim ----
  status: "idle" | "loading" | "ready" | "error";
  runnerLabel: string;
  world: World | null;
  baseline: SimOutput | null;
  current: SimOutput | null;
  scenario: Scenario;
  /** Bumped on every world change; the map animates when this changes. */
  revision: number;
  history: Record<MetricKey, number[]>;
  events: LogEvent[];

  // ---- UI ----
  leftOpen: boolean;
  rightOpen: boolean;
  presentation: boolean;
  orbit: boolean;
  introOpen: boolean;
  assumptionsOpen: boolean;
  commandOpen: boolean;
  goal: string;
  budget: BudgetTier;

  // ---- actions ----
  init: () => Promise<void>;
  removeBridge: () => Promise<void>;
  restoreBridge: () => Promise<void>;
  resetWorld: () => Promise<void>;
  log: (tag: LogEvent["tag"], text: string) => void;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  togglePresentation: () => void;
  toggleOrbit: () => void;
  setIntroOpen: (v: boolean) => void;
  setAssumptionsOpen: (v: boolean) => void;
  setCommandOpen: (v: boolean) => void;
  setGoal: (v: string) => void;
  setBudget: (v: BudgetTier) => void;
}

export const useApp = create<AppState>((set, get) => {
  async function apply(scenario: Scenario, opts: { resetHistory?: boolean } = {}) {
    const { world } = get();
    if (!world) return;
    const out = await simulator.run(world, scenario);
    set((s) => {
      const history = opts.resetHistory
        ? histFrom(out.metrics)
        : (Object.fromEntries(
            METRIC_KEYS.map((k) => [k, [...s.history[k], out.metrics[k]].slice(-24)]),
          ) as Record<MetricKey, number[]>);
      return { scenario, current: out, history, revision: s.revision + 1 };
    });
    return out;
  }

  return {
    status: "idle",
    runnerLabel: simulator.meta.runnerLabel,
    world: null,
    baseline: null,
    current: null,
    scenario: { removedLinks: [] },
    revision: 0,
    history: histFrom({ p50: 0, p90: 0, pctWithin8: 0, isolated: 0, equityGap: 0 }),
    events: [],

    leftOpen: true,
    rightOpen: true,
    presentation: false,
    orbit: true,
    introOpen: false,
    assumptionsOpen: false,
    commandOpen: false,
    goal: "",
    budget: "med",

    async init() {
      if (get().status !== "idle") return;
      set({ status: "loading" });
      try {
        const world = await simulator.loadWorld();
        const scenario: Scenario = { removedLinks: [] };
        const out = await simulator.run(world, scenario);
        set({
          status: "ready",
          world,
          baseline: out,
          current: out,
          scenario,
          history: histFrom(out.metrics),
          revision: 1,
          events: [
            mkEvent("SYS", `World loaded: ${world.regionName}, ${world.cells.length.toLocaleString("en-US")} cells (H3 res 9)`),
            mkEvent("SYS", `Runner: ${simulator.meta.runnerLabel} (${simulator.meta.kind})`),
            mkEvent("SYS", world.provenance),
          ],
        });
      } catch (e) {
        set({ status: "error" });
        get().log("SYS", `Failed to load world: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    async removeBridge() {
      const s = get();
      if (s.status !== "ready" || s.scenario.removedLinks.includes("key_bridge")) return;
      s.log("USER", "Remove link: Key Bridge (I-695)");
      const before = s.current!.metrics;
      const out = await apply({ removedLinks: ["key_bridge"] });
      if (!out) return;
      const m = out.metrics;
      get().log("SIM", `Recomputed in ${out.computeMs.toFixed(0)} ms (mock)`);
      get().log(
        "SIM",
        `p90 ${before.p90.toFixed(1)} -> ${m.p90.toFixed(1)} min; isolated block groups ${Math.round(before.isolated)} -> ${Math.round(m.isolated)}`,
      );
    },

    async restoreBridge() {
      const s = get();
      if (s.status !== "ready" || s.scenario.removedLinks.length === 0) return;
      s.log("USER", "Restore link: Key Bridge (I-695)");
      const out = await apply({ removedLinks: [] });
      if (out) get().log("SIM", `Recomputed in ${out.computeMs.toFixed(0)} ms (mock). Baseline restored.`);
    },

    async resetWorld() {
      const s = get();
      if (s.status !== "ready") return;
      const out = await apply({ removedLinks: [] }, { resetHistory: true });
      if (out) get().log("SYS", "World reset to baseline. Session history cleared.");
    },

    log(tag, text) {
      set((s) => ({ events: [...s.events, mkEvent(tag, text)].slice(-200) }));
    },

    setLeftOpen: (v) => set({ leftOpen: v }),
    setRightOpen: (v) => set({ rightOpen: v }),
    togglePresentation: () => set((s) => ({ presentation: !s.presentation })),
    toggleOrbit: () => set((s) => ({ orbit: !s.orbit })),
    setIntroOpen: (v) => set({ introOpen: v }),
    setAssumptionsOpen: (v) => set({ assumptionsOpen: v }),
    setCommandOpen: (v) => set({ commandOpen: v }),
    setGoal: (v) => set({ goal: v }),
    setBudget: (v) => set({ budget: v }),
  };
});

export const isBridgeRemoved = (s: AppState): boolean =>
  s.scenario.removedLinks.includes("key_bridge");

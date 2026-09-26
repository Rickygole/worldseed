import { create } from "zustand";
import { fmtClock, fmtCount, fmtDurText, fmtMin } from "./format";
import {
  createSimulator,
  type CausalChain,
  type LensId,
  type Scenario,
  type SimOutput,
  type SimulatorMeta,
  type World,
  type RealSimulator,
} from "./sim";
import type { SnapshotInfo } from "./sim/engine";
import { RIBBON_KEYS, ribbonValues, type RibbonKey } from "./ui/ribbon";
import { loadNodeCoords } from "./ui/snapshotAux";

export interface LogEvent {
  id: number;
  time: string;
  tag: "SYS" | "USER" | "SIM";
  text: string;
}

export type BudgetTier = "low" | "med" | "high";

export interface LoadError {
  /** Plain-language cause for the error card. */
  title: string;
  /** The underlying message, shown small for anyone debugging. */
  detail: string;
}

export interface Inspection {
  hex: number;
  /** Which lens the causal chain was computed on (EMS on the EMS lens; regional job centers otherwise). */
  chainLens: LensId;
  status: "loading" | "ready" | "error";
  chain?: CausalChain;
  /** Route geometry [lng, lat] for the map overlay: baseline (dim) and current world (bright). */
  routes?: { before: [number, number][]; after: [number, number][] };
  error?: string;
}

const simulator = createSimulator();

/**
 * The snapshot-backed simulator (runFutures, explain, worldState, info) once loaded; null on the demo mock.
 * The planner uses this for futures; world changes should still go through `applyScenario` so the UI follows.
 */
export function snapshotSimulator(): RealSimulator | null {
  return simulator.snapshotBacked;
}

/** Snapshot summary (links, parameters) once the real simulator is loaded; null on the demo mock. */
export function simInfo(): SnapshotInfo | null {
  const sb = simulator.snapshotBacked;
  if (!sb) return null;
  try {
    return sb.info();
  } catch {
    return null;
  }
}

let eventSeq = 0;
const mkEvent = (tag: LogEvent["tag"], text: string): LogEvent => ({
  id: ++eventSeq,
  time: fmtClock(new Date()),
  tag,
  text,
});

const BASELINE: Scenario = { removedLinks: [] };

const scenarioKey = (s: Scenario): string =>
  JSON.stringify([[...s.removedLinks].sort(), (s.mutations ?? []).map((r) => r.m)]);

const emptyHistory = (): Record<RibbonKey, number[]> =>
  Object.fromEntries(RIBBON_KEYS.map((k) => [k, []])) as unknown as Record<RibbonKey, number[]>;

function pushHistory(h: Record<RibbonKey, number[]>, out: SimOutput): Record<RibbonKey, number[]> {
  const r = ribbonValues(out);
  if (!r) return h;
  return Object.fromEntries(RIBBON_KEYS.map((k) => [k, [...h[k], r.v[k]].slice(-24)])) as unknown as Record<RibbonKey, number[]>;
}

function describeLoadError(e: unknown): LoadError {
  const msg = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : "";
  if (/could not fetch|failed to fetch|networkerror|load failed|HTTP 5\d\d/i.test(msg)) {
    return { title: "The simulation data could not be downloaded. Check your connection, then try again.", detail: msg };
  }
  if (/worker/i.test(msg)) {
    return { title: "This browser could not start the background workers the simulator runs in.", detail: msg };
  }
  if (name === "ContractError" || /snapshot|meta\.json|\.bin/i.test(msg)) {
    return { title: "The simulation data on the server is incomplete or out of date.", detail: msg };
  }
  return { title: "The simulator could not start.", detail: msg };
}

interface AppState {
  // ---- world / sim ----
  status: "idle" | "loading" | "ready" | "error";
  loadStage: "snapshot" | "baseline" | null;
  loadError: LoadError | null;
  simKind: SimulatorMeta["kind"];
  runnerLabel: string;
  world: World | null;
  /** Lens that drives the terrain. The ribbon always shows all three. */
  lens: LensId;
  /** Cross-harbor run of the baseline and of the current scenario (ribbon, explainer, camera). */
  baseline: SimOutput | null;
  current: SimOutput | null;
  /** Run of the active lens for the current scenario and for the baseline (terrain, inspector). */
  view: SimOutput | null;
  viewBaseline: SimOutput | null;
  busy: boolean;
  scenario: Scenario;
  /** Bumped on every world (scenario) change: camera fly-to. */
  revision: number;
  /** Bumped whenever the terrain target changes (scenario or lens): terrain animation. */
  viewRevision: number;
  history: Record<RibbonKey, number[]>;
  events: LogEvent[];
  selectedHex: number | null;
  inspection: Inspection | null;

  // ---- UI ----
  leftOpen: boolean;
  rightOpen: boolean;
  presentation: boolean;
  orbit: boolean;
  introOpen: boolean;
  assumptionsOpen: boolean;
  commandOpen: boolean;
  aboutOpen: boolean;
  logOpen: boolean;
  goal: string;
  budget: BudgetTier;

  // ---- actions ----
  init: () => Promise<void>;
  retry: () => Promise<void>;
  /** Run a scenario on every lens and make it current. The hook the planner uses to apply a bundle. */
  applyScenario: (scenario: Scenario, opts?: { resetHistory?: boolean }) => Promise<SimOutput | undefined>;
  removeBridge: () => Promise<void>;
  restoreBridge: () => Promise<void>;
  resetWorld: () => Promise<void>;
  setLens: (lens: LensId) => Promise<void>;
  selectHex: (hex: number | null) => Promise<void>;
  log: (tag: LogEvent["tag"], text: string) => void;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  togglePresentation: () => void;
  toggleOrbit: () => void;
  setIntroOpen: (v: boolean) => void;
  setAssumptionsOpen: (v: boolean) => void;
  setCommandOpen: (v: boolean) => void;
  setAboutOpen: (v: boolean) => void;
  setLogOpen: (v: boolean) => void;
  setGoal: (v: string) => void;
  setBudget: (v: BudgetTier) => void;
}

export const useApp = create<AppState>((set, get) => {
  /** Memoized runs: (scenario, lens) -> output. A failed run is dropped so it can be retried. */
  const cache = new Map<string, Promise<SimOutput>>();
  function compute(scenario: Scenario, lens: LensId): Promise<SimOutput> {
    const world = get().world;
    if (!world) return Promise.reject(new Error("world not loaded"));
    const key = `${scenarioKey(scenario)}|${lens}`;
    let p = cache.get(key);
    if (!p) {
      p = simulator.run(world, scenario, { lens });
      p.catch(() => cache.delete(key));
      cache.set(key, p);
    }
    return p;
  }

  let applySeq = 0;
  let lensSeq = 0;
  let inspectSeq = 0;

  function logRun(out: SimOutput) {
    const runner = out.detail?.runnerText ?? `Computed locally (${Math.round(out.computeMs)} ms)`;
    get().log("SIM", runner);
  }

  return {
    status: "idle",
    loadStage: null,
    loadError: null,
    simKind: simulator.meta.kind,
    runnerLabel: simulator.meta.runnerLabel,
    world: null,
    lens: "xharbor",
    baseline: null,
    current: null,
    view: null,
    viewBaseline: null,
    busy: false,
    scenario: BASELINE,
    revision: 0,
    viewRevision: 0,
    history: emptyHistory(),
    events: [],
    selectedHex: null,
    inspection: null,

    leftOpen: true,
    rightOpen: true,
    presentation: false,
    orbit: false,
    introOpen: false,
    assumptionsOpen: false,
    commandOpen: false,
    aboutOpen: false,
    logOpen: false,
    goal: "",
    budget: "med",

    async init() {
      if (get().status !== "idle") return;
      set({ status: "loading", loadStage: "snapshot", loadError: null });
      try {
        const world = await simulator.loadWorld();
        set({ world, loadStage: "baseline", simKind: simulator.meta.kind, runnerLabel: simulator.meta.runnerLabel });
        const out = await compute(BASELINE, "xharbor");
        const info = simInfo();
        const events = [
          mkEvent("SYS", `World loaded: ${world.regionName}, ${world.cells.length.toLocaleString("en-US")} hexagons (H3 res 9)`),
          info ? mkEvent("SYS", `Snapshot ${info.id}`) : null,
          mkEvent("SYS", `Runner: ${simulator.meta.runnerLabel}`),
          simulator.meta.kind === "mock" && world.provenance ? mkEvent("SYS", world.provenance) : null,
          mkEvent("SIM", out.detail?.runnerText ?? `Computed locally (${Math.round(out.computeMs)} ms)`),
        ].filter((e): e is LogEvent => e !== null);
        set((s) => ({
          status: "ready",
          loadStage: null,
          baseline: out,
          current: out,
          view: out,
          viewBaseline: out,
          scenario: BASELINE,
          history: pushHistory(emptyHistory(), out),
          revision: 1,
          viewRevision: s.viewRevision + 1,
          events: [...s.events, ...events],
        }));
      } catch (e) {
        const err = describeLoadError(e);
        set({ status: "error", loadStage: null, loadError: err });
        get().log("SYS", `Failed to load the world: ${err.detail}`);
      }
    },

    async retry() {
      if (get().status !== "error") return;
      cache.clear();
      set({ status: "idle" });
      await get().init();
    },

    async applyScenario(scenario, opts = {}) {
      const s0 = get();
      if (s0.status !== "ready" || !s0.world) return;
      const seq = ++applySeq;
      set({ busy: true });
      try {
        const lens = get().lens;
        const [cur, view] = await Promise.all([compute(scenario, "xharbor"), compute(scenario, lens)]);
        if (seq !== applySeq) return cur;
        set((s) => ({
          scenario,
          current: cur,
          view: s.lens === lens ? view : s.view,
          history: pushHistory(opts.resetHistory ? emptyHistory() : s.history, cur),
          revision: s.revision + 1,
          viewRevision: s.viewRevision + 1,
          busy: false,
        }));
        if (get().lens !== lens) void get().setLens(get().lens);
        const sel = get().selectedHex;
        if (sel !== null) void get().selectHex(sel);
        return cur;
      } catch (e) {
        if (seq === applySeq) set({ busy: false });
        get().log("SYS", `Simulation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    async removeBridge() {
      const s = get();
      if (s.status !== "ready" || s.scenario.removedLinks.includes("key_bridge")) return;
      s.log("USER", "Remove link: Francis Scott Key Bridge (I-695)");
      const out = await get().applyScenario({ removedLinks: ["key_bridge"] });
      if (!out) return;
      logRun(out);
      const b = ribbonValues(get().baseline);
      const c = ribbonValues(out);
      if (b && c) {
        get().log("SIM", `Cross-harbor: ${fmtCount(c.v.xhPeople)} residents lose >10% of cross-harbor jobs within 30 min (baseline ${fmtCount(b.v.xhPeople)})`);
        get().log(
          "SIM",
          `Regional access +${fmtDurText(c.v.regional - b.v.regional)}; first response p90 ${fmtMin(b.v.ems / 60)} -> ${fmtMin(c.v.ems / 60)} min`,
        );
      }
    },

    async restoreBridge() {
      const s = get();
      if (s.status !== "ready" || s.scenario.removedLinks.length === 0) return;
      s.log("USER", "Restore link: Francis Scott Key Bridge (I-695)");
      const out = await get().applyScenario(BASELINE);
      if (out) {
        logRun(out);
        get().log("SIM", "Baseline restored.");
      }
    },

    async resetWorld() {
      const s = get();
      if (s.status !== "ready") return;
      const out = await get().applyScenario(BASELINE, { resetHistory: true });
      if (out) get().log("SYS", "World reset to baseline. Session history cleared.");
    },

    async setLens(lens) {
      const s = get();
      set({ lens });
      if (s.status !== "ready") return;
      const seq = ++lensSeq;
      try {
        const [view, viewBaseline] = await Promise.all([compute(get().scenario, lens), compute(BASELINE, lens)]);
        if (seq !== lensSeq || get().lens !== lens) return;
        set((st) => ({ view, viewBaseline, viewRevision: st.viewRevision + 1 }));
        const sel = get().selectedHex;
        if (sel !== null) void get().selectHex(sel);
      } catch (e) {
        get().log("SYS", `Simulation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    async selectHex(hex) {
      const seq = ++inspectSeq;
      if (hex === null) {
        set({ selectedHex: null, inspection: null });
        return;
      }
      const chainLens: LensId = get().lens === "ems" ? "ems" : "access";
      set({ selectedHex: hex, inspection: { hex, chainLens, status: "loading" } });
      const sb = simulator.snapshotBacked;
      if (!sb) {
        set({ inspection: { hex, chainLens, status: "error", error: "Route explanations need the real snapshot; the demo data has none." } });
        return;
      }
      try {
        const [chain, coords] = await Promise.all([sb.explain(get().scenario, chainLens, hex), loadNodeCoords()]);
        if (seq !== inspectSeq) return;
        const path = (nodes: number[]) => nodes.map((n) => [coords.lon[n], coords.lat[n]] as [number, number]);
        set({
          inspection: {
            hex,
            chainLens,
            status: "ready",
            chain,
            routes: { before: path(chain.before.route.nodes), after: path(chain.after.route.nodes) },
          },
        });
      } catch (e) {
        if (seq !== inspectSeq) return;
        set({ inspection: { hex, chainLens, status: "error", error: e instanceof Error ? e.message : String(e) } });
      }
    },

    log(tag, text) {
      if (!text) return;
      set((s) => ({ events: [...s.events, mkEvent(tag, text)].slice(-200) }));
    },

    setLeftOpen: (v) => set({ leftOpen: v }),
    setRightOpen: (v) => set({ rightOpen: v }),
    // Presentation mode is the hero view: the slow orbit comes with it and leaves with it.
    togglePresentation: () => set((s) => ({ presentation: !s.presentation, orbit: !s.presentation })),
    toggleOrbit: () => set((s) => ({ orbit: !s.orbit })),
    setIntroOpen: (v) => set({ introOpen: v }),
    setAssumptionsOpen: (v) => set({ assumptionsOpen: v }),
    setCommandOpen: (v) => set({ commandOpen: v }),
    setAboutOpen: (v) => set({ aboutOpen: v }),
    setLogOpen: (v) => set({ logOpen: v }),
    setGoal: (v) => set({ goal: v }),
    setBudget: (v) => set({ budget: v }),
  };
});

export const isBridgeRemoved = (s: AppState): boolean =>
  s.scenario.removedLinks.includes("key_bridge");

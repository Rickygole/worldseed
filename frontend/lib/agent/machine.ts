/**
 * Client state machine for a planning mission.
 *
 *   idle -> parsing -> confirmGoal -> planning(r) -> evaluating(r) -> critiquing -> finalizing
 *        -> finalists -> applied
 *
 * The browser orchestrates the loop: it asks the server for one validated action, runs the
 * simulator through the injected `evaluate` function, and posts the results back. The server is
 * stateless. Every model output is re-validated here as well (defense in depth).
 *
 * Failure handling: before a mission is confirmed a failure returns to `idle` with `degraded` set
 * so the UI can say "AI planner unavailable. Explore manually." After confirmation the mission
 * continues with the deterministic search (labeled non-AI), and each switch is a decision-log entry.
 */
import type { AgentApi } from "./api";
import { bundleCostTier, type Catalog } from "./catalog";
import type { EvaluateFn } from "./evaluate";
import { greedyFinalists, greedyPlanRound } from "./greedy";
import {
  UI_MESSAGES,
  type AgentEvent,
  type FallbackNext,
  type FallbackReason,
  type LogKind,
  type Outcome,
  type PlanRequest,
} from "./protocol";
import { makeSlotResolver, fillSlots } from "./slots";
import {
  ConfirmedMissionSchema,
  MAX_EVALUATED_BUNDLES,
  MAX_ROUNDS,
  type BaselineRow,
  type BundleSpec,
  type ConfirmedMission,
  type CritiqueOutput,
  type EvaluationRow,
  type NarrationOutput,
  type ParsedMission,
  type PlannerAction,
} from "./tools";
import {
  computeExcluded,
  describeViolations,
  validateCritiqueOutput,
  validateNarrationOutput,
  validateParseOutput,
  validatePlannerOutput,
  type KnownBundle,
  type Violation,
} from "./validator";

export type Phase =
  | "idle"
  | "parsing"
  | "confirmGoal"
  | "planning"
  | "evaluating"
  | "critiquing"
  | "finalizing"
  | "finalists"
  | "applied";

export type Mode = "ai" | "deterministic";

export interface LogEntry {
  id: number;
  t: number;
  kind: LogKind | "evaluation" | "state";
  sentence: string;
  model?: string;
  errors?: string[];
  /** Raw validated tool JSON, for the expandable view in the decision log. */
  raw?: unknown;
}

export interface BudgetMeter {
  inputTokens: number;
  outputTokens: number;
  limitIn: number;
  limitOut: number;
  /** 0..1, the larger of the input and output shares. */
  fraction: number;
}

export interface Finalist {
  bundleId: string;
  candidateIds: string[];
  tradeoff: string;
  costTier: string;
}

export interface Degraded {
  reason: FallbackReason;
  message: string;
  next: FallbackNext;
}

export interface MachineState {
  phase: Phase;
  round: number;
  mode: Mode;
  missionId?: string;
  parsed?: ParsedMission;
  mission?: ConfirmedMission;
  bundles: BundleSpec[];
  dropped: string[];
  rows: EvaluationRow[];
  baseline?: BaselineRow;
  critique?: CritiqueOutput;
  finalists: Finalist[];
  narration: Record<string, { headline: string; body: string }>;
  appliedBundleId?: string;
  log: LogEntry[];
  budget: BudgetMeter;
  /** Real totals reported by the evaluator. */
  counts: { bundlesEvaluated: number; futuresEvaluated: number };
  progress?: { done: number; total: number };
  models: Record<string, string>;
  degraded?: Degraded;
}

export interface MachineDeps {
  api: AgentApi;
  evaluate: EvaluateFn;
  catalog: Catalog;
  newMissionId?: () => string;
  now?: () => number;
  onApply?: (bundle: { bundleId: string; candidateIds: string[] }) => void | Promise<void>;
  limits?: { inputTokens: number; outputTokens: number };
}

class Cancelled extends Error {}

const DEFAULT_LIMITS = { inputTokens: 60_000, outputTokens: 12_000 };

function randomId(): string {
  const a = new Uint8Array(12);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class AgentMachine {
  private state: MachineState;
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private pendingRaw: unknown;
  private seq = 0;

  constructor(private deps: MachineDeps) {
    this.state = this.initial();
  }

  /* ------------------------------ store API ------------------------------ */

  getState = (): MachineState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Replaces {{slot}} placeholders in model prose with simulator results. */
  fill(text: string, focusBundleId?: string): string {
    return fillSlots(text, makeSlotResolver({ baseline: this.state.baseline, rows: this.state.rows, focusBundleId }));
  }

  private initial(): MachineState {
    const lim = this.deps.limits ?? DEFAULT_LIMITS;
    return {
      phase: "idle",
      round: 0,
      mode: "ai",
      bundles: [],
      dropped: [],
      rows: [],
      finalists: [],
      narration: {},
      log: [],
      budget: { inputTokens: 0, outputTokens: 0, limitIn: lim.inputTokens, limitOut: lim.outputTokens, fraction: 0 },
      counts: { bundlesEvaluated: 0, futuresEvaluated: 0 },
      models: {},
    };
  }

  private set(patch: Partial<MachineState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private log(kind: LogEntry["kind"], sentence: string, extra: Partial<LogEntry> = {}): void {
    const entry: LogEntry = { id: ++this.seq, t: (this.deps.now ?? Date.now)(), kind, sentence, ...extra };
    this.set({ log: [...this.state.log, entry] });
  }

  private phase(phase: Phase, round = this.state.round): void {
    this.set({ phase, round, progress: undefined });
  }

  private assertLive(): AbortSignal {
    const s = this.controller?.signal;
    if (!s || s.aborted) throw new Cancelled();
    return s;
  }

  /* ------------------------------ public flow ---------------------------- */

  reset(): void {
    this.controller?.abort();
    this.controller = null;
    this.state = this.initial();
    for (const l of this.listeners) l();
  }

  cancel(): void {
    if (this.state.phase === "idle" || this.state.phase === "applied") return;
    this.controller?.abort();
    this.controller = null;
    const log = this.state.log;
    this.state = { ...this.initial(), log };
    this.log("state", "Mission cancelled. Nothing was applied.");
  }

  /** idle -> parsing -> confirmGoal. */
  async start(text: string): Promise<void> {
    if (this.state.phase !== "idle") throw new Error("A mission is already in progress.");
    const missionId = (this.deps.newMissionId ?? randomId)();
    const controller = new AbortController();
    this.controller = controller;
    this.set({ ...this.initial(), log: this.state.log, missionId, phase: "parsing" });
    try {
      const outcome = await this.deps.api.parse({ missionId, text }, this.callOpts(controller.signal));
      this.assertLive();
      if (outcome.status !== "ok") return this.degradeToIdle(outcome);
      this.track("parser", outcome.model);
      const check = validateParseOutput(outcome.result, { catalog: this.deps.catalog });
      if (!check.ok) {
        this.logViolations(check.violations, outcome.model);
        return this.degradeToIdle({
          status: "fallback",
          reason: "output_rejected",
          message: UI_MESSAGES.outputRejected,
          next: "deterministic_search",
        });
      }
      this.log("decision", check.value.log_sentence, { model: outcome.model, raw: check.value });
      this.set({ parsed: check.value, phase: "confirmGoal" });
    } catch (e) {
      this.swallowCancel(e);
    }
  }

  /** confirmGoal -> planning(1) ... -> finalists. The mission carries the chip-picker target. */
  async confirmGoal(mission: ConfirmedMission): Promise<void> {
    if (this.state.phase !== "confirmGoal") throw new Error("There is no goal waiting for confirmation.");
    const parsed = ConfirmedMissionSchema.parse(mission);
    this.log("state", "Goal confirmed by you. Planning starts.");
    await this.run(parsed, "ai");
  }

  /** The "Deterministic search" button: no model calls at all. */
  async runDeterministic(mission: ConfirmedMission): Promise<void> {
    if (this.state.phase !== "idle") throw new Error("A mission is already in progress.");
    const parsed = ConfirmedMissionSchema.parse(mission);
    this.controller = new AbortController();
    this.set({ ...this.initial(), log: this.state.log, missionId: (this.deps.newMissionId ?? randomId)() });
    this.log("state", `${UI_MESSAGES.deterministicLabel} started by you.`);
    await this.run(parsed, "deterministic");
  }

  /** finalists -> applied. The host commits the bundle as a world mutation via onApply. */
  async apply(bundleId: string): Promise<void> {
    if (this.state.phase !== "finalists") throw new Error("There are no finalists to apply.");
    const f = this.state.finalists.find((x) => x.bundleId === bundleId);
    if (!f) throw new Error("That bundle is not one of the finalists.");
    await this.deps.onApply?.({ bundleId: f.bundleId, candidateIds: f.candidateIds });
    this.log("state", `Bundle ${f.bundleId} applied by you. The terrain will re-run.`);
    this.set({ phase: "applied", appliedBundleId: f.bundleId });
  }

  /* -------------------------------- the loop ----------------------------- */

  private async run(mission: ConfirmedMission, mode: Mode): Promise<void> {
    const controller = this.controller ?? (this.controller = new AbortController());
    this.set({ mission, mode, bundles: [], dropped: [], rows: [], finalists: [], narration: {}, critique: undefined, degraded: undefined });
    try {
      await this.searchRounds(mission);
      await this.topUp(mission);
      if (this.state.rows.length === 0) {
        // Nothing was scored (for example the catalog has no eligible interventions). Say so.
        const message = "No catalog intervention could be evaluated under these constraints.";
        this.log("fallback", message);
        this.set({ phase: "idle", round: 0, progress: undefined, degraded: { reason: "catalog_unavailable", message, next: "deterministic_search" } });
        return;
      }
      if (this.state.mode === "ai") await this.critique(mission);
      await this.finalize(mission);
      if (this.state.mode === "ai") await this.narrate(mission);
      this.assertLive();
      this.phase("finalists");
      this.log("state", `${this.state.finalists.length} finalist bundles ready. You decide what to apply.`);
    } catch (e) {
      this.swallowCancel(e);
    } finally {
      if (this.controller === controller && (this.state.phase === "finalists" || this.state.phase === "idle")) this.controller = null;
    }
  }

  private async searchRounds(mission: ConfirmedMission): Promise<void> {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      this.phase("planning", round);
      let fresh: BundleSpec[] = [];
      let converged = false;

      if (this.state.mode === "ai") {
        const action = await this.askPlanner(mission, "search", round);
        if (action?.action === "propose") fresh = action.bundles;
        else if (action?.action === "refine") {
          this.set({ dropped: [...new Set([...this.state.dropped, ...action.drop])] });
          fresh = action.add;
          converged = fresh.length === 0;
        }
      }
      if (this.state.mode === "deterministic") {
        fresh = greedyPlanRound({
          catalog: this.deps.catalog,
          mission,
          round,
          rows: this.state.rows,
          known: this.state.bundles,
        });
        if (fresh.length > 0) {
          this.log("decision", `Deterministic search (not AI) chose ${fresh.length} bundles for round ${round}.`);
        }
      }

      if (fresh.length === 0) {
        this.log("info", converged ? "The planner added no new bundles, so search stops here." : "No new bundles to try, so search stops here.");
        break;
      }
      await this.evaluateBundles(mission, round, fresh);
    }
  }

  private async evaluateBundles(mission: ConfirmedMission, round: number, fresh: BundleSpec[]): Promise<void> {
    const signal = this.assertLive();
    this.set({ bundles: [...this.state.bundles, ...fresh] });
    this.phase("evaluating", round);
    const batch = await this.deps.evaluate(fresh, {
      mission,
      round,
      signal,
      onProgress: (done, total) => this.set({ progress: { done, total } }),
    });
    this.assertLive();
    const wanted = new Map(fresh.map((b) => [b.id, b]));
    const accepted = batch.rows.filter((r) => {
      const b = wanted.get(r.bundleId);
      return b !== undefined && b.candidateIds.join("|") === r.candidateIds.join("|");
    });
    this.set({
      rows: [...this.state.rows, ...accepted],
      baseline: batch.baseline ?? this.state.baseline,
      counts: {
        bundlesEvaluated: this.state.counts.bundlesEvaluated + batch.bundlesEvaluated,
        futuresEvaluated: this.state.counts.futuresEvaluated + batch.futuresEvaluated,
      },
    });
    // These numbers are exactly what the evaluator reported, never what was requested.
    this.log(
      "evaluation",
      `Round ${round}: the simulator scored ${batch.bundlesEvaluated} of ${fresh.length} requested bundles across ${batch.futuresEvaluated} simulated futures, computed locally in your browser.`,
    );
  }

  /** Finalize needs three evaluated bundles; add deterministic singles if the search found fewer. */
  private async topUp(mission: ConfirmedMission): Promise<void> {
    const have = this.state.rows.length;
    if (have >= 3 || have >= MAX_EVALUATED_BUNDLES) return;
    const extra = greedyPlanRound({ catalog: this.deps.catalog, mission, round: 1, rows: this.state.rows, known: this.state.bundles }).slice(0, 3 - have);
    if (extra.length === 0) {
      this.log("info", "Fewer than three distinct bundles exist under these constraints.");
      return;
    }
    this.log("fallback", "Fewer than three bundles were scored, so deterministic search (not AI) added some.");
    await this.evaluateBundles(mission, Math.max(1, this.state.round), extra);
  }

  private async critique(mission: ConfirmedMission): Promise<void> {
    if (this.state.rows.length === 0) return;
    const signal = this.assertLive();
    this.phase("critiquing");
    const outcome = await this.deps.api.critique(
      {
        missionId: this.state.missionId as string,
        mission,
        round: Math.min(Math.max(this.state.round, 1), MAX_ROUNDS),
        evaluations: this.state.rows,
        baseline: this.state.baseline,
        dropped: this.state.dropped,
      },
      this.callOpts(signal),
    );
    this.assertLive();
    if (outcome.status !== "ok") {
      this.log("fallback", `${outcome.message} Continuing without a critique.`);
      return;
    }
    this.track("critic", outcome.model);
    const check = validateCritiqueOutput(outcome.result, { catalog: this.deps.catalog, known: this.knownBundles() });
    if (!check.ok) {
      this.logViolations(check.violations, outcome.model);
      this.log("fallback", "Critic output rejected; continuing without a critique.");
      return;
    }
    this.log("decision", check.value.log_sentence, { model: outcome.model, raw: this.takeRaw(check.value) });
    for (const c of check.value.concerns) this.log("decision", `${c.bundleId} (${c.kind}): ${c.note}`, { model: outcome.model });
    this.set({ critique: check.value });
  }

  private async finalize(mission: ConfirmedMission): Promise<void> {
    this.phase("finalizing");
    const ids = this.state.rows.map((r) => r.bundleId);
    const excluded = computeExcluded(ids, this.state.dropped, this.state.critique?.veto ?? []);
    let finalists: Finalist[] | null = null;

    if (this.state.mode === "ai" && ids.length >= 3) {
      const action = await this.askPlanner(mission, "finalize", Math.max(1, Math.min(this.state.round, MAX_ROUNDS)), excluded);
      if (action?.action === "finalize") {
        finalists = action.finalists.map((f) => this.toFinalist(f.bundleId, f.tradeoff));
      }
    }
    if (!finalists) {
      finalists = greedyFinalists(this.state.rows, mission, excluded).map((f) => this.toFinalist(f.bundleId, f.tradeoff));
      this.log("decision", `Deterministic search (not AI) ranked ${finalists.length} finalists by the goal metric.`);
    }
    this.set({ finalists });
  }

  private async narrate(mission: ConfirmedMission): Promise<void> {
    if (this.state.finalists.length !== 3) return;
    const signal = this.assertLive();
    const outcome = await this.deps.api.narrate(
      {
        missionId: this.state.missionId as string,
        mission,
        finalists: this.state.finalists.map((f) => ({ bundleId: f.bundleId, tradeoff: f.tradeoff })),
        evaluations: this.state.rows,
        baseline: this.state.baseline,
      },
      this.callOpts(signal),
    );
    this.assertLive();
    if (outcome.status !== "ok") {
      this.log("fallback", `${outcome.message} Finalists are shown without narration.`);
      return;
    }
    this.track("narrator", outcome.model);
    const check = validateNarrationOutput(outcome.result as NarrationOutput, {
      catalog: this.deps.catalog,
      finalistIds: this.state.finalists.map((f) => f.bundleId),
    });
    if (!check.ok) {
      this.logViolations(check.violations, outcome.model);
      this.log("fallback", "Narration rejected; finalists are shown without narration.");
      return;
    }
    const narration: MachineState["narration"] = {};
    for (const it of check.value.items) narration[it.bundleId] = { headline: it.headline, body: it.body };
    this.set({ narration });
    this.log("decision", "Narration written; numbers in it are filled in from the simulator.", { model: outcome.model });
  }

  /* ------------------------------- planner ------------------------------- */

  /** Returns a validated action, or null after switching to the deterministic search. */
  private async askPlanner(
    mission: ConfirmedMission,
    phase: "search" | "finalize",
    round: number,
    excluded?: ReadonlySet<string>,
  ): Promise<PlannerAction | null> {
    const signal = this.assertLive();
    const req: PlanRequest = {
      missionId: this.state.missionId as string,
      mission,
      phase,
      round,
      bundles: this.state.bundles,
      evaluations: this.state.rows,
      baseline: this.state.baseline,
      dropped: this.state.dropped,
      critique: this.state.critique ? { concerns: this.state.critique.concerns, veto: this.state.critique.veto ?? [] } : undefined,
    };
    const outcome = await this.deps.api.plan(req, this.callOpts(signal));
    this.assertLive();
    if (outcome.status !== "ok") {
      this.switchToDeterministic(outcome);
      return null;
    }
    this.track("planner", outcome.model);
    const check = validatePlannerOutput(outcome.result, {
      catalog: this.deps.catalog,
      mission,
      phase,
      round,
      known: this.knownBundles(),
      excludedBundleIds: excluded,
    });
    if (!check.ok) {
      this.logViolations(check.violations, outcome.model);
      this.switchToDeterministic({
        status: "fallback",
        reason: "output_rejected",
        message: UI_MESSAGES.outputRejected,
        next: "deterministic_search",
      });
      return null;
    }
    this.log("decision", check.value.log_sentence, { model: outcome.model, raw: this.takeRaw(check.value) });
    return check.value;
  }

  private switchToDeterministic(outcome: Extract<Outcome<unknown>, { status: "fallback" }>): void {
    const last = this.state.log[this.state.log.length - 1];
    if (last?.kind === "fallback" && last.sentence === outcome.message) {
      // The server already logged this fallback; do not repeat it.
      this.log("state", "Deterministic search (not AI) continues the mission.");
    } else {
      this.log("fallback", `${outcome.message} Deterministic search (not AI) continues the mission.`, {
        errors: [outcome.reason],
      });
    }
    this.set({ mode: "deterministic", degraded: { reason: outcome.reason, message: outcome.message, next: outcome.next } });
  }

  private degradeToIdle(outcome: Extract<Outcome<unknown>, { status: "fallback" }>): void {
    const message = outcome.reason === "output_rejected" ? outcome.message : this.degradedMessage(outcome);
    this.log("fallback", message, { errors: [outcome.reason] });
    this.controller = null;
    this.set({
      phase: "idle",
      round: 0,
      progress: undefined,
      degraded: { reason: outcome.reason, message, next: outcome.next },
    });
  }

  private degradedMessage(o: Extract<Outcome<unknown>, { status: "fallback" }>): string {
    if (o.reason === "budget_exhausted") return UI_MESSAGES.budgetExhausted;
    if (o.reason === "rate_limited") return o.message;
    return UI_MESSAGES.plannerUnavailable;
  }

  /* ------------------------------- helpers ------------------------------- */

  private knownBundles(): KnownBundle[] {
    const scored = new Set(this.state.rows.map((r) => r.bundleId));
    return this.state.bundles.map((b) => ({ id: b.id, candidateIds: b.candidateIds, evaluated: scored.has(b.id) }));
  }

  private toFinalist(bundleId: string, tradeoff: string): Finalist {
    const b = this.state.bundles.find((x) => x.id === bundleId);
    const candidateIds = b?.candidateIds ?? [];
    return { bundleId, candidateIds, tradeoff, costTier: bundleCostTier(this.deps.catalog, candidateIds) };
  }

  private track(role: string, model: string): void {
    this.set({ models: { ...this.state.models, [role]: model } });
  }

  private takeRaw(fallback: unknown): unknown {
    const raw = this.pendingRaw ?? fallback;
    this.pendingRaw = undefined;
    return raw;
  }

  private logViolations(vs: readonly Violation[], model?: string): void {
    this.log("validator", "The planning output was rejected by the validator.", { model, errors: describeViolations(vs) });
  }

  private callOpts(signal: AbortSignal) {
    return { signal, onEvent: (e: AgentEvent) => this.onServerEvent(e) };
  }

  private onServerEvent(e: AgentEvent): void {
    if (e.event === "log") {
      this.log(e.data.kind, e.data.sentence, { model: e.data.model, errors: e.data.errors });
    } else if (e.event === "tool_call") {
      this.pendingRaw = e.data.args;
    } else if (e.event === "usage") {
      const m = e.data.mission;
      this.set({
        budget: {
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          limitIn: m.limitIn,
          limitOut: m.limitOut,
          fraction: Math.min(1, Math.max(m.inputTokens / m.limitIn, m.outputTokens / m.limitOut)),
        },
      });
    }
  }

  private swallowCancel(e: unknown): void {
    if (e instanceof Cancelled || (e instanceof Error && e.name === "AbortError")) return;
    this.log("state", "The mission stopped because of an unexpected error. Nothing was applied.", {
      errors: [e instanceof Error ? e.message : "unknown error"],
    });
    this.controller = null;
    this.set({ phase: "idle", round: 0, progress: undefined });
  }
}

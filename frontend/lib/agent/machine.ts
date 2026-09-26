/**
 * Client state machine for a planning mission.
 *
 *   idle -> parsing -> confirmGoal -> planning(r) -> evaluating(r) -> critiquing -> finalizing
 *        -> finalists -> applying -> applied
 *
 * The browser orchestrates the loop: it asks the server for one validated action, runs the
 * simulator through the injected `evaluate` function, and posts the results back. The server is
 * stateless. Every model output is re-validated here as well (defense in depth). Model prose is
 * screened and numbers appear only through slots the application fills from simulator results.
 *
 * Every run owns a token. A run that was cancelled or replaced can no longer write state or log
 * entries, so a slow evaluator or network call from an old mission cannot leak into the next one.
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
  outputRejectedMessage,
  UI_MESSAGES,
  type AgentEvent,
  type FallbackNext,
  type FallbackReason,
  type LogKind,
  type Outcome,
  type PlanRequest,
} from "./protocol";
import { rationaleLogSentence, renderRationale, type Rationale } from "./rationale";
import { cardLines, fillSlots, makeSlotResolver } from "./slots";
import {
  BaselineRowSchema,
  CONCERN_TEXT,
  ConfirmedMissionSchema,
  EvaluatedRowSchema,
  MAX_EVALUATED_BUNDLES,
  MAX_FUTURES_PER_ROW,
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
  validateMintedPlannerOutput,
  validateNarrationOutput,
  validateParseOutput,
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
  | "applying"
  | "applied";

export type Mode = "ai" | "deterministic";

export interface LogEntry {
  id: number;
  t: number;
  /** "commentary" entries are the application's rendering of a model's rationale SELECTION, labeled RATIONALE_LABEL. */
  kind: LogKind | "evaluation" | "state" | "commentary";
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
  costTier: string;
  /** Kept for compatibility. Always "": a finalist carries no model text. */
  mechanismNote: string;
  /** Application-authored label: how this finalist was chosen. "" for AI-chosen finalists. */
  note: string;
}

/**
 * What a finalist card shows. Every field is application or catalog text: no model-written text
 * appears on a card. The model's rationale appears only in the decision log.
 */
export interface FinalistCard {
  /** Application template: bundle id and the catalog titles of its candidates. */
  headline: string;
  /** Application templates filled from the bundle's own simulator row, with real signs and directions. */
  lines: string[];
  /** The catalog's own description of what the candidates do (pipeline data, not model output); "" when the catalog has none. */
  commentary: string;
  /** Label to show above `commentary`. */
  commentaryLabel: typeof CARD_TEXT_LABEL;
  /** Kept for compatibility. Always "". */
  mechanismNote: string;
  /** How a deterministic search chose it ("" for AI choices). */
  note: string;
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
  /** Kept for compatibility. Always empty: cards carry no model text (see FinalistCard). */
  narration: Record<string, { commentary: string }>;
  appliedBundleId?: string;
  log: LogEntry[];
  budget: BudgetMeter;
  /**
   * Bundles = accepted rows (after dropping unknown, duplicate, mismatched and malformed rows).
   * Futures = the SUM of the futures counts carried by the accepted rows.
   */
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
  /**
   * Also ask the narrator for a rationale per finalist. Off by default: the narrator's output can
   * only reach the decision log (never a card), so it costs a model call for one labeled log line.
   */
  narrate?: boolean;
  /**
   * Supplies the Cloudflare Turnstile token for the mission start (sent as `turnstileToken` with the
   * parse request). Needed only when the server has WS_TURNSTILE_SECRET set; a token is single use,
   * so return a fresh one each call.
   */
  turnstileToken?: () => string | undefined | Promise<string | undefined>;
  /** The simulator's configured futures per bundle. A row claiming more (or fewer than one) is refused. Default MAX_FUTURES_PER_ROW. */
  maxFutures?: number;
}

/** Label above the catalog description on a finalist card. */
export const CARD_TEXT_LABEL = "How it works (catalog description)";

class Cancelled extends Error {}

/** One mission attempt. Only the current run may write state. */
interface Run {
  readonly id: number;
  readonly controller: AbortController;
  /** Evaluator rows that were refused during this run (unknown, duplicate, mismatched, malformed). */
  rowsRefused: number;
}

const DEFAULT_LIMITS = { inputTokens: 60_000, outputTokens: 12_000 };

function randomId(): string {
  const a = new Uint8Array(12);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

type Fb = Extract<Outcome<unknown>, { status: "fallback" }>;

export class AgentMachine {
  private state: MachineState;
  private listeners = new Set<() => void>();
  private current: Run | null = null;
  private runSeq = 0;
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

  /** Replaces {{slot}} placeholders with simulator results (application text only; no model prose is ever passed through). */
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

  /** Logs a fallback sentence unless the server just sent the identical one. */
  private logFallbackOnce(sentence: string, extra: Partial<LogEntry> = {}): void {
    const last = this.state.log[this.state.log.length - 1];
    if (last?.kind === "fallback" && last.sentence === sentence) return;
    this.log("fallback", sentence, extra);
  }

  private phase(phase: Phase, round = this.state.round): void {
    this.set({ phase, round, progress: undefined });
  }

  /* ------------------------------ run tokens ----------------------------- */

  private newRun(): Run {
    this.current?.controller.abort();
    const run: Run = { id: ++this.runSeq, controller: new AbortController(), rowsRefused: 0 };
    this.current = run;
    return run;
  }

  private isLive(run: Run): boolean {
    return this.current === run && !run.controller.signal.aborted;
  }

  /** Throws Cancelled unless `run` is still the current, uncancelled run. Call after every await. */
  private live(run: Run): AbortSignal {
    if (!this.isLive(run)) throw new Cancelled();
    return run.controller.signal;
  }

  /* ------------------------------ public flow ---------------------------- */

  reset(): void {
    if (this.state.phase === "applying") {
      this.log("state", "Applying is in progress and cannot be interrupted.");
      return;
    }
    this.current?.controller.abort();
    this.current = null;
    this.state = this.initial();
    for (const l of this.listeners) l();
  }

  cancel(): void {
    if (this.state.phase === "idle" || this.state.phase === "applied") return;
    if (this.state.phase === "applying") {
      // The host is already committing the bundle; saying "nothing was applied" would be false.
      this.log("state", "Applying is in progress and cannot be cancelled.");
      return;
    }
    this.current?.controller.abort();
    this.current = null;
    const log = this.state.log;
    this.state = { ...this.initial(), log };
    this.log("state", "Mission cancelled. Nothing was applied.");
  }

  /** idle -> parsing -> confirmGoal. */
  async start(text: string): Promise<void> {
    if (this.state.phase !== "idle") throw new Error("A mission is already in progress.");
    const missionId = (this.deps.newMissionId ?? randomId)();
    const run = this.newRun();
    this.set({ ...this.initial(), log: this.state.log, missionId, phase: "parsing" });
    try {
      const token = await this.deps.turnstileToken?.();
      this.live(run);
      const outcome = await this.deps.api.parse({ missionId, text, ...(token ? { turnstileToken: token } : {}) }, this.callOpts(run));
      this.live(run);
      if (outcome.status !== "ok") return this.degradeToIdle(outcome, "parser");
      this.track("parser", outcome.model);
      const check = validateParseOutput(outcome.result, { catalog: this.deps.catalog });
      if (!check.ok) {
        this.logViolations(check.violations, outcome.model);
        return this.degradeToIdle({ status: "fallback", reason: "output_rejected", message: UI_MESSAGES.parserRejected, next: "deterministic_search" }, "parser");
      }
      // The reading of the mission is an application template built from the validated fields.
      this.log("decision", this.describeParsed(check.value), { model: outcome.model, raw: check.value });
      this.set({ parsed: check.value, phase: "confirmGoal" });
    } catch (e) {
      this.swallowCancel(e, run);
    }
  }

  /** confirmGoal -> planning(1) ... -> finalists. The mission carries the chip-picker target. */
  async confirmGoal(mission: ConfirmedMission): Promise<void> {
    if (this.state.phase !== "confirmGoal") throw new Error("There is no goal waiting for confirmation.");
    const parsed = ConfirmedMissionSchema.parse(mission);
    const run = this.current;
    if (!run || !this.isLive(run)) throw new Error("There is no goal waiting for confirmation.");
    this.log("state", "Goal confirmed by you. Planning starts.");
    await this.run(run, parsed, "ai");
  }

  /** The "Deterministic search" button: no model calls at all. */
  async runDeterministic(mission: ConfirmedMission): Promise<void> {
    if (this.state.phase !== "idle") throw new Error("A mission is already in progress.");
    const parsed = ConfirmedMissionSchema.parse(mission);
    const run = this.newRun();
    this.set({ ...this.initial(), log: this.state.log, missionId: (this.deps.newMissionId ?? randomId)() });
    this.log("state", `${UI_MESSAGES.deterministicLabel} started by you.`);
    await this.run(run, parsed, "deterministic");
  }

  /**
   * finalists -> applying -> applied. The host commits the bundle as a world mutation via onApply.
   * The phase changes to "applying" synchronously, so a second call (or a cancel) while the host
   * is committing is refused instead of applying twice or claiming that nothing was applied.
   */
  async apply(bundleId: string): Promise<void> {
    if (this.state.phase !== "finalists") throw new Error("There are no finalists to apply.");
    const f = this.state.finalists.find((x) => x.bundleId === bundleId);
    if (!f) throw new Error("That bundle is not one of the finalists.");
    this.set({ phase: "applying", progress: undefined });
    try {
      await this.deps.onApply?.({ bundleId: f.bundleId, candidateIds: f.candidateIds });
    } catch (e) {
      this.log("state", `Applying bundle ${f.bundleId} did not complete. Check the terrain before trying again.`, { errors: ["apply_failed"] });
      this.set({ phase: "finalists" });
      throw e;
    }
    this.log("state", `Bundle ${f.bundleId} applied by you. The terrain will re-run.`);
    this.set({ phase: "applied", appliedBundleId: f.bundleId });
  }

  /* -------------------------------- the loop ----------------------------- */

  private async run(run: Run, mission: ConfirmedMission, mode: Mode): Promise<void> {
    this.live(run);
    this.set({ mission, mode, bundles: [], dropped: [], rows: [], finalists: [], narration: {}, critique: undefined, degraded: undefined });
    try {
      await this.searchRounds(run, mission);
      await this.topUp(run, mission);
      this.live(run);
      if (this.state.rows.length === 0) {
        // Nothing was scored. Say why: the simulator's rows were refused, or the catalog offers nothing.
        const refused = run.rowsRefused > 0;
        const message = refused
          ? "The simulator returned no usable rows for the requested bundles."
          : "No catalog intervention could be evaluated under these constraints.";
        this.log("fallback", message);
        this.set({
          phase: "idle",
          round: 0,
          progress: undefined,
          degraded: { reason: refused ? "evaluation_failed" : "catalog_unavailable", message, next: "deterministic_search" },
        });
        return;
      }
      if (this.state.mode === "ai") await this.critique(run, mission);
      await this.finalize(run, mission);
      if (this.state.mode === "ai" && this.deps.narrate === true) await this.narrate(run, mission);
      this.live(run);
      this.phase("finalists");
      this.log("state", `${this.state.finalists.length} finalist bundles ready. You decide what to apply.`);
    } catch (e) {
      this.swallowCancel(e, run);
    }
  }

  private async searchRounds(run: Run, mission: ConfirmedMission): Promise<void> {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      this.live(run);
      this.phase("planning", round);
      let fresh: BundleSpec[] = [];
      let converged = false;

      if (this.state.mode === "ai") {
        const action = await this.askPlanner(run, mission, "search", round);
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
      await this.evaluateBundles(run, mission, round, fresh);
    }
  }

  private async evaluateBundles(run: Run, mission: ConfirmedMission, round: number, fresh: BundleSpec[]): Promise<void> {
    const signal = this.live(run);
    this.set({ bundles: [...this.state.bundles, ...fresh] });
    this.phase("evaluating", round);
    const batch = await this.deps.evaluate(fresh, {
      mission,
      round,
      signal,
      onProgress: (done, total) => {
        if (this.isLive(run)) this.set({ progress: { done, total } });
      },
    });
    this.live(run); // a stale evaluator result is dropped here, never written

    // Accept a row only if it is for a bundle we asked about, has the candidates we sent, is the
    // first row for that bundle, and is well-formed. Counts come from the accepted rows alone:
    // bundles = how many rows, futures = the sum of the futures each accepted row carries.
    const wanted = new Map(fresh.map((b) => [b.id, b]));
    const have = new Set(this.state.rows.map((r) => r.bundleId));
    const accepted: EvaluationRow[] = [];
    let futures = 0;
    const refused = { unknown_bundle: 0, duplicate_row: 0, candidate_mismatch: 0, malformed_row: 0 };
    for (const raw of batch.rows) {
      const parsed = EvaluatedRowSchema.safeParse(raw);
      if (!parsed.success) {
        refused.malformed_row++;
        continue;
      }
      const { futures: rowFutures, ...r } = parsed.data;
      if (rowFutures > (this.deps.maxFutures ?? MAX_FUTURES_PER_ROW)) {
        refused.malformed_row++;
        continue;
      }
      const b = wanted.get(r.bundleId);
      if (!b) refused.unknown_bundle++;
      else if (have.has(r.bundleId)) refused.duplicate_row++;
      else if (b.candidateIds.join("|") !== r.candidateIds.join("|")) refused.candidate_mismatch++;
      else {
        have.add(r.bundleId);
        accepted.push(r);
        futures += rowFutures;
      }
    }
    const refusedTotal = Object.values(refused).reduce((a, b) => a + b, 0);
    run.rowsRefused += refusedTotal;
    const baseline = batch.baseline ? BaselineRowSchema.safeParse(batch.baseline) : undefined;

    this.set({
      rows: [...this.state.rows, ...accepted],
      baseline: baseline?.success ? baseline.data : this.state.baseline,
      counts: {
        bundlesEvaluated: this.state.counts.bundlesEvaluated + accepted.length,
        futuresEvaluated: this.state.counts.futuresEvaluated + futures,
      },
    });
    // These numbers come from rows the machine accepted, never from what was requested or self-reported.
    this.log(
      "evaluation",
      `Round ${round}: the simulator scored ${accepted.length} of ${fresh.length} requested bundles across ${futures} simulated futures, computed locally in your browser.`,
    );
    if (refusedTotal > 0) {
      const codes = Object.entries(refused).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`);
      this.log("validator", `The simulator returned ${refusedTotal} rows that were not used (unknown bundle, duplicate, mismatched candidates or malformed).`, { errors: codes });
    }
  }

  /** Finalize needs three evaluated bundles; add deterministic singles if the search found fewer. */
  private async topUp(run: Run, mission: ConfirmedMission): Promise<void> {
    this.live(run);
    const have = this.state.rows.length;
    if (have >= 3 || have >= MAX_EVALUATED_BUNDLES) return;
    const extra = greedyPlanRound({ catalog: this.deps.catalog, mission, round: 1, rows: this.state.rows, known: this.state.bundles }).slice(0, 3 - have);
    if (extra.length === 0) {
      this.log("info", "Fewer than three distinct bundles exist under these constraints.");
      return;
    }
    this.log("fallback", "Fewer than three bundles were scored, so deterministic search (not AI) added some.");
    await this.evaluateBundles(run, mission, Math.max(1, this.state.round), extra);
  }

  private async critique(run: Run, mission: ConfirmedMission): Promise<void> {
    if (this.state.rows.length === 0) return;
    this.live(run);
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
      this.callOpts(run),
    );
    this.live(run);
    if (outcome.status !== "ok") {
      // A rejected critique changes nothing about the search mode: only the critique is skipped.
      this.logFallbackOnce(outcome.reason === "output_rejected" ? UI_MESSAGES.criticRejected : `${outcome.message} Continuing without a critique.`);
      return;
    }
    this.track("critic", outcome.model);
    const check = validateCritiqueOutput(outcome.result, { catalog: this.deps.catalog, known: this.knownBundles() });
    if (!check.ok) {
      this.logViolations(check.violations, outcome.model);
      this.logFallbackOnce(UI_MESSAGES.criticRejected);
      return;
    }
    const c = check.value;
    this.log("decision", `The critic flagged ${c.concerns.length} concern${c.concerns.length === 1 ? "" : "s"} and ${(c.veto ?? []).length} veto${(c.veto ?? []).length === 1 ? "" : "es"}.`, { model: outcome.model, raw: check.value });
    // The sentence per concern kind is fixed text; the critic supplies only the bundle and the kind.
    for (const c of check.value.concerns) this.log("decision", `${c.bundleId} (${c.kind}): ${CONCERN_TEXT[c.kind]}`, { model: outcome.model });
    this.set({ critique: check.value });
  }

  private async finalize(run: Run, mission: ConfirmedMission): Promise<void> {
    this.live(run);
    this.phase("finalizing");
    const ids = this.state.rows.map((r) => r.bundleId);
    const excluded = computeExcluded(ids, this.state.dropped, this.state.critique?.veto ?? []);
    let finalists: Finalist[] | null = null;

    if (this.state.mode === "ai" && ids.length >= 3) {
      const action = await this.askPlanner(run, mission, "finalize", Math.max(1, Math.min(this.state.round, MAX_ROUNDS)), excluded);
      if (action?.action === "finalize") {
        finalists = action.finalists.map((f) => this.toFinalist(f.bundleId, ""));
      }
    }
    this.live(run);
    if (!finalists) {
      finalists = greedyFinalists(this.state.rows, mission, excluded).map((f) => this.toFinalist(f.bundleId, f.note));
      this.log("decision", `Deterministic search (not AI) ranked ${finalists.length} finalists by the goal metric.`);
    }
    this.set({ finalists });
  }

  private async narrate(run: Run, mission: ConfirmedMission): Promise<void> {
    if (this.state.finalists.length !== 3) return;
    this.live(run);
    const outcome = await this.deps.api.narrate(
      {
        missionId: this.state.missionId as string,
        mission,
        // Only the ids go back to the server: the planner's tradeoff sentence is not re-sent into a prompt.
        finalists: this.state.finalists.map((f) => ({ bundleId: f.bundleId })),
        evaluations: this.state.rows,
        baseline: this.state.baseline,
      },
      this.callOpts(run),
    );
    this.live(run);
    if (outcome.status !== "ok") {
      this.logFallbackOnce(outcome.reason === "output_rejected" ? UI_MESSAGES.narratorRejected : `${outcome.message} Finalists are shown without narration.`);
      return;
    }
    this.track("narrator", outcome.model);
    const check = validateNarrationOutput(outcome.result as NarrationOutput, {
      catalog: this.deps.catalog,
      finalistIds: this.state.finalists.map((f) => f.bundleId),
    });
    if (!check.ok) {
      this.logViolations(check.violations, outcome.model);
      this.logFallbackOnce(UI_MESSAGES.narratorRejected);
      return;
    }
    for (const it of check.value.items) this.logRationale(`narrator, ${it.bundleId}`, it.rationale, outcome.model);
  }

  /* ------------------------------- planner ------------------------------- */

  /** Returns a validated action, or null after switching to the deterministic search. */
  private async askPlanner(
    run: Run,
    mission: ConfirmedMission,
    phase: "search" | "finalize",
    round: number,
    excluded?: ReadonlySet<string>,
  ): Promise<PlannerAction | null> {
    this.live(run);
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
    const outcome = await this.deps.api.plan(req, this.callOpts(run));
    this.live(run);
    if (outcome.status !== "ok") {
      this.switchToDeterministic(outcome);
      return null;
    }
    this.track("planner", outcome.model);
    // The server minted the bundle IDs; the client accepts only the IDs it would mint itself.
    const check = validateMintedPlannerOutput(outcome.result, {
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
        message: outputRejectedMessage("planner"),
        next: "deterministic_search",
      });
      return null;
    }
    this.logPlannerDecision(check.value, round, outcome.model);
    return check.value;
  }

  /** Application-authored line for what the planner did, then its rationale selection rendered as a labeled log line. */
  private logPlannerDecision(a: PlannerAction, round: number, model: string): void {
    if (a.action === "propose") {
      this.log("decision", `Round ${round}: the planner proposed ${a.bundles.length} bundle${a.bundles.length === 1 ? "" : "s"} (${a.bundles.map((b) => b.id).join(", ")}).`, { model, raw: a });
    } else if (a.action === "refine") {
      this.log("decision", `Round ${round}: the planner kept ${a.keep.length}, dropped ${a.drop.length} and added ${a.add.length} bundle${a.add.length === 1 ? "" : "s"}${a.add.length > 0 ? ` (${a.add.map((b) => b.id).join(", ")})` : ""}.`, { model, raw: a });
    } else {
      this.log("decision", `The planner chose finalists ${a.finalists.map((f) => f.bundleId).join(", ")}.`, { model, raw: a });
    }
    this.logRationale("planner", a.rationale, model);
  }

  /** Only called when the mode really does switch, so its wording may say so. */
  private switchToDeterministic(outcome: Fb): void {
    const last = this.state.log[this.state.log.length - 1];
    const sentence = outcome.reason === "output_rejected" ? outputRejectedMessage("planner") : outcome.message;
    if (last?.kind === "fallback" && last.sentence === sentence) {
      // The server already logged this fallback; do not repeat it.
      this.log("state", "Deterministic search (not AI) continues the mission.");
    } else {
      this.log("fallback", `${sentence} Deterministic search (not AI) continues the mission.`, { errors: [outcome.reason] });
    }
    this.set({ mode: "deterministic", degraded: { reason: outcome.reason, message: sentence, next: outcome.next } });
  }

  private degradeToIdle(outcome: Fb, role: "parser"): void {
    const message = outcome.reason === "output_rejected" ? outputRejectedMessage(role) : this.degradedMessage(outcome);
    this.log("fallback", message, { errors: [outcome.reason] });
    this.current = null;
    this.set({
      phase: "idle",
      round: 0,
      progress: undefined,
      degraded: { reason: outcome.reason, message, next: outcome.next },
    });
  }

  private degradedMessage(o: Fb): string {
    if (o.reason === "budget_exhausted") return UI_MESSAGES.budgetExhausted;
    if (o.reason === "rate_limited" || o.reason === "verification_failed") return o.message;
    return UI_MESSAGES.plannerUnavailable;
  }

  /* ------------------------------- helpers ------------------------------- */

  private knownBundles(): KnownBundle[] {
    const scored = new Set(this.state.rows.map((r) => r.bundleId));
    return this.state.bundles.map((b) => ({ id: b.id, candidateIds: b.candidateIds, evaluated: scored.has(b.id) }));
  }

  private toFinalist(bundleId: string, note: string): Finalist {
    const b = this.state.bundles.find((x) => x.id === bundleId);
    const candidateIds = b?.candidateIds ?? [];
    return { bundleId, candidateIds, costTier: bundleCostTier(this.deps.catalog, candidateIds), mechanismNote: "", note };
  }

  /** "Read your mission as ...": an application template over the validated fields (no model text). */
  private describeParsed(p: ParsedMission): string {
    const metric = { p50: "median travel time", p90: "worst-case (90th percentile) travel time", isolatedCount: "isolated groups", equityGap: "the equity gap" }[p.goal.metric];
    const areas = p.constraints.areas.map((id) => this.deps.catalog.gazetteerById.get(id)?.name ?? id);
    const types = p.constraints.types.length > 0 ? `, types ${p.constraints.types.join(", ")}` : "";
    return `Read your mission as: ${p.lens} lens, lower ${metric} (you set the target next), cost tier up to ${p.constraints.maxCostTier}${types}${areas.length > 0 ? `, areas ${areas.join(", ")}` : ""}.`;
  }

  /** Logs the rendered rationale, labeled; nothing is logged when the sentence cannot be rendered. */
  private logRationale(who: string, r: Rationale, model?: string): void {
    const text = renderRationale(r, this.deps.catalog);
    if (text.trim() !== "") this.log("commentary", rationaleLogSentence(text, who), { model });
  }

  /** The card for a finalist: application headline, simulator result lines and the catalog's own description. No model text. */
  card(bundleId: string): FinalistCard | undefined {
    const f = this.state.finalists.find((x) => x.bundleId === bundleId);
    if (!f) return undefined;
    const row = this.state.rows.find((r) => r.bundleId === bundleId);
    const titles = f.candidateIds.map((id) => this.deps.catalog.byId.get(id)?.title ?? id);
    return {
      headline: `${f.bundleId}: ${titles.join(" + ")}`,
      lines: row ? cardLines(row, this.state.baseline, this.state.mission?.lens ?? "access") : [],
      commentary: f.candidateIds.map((id) => this.deps.catalog.byId.get(id)?.mechanism ?? "").filter((t) => t !== "").join(" "),
      commentaryLabel: CARD_TEXT_LABEL,
      mechanismNote: "",
      note: f.note,
    };
  }

  private track(role: string, model: string): void {
    this.set({ models: { ...this.state.models, [role]: model } });
  }

  private logViolations(vs: readonly Violation[], model?: string): void {
    this.log("validator", "The planning output was rejected by the validator.", { model, errors: describeViolations(vs) });
  }

  private callOpts(run: Run) {
    return {
      signal: run.controller.signal,
      onEvent: (e: AgentEvent) => {
        if (this.isLive(run)) this.onServerEvent(e);
      },
    };
  }

  private onServerEvent(e: AgentEvent): void {
    if (e.event === "log") {
      this.log(e.data.kind, e.data.sentence, { model: e.data.model, errors: e.data.errors });
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

  /** A cancelled or replaced run ends silently. Anything else stops the mission with a fixed message. */
  private swallowCancel(e: unknown, run: Run): void {
    if (e instanceof Cancelled || (e instanceof Error && e.name === "AbortError")) return;
    if (!this.isLive(run)) return;
    this.log("state", "The mission stopped because of an unexpected error. Nothing was applied.", { errors: ["internal_error"] });
    this.current = null;
    this.set({ phase: "idle", round: 0, progress: undefined });
  }
}

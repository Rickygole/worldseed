/**
 * Client state machine for a planning mission.
 *
 *   idle -> parsing -> confirmGoal -> [planning(r) -> evaluating(r) -> critiquing(stress test)]x2
 *        -> planning(3) -> evaluating(3) -> finalizing -> finalists -> applying -> applied
 *
 * The adversarial loop: after each of the first two search rounds the critic (or, without AI, the
 * deterministic critic) chooses a STRESS TEST from the application's closed set; the simulator
 * re-scores the leading bundles under it, and the planner's next round reads those results.
 * The stress evaluations happen inside the three planning rounds; they add no planner rounds.
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
import { bundleCostTier, COST_TIER_RANK, type Catalog } from "./catalog";
import type { EvaluateFn } from "./evaluate";
import { pickDeterministicStress } from "./critic";
import { exhaustiveSearch, type DeterministicEvaluateFn, type ExhaustiveResult } from "./exhaustive";
import { greedyFinalists, greedyPlanRound, rankRows, shortlistBundles } from "./greedy";
import {
  outputRejectedMessage,
  UI_MESSAGES,
  type AgentEvent,
  type StepMetrics,
  type FallbackNext,
  type FallbackReason,
  type LogKind,
  type Outcome,
  type PlanRequest,
} from "./protocol";
import { rationaleLogSentence, renderRationale, type Rationale } from "./rationale";
import { metricLabel } from "./lenses";
import { REASONING_LABEL, reasoningWithheldSentence, screenReasoning, type ReasoningEntry } from "./reasoning";
import { cardLines, figureLines, fillSlots, makeSlotResolver, stressBenefitLine } from "./slots";
import { stressContext, stressLabel, type StressSpec } from "./stress";
import {
  baselineRowSchemaFor,
  CONCERN_TEXT,
  ConfirmedMissionSchema,
  evaluatedRowSchemaFor,
  MAX_EVALUATED_BUNDLES,
  MAX_FUTURES_PER_ROW,
  MAX_ROUNDS,
  type BaselineRow,
  type BundleSpec,
  type ConfirmedMission,
  type CritiqueOutput,
  type EvaluationRow,
  type ParsedMission,
  type PlannerAction,
} from "./tools";
import {
  computeExcluded,
  describeViolations,
  validateCritiqueOutput,
  validateMintedPlannerOutput,
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
  kind: LogKind | "evaluation" | "state" | "commentary" | "reasoning";
  sentence: string;
  model?: string;
  errors?: string[];
  /** Raw validated tool JSON, for the expandable view in the decision log. */
  raw?: unknown;
  /**
   * Present only on kind "reasoning": the model's optional plain-text reasoning (screened for
   * length, charset, digits, links and markup only) with the metrics of the step. Show it inside a
   * collapsed section labeled REASONING_LABEL; never use it for a decision or put it on a card.
   */
  reasoning?: ReasoningEntry;
}

/** One stress test the mission ran, with the simulator's results for the leading bundles. */
export interface StressResult {
  id: string;
  spec: StressSpec;
  /** Application-authored label ("Harbor Tunnel closed"). */
  label: string;
  source: "ai" | "deterministic";
  model?: string;
  /** No-intervention baseline under the same stress, when the evaluator returned one. */
  baseline?: BaselineRow;
  rows: EvaluationRow[];
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
  /** Set when this finalist shows exactly the same figures as an earlier one ("B2 matches B1 on every displayed figure; the smaller bundle is listed first."); otherwise "". */
  tieNote: string;
  /** Application sentences, from real stress-test rows, saying how this bundle held up ("Harbor Tunnel closed: Under this stress B2 loses ..."). Empty when it was not stress-tested. */
  stressLines: string[];
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
   * Futures = the SUM of the futures counts carried by the accepted rows, stress rows included.
   * stressEvaluations = accepted rows scored under a stress (re-scores of bundles already counted).
   */
  counts: { bundlesEvaluated: number; futuresEvaluated: number; stressEvaluations: number };
  /** Stress tests run so far (at most two per mission), each with real simulator rows. */
  stresses: StressResult[];
  /** Metrics of every model call so far (role, model, tokens, latency), for the decision log. */
  steps: StepMetrics[];
  progress?: { done: number; total: number };
  models: Record<string, string>;
  degraded?: Degraded;
  /** Stage-1 numbers of a screened deterministic search: how many bundles were scored and how many went on to the futures run. */
  screened?: { enumerated: number; scored: number; shortlisted: number };
}

export interface MachineDeps {
  api: AgentApi;
  evaluate: EvaluateFn;
  catalog: Catalog;
  newMissionId?: () => string;
  now?: () => number;
  onApply?: (bundle: { bundleId: string; candidateIds: string[] }) => void | Promise<void>;
  limits?: { inputTokens: number; outputTokens: number };
  /** Deprecated and ignored: the narrator was removed. Kept only so existing callers still compile. */
  narrate?: boolean;
  /**
   * A deterministic one-run-per-bundle evaluator (no futures; the same kind the exhaustive check
   * uses). When given, the deterministic search (the "Deterministic search" button, or the fallback
   * after the AI planner fails before anything was scored) runs in two stages: it SCREENS every
   * eligible bundle with this evaluator, then runs the futures evaluation only on the shortlist.
   * Without it the round-by-round greedy search runs as before. The AI path never uses it.
   */
  screen?: DeterministicEvaluateFn;
  /** Shortlist size for the futures run (default 12, the per-mission cap on evaluated bundles). */
  shortlist?: number;
  /** How many leading bundles a stress test re-scores. Default 4. */
  stressTopK?: number;
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
      counts: { bundlesEvaluated: 0, futuresEvaluated: 0, stressEvaluations: 0 },
      stresses: [],
      steps: [],
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
    this.set({ mission, mode, bundles: [], dropped: [], rows: [], finalists: [], narration: {}, critique: undefined, degraded: undefined, stresses: [], screened: undefined });
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
      // At least one stress test always runs before the finalists are chosen (the search may have stopped early).
      if (this.state.stresses.length === 0) await this.attack(run, mission);
      await this.finalize(run, mission);
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
      if (this.state.mode === "deterministic" && round === 1 && this.deps.screen && this.state.rows.length === 0) {
        fresh = await this.screenAll(run, mission);
      }
      if (this.state.mode === "deterministic" && fresh.length === 0 && !this.state.screened) {
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
      if (this.state.mode === "deterministic" && this.state.screened && round > 1) {
        // The shortlist used the whole budget of bundles, so there is no round 2 or 3; the second stress test still runs.
        if (this.state.stresses.length < 2) await this.attack(run, mission);
        break;
      }

      if (fresh.length === 0) {
        this.log("info", converged ? "The planner added no new bundles, so search stops here." : "No new bundles to try, so search stops here.");
        break;
      }
      await this.evaluateBundles(run, mission, round, fresh);
      if (this.state.mode === "deterministic" && this.state.screened && round === 1) {
        const n = this.state.rows.length;
        const f = this.state.counts.futuresEvaluated;
        this.log(
          "decision",
          `Deterministic search (no AI): screened ${this.state.screened.scored} bundles, then scored the top ${n} with ${f} simulated futures${n > 0 && f % n === 0 ? ` (${f / n} per bundle)` : ""} in total.`,
        );
      }
      // The critic attacks the leaders after each of the first two rounds; the next round reads the result.
      if (round < MAX_ROUNDS) await this.attack(run, mission);
    }
  }

  /**
   * Stage 1 of the screened deterministic search: one deterministic run per eligible bundle, all
   * ranked on the goal metric; returns the shortlist (application-minted ids) for the futures run,
   * or [] when screening was not possible (the round-by-round search then runs instead).
   */
  private async screenAll(run: Run, mission: ConfirmedMission): Promise<BundleSpec[]> {
    const signal = this.live(run);
    this.log("info", "Deterministic search (no AI): screening every eligible bundle with one deterministic run each.");
    let res: ExhaustiveResult;
    try {
      res = await exhaustiveSearch({
        catalog: this.deps.catalog,
        mission,
        evaluate: this.deps.screen as DeterministicEvaluateFn,
        signal,
        onProgress: (done, total) => {
          if (this.isLive(run)) this.set({ progress: { done, total } });
        },
      });
    } catch (e) {
      this.live(run);
      if (e instanceof Cancelled || (e instanceof Error && e.name === "AbortError")) throw e;
      this.log("fallback", "Screening could not be run; the round-by-round deterministic search is used instead.", { errors: ["screen_failed"] });
      return [];
    }
    this.live(run);
    if (res.ranked.length < 3) {
      this.log("info", `Screening scored only ${res.ranked.length} bundles; the round-by-round deterministic search is used instead.`);
      return [];
    }
    const list = shortlistBundles(res, Math.min(this.deps.shortlist ?? MAX_EVALUATED_BUNDLES, MAX_EVALUATED_BUNDLES));
    this.set({ screened: { enumerated: res.enumerated, scored: res.evaluations, shortlisted: list.length }, progress: undefined });
    this.log(
      "decision",
      `Deterministic search (no AI): screened ${res.evaluations} of ${res.enumerated} bundles with one deterministic run each, and took the top ${list.length} (the leaders, plus variety) for the full futures run.`,
    );
    return list;
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
      const parsed = evaluatedRowSchemaFor(mission.lens).safeParse(raw);
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
    const baseline = batch.baseline ? baselineRowSchemaFor(mission.lens).safeParse(batch.baseline) : undefined;

    this.set({
      rows: [...this.state.rows, ...accepted],
      baseline: baseline?.success ? baseline.data : this.state.baseline,
      counts: {
        ...this.state.counts,
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

  /* ------------------------ the adversarial stress step ------------------------ */

  /** The leading bundles by the goal, not dropped: the ones a stress test re-scores. */
  private leaders(mission: ConfirmedMission): BundleSpec[] {
    const dropped = new Set(this.state.dropped);
    const pool = this.state.rows.filter((r) => !dropped.has(r.bundleId));
    const ranked = rankRows(pool.length > 0 ? pool : this.state.rows, mission).slice(0, Math.max(1, this.deps.stressTopK ?? 4));
    return ranked.map((r) => ({ id: r.bundleId, candidateIds: r.candidateIds }));
  }

  /** Stress results as the server accepts them in a plan or critique request (the last three at most). */
  private stressRequests(): NonNullable<PlanRequest["stresses"]> {
    return this.state.stresses.slice(-3).map((st) => ({ stress: st.spec, baseline: st.baseline, evaluations: st.rows }));
  }

  /**
   * One critic turn: choose a stress test (the AI critic from the closed set, or the deterministic
   * critic), have the simulator re-score the leaders under it, and log what happened from the rows.
   */
  private async attack(run: Run, mission: ConfirmedMission): Promise<void> {
    if (this.state.rows.length === 0) return;
    this.live(run);
    this.phase("critiquing", Math.min(Math.max(this.state.round, 1), MAX_ROUNDS));
    const leaders = this.leaders(mission);
    if (leaders.length === 0) return;
    const tried = this.state.stresses.map((st) => st.spec);
    let spec: StressSpec | null = null;
    let model: string | undefined;

    if (this.state.mode === "ai") {
      const outcome = await this.deps.api.critique(
        {
          missionId: this.state.missionId as string,
          mission,
          round: Math.min(Math.max(this.state.round, 1), MAX_ROUNDS),
          evaluations: this.state.rows,
          baseline: this.state.baseline,
          dropped: this.state.dropped,
          stresses: this.stressRequests(),
        },
        this.callOpts(run),
      );
      this.live(run);
      if (outcome.status !== "ok") {
        // A rejected critique changes nothing about the search mode; the deterministic critic still runs the stress step.
        this.logFallbackOnce(outcome.reason === "output_rejected" ? UI_MESSAGES.criticRejected : `${outcome.message} Continuing with the deterministic critic.`);
      } else {
        this.track("critic", outcome.model);
        const check = validateCritiqueOutput(outcome.result, { catalog: this.deps.catalog, known: this.knownBundles(), tried });
        if (!check.ok) {
          this.logViolations(check.violations, outcome.model);
          this.logFallbackOnce(UI_MESSAGES.criticRejected);
        } else {
          const c = check.value;
          this.log("decision", `The critic flagged ${c.concerns.length} concern${c.concerns.length === 1 ? "" : "s"} and ${(c.veto ?? []).length} veto${(c.veto ?? []).length === 1 ? "" : "es"}.`, { model: outcome.model, raw: check.value });
          // The sentence per concern kind is fixed text; the critic supplies only the bundle and the kind.
          for (const k of c.concerns) this.log("decision", `${k.bundleId} (${k.kind}): ${CONCERN_TEXT[k.kind]}`, { model: outcome.model });
          this.logRationale("critic", c.rationale, outcome.model);
          this.set({ critique: c });
          spec = c.stress;
          model = outcome.model;
        }
      }
    }

    if (spec !== null) {
      this.log("decision", `Stress test chosen by the critic: ${stressLabel(spec)}.`, { model, raw: spec });
      await this.runStress(run, mission, spec, "ai", leaders, model);
      return;
    }

    // Deterministic critic: scan the single-link closures and keep the one that hurts the leaders most.
    const signal = this.live(run);
    let pick;
    try {
      pick = await pickDeterministicStress({ evaluate: this.deps.evaluate, mission, round: this.state.round, leaders, normal: this.state.rows, tried, signal });
    } catch (e) {
      this.live(run);
      if (e instanceof Cancelled || (e instanceof Error && e.name === "AbortError")) throw e;
      this.log("fallback", "The deterministic stress test could not be run; the search continues without it.", { errors: ["stress_failed"] });
      return;
    }
    this.live(run);
    if (!pick) {
      this.log("info", "No further stress test could be run.");
      return;
    }
    this.log(
      "decision",
      `Deterministic stress test (no AI): ${stressLabel(pick.spec)}, the closure that hurt the leading bundles most of the ${pick.scanned} single-link closures the simulator tried.`,
      { raw: pick.spec },
    );
    this.recordStress(run, mission, pick.spec, "deterministic", leaders, { rows: pick.rows, baseline: pick.baseline });
  }

  /** Has the simulator re-score the leaders under `spec`, then records the result. */
  private async runStress(run: Run, mission: ConfirmedMission, spec: StressSpec, source: "ai" | "deterministic", leaders: BundleSpec[], model?: string): Promise<void> {
    const signal = this.live(run);
    this.phase("evaluating", this.state.round);
    let batch;
    try {
      batch = await this.deps.evaluate(leaders, {
        mission,
        round: this.state.round,
        signal,
        stress: stressContext(spec),
        onProgress: (done, total) => {
          if (this.isLive(run)) this.set({ progress: { done, total } });
        },
      });
    } catch (e) {
      this.live(run);
      if (e instanceof Cancelled || (e instanceof Error && e.name === "AbortError")) throw e;
      this.log("fallback", "The stress test could not be run by the simulator; the search continues without it.", { errors: ["stress_failed"] });
      return;
    }
    this.live(run);
    this.recordStress(run, mission, spec, source, leaders, batch, model);
  }

  /** Accepts stress rows under the same rules as normal rows, stores them and writes the application's log lines. */
  private recordStress(run: Run, mission: ConfirmedMission, spec: StressSpec, source: "ai" | "deterministic", leaders: BundleSpec[], batch: { rows: unknown[]; baseline?: unknown }, model?: string): void {
    const wanted = new Map(leaders.map((b) => [b.id, b]));
    const seen = new Set<string>();
    const accepted: EvaluationRow[] = [];
    let futures = 0;
    let refused = 0;
    for (const raw of batch.rows) {
      const parsed = evaluatedRowSchemaFor(mission.lens).safeParse(raw);
      if (!parsed.success) {
        refused++;
        continue;
      }
      const { futures: n, stressLabel: _echo, ...r } = parsed.data;
      void _echo;
      const b = wanted.get(r.bundleId);
      if (!b || seen.has(r.bundleId) || b.candidateIds.join("|") !== r.candidateIds.join("|") || n > (this.deps.maxFutures ?? MAX_FUTURES_PER_ROW)) {
        refused++;
        continue;
      }
      seen.add(r.bundleId);
      accepted.push(r);
      futures += n;
    }
    run.rowsRefused += refused;
    const label = stressLabel(spec);
    if (accepted.length === 0) {
      this.log("validator", `The simulator returned no usable rows under the stress "${label}"; the search continues without it.`, { errors: ["stress_rows_refused"] });
      return;
    }
    const base = batch.baseline ? baselineRowSchemaFor(mission.lens).safeParse(batch.baseline) : undefined;
    const result: StressResult = { id: `S${this.state.stresses.length + 1}`, spec, label, source, model, baseline: base?.success ? base.data : undefined, rows: accepted };
    this.set({
      stresses: [...this.state.stresses, result],
      counts: { ...this.state.counts, futuresEvaluated: this.state.counts.futuresEvaluated + futures, stressEvaluations: this.state.counts.stressEvaluations + accepted.length },
    });
    this.log(
      "evaluation",
      `Stress test: the simulator re-scored ${accepted.length} of ${leaders.length} leading bundles under "${label}" across ${futures} simulated futures, computed locally in your browser.`,
    );
    if (refused > 0) this.log("validator", `The simulator returned ${refused} stress rows that were not used (unknown bundle, duplicate, mismatched candidates or malformed).`, { errors: [`stress_rows_refused: ${refused}`] });
    for (const line of this.stressLines(mission, result)) this.log("decision", line.text);
  }

  /** Application sentences for a stress result, one per re-scored bundle, from the real rows. */
  private stressLines(mission: ConfirmedMission, st: StressResult): { bundleId: string; text: string }[] {
    const byId = new Map(this.state.rows.map((r) => [r.bundleId, r]));
    const out: { bundleId: string; text: string }[] = [];
    for (const r of st.rows) {
      const normal = byId.get(r.bundleId);
      if (normal) out.push({ bundleId: r.bundleId, text: stressBenefitLine(mission.goal.metric, r.bundleId, { baseline: this.state.baseline, row: normal }, { baseline: st.baseline, row: r }, mission.lens) });
    }
    return out;
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
      finalists = greedyFinalists(this.state.rows, mission, excluded, { diverse: this.state.screened !== undefined }).map((f) => this.toFinalist(f.bundleId, f.note));
      this.log("decision", `Deterministic search (not AI) ranked ${finalists.length} finalists by the goal metric.`);
    }
    finalists = this.orderTies(finalists, mission);
    this.set({ finalists });
    for (let i = 1; i < finalists.length; i++) {
      const t = this.tieWith(finalists, i);
      if (t) this.log("decision", t);
    }
  }

  /** The figure lines of a finalist as displayed (no cost tier), or null when it has no row. */
  private figuresOf(f: Finalist): string | null {
    const row = this.state.rows.find((r) => r.bundleId === f.bundleId);
    return row ? figureLines(row, this.state.baseline, this.state.mission?.lens ?? "access").join("\n") : null;
  }

  /**
   * Finalists that show identical figures cannot be told apart by what the reader sees. Within each
   * such group the smaller bundle is listed first, then the lower cost tier, then a fixed candidate
   * order; the groups keep the positions they had, so distinguishable finalists are never reordered.
   */
  private orderTies(fs: Finalist[], mission: ConfirmedMission): Finalist[] {
    void mission;
    const groups = new Map<string, number[]>();
    fs.forEach((f, i) => {
      const sig = this.figuresOf(f);
      if (sig !== null) groups.set(sig, [...(groups.get(sig) ?? []), i]);
    });
    const out = [...fs];
    for (const idx of groups.values()) {
      if (idx.length < 2) continue;
      const sorted = idx
        .map((i) => fs[i])
        .sort(
          (a, b) =>
            a.candidateIds.length - b.candidateIds.length ||
            COST_TIER_RANK[a.costTier as keyof typeof COST_TIER_RANK] - COST_TIER_RANK[b.costTier as keyof typeof COST_TIER_RANK] ||
            [...a.candidateIds].sort().join("+").localeCompare([...b.candidateIds].sort().join("+")),
        );
      idx.forEach((pos, k) => (out[pos] = sorted[k]));
    }
    return out;
  }

  /** The application's sentence when finalist `i` shows the same figures as an earlier one ("" when it does not). */
  private tieWith(fs: readonly Finalist[], i: number): string {
    const sig = this.figuresOf(fs[i]);
    if (sig === null) return "";
    const j = fs.findIndex((x, k) => k < i && this.figuresOf(x) === sig);
    if (j < 0) return "";
    const a = fs[j];
    const b = fs[i];
    const why =
      a.candidateIds.length !== b.candidateIds.length
        ? "the smaller bundle is listed first."
        : a.costTier !== b.costTier
          ? "the lower cost tier is listed first."
          : "they are listed in a fixed order.";
    return `${b.bundleId} matches ${a.bundleId} on every displayed figure; ${why}`;
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
      stresses: this.stressRequests(),
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
    const metric = metricLabel(p.lens, p.goal.metric);
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
      tieNote: this.tieWith(this.state.finalists, this.state.finalists.indexOf(f)),
      stressLines: this.state.stresses.flatMap((st) => this.stressLines(this.state.mission as ConfirmedMission, st).filter((l) => l.bundleId === bundleId).map((l) => `${st.label}: ${l.text}`)),
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
    } else if (e.event === "reasoning") {
      this.onReasoning(e.data);
    } else if (e.event === "usage") {
      this.set({ steps: [...this.state.steps, { role: e.data.role, model: e.data.model, inputTokens: e.data.inputTokens, outputTokens: e.data.outputTokens, latencyMs: e.data.latencyMs ?? 0 }] });
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

  /** Model reasoning from the server, screened again here; a failing field is blanked and the log says so. */
  private onReasoning(d: StepMetrics & { text: string }): void {
    const v = screenReasoning(d.text);
    if (!v.ok) {
      this.log("validator", reasoningWithheldSentence(v.problems), { model: d.model, errors: ["reasoning_withheld"] });
      return;
    }
    this.log("reasoning", REASONING_LABEL, {
      model: d.model,
      reasoning: { role: d.role, model: d.model, tokensIn: d.inputTokens, tokensOut: d.outputTokens, latencyMs: d.latencyMs, text: v.text },
    });
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

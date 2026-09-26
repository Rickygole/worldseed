/**
 * Agent validator (docs/ARCHITECTURE.md 2.7). Runs in the browser and is re-run on the server.
 *
 * Rules (the `rule` number on every Violation):
 *   1. Output parses against the schema; unknown keys are rejected.
 *   2. Every candidateId is in the catalog, matches the lens, is within maxCostTier and has an
 *      allowed type. Every gazetteer ID exists.
 *   3. Bundles have 1-3 unique candidates, no duplicate bundles, at most 12 evaluated per mission.
 *   4. Round <= 3, the action matches the phase, the per-mission token budget is not exceeded.
 *   5. A model writes no text: its "why" is a rationale selection (kind from a fixed list, optional
 *      catalog focus id) that the application renders (rationale.ts). Anything else is a schema
 *      violation, so free text cannot reach a card or the log.
 *   6. finalize names exactly 3 distinct evaluated bundles and nothing unevaluated.
 *   7. A critic's stress test is a member of the application's closed set (link ids, times of
 *      day: enforced by the schema's enums) and is not one that was already run.
 *   7. On violation: one repair turn, then deterministic search. That is orchestration, done in
 *      lib/server/agentService.ts (repair) and agent/machine.ts (fallback), not here.
 *
 * Violation text never echoes model-supplied strings or key names: a violation carries a rule, a
 * code, an index path and a fixed message. (An echo would put model text into logs, repair prompts
 * and error events.)
 */
import { z } from "zod";
import { stressKey, type StressSpec } from "./stress";
import { candidateRejection, type Catalog, type CatalogConstraints } from "./catalog";
import {
  CritiqueSchema,
  expectedAction,
  MAX_EVALUATED_BUNDLES,
  MAX_ROUNDS,
  mintBundleIds,
  ParsedMissionSchema,
  plannerModelSchemaFor,
  plannerSchemaFor,
  type BundleSpec,
  type ConfirmedMission,
  type CritiqueOutput,
  type FinalizeAction,
  type ParsedMission,
  type PlannerAction,
  type PlannerPhase,
  type ProposeAction,
  type RefineAction,
} from "./tools";

export type RuleNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Violation {
  rule: RuleNumber;
  code: string;
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; violations: Violation[] };

export interface KnownBundle {
  id: string;
  candidateIds: string[];
  evaluated: boolean;
}

export interface TokenBudget {
  inputUsed: number;
  outputUsed: number;
  inputLimit: number;
  outputLimit: number;
}

export interface PlannerContext {
  catalog: Catalog;
  mission: ConfirmedMission;
  phase: PlannerPhase;
  round: number;
  /** Bundles already proposed in this mission and whether the simulator has scored them. */
  known: KnownBundle[];
  /** Bundles the finalists may not include (dropped or vetoed). */
  excludedBundleIds?: ReadonlySet<string>;
  budget?: TokenBudget;
  /** Per-mission cap on evaluated bundles. */
  maxEvaluated?: number;
}

const v = (rule: RuleNumber, code: string, path: string, message: string): Violation => ({ rule, code, path, message });

/** Catalog filter implied by a confirmed mission. */
export function constraintsOf(m: ConfirmedMission): CatalogConstraints {
  return { lens: m.lens, maxCostTier: m.constraints.maxCostTier, types: m.constraints.types };
}

export function bundleKey(candidateIds: readonly string[]): string {
  return [...candidateIds].sort().join("+");
}

/* ----------------------------- shared helpers ----------------------------- */

/** Zod messages for these codes would quote model-supplied key names or values. */
export function safeMessage(i: z.core.$ZodIssue): string {
  if (i.code === "unrecognized_keys") return "unexpected field";
  if (i.code === "invalid_union") return "does not match any allowed shape";
  return i.message.slice(0, 160);
}

export function zodViolations(err: z.ZodError): Violation[] {
  return err.issues.slice(0, 12).map((i) => {
    const code = i.code === "unrecognized_keys" ? "unknown_keys" : "schema";
    return v(1, code, i.path.map((p) => (typeof p === "number" ? String(p) : String(p))).join(".") || "(root)", safeMessage(i));
  });
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): ValidationResult<T> {
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, value: r.data } : { ok: false, violations: zodViolations(r.error) };
}

export function checkTokenBudget(b: TokenBudget | undefined): Violation[] {
  if (!b) return [];
  const out: Violation[] = [];
  if (b.inputUsed > b.inputLimit) {
    out.push(v(4, "token_budget", "(budget)", "per-mission input token budget exceeded"));
  }
  if (b.outputUsed > b.outputLimit) {
    out.push(v(4, "token_budget", "(budget)", "per-mission output token budget exceeded"));
  }
  return out;
}

/** Rule 2 for a single candidate. */
function checkCandidate(catalog: Catalog, k: CatalogConstraints, id: string, path: string): Violation[] {
  const c = catalog.byId.get(id);
  if (!c) return [v(2, "unknown_candidate", path, "candidateId is not in the catalog")];
  const why = candidateRejection(c, k);
  return why ? [v(2, "candidate_not_allowed", path, `candidate ${why}`)] : [];
}

/** Rules 2 and 3 for a set of new bundles. `seen` holds keys of bundles already in play. */
function checkNewBundles(
  ctx: PlannerContext,
  bundles: readonly BundleSpec[],
  pathBase: string,
  takenIds: Set<string>,
  seenKeys: Set<string>,
): Violation[] {
  const out: Violation[] = [];
  bundles.forEach((b, i) => {
    const path = `${pathBase}.${i}`;
    if (takenIds.has(b.id)) out.push(v(3, "duplicate_bundle_id", `${path}.id`, "bundle id is already used"));
    takenIds.add(b.id);
    if (new Set(b.candidateIds).size !== b.candidateIds.length) {
      out.push(v(3, "duplicate_candidate", `${path}.candidateIds`, "a bundle may not repeat a candidate"));
    }
    b.candidateIds.forEach((cid, j) => out.push(...checkCandidate(ctx.catalog, constraintsOf(ctx.mission), cid, `${path}.candidateIds.${j}`)));
    const key = bundleKey(b.candidateIds);
    if (seenKeys.has(key)) out.push(v(3, "duplicate_bundle", path, "this bundle duplicates one already proposed"));
    seenKeys.add(key);
  });
  return out;
}

function knownIds(ctx: PlannerContext): Set<string> {
  return new Set(ctx.known.map((b) => b.id));
}
function knownKeys(ctx: PlannerContext): Set<string> {
  return new Set(ctx.known.map((b) => bundleKey(b.candidateIds)));
}

/* ------------------------------- planner ------------------------------- */

/** Rule 4 and the action allowed for this phase. Shared by both planner entry points. */
function phaseViolations(raw: unknown, ctx: PlannerContext): { violations: Violation[]; expected: ReturnType<typeof expectedAction> } {
  const violations: Violation[] = [];
  if (ctx.round > MAX_ROUNDS || ctx.round < 1) {
    violations.push(v(4, "round_limit", "(round)", `round must be between 1 and ${MAX_ROUNDS}`));
  }
  const expected = expectedAction(ctx.phase, ctx.round);
  const rawAction = raw && typeof raw === "object" ? (raw as { action?: unknown }).action : undefined;
  if (typeof rawAction === "string" && rawAction !== expected) {
    violations.push(v(4, "wrong_action", "action", "the action does not match this turn"));
  }
  violations.push(...checkTokenBudget(ctx.budget));
  return { violations, expected };
}

/**
 * Validates what a MODEL returned. Bundles carry no IDs in this form; on success the result is the
 * same action with application-minted IDs (B1..B12, first unused, in order).
 */
export function validatePlannerOutput(raw: unknown, ctx: PlannerContext): ValidationResult<PlannerAction> {
  const { violations, expected } = phaseViolations(raw, ctx);
  const parsed = parseWith(plannerModelSchemaFor(expected) as z.ZodType<unknown>, raw);
  if (!parsed.ok) return { ok: false, violations: [...violations, ...parsed.violations] };
  const model = parsed.value as PlannerAction | { action: "propose"; bundles: { candidateIds: string[] }[] } | { action: "refine"; add: { candidateIds: string[] }[] };
  const taken = knownIds(ctx);
  let action: PlannerAction;
  if (model.action === "propose") {
    const ids = mintBundleIds(taken, model.bundles.length);
    if (ids.length < model.bundles.length) violations.push(v(3, "too_many_bundles", "bundles", `at most ${MAX_EVALUATED_BUNDLES} bundles may be evaluated per mission`));
    action = { ...model, bundles: model.bundles.map((b, i) => ({ id: ids[i] ?? "B12", candidateIds: b.candidateIds })) } as ProposeAction;
  } else if (model.action === "refine") {
    const ids = mintBundleIds(taken, model.add.length);
    if (ids.length < model.add.length) violations.push(v(3, "too_many_bundles", "add", `at most ${MAX_EVALUATED_BUNDLES} bundles may be evaluated per mission`));
    action = { ...model, add: model.add.map((b, i) => ({ id: ids[i] ?? "B12", candidateIds: b.candidateIds })) } as RefineAction;
  } else {
    action = model as PlannerAction;
  }
  const checked = checkPlannerAction(action, ctx);
  violations.push(...checked.violations);
  return violations.length ? { ok: false, violations } : { ok: true, value: checked.action };
}

/**
 * Validates an action that already has bundle IDs (what the server returns to the browser). The
 * IDs must be exactly the ones the application would mint next, so a hostile or buggy server
 * cannot introduce its own identifiers either.
 */
export function validateMintedPlannerOutput(raw: unknown, ctx: PlannerContext): ValidationResult<PlannerAction> {
  const { violations, expected } = phaseViolations(raw, ctx);
  const parsed = parseWith(plannerSchemaFor(expected) as z.ZodType<PlannerAction>, raw);
  if (!parsed.ok) return { ok: false, violations: [...violations, ...parsed.violations] };
  const action = parsed.value;
  const fresh = action.action === "propose" ? action.bundles : action.action === "refine" ? action.add : [];
  const want = mintBundleIds(knownIds(ctx), fresh.length);
  fresh.forEach((b, i) => {
    if (b.id !== want[i]) violations.push(v(3, "unminted_bundle_id", `${action.action === "propose" ? "bundles" : "add"}.${i}.id`, "bundle id was not assigned by the application"));
  });
  const checked = checkPlannerAction(action, ctx);
  violations.push(...checked.violations);
  return violations.length ? { ok: false, violations } : { ok: true, value: checked.action };
}

interface PlannerChecked {
  violations: Violation[];
  action: PlannerAction;
}

function checkPlannerAction(action: PlannerAction, ctx: PlannerContext): PlannerChecked {
  const out: Violation[] = [];
  const focus = action.rationale.focus;
  if (focus !== undefined) out.push(...checkCandidate(ctx.catalog, constraintsOf(ctx.mission), focus, "rationale.focus"));
  if (action.action === "propose") out.push(...validatePropose(action, ctx));
  else if (action.action === "refine") out.push(...validateRefine(action, ctx));
  else out.push(...validateFinalize(action, ctx));
  return { violations: out, action };
}

function validatePropose(a: ProposeAction, ctx: PlannerContext): Violation[] {
  const out: Violation[] = [];
  const max = ctx.maxEvaluated ?? MAX_EVALUATED_BUNDLES;
  if (ctx.known.length + a.bundles.length > max) {
    out.push(v(3, "too_many_bundles", "bundles", `at most ${max} bundles may be evaluated per mission`));
  }
  out.push(...checkNewBundles(ctx, a.bundles, "bundles", knownIds(ctx), knownKeys(ctx)));
  return out;
}

function validateRefine(a: RefineAction, ctx: PlannerContext): Violation[] {
  const out: Violation[] = [];
  const ids = knownIds(ctx);
  a.keep.forEach((id, i) => {
    if (!ids.has(id)) out.push(v(3, "unknown_bundle", `keep.${i}`, "bundle was never proposed"));
  });
  a.drop.forEach((id, i) => {
    if (!ids.has(id)) out.push(v(3, "unknown_bundle", `drop.${i}`, "bundle was never proposed"));
  });
  const dropSet = new Set(a.drop);
  a.keep.forEach((id, i) => {
    if (dropSet.has(id)) out.push(v(3, "keep_and_drop", `keep.${i}`, "a bundle cannot be both kept and dropped"));
  });
  const max = ctx.maxEvaluated ?? MAX_EVALUATED_BUNDLES;
  if (ctx.known.length + a.add.length > max) {
    out.push(v(3, "too_many_bundles", "add", `at most ${max} bundles may be evaluated per mission`));
  }
  out.push(...checkNewBundles(ctx, a.add, "add", knownIds(ctx), knownKeys(ctx)));
  return out;
}

function validateFinalize(a: FinalizeAction, ctx: PlannerContext): Violation[] {
  const out: Violation[] = [];
  const byId = new Map(ctx.known.map((b) => [b.id, b]));
  const seen = new Set<string>();
  a.finalists.forEach((f, i) => {
    const path = `finalists.${i}`;
    if (seen.has(f.bundleId)) out.push(v(6, "duplicate_finalist", `${path}.bundleId`, "finalist is listed twice"));
    seen.add(f.bundleId);
    const b = byId.get(f.bundleId);
    if (!b) out.push(v(6, "unknown_finalist", `${path}.bundleId`, "finalist was never proposed"));
    else if (!b.evaluated) out.push(v(6, "unevaluated_finalist", `${path}.bundleId`, "finalist has not been evaluated"));
    else if (ctx.excludedBundleIds?.has(f.bundleId)) {
      out.push(v(6, "excluded_finalist", `${path}.bundleId`, "finalist was dropped or vetoed"));
    }
  });
  return out;
}

/* -------------------------------- critic -------------------------------- */

export interface CritiqueContext {
  catalog: Catalog;
  /** Evaluated bundles the critic may mention. */
  known: KnownBundle[];
  /** Stress tests already run in this mission: the critic may not pick one of them again. */
  tried?: readonly StressSpec[];
  budget?: TokenBudget;
}

export function validateCritiqueOutput(raw: unknown, ctx: CritiqueContext): ValidationResult<CritiqueOutput> {
  const violations = checkTokenBudget(ctx.budget);
  const parsed = parseWith(CritiqueSchema, raw);
  if (!parsed.ok) return { ok: false, violations: [...violations, ...parsed.violations] };
  const a = parsed.value;
  const evaluated = new Set(ctx.known.filter((b) => b.evaluated).map((b) => b.id));
  a.concerns.forEach((c, i) => {
    if (!evaluated.has(c.bundleId)) {
      violations.push(v(6, "unknown_bundle", `concerns.${i}.bundleId`, "bundle was not evaluated"));
    }
  });
  (a.veto ?? []).forEach((id, i) => {
    if (!evaluated.has(id)) violations.push(v(6, "unknown_bundle", `veto.${i}`, "bundle was not evaluated"));
  });
  if ((ctx.tried ?? []).some((t) => stressKey(t) === stressKey(a.stress))) {
    violations.push(v(7, "stress_repeated", "stress", "this stress test was already run in this mission"));
  }
  const focus = a.rationale.focus;
  if (focus !== undefined && !ctx.catalog.byId.has(focus)) violations.push(v(2, "unknown_candidate", "rationale.focus", "candidateId is not in the catalog"));
  return violations.length ? { ok: false, violations } : { ok: true, value: a };
}

/* -------------------------------- parser -------------------------------- */

export interface ParseContext {
  catalog: Catalog;
  budget?: TokenBudget;
}

export function validateParseOutput(raw: unknown, ctx: ParseContext): ValidationResult<ParsedMission> {
  const violations = checkTokenBudget(ctx.budget);
  const parsed = parseWith(ParsedMissionSchema, raw);
  if (!parsed.ok) return { ok: false, violations: [...violations, ...parsed.violations] };
  const m = parsed.value;
  m.constraints.areas.forEach((id, i) => {
    if (!ctx.catalog.gazetteerById.has(id)) {
      violations.push(v(2, "unknown_gazetteer", `constraints.areas.${i}`, "gazetteer id does not exist"));
    }
  });
  if (new Set(m.constraints.areas).size !== m.constraints.areas.length) {
    violations.push(v(2, "duplicate_area", "constraints.areas", "areas must be unique"));
  }
  return violations.length ? { ok: false, violations } : { ok: true, value: m };
}

/** Human-readable list for logs and the repair prompt. */
export function describeViolations(vs: readonly Violation[]): string[] {
  return vs.map((x) => `rule ${x.rule} (${x.code}) at ${x.path}: ${x.message}`);
}

/**
 * Bundles a finalize turn may not pick. Dropped and vetoed bundles are excluded only while at
 * least three evaluated bundles remain, so a finalize turn is always possible.
 */
export function computeExcluded(
  evaluatedIds: readonly string[],
  dropped: readonly string[],
  veto: readonly string[],
): Set<string> {
  const enough = (ex: Set<string>) => evaluatedIds.filter((id) => !ex.has(id)).length >= 3;
  const both = new Set([...dropped, ...veto]);
  if (enough(both)) return both;
  const onlyDropped = new Set(dropped);
  if (enough(onlyDropped)) return onlyDropped;
  return new Set();
}

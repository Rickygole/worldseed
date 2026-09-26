/**
 * Agent validator (docs/ARCHITECTURE.md 2.7). Runs in the browser and is re-run on the server.
 *
 * Rules (the `rule` number on every Violation):
 *   1. Output parses against the schema; unknown keys are rejected.
 *   2. Every candidateId is in the catalog, matches the lens, is within maxCostTier and has an
 *      allowed type. Every gazetteer ID exists.
 *   3. Bundles have 1-3 unique candidates, no duplicate bundles, at most 12 evaluated per mission.
 *   4. Round <= 3, the action matches the phase, the per-mission token budget is not exceeded.
 *   5. No numbers in model prose (prose.ts).
 *   6. finalize names exactly 3 distinct evaluated bundles and nothing unevaluated.
 *   7. On violation: one repair turn, then deterministic search. That is orchestration, done in
 *      lib/server/agentService.ts (repair) and agent/machine.ts (fallback), not here.
 */
import { z } from "zod";
import { candidateRejection, type Catalog, type CatalogConstraints } from "./catalog";
import { proseIssues } from "./prose";
import {
  CritiqueSchema,
  expectedAction,
  MAX_EVALUATED_BUNDLES,
  MAX_ROUNDS,
  NarrationSchema,
  ParsedMissionSchema,
  plannerSchemaFor,
  type BundleSpec,
  type ConfirmedMission,
  type CritiqueOutput,
  type FinalizeAction,
  type NarrationOutput,
  type ParsedMission,
  type PlannerAction,
  type PlannerPhase,
  type ProposeAction,
  type RefineAction,
} from "./tools";

export type RuleNumber = 1 | 2 | 3 | 4 | 5 | 6;

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

/** Short, safe echo of model-supplied text for error messages. */
function show(s: unknown): string {
  return JSON.stringify(String(s).slice(0, 48));
}

/** Catalog filter implied by a confirmed mission. */
export function constraintsOf(m: ConfirmedMission): CatalogConstraints {
  return { lens: m.lens, maxCostTier: m.constraints.maxCostTier, types: m.constraints.types };
}

export function bundleKey(candidateIds: readonly string[]): string {
  return [...candidateIds].sort().join("+");
}

/* ----------------------------- shared helpers ----------------------------- */

function zodViolations(err: z.ZodError): Violation[] {
  return err.issues.slice(0, 12).map((i) => {
    const code = i.code === "unrecognized_keys" ? "unknown_keys" : "schema";
    return v(1, code, i.path.join(".") || "(root)", i.message);
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

export function checkProse(path: string, text: string, allowedTokens: readonly string[]): Violation[] {
  return proseIssues(text, { allowedTokens }).map((i) => v(5, i.code, path, i.message));
}

function proseTokens(ctx: { catalog: Catalog; known?: readonly KnownBundle[] }, extra: readonly string[] = []): string[] {
  const t = [...ctx.catalog.byId.keys(), ...extra];
  for (const b of ctx.known ?? []) t.push(b.id);
  return t;
}

/** Rule 2 for a single candidate. */
function checkCandidate(catalog: Catalog, k: CatalogConstraints, id: string, path: string): Violation[] {
  const c = catalog.byId.get(id);
  if (!c) return [v(2, "unknown_candidate", path, `candidateId ${show(id)} is not in the catalog`)];
  const why = candidateRejection(c, k);
  return why ? [v(2, "candidate_not_allowed", path, `candidate ${show(id)} ${why}`)] : [];
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
    if (takenIds.has(b.id)) out.push(v(3, "duplicate_bundle_id", `${path}.id`, `bundle id ${show(b.id)} is already used`));
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

export function validatePlannerOutput(raw: unknown, ctx: PlannerContext): ValidationResult<PlannerAction> {
  const violations: Violation[] = [];

  // Rule 4: round limit and the action allowed for this phase.
  if (ctx.round > MAX_ROUNDS || ctx.round < 1) {
    violations.push(v(4, "round_limit", "(round)", `round must be between 1 and ${MAX_ROUNDS}`));
  }
  const expected = expectedAction(ctx.phase, ctx.round);
  const rawAction = raw && typeof raw === "object" ? (raw as { action?: unknown }).action : undefined;
  if (typeof rawAction === "string" && rawAction !== expected) {
    violations.push(v(4, "wrong_action", "action", `this turn requires action ${show(expected)}, got ${show(rawAction)}`));
  }
  violations.push(...checkTokenBudget(ctx.budget));

  // Rule 1: schema.
  const parsed = parseWith(plannerSchemaFor(expected) as z.ZodType<PlannerAction>, raw);
  if (!parsed.ok) return { ok: false, violations: [...violations, ...parsed.violations] };
  const action = parsed.value;

  const tokens = proseTokens(ctx);
  violations.push(...checkProse("log_sentence", action.log_sentence, tokens));

  if (action.action === "propose") violations.push(...validatePropose(action, ctx, tokens));
  else if (action.action === "refine") violations.push(...validateRefine(action, ctx));
  else violations.push(...validateFinalize(action, ctx, tokens));

  return violations.length ? { ok: false, violations } : { ok: true, value: action };
}

function validatePropose(a: ProposeAction, ctx: PlannerContext, tokens: string[]): Violation[] {
  const out = checkProse("hypothesis", a.hypothesis, tokens);
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
    if (!ids.has(id)) out.push(v(3, "unknown_bundle", `keep.${i}`, `bundle ${show(id)} was never proposed`));
  });
  a.drop.forEach((id, i) => {
    if (!ids.has(id)) out.push(v(3, "unknown_bundle", `drop.${i}`, `bundle ${show(id)} was never proposed`));
  });
  const dropSet = new Set(a.drop);
  a.keep.forEach((id, i) => {
    if (dropSet.has(id)) out.push(v(3, "keep_and_drop", `keep.${i}`, `bundle ${show(id)} cannot be both kept and dropped`));
  });
  const max = ctx.maxEvaluated ?? MAX_EVALUATED_BUNDLES;
  if (ctx.known.length + a.add.length > max) {
    out.push(v(3, "too_many_bundles", "add", `at most ${max} bundles may be evaluated per mission`));
  }
  out.push(...checkNewBundles(ctx, a.add, "add", knownIds(ctx), knownKeys(ctx)));
  return out;
}

function validateFinalize(a: FinalizeAction, ctx: PlannerContext, tokens: string[]): Violation[] {
  const out: Violation[] = [];
  const byId = new Map(ctx.known.map((b) => [b.id, b]));
  const seen = new Set<string>();
  a.finalists.forEach((f, i) => {
    const path = `finalists.${i}`;
    out.push(...checkProse(`${path}.tradeoff`, f.tradeoff, tokens));
    if (seen.has(f.bundleId)) out.push(v(6, "duplicate_finalist", `${path}.bundleId`, `finalist ${show(f.bundleId)} is listed twice`));
    seen.add(f.bundleId);
    const b = byId.get(f.bundleId);
    if (!b) out.push(v(6, "unknown_finalist", `${path}.bundleId`, `finalist ${show(f.bundleId)} was never proposed`));
    else if (!b.evaluated) out.push(v(6, "unevaluated_finalist", `${path}.bundleId`, `finalist ${show(f.bundleId)} has not been evaluated`));
    else if (ctx.excludedBundleIds?.has(f.bundleId)) {
      out.push(v(6, "excluded_finalist", `${path}.bundleId`, `finalist ${show(f.bundleId)} was dropped or vetoed`));
    }
  });
  return out;
}

/* -------------------------------- critic -------------------------------- */

export interface CritiqueContext {
  catalog: Catalog;
  /** Evaluated bundles the critic may mention. */
  known: KnownBundle[];
  budget?: TokenBudget;
}

export function validateCritiqueOutput(raw: unknown, ctx: CritiqueContext): ValidationResult<CritiqueOutput> {
  const violations = checkTokenBudget(ctx.budget);
  const parsed = parseWith(CritiqueSchema, raw);
  if (!parsed.ok) return { ok: false, violations: [...violations, ...parsed.violations] };
  const a = parsed.value;
  const tokens = proseTokens(ctx);
  const evaluated = new Set(ctx.known.filter((b) => b.evaluated).map((b) => b.id));
  violations.push(...checkProse("log_sentence", a.log_sentence, tokens));
  a.concerns.forEach((c, i) => {
    violations.push(...checkProse(`concerns.${i}.note`, c.note, tokens));
    if (!evaluated.has(c.bundleId)) {
      violations.push(v(6, "unknown_bundle", `concerns.${i}.bundleId`, `bundle ${show(c.bundleId)} was not evaluated`));
    }
  });
  (a.veto ?? []).forEach((id, i) => {
    if (!evaluated.has(id)) violations.push(v(6, "unknown_bundle", `veto.${i}`, `bundle ${show(id)} was not evaluated`));
  });
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
  violations.push(...checkProse("log_sentence", m.log_sentence, [...ctx.catalog.gazetteerById.keys()]));
  m.constraints.areas.forEach((id, i) => {
    if (!ctx.catalog.gazetteerById.has(id)) {
      violations.push(v(2, "unknown_gazetteer", `constraints.areas.${i}`, `gazetteer id ${show(id)} does not exist`));
    }
  });
  if (new Set(m.constraints.areas).size !== m.constraints.areas.length) {
    violations.push(v(2, "duplicate_area", "constraints.areas", "areas must be unique"));
  }
  return violations.length ? { ok: false, violations } : { ok: true, value: m };
}

/* ------------------------------- narrator ------------------------------- */

export interface NarrationContext {
  catalog: Catalog;
  finalistIds: readonly string[];
  budget?: TokenBudget;
}

export function validateNarrationOutput(raw: unknown, ctx: NarrationContext): ValidationResult<NarrationOutput> {
  const violations = checkTokenBudget(ctx.budget);
  const parsed = parseWith(NarrationSchema, raw);
  if (!parsed.ok) return { ok: false, violations: [...violations, ...parsed.violations] };
  const n = parsed.value;
  const allowed = new Set(ctx.finalistIds);
  const tokens = proseTokens(ctx, ctx.finalistIds);
  const seen = new Set<string>();
  n.items.forEach((it, i) => {
    if (!allowed.has(it.bundleId)) violations.push(v(6, "unknown_bundle", `items.${i}.bundleId`, `bundle ${show(it.bundleId)} is not a finalist`));
    if (seen.has(it.bundleId)) violations.push(v(6, "duplicate_finalist", `items.${i}.bundleId`, `bundle ${show(it.bundleId)} is narrated twice`));
    seen.add(it.bundleId);
    violations.push(...checkProse(`items.${i}.headline`, it.headline, tokens));
    violations.push(...checkProse(`items.${i}.body`, it.body, tokens));
  });
  if (seen.size !== allowed.size) violations.push(v(6, "missing_finalist", "items", "every finalist must be narrated exactly once"));
  return violations.length ? { ok: false, violations } : { ok: true, value: n };
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

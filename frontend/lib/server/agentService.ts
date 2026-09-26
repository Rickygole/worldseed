/**
 * Server pipeline for the four agent routes. One shared structured-call routine does all the
 * guarding: mission and daily budgets, model fallback chain, JSON extraction, validation, ONE
 * repair turn, then a structured fallback. Every rejection and fallback is emitted as a `log`
 * event so it lands in the decision log.
 *
 * No endpoint accepts prompt text. Bodies are zod-validated structured payloads and prompts come
 * from lib/server/prompts/*.
 */
import { z } from "zod";
import {
  bundleCostTier,
  candidateRejection,
  eligibleCandidates,
  promptView,
  type Catalog,
} from "../agent/catalog";
import { proseIssues } from "../agent/prose";
import {
  CritiqueRequestSchema,
  NarrateRequestSchema,
  ParseRequestSchema,
  PlanRequestSchema,
  UI_MESSAGES,
  type CritiqueRequest,
  type FallbackNext,
  type FallbackReason,
  type NarrateRequest,
  type Outcome,
  type ParseRequest,
  type PlanRequest,
} from "../agent/protocol";
import {
  CritiqueSchema,
  expectedAction,
  MAX_ROUNDS,
  NarrationSchema,
  ParsedMissionSchema,
  plannerSchemaFor,
  toJsonSchema,
  type EvaluationRow,
} from "../agent/tools";
import {
  computeExcluded,
  constraintsOf,
  describeViolations,
  validateCritiqueOutput,
  validateNarrationOutput,
  validateParseOutput,
  validatePlannerOutput,
  type KnownBundle,
  type TokenBudget,
  type ValidationResult,
} from "../agent/validator";
import type { ServerConfig } from "./config";
import { costUsd, type ModelResolver, type Role } from "./models";
import { buildCritiqueMessages, CRITIQUE_SCHEMA_NAME } from "./prompts/critique";
import { buildNarrateMessages, NARRATE_SCHEMA_NAME } from "./prompts/narrate";
import { buildParseMessages, PARSE_SCHEMA_NAME } from "./prompts/parse";
import { buildPlanMessages, PLAN_SCHEMA_NAME } from "./prompts/plan";
import { clientIp, missionRules, type DailyBudget, type MissionRecord, type MissionStore, type RateLimiter } from "./ratelimit";
import { sseResponse, type Emit } from "./sse";
import { callRole, extractJson, ProviderError, type ChatMessage, type LlmProvider } from "./tokenfactory";

export interface AgentDeps {
  config: ServerConfig;
  provider: LlmProvider | null;
  resolver: ModelResolver;
  limiter: RateLimiter;
  budget: DailyBudget;
  missions: MissionStore;
  loadCatalog: () => Promise<Catalog>;
  now: () => number;
}

const MAX_BODY_BYTES = 64 * 1024;
const MIN_OUTPUT_TOKENS = 300;
const estimateTokens = (messages: readonly ChatMessage[]): number =>
  Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4) + 16;

/* --------------------------------- HTTP glue -------------------------------- */

export function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function invalid(issues: { path: string; message: string }[]): Response {
  return json({ error: "invalid_request", issues: issues.slice(0, 12) }, 400);
}

export async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<{ ok: true; value: T } | { ok: false; res: Response }> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, res: invalid([{ path: "(body)", message: "unreadable body" }]) };
  }
  if (text.length > MAX_BODY_BYTES) return { ok: false, res: json({ error: "payload_too_large" }, 413) };
  let raw: unknown;
  try {
    raw = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return { ok: false, res: invalid([{ path: "(body)", message: "body is not valid JSON" }]) };
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    return { ok: false, res: invalid(r.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message }))) };
  }
  return { ok: true, value: r.data };
}

type Fallback = Extract<Outcome<never>, { status: "fallback" }>;
const fallback = (reason: FallbackReason, message: string, next: FallbackNext, retryAfterS?: number): Fallback => ({
  status: "fallback",
  reason,
  message,
  next,
  ...(retryAfterS !== undefined ? { retryAfterS } : {}),
});

/** Mission admission: a new mission ID costs one unit of the per-IP quota; known IDs are free. */
async function admit(deps: AgentDeps, missionId: string, ip: string): Promise<{ rec: MissionRecord } | { blocked: Response }> {
  const known = deps.missions.get(missionId);
  if (known) return { rec: known };
  const r = await deps.limiter.consume(`ip:${ip}`, missionRules(deps.config.ipMissionsPerHour, deps.config.ipMissionsPerDay));
  if (!r.allowed) {
    const o = fallback(
      "rate_limited",
      `Mission limit reached for this connection. Try again in about ${Math.ceil(r.retryAfterS / 60)} minutes, or use the recorded run.`,
      "recorded_tour",
      r.retryAfterS,
    );
    return { blocked: json(o, 429, { "retry-after": String(r.retryAfterS) }) };
  }
  return { rec: deps.missions.create(missionId, ip) };
}

/* ------------------------------ structured call ----------------------------- */

export interface StructuredSpec<T> {
  deps: AgentDeps;
  emit: Emit;
  rec: MissionRecord;
  role: Role;
  toolName: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  messages: ChatMessage[];
  maxOut: number;
  deadlineAt: number;
  signal?: AbortSignal;
  validate: (raw: unknown, budget: TokenBudget) => ValidationResult<T>;
}

function fail(emit: Emit, code: string, o: Fallback): Fallback {
  emit({ event: "error", data: { code, message: o.message } });
  return o;
}

function providerFallback(emit: Emit, e: ProviderError): Fallback {
  if (e.kind === "auth" || e.kind === "model_not_found") {
    return fail(emit, e.kind, fallback("planner_unavailable", UI_MESSAGES.plannerUnavailable, "deterministic_search"));
  }
  if (e.kind === "rate_limited") {
    return fail(
      emit,
      "provider_rate_limited",
      fallback("upstream_error", "The model provider is rate limiting requests right now. Deterministic search (not AI) can continue.", "deterministic_search", e.retryAfterS),
    );
  }
  if (e.kind === "timeout") {
    return fail(emit, "timeout", fallback("upstream_error", "The model did not answer in time. Deterministic search (not AI) can continue.", "deterministic_search"));
  }
  return fail(emit, e.kind, fallback("upstream_error", "The model provider could not be reached. Deterministic search (not AI) can continue.", "deterministic_search"));
}

export async function runStructured<T>(s: StructuredSpec<T>): Promise<Outcome<T>> {
  const { deps, emit, rec } = s;
  const models = await deps.resolver.resolve(s.role);
  if (!deps.provider || models.length === 0) {
    return fail(emit, "planner_unavailable", fallback("planner_unavailable", UI_MESSAGES.plannerUnavailable, "deterministic_search"));
  }
  emit({ event: "status", data: { phase: s.toolName, message: "Asking the model.", model: models[0] } });

  let messages = s.messages;
  let repaired = false;
  const total = { inputTokens: 0, outputTokens: 0 };

  for (let attempt = 0; attempt < 2; attempt++) {
    const limitIn = deps.config.missionInputTokens;
    const limitOut = deps.config.missionOutputTokens;
    const estIn = estimateTokens(messages);
    const remOut = limitOut - rec.outputTokens;
    if (rec.inputTokens + estIn > limitIn || remOut < MIN_OUTPUT_TOKENS) {
      return fail(emit, "mission_budget_exhausted", fallback("mission_budget_exhausted", "This mission has used its AI token budget. Deterministic search (not AI) can continue.", "deterministic_search"));
    }
    const maxTokens = Math.min(s.maxOut, remOut);
    const reservation = await deps.budget.reserve(costUsd(models[0], estIn, maxTokens));
    if (!reservation) {
      return fail(emit, "budget_exhausted", fallback("budget_exhausted", UI_MESSAGES.budgetExhausted, "recorded_tour"));
    }

    let res;
    try {
      res = await callRole(
        deps.provider,
        models,
        { messages, schemaName: s.schemaName, jsonSchema: s.jsonSchema, maxTokens, timeoutMs: deps.config.llmTimeoutMs, deadlineAt: s.deadlineAt, signal: s.signal },
        deps.now,
      );
    } catch (e) {
      await deps.budget.settle(reservation, 0);
      return providerFallback(emit, e instanceof ProviderError ? e : new ProviderError("upstream", "unexpected error"));
    }

    // Trust reported usage, but never let a missing count make a call free.
    const inTok = res.usage.inputTokens || estIn;
    const outTok = res.usage.outputTokens || Math.ceil(res.text.length / 4);
    await deps.budget.settle(reservation, costUsd(res.model, inTok, outTok));
    rec.inputTokens += inTok;
    rec.outputTokens += outTok;
    total.inputTokens += inTok;
    total.outputTokens += outTok;
    emit({
      event: "usage",
      data: {
        role: s.role,
        model: res.model,
        inputTokens: inTok,
        outputTokens: outTok,
        mission: { inputTokens: rec.inputTokens, outputTokens: rec.outputTokens, limitIn, limitOut },
      },
    });
    for (const sk of res.skipped) {
      emit({ event: "log", data: { kind: "info", sentence: `Model ${sk.model} was skipped (${sk.kind}); the next model in the chain was used.`, code: sk.kind } });
    }

    const parsed = extractJson(res.text);
    const budget: TokenBudget = { inputUsed: rec.inputTokens, outputUsed: rec.outputTokens, inputLimit: limitIn, outputLimit: limitOut };
    const verdict: ValidationResult<T> = parsed.ok
      ? s.validate(parsed.value, budget)
      : { ok: false, violations: [{ rule: 1, code: "not_json", path: "(root)", message: parsed.error }] };

    if (verdict.ok) {
      emit({ event: "tool_call", data: { name: s.toolName, args: verdict.value, model: res.model, repaired } });
      return { status: "ok", result: verdict.value, model: res.model, usage: total, repaired };
    }

    const errors = describeViolations(verdict.violations);
    if (attempt === 0) {
      emit({
        event: "log",
        data: { kind: "validator", sentence: "Model output was rejected by the validator; asking once for a corrected answer.", errors, model: res.model },
      });
      repaired = true;
      messages = [
        ...s.messages,
        { role: "assistant", content: res.text.slice(0, 4000) },
        {
          role: "user",
          content: `Your previous reply was rejected by the validator:\n${errors.map((x) => `- ${x}`).join("\n")}\nReturn a corrected JSON object only, following every rule in the system message. Cite figures only as placeholders.`,
        },
      ];
      continue;
    }
    emit({
      event: "log",
      data: { kind: "fallback", sentence: UI_MESSAGES.outputRejected, errors, code: "output_rejected", model: res.model },
    });
    return fallback("output_rejected", UI_MESSAGES.outputRejected, "deterministic_search");
  }
  return fallback("output_rejected", UI_MESSAGES.outputRejected, "deterministic_search");
}

/* ------------------------------- shared checks ------------------------------ */

type Issue = { path: string; message: string };

/** Defense in depth: history sent by the client is re-checked against the catalog and mission. */
function checkHistory(
  catalog: Catalog,
  mission: PlanRequest["mission"],
  bundles: readonly { id: string; candidateIds: string[] }[],
  rows: readonly EvaluationRow[],
): Issue[] {
  const issues: Issue[] = [];
  const k = constraintsOf(mission);
  const scan = (list: readonly { candidateIds: string[] }[], base: string) =>
    list.forEach((b, i) =>
      b.candidateIds.forEach((id, j) => {
        const c = catalog.byId.get(id);
        if (!c) issues.push({ path: `${base}.${i}.candidateIds.${j}`, message: "candidate is not in the catalog" });
        else {
          const why = candidateRejection(c, k);
          if (why) issues.push({ path: `${base}.${i}.candidateIds.${j}`, message: `candidate ${why}` });
        }
      }),
    );
  scan(bundles, "bundles");
  scan(rows, "evaluations");
  const ids = new Set(rows.map((r) => r.bundleId));
  if (ids.size !== rows.length) issues.push({ path: "evaluations", message: "duplicate bundle ids" });
  const bundleIds = new Set(bundles.map((b) => b.id));
  if (bundleIds.size !== bundles.length) issues.push({ path: "bundles", message: "duplicate bundle ids" });
  return issues;
}

/** Recomputes the cost tier from the catalog so the model never sees a client-supplied tier. */
const trustedRows = (catalog: Catalog, rows: readonly EvaluationRow[]): EvaluationRow[] =>
  rows.map((r) => ({ ...r, costTier: bundleCostTier(catalog, r.candidateIds) }));

async function catalogOr(deps: AgentDeps, emit: Emit): Promise<Catalog | Fallback> {
  try {
    return await deps.loadCatalog();
  } catch {
    return fail(emit, "catalog_unavailable", fallback("catalog_unavailable", UI_MESSAGES.plannerUnavailable, "deterministic_search"));
  }
}
const isFallback = (x: Catalog | Fallback): x is Fallback => "status" in x;

function done(emit: Emit, o: Outcome<unknown>): void {
  emit({ event: "done", data: o });
}

/* ---------------------------------- handlers -------------------------------- */

type Handler = (request: Request, deps: AgentDeps) => Promise<Response>;

export const handleParse: Handler = async (request, deps) => {
  const body = await readBody<ParseRequest>(request, ParseRequestSchema);
  if (!body.ok) return body.res;
  const adm = await admit(deps, body.value.missionId, clientIp(request.headers));
  if ("blocked" in adm) return adm.blocked;
  const deadlineAt = deps.now() + deps.config.routeDeadlineMs;
  return sseResponse(async (emit) => {
    const catalog = await catalogOr(deps, emit);
    if (isFallback(catalog)) return done(emit, catalog);
    const jsonSchema = toJsonSchema(ParsedMissionSchema);
    done(
      emit,
      await runStructured({
        deps, emit, rec: adm.rec, role: "parser", toolName: "parse", schemaName: PARSE_SCHEMA_NAME, jsonSchema,
        messages: buildParseMessages(catalog, body.value.text, jsonSchema),
        maxOut: 700, deadlineAt, signal: request.signal,
        validate: (raw, budget) => validateParseOutput(raw, { catalog, budget }),
      }),
    );
  });
};

function knownFrom(bundles: readonly { id: string; candidateIds: string[] }[], rows: readonly EvaluationRow[]): KnownBundle[] {
  const scored = new Set(rows.map((r) => r.bundleId));
  const out = new Map<string, KnownBundle>();
  for (const b of bundles) out.set(b.id, { id: b.id, candidateIds: b.candidateIds, evaluated: scored.has(b.id) });
  for (const r of rows) if (!out.has(r.bundleId)) out.set(r.bundleId, { id: r.bundleId, candidateIds: r.candidateIds, evaluated: true });
  return [...out.values()];
}

export const handlePlan: Handler = async (request, deps) => {
  const body = await readBody<PlanRequest>(request, PlanRequestSchema);
  if (!body.ok) return body.res;
  const req = body.value;
  const adm = await admit(deps, req.missionId, clientIp(request.headers));
  if ("blocked" in adm) return adm.blocked;
  const deadlineAt = deps.now() + deps.config.routeDeadlineMs;
  return sseResponse(async (emit) => {
    const catalog = await catalogOr(deps, emit);
    if (isFallback(catalog)) return done(emit, catalog);

    const issues = checkHistory(catalog, req.mission, req.bundles, req.evaluations);
    const action = expectedAction(req.phase, req.round);
    if (req.phase === "finalize" && req.evaluations.length < 3) issues.push({ path: "evaluations", message: "finalize needs at least three evaluated bundles" });
    if (req.phase === "search" && req.round > 1 && req.evaluations.length === 0) issues.push({ path: "evaluations", message: "refine needs evaluated bundles" });
    if (issues.length > 0) {
      emit({ event: "error", data: { code: "invalid_request", message: issues[0].message } });
      return done(emit, fallback("output_rejected", "The planning request was inconsistent and was not sent to a model.", "deterministic_search"));
    }

    // Rounds: 3 search rounds plus one finalize turn per mission. Re-asking the same turn is fine.
    const turn = `${req.phase}:${req.round}`;
    if (!adm.rec.turns.has(turn) && adm.rec.turns.size >= MAX_ROUNDS + 1) {
      return done(emit, fail(emit, "round_limit", fallback("round_limit", "This mission has used all of its planning rounds.", "deterministic_search")));
    }
    adm.rec.turns.add(turn);

    const eligible = eligibleCandidates(catalog, constraintsOf(req.mission));
    if (eligible.length === 0) {
      return done(emit, fail(emit, "no_eligible_candidates", fallback("catalog_unavailable", "No catalog intervention fits these constraints.", "deterministic_search")));
    }
    const rows = trustedRows(catalog, req.evaluations);
    const known = knownFrom(req.bundles, rows);
    const excluded = req.phase === "finalize" ? computeExcluded(rows.map((r) => r.bundleId), req.dropped, req.critique?.veto ?? []) : new Set<string>();
    const ids = eligible.map((c) => c.id) as [string, ...string[]];
    const jsonSchema = toJsonSchema(plannerSchemaFor(action, z.enum(ids)));

    done(
      emit,
      await runStructured({
        deps, emit, rec: adm.rec, role: "planner", toolName: action, schemaName: PLAN_SCHEMA_NAME, jsonSchema,
        messages: buildPlanMessages({ req, action, eligible: eligible.map(promptView), rows, baseline: req.baseline, excluded, jsonSchema }),
        maxOut: 1800, deadlineAt, signal: request.signal,
        validate: (raw, budget) =>
          validatePlannerOutput(raw, { catalog, mission: req.mission, phase: req.phase, round: req.round, known, excludedBundleIds: excluded, budget }),
      }),
    );
  });
};

function usedViews(catalog: Catalog, rows: readonly EvaluationRow[]) {
  const ids = new Set(rows.flatMap((r) => r.candidateIds));
  return [...ids].map((id) => catalog.byId.get(id)).filter((c) => c !== undefined).map(promptView);
}

export const handleCritique: Handler = async (request, deps) => {
  const body = await readBody<CritiqueRequest>(request, CritiqueRequestSchema);
  if (!body.ok) return body.res;
  const req = body.value;
  const adm = await admit(deps, req.missionId, clientIp(request.headers));
  if ("blocked" in adm) return adm.blocked;
  const deadlineAt = deps.now() + deps.config.routeDeadlineMs;
  return sseResponse(async (emit) => {
    const catalog = await catalogOr(deps, emit);
    if (isFallback(catalog)) return done(emit, catalog);
    const issues = checkHistory(catalog, req.mission, [], req.evaluations);
    if (issues.length > 0) {
      emit({ event: "error", data: { code: "invalid_request", message: issues[0].message } });
      return done(emit, fallback("output_rejected", "The critique request was inconsistent and was not sent to a model.", "deterministic_search"));
    }
    const rows = trustedRows(catalog, req.evaluations);
    const known = knownFrom([], rows);
    const jsonSchema = toJsonSchema(CritiqueSchema);
    done(
      emit,
      await runStructured({
        deps, emit, rec: adm.rec, role: "critic", toolName: "critique", schemaName: CRITIQUE_SCHEMA_NAME, jsonSchema,
        messages: buildCritiqueMessages({ req, used: usedViews(catalog, rows), rows, baseline: req.baseline, jsonSchema }),
        maxOut: 1200, deadlineAt, signal: request.signal,
        validate: (raw, budget) => validateCritiqueOutput(raw, { catalog, known, budget }),
      }),
    );
  });
};

export const handleNarrate: Handler = async (request, deps) => {
  const body = await readBody<NarrateRequest>(request, NarrateRequestSchema);
  if (!body.ok) return body.res;
  const req = body.value;
  // Finalist tradeoffs come from the client and go into a prompt, so they get the prose check too.
  const proseErrors = req.finalists.flatMap((f, i) =>
    proseIssues(f.tradeoff, { allowedTokens: [f.bundleId] }).map((p) => ({ path: `finalists.${i}.tradeoff`, message: p.message })),
  );
  if (proseErrors.length > 0) return invalid(proseErrors);
  const adm = await admit(deps, req.missionId, clientIp(request.headers));
  if ("blocked" in adm) return adm.blocked;
  const deadlineAt = deps.now() + deps.config.routeDeadlineMs;
  return sseResponse(async (emit) => {
    const catalog = await catalogOr(deps, emit);
    if (isFallback(catalog)) return done(emit, catalog);
    const issues = checkHistory(catalog, req.mission, [], req.evaluations);
    const scored = new Set(req.evaluations.map((r) => r.bundleId));
    req.finalists.forEach((f, i) => {
      if (!scored.has(f.bundleId)) issues.push({ path: `finalists.${i}.bundleId`, message: "finalist was not evaluated" });
    });
    if (new Set(req.finalists.map((f) => f.bundleId)).size !== 3) issues.push({ path: "finalists", message: "finalists must be distinct" });
    if (issues.length > 0) {
      emit({ event: "error", data: { code: "invalid_request", message: issues[0].message } });
      return done(emit, fallback("output_rejected", "The narration request was inconsistent and was not sent to a model.", "deterministic_search"));
    }
    const rows = trustedRows(catalog, req.evaluations);
    const jsonSchema = toJsonSchema(NarrationSchema);
    done(
      emit,
      await runStructured({
        deps, emit, rec: adm.rec, role: "narrator", toolName: "narrate", schemaName: NARRATE_SCHEMA_NAME, jsonSchema,
        messages: buildNarrateMessages({ req, used: usedViews(catalog, rows), rows, baseline: req.baseline, jsonSchema }),
        maxOut: 1200, deadlineAt, signal: request.signal,
        validate: (raw, budget) => validateNarrationOutput(raw, { catalog, finalistIds: req.finalists.map((f) => f.bundleId), budget }),
      }),
    );
  });
};


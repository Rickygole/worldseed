/**
 * Server pipeline for the four agent routes.
 *
 * Every route runs the same steps, in this order:
 *   1. guardPost: application/json only, cross-site requests refused.
 *   2. Body validation (zod, strict). No endpoint accepts prompt text.
 *   3. preflight: kill switch, provider, listed model, catalog, daily ceiling, protection store.
 *      An outage answers "AI planner unavailable" WITHOUT charging the visitor's quota.
 *   4. Request-level checks (history, areas against the gazetteer) before any quota is charged.
 *   5. begin: per-client quota for a new (mission, client) pair (increment then compare, check-and-set
 *      record), one in-flight request per mission, per-route turn caps.
 *   6. runStructured: one shared routine. Each upstream ATTEMPT reserves its mission tokens, call
 *      count and worst-case dollars BEFORE it is sent and settles afterwards (failures keep at least
 *      the input estimate). At most three attempts per request, model chain plus one repair turn,
 *      JSON extraction, validation, then a structured fallback. Provider 429 pauses further calls.
 *   7. The mission lock is released, then `done` is sent.
 * Every rejection and fallback is emitted as a `log` event so it lands in the decision log; error
 * text never echoes model or client text.
 */
import { z } from "zod";
import {
  bundleCostTier,
  candidateRejection,
  eligibleCandidates,
  promptView,
  type Catalog,
} from "../agent/catalog";
import {
  CritiqueRequestSchema,
  NarrateRequestSchema,
  ParseRequestSchema,
  PlanRequestSchema,
  UI_MESSAGES,
  outputRejectedMessage,
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
  NarrationSchema,
  ParsedMissionSchema,
  plannerModelSchemaFor,
  toJsonSchema,
  type EvaluationRow,
} from "../agent/tools";
import {
  computeExcluded,
  constraintsOf,
  describeViolations,
  validateCritiqueOutput,
  safeMessage,
  validateNarrationOutput,
  validateParseOutput,
  validatePlannerOutput,
  type KnownBundle,
  type TokenBudget,
  type ValidationResult,
} from "../agent/validator";
import type { ServerConfig } from "./config";
import { logEvent, ipTag } from "./log";
import { TURN_LIMITS, type MissionAccount, type MissionLedger, type MissionReservation } from "./missions";
import { costUsd, type ModelResolver, type Role } from "./models";
import { buildCritiqueMessages, CRITIQUE_SCHEMA_NAME } from "./prompts/critique";
import { buildNarrateMessages, NARRATE_SCHEMA_NAME } from "./prompts/narrate";
import { buildParseMessages, PARSE_SCHEMA_NAME } from "./prompts/parse";
import { buildPlanMessages, PLAN_SCHEMA_NAME } from "./prompts/plan";
import {
  clientIp,
  ipKey,
  missionRules,
  type BudgetReservation,
  type DailyBudget,
  type FrontDoor,
  type FrontDoorKind,
  type RateLimiter,
} from "./ratelimit";
import { sseResponse, type Emit } from "./sse";
import { StoreError } from "./store";
import {
  AttemptDenied,
  callRole,
  extractJson,
  ProviderError,
  type AttemptGate,
  type ChatMessage,
  type LlmProvider,
  type ProviderBackoff,
} from "./tokenfactory";

export interface AgentDeps {
  config: ServerConfig;
  provider: LlmProvider | null;
  resolver: ModelResolver;
  limiter: RateLimiter;
  budget: DailyBudget;
  missions: MissionLedger;
  backoff: ProviderBackoff;
  /** In-memory limiter that runs before any store command. */
  frontDoor: FrontDoor;
  /** Process-local facts for /api/health (it never reads the store itself). */
  signals?: { storeDownAt: number };
  loadCatalog: () => Promise<Catalog>;
  now: () => number;
}

const MAX_BODY_BYTES = 64 * 1024;
/** A conservative token estimate for the reservation: three characters per token, plus overhead. */
export const estimateTokens = (messages: readonly ChatMessage[]): number =>
  Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 3) + 16;

/* --------------------------------- HTTP glue -------------------------------- */

export function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function invalid(issues: { path: string; message: string }[]): Response {
  return json({ error: "invalid_request", issues: issues.slice(0, 12) }, 400);
}

const JSON_TYPE = /^application\/json\s*(?:;.*)?$/i;

/**
 * Cheap cross-site defenses for every POST route: the body must be declared application/json (a
 * cross-site form or text/plain POST cannot set that without a CORS preflight, which these routes
 * never approve), a browser-declared cross-site fetch is refused, and an Origin that is not this
 * site (or an allowlisted one) is refused. Returns a response to send, or null when the request may proceed.
 */
export function guardPost(request: Request, config: Pick<ServerConfig, "allowedOrigins">): Response | null {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") {
    logEvent("warn", "cross_site_refused", { reason: "sec-fetch-site" });
    return json({ error: "cross_site_request" }, 403);
  }
  const origin = request.headers.get("origin");
  if (origin !== null) {
    let host = "";
    try {
      host = new URL(origin).host.toLowerCase();
    } catch {
      /* "null" and malformed origins are refused below */
    }
    const own = new Set<string>();
    try {
      own.add(new URL(request.url).host.toLowerCase());
    } catch {
      /* no usable request URL */
    }
    for (const h of [request.headers.get("host"), request.headers.get("x-forwarded-host")]) if (h) own.add(h.split(",")[0].trim().toLowerCase());
    const listed = config.allowedOrigins.includes(origin.toLowerCase()) || config.allowedOrigins.includes(host);
    if (!host || (!own.has(host) && !listed)) {
      logEvent("warn", "cross_origin_refused", { reason: "origin" });
      return json({ error: "cross_site_request" }, 403);
    }
  }
  if (!JSON_TYPE.test((request.headers.get("content-type") ?? "").trim())) {
    return json({ error: "unsupported_media_type", message: "Send application/json." }, 415);
  }
  return null;
}

/** The client address for this deployment (see clientIp: forged headers are ignored unless a proxy is trusted). */
export function requestIp(request: Request, config: Pick<ServerConfig, "trustedProxyHops" | "trustForwarded">): string {
  return clientIp(request.headers, { trustedHops: config.trustedProxyHops, trustForwarded: config.trustForwarded });
}

/**
 * The in-memory front door: turns a flood away BEFORE any store command, body read or model call.
 * Returns a 429 to send, or null when the request may proceed.
 */
export function frontDoorCheck(request: Request, config: Pick<ServerConfig, "trustedProxyHops" | "trustForwarded">, door: FrontDoor, kind: FrontDoorKind): Response | null {
  const ip = requestIp(request, config);
  const r = door.check(kind, ip);
  if (r.ok) return null;
  logEvent("info", "front_door_refused", { kind, ip: ipTag(ip) });
  const o = fallback("rate_limited", "Too many requests from this connection. Try again shortly.", "retry_later", r.retryAfterS);
  return json(o, 429, { "retry-after": String(r.retryAfterS) });
}

export async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<{ ok: true; value: T } | { ok: false; res: Response }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, res: json({ error: "payload_too_large" }, 413) };
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
    return { ok: false, res: invalid(r.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: safeMessage(i) }))) };
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

function fail(emit: Emit, code: string, o: Fallback): Fallback {
  emit({ event: "error", data: { code, message: o.message } });
  return o;
}

/** A complete SSE answer that only reports an outcome (nothing was sent to a model). */
function refuse(code: string, o: Fallback): Response {
  return sseResponse(async (emit) => {
    emit({ event: "error", data: { code, message: o.message } });
    emit({ event: "done", data: o });
  });
}

const plannerUnavailable = (): Fallback => fallback("planner_unavailable", UI_MESSAGES.plannerUnavailable, "deterministic_search");

/* ------------------------- infrastructure preflight ------------------------- */

type Pre = { ok: true; catalog: Catalog } | { ok: false; res: Response };

/**
 * Everything that can make the AI layer unavailable is checked BEFORE the visitor's quota is
 * charged: kill switch, missing key, no listed model, catalog, budget ceiling, protection store.
 * An outage therefore never burns a judge's per-IP mission allowance.
 */
async function preflight(deps: AgentDeps, role: Role, route: string): Promise<Pre> {
  const { config } = deps;
  if (!config.liveAi) {
    logEvent("warn", "kill_switch", { route });
    return { ok: false, res: refuse("planner_unavailable", plannerUnavailable()) };
  }
  if (!deps.provider) {
    logEvent("warn", "provider_unconfigured", { route, issue: config.baseUrlIssue ?? "no key" });
    return { ok: false, res: refuse("planner_unavailable", plannerUnavailable()) };
  }
  const models = await deps.resolver.resolve(role);
  if (models.length === 0) {
    logEvent("warn", "provider_unavailable", { route, role, reason: "no listed model" });
    return { ok: false, res: refuse("planner_unavailable", plannerUnavailable()) };
  }
  let catalog: Catalog;
  try {
    catalog = await deps.loadCatalog();
  } catch {
    return { ok: false, res: refuse("catalog_unavailable", fallback("catalog_unavailable", UI_MESSAGES.plannerUnavailable, "deterministic_search")) };
  }
  try {
    // One read per minute per process at most: the cached total is refreshed by every reserve and settle.
    const st = await deps.budget.status(60_000);
    if (st.exhausted) {
      logEvent("warn", "budget_exhausted", { route });
      return { ok: false, res: refuse("budget_exhausted", fallback("budget_exhausted", UI_MESSAGES.budgetExhausted, "recorded_tour")) };
    }
  } catch (e) {
    if (!(e instanceof StoreError)) throw e;
    logEvent("warn", "protection_unavailable", { route, where: "budget" });
    return { ok: false, res: refuse("protection_unavailable", plannerUnavailable()) };
  }
  return { ok: true, catalog };
}

/* ---------------------------- admission and locking --------------------------- */

interface Begun {
  account: MissionAccount;
  release: () => Promise<void>;
  /** Hashed client key, for the per-client dollar allowance. */
  clientKey: string;
}

/**
 * Admission for one request, after the preflight:
 *   1. A (mission id, client) pair not seen before costs one unit of that client's quota, charged
 *      with increment-then-compare and recorded with SET NX; a request that loses the SET NX race
 *      gives its unit back. Known pairs are free.
 *   2. One in-flight request per mission (lock with TTL).
 *   3. A per-route ask cap.
 */
async function begin(
  deps: AgentDeps,
  request: Request,
  missionId: string,
  turn: { kind: string },
): Promise<{ ok: true; begun: Begun } | { ok: false; res: Response }> {
  const { config, missions, limiter } = deps;
  const ip = requestIp(request, config);
  const clientKey = ipKey(ip);
  const quotaKey = `ip:${clientKey}`;
  let token: string | null = null;
  try {
    if (!(await missions.isBound(missionId, ip))) {
      // Only the hourly rule lives in the store; the daily allowance is the client's dollar cap,
      // and a per-process daily count of new missions is checked in memory first.
      const day = deps.frontDoor.newMission(ip);
      if (!day.ok) {
        const o = fallback("rate_limited", "Mission limit reached for this connection today. Use the recorded run.", "recorded_tour", day.retryAfterS);
        return { ok: false, res: json(o, 429, { "retry-after": String(day.retryAfterS) }) };
      }
      const rules = missionRules(config.ipMissionsPerHour, config.ipMissionsPerDay, ip).slice(0, 1);
      const r = await limiter.consume(quotaKey, rules);
      if (r.error) {
        logEvent("warn", "protection_unavailable", { where: "limiter" });
        return { ok: false, res: refuse("protection_unavailable", plannerUnavailable()) };
      }
      if (!r.allowed) {
        logEvent("info", "rate_limited", { ip: ipTag(ip), rule: r.blockedBy });
        const o = fallback(
          "rate_limited",
          `Mission limit reached for this connection. Try again in about ${Math.ceil(r.retryAfterS / 60)} minutes, or use the recorded run.`,
          "recorded_tour",
          r.retryAfterS,
        );
        return { ok: false, res: json(o, 429, { "retry-after": String(r.retryAfterS) }) };
      }
      // Only the request that creates the record keeps its unit; a concurrent twin refunds.
      if (!(await missions.bind(missionId, ip))) await limiter.refund(quotaKey, rules);
    }
    token = await missions.acquire(missionId, config.routeDeadlineMs + 5_000);
    if (token === null) {
      const o = fallback("rate_limited", "This mission already has a request in progress. Try again in a moment.", "retry_later", 2);
      return { ok: false, res: json(o, 429, { "retry-after": "2" }) };
    }
    const release = () => missions.release(missionId, token as string);
    if (!(await missions.claimTurn(missionId, turn.kind, TURN_LIMITS[turn.kind] ?? 3))) {
      await release();
      return {
        ok: false,
        res: refuse("round_limit", fallback("round_limit", "This mission has used all of its planning rounds.", "deterministic_search")),
      };
    }
    return {
      ok: true,
      begun: {
        release,
        clientKey,
        account: {
          ledger: missions,
          id: missionId,
          caps: { inputTokens: config.missionInputTokens, outputTokens: config.missionOutputTokens, maxCalls: config.missionMaxCalls },
        },
      },
    };
  } catch (e) {
    if (!(e instanceof StoreError)) throw e;
    if (token !== null) await missions.release(missionId, token);
    logEvent("warn", "protection_unavailable", { where: "mission" });
    if (deps.signals) deps.signals.storeDownAt = deps.now();
    return { ok: false, res: refuse("protection_unavailable", plannerUnavailable()) };
  }
}

/** Runs the work, releases the mission lock BEFORE `done` is sent, then reports the outcome. */
function streamOutcome(begun: Begun, work: (emit: Emit) => Promise<Outcome<unknown>>): Response {
  return sseResponse(async (emit) => {
    let outcome: Outcome<unknown>;
    try {
      outcome = await work(emit);
    } finally {
      await begun.release();
    }
    done(emit, outcome);
  });
}

/* ------------------------------ structured call ----------------------------- */

export interface StructuredSpec<T> {
  deps: AgentDeps;
  emit: Emit;
  account: MissionAccount;
  /** Hashed client key: the client's own daily dollar allowance is charged too. */
  clientKey?: string;
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

const RATE_MESSAGE = "The model provider is rate limiting requests right now. Deterministic search (not AI) can continue.";

function providerFallback(deps: AgentDeps, emit: Emit, e: ProviderError, role: Role): Fallback {
  if (e.kind === "auth" || e.kind === "model_not_found") {
    logEvent("warn", e.kind === "auth" ? "provider_auth_failed" : "provider_model_missing", { role, status: e.status });
    return fail(emit, e.kind, plannerUnavailable());
  }
  if (e.kind === "rate_limited") {
    const wait = deps.backoff.hit(e.retryAfterS);
    logEvent("warn", "provider_rate_limited", { role, retryAfterS: wait });
    return fail(emit, "provider_rate_limited", fallback("upstream_error", RATE_MESSAGE, "deterministic_search", wait));
  }
  logEvent("warn", "provider_error", { role, kind: e.kind, status: e.status });
  if (e.kind === "timeout") {
    return fail(emit, "timeout", fallback("upstream_error", "The model did not answer in time. Deterministic search (not AI) can continue.", "deterministic_search"));
  }
  return fail(emit, e.kind, fallback("upstream_error", "The model provider could not be reached. Deterministic search (not AI) can continue.", "deterministic_search"));
}

function deniedFallback(emit: Emit, d: AttemptDenied, role: Role): Fallback {
  switch (d.reason) {
    case "mission_calls":
      return fail(emit, "mission_calls_exhausted", fallback("mission_budget_exhausted", "This mission has used its AI call allowance. Deterministic search (not AI) can continue.", "deterministic_search"));
    case "mission_input":
    case "mission_output":
      return fail(emit, "mission_budget_exhausted", fallback("mission_budget_exhausted", "This mission has used its AI token budget. Deterministic search (not AI) can continue.", "deterministic_search"));
    case "daily_budget":
      logEvent("warn", "budget_exhausted", { role });
      return fail(emit, "budget_exhausted", fallback("budget_exhausted", UI_MESSAGES.budgetExhausted, "recorded_tour"));
    case "ip_budget":
      logEvent("info", "ip_budget_exhausted", { role });
      return fail(emit, "ip_budget_exhausted", fallback("budget_exhausted", "This connection has used its AI allowance for today. Try the recorded run.", "recorded_tour"));
    case "provider_backoff":
      return fail(emit, "provider_backoff", fallback("upstream_error", RATE_MESSAGE, "deterministic_search", d.retryAfterS));
    default:
      logEvent("warn", "protection_unavailable", { role, where: "attempt" });
      return fail(emit, "protection_unavailable", plannerUnavailable());
  }
}

/** Providers that never billed a failed call: a refused key or a missing model or a rejected request. */
const UNBILLED_FAILURES = new Set(["auth", "model_not_found", "schema_unsupported", "bad_request", "rate_limited"]);

interface AttemptHandle {
  mission: MissionReservation;
  daily: BudgetReservation;
  estIn: number;
  model: string;
}

export async function runStructured<T>(s: StructuredSpec<T>): Promise<Outcome<T>> {
  const { deps, emit, account } = s;
  const { config } = deps;
  const models = await deps.resolver.resolve(s.role);
  if (!config.liveAi || !deps.provider || models.length === 0) {
    return fail(emit, "planner_unavailable", plannerUnavailable());
  }
  const paused = deps.backoff.remainingS();
  if (paused > 0) return fail(emit, "provider_backoff", fallback("upstream_error", RATE_MESSAGE, "deterministic_search", paused));
  emit({ event: "status", data: { phase: s.toolName, message: "Asking the model.", model: models[0] } });

  let messages = s.messages;
  let repaired = false;
  let chain: readonly string[] = models;
  let attemptsLeft = config.maxAttemptsPerRequest;
  const total = { inputTokens: 0, outputTokens: 0 };
  let mission = { inputTokens: 0, outputTokens: 0 };
  let lastUsage = { inputTokens: 0, outputTokens: 0 };
  const limitIn = account.caps.inputTokens;
  const limitOut = account.caps.outputTokens;

  /** Reserve before, settle after: every upstream attempt is charged to the mission and the day. */
  const gate: AttemptGate = {
    async before(model) {
      const wait = deps.backoff.remainingS();
      if (wait > 0) throw new AttemptDenied("provider_backoff", wait);
      const estIn = estimateTokens(messages);
      let mres;
      try {
        mres = await account.ledger.reserve(account.id, estIn, s.maxOut, account.caps);
      } catch (e) {
        if (e instanceof StoreError) throw new AttemptDenied("store_error");
        throw e;
      }
      if (!mres.ok) throw new AttemptDenied(mres.reason === "calls" ? "mission_calls" : mres.reason === "input" ? "mission_input" : "mission_output");
      let daily: BudgetReservation;
      try {
        const cost = costUsd(model, estIn, mres.maxTokens, config.prices);
        const r = s.clientKey ? await deps.budget.reserveFor(s.clientKey, config.ipDailyUsd, cost) : await deps.budget.reserve(cost);
        if (!r || "denied" in r) {
          await account.ledger.cancel(account.id, mres).catch(() => undefined);
          throw new AttemptDenied(r && r.denied === "ip" ? "ip_budget" : "daily_budget");
        }
        daily = r;
      } catch (e) {
        if (e instanceof AttemptDenied) throw e;
        await account.ledger.cancel(account.id, mres).catch(() => undefined);
        if (e instanceof StoreError) throw new AttemptDenied("store_error");
        throw e;
      }
      mission = { inputTokens: mres.inputTokens, outputTokens: mres.outputTokens };
      const handle: AttemptHandle = { mission: mres, daily, estIn, model };
      return { maxTokens: mres.maxTokens, handle };
    },
    async after(raw, outcome) {
      const h = raw as AttemptHandle;
      let inTok = 0;
      let outTok = 0;
      let cost = 0;
      if (outcome.ok) {
        // Trust reported usage, but never let a missing count make a call free.
        inTok = outcome.usage.inputTokens || h.estIn;
        outTok = outcome.usage.outputTokens || Math.ceil(outcome.text.length / 4);
        cost = costUsd(outcome.model, inTok, outTok, config.prices);
        deps.backoff.ok();
      } else if (!UNBILLED_FAILURES.has(outcome.kind)) {
        // A failed or timed-out call may still be billed: keep at least its input cost.
        inTok = h.estIn;
        cost = costUsd(h.model, h.estIn, 0, config.prices);
      }
      lastUsage = { inputTokens: inTok, outputTokens: outTok };
      total.inputTokens += inTok;
      total.outputTokens += outTok;
      try {
        mission = await account.ledger.settle(account.id, h.mission, inTok, outTok);
      } catch (e) {
        if (!(e instanceof StoreError)) throw e;
        logEvent("warn", "mission_settle_failed", { role: s.role });
      }
      await deps.budget.settle(h.daily, cost);
    },
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attemptsLeft <= 0) {
      return fail(emit, "attempt_cap", fallback("upstream_error", "The model could not answer within this request's call limit. Deterministic search (not AI) can continue.", "deterministic_search"));
    }
    let res;
    try {
      res = await callRole(
        deps.provider,
        chain,
        { messages, schemaName: s.schemaName, jsonSchema: s.jsonSchema, maxTokens: s.maxOut, timeoutMs: config.llmTimeoutMs, deadlineAt: s.deadlineAt, signal: s.signal },
        deps.now,
        { maxAttempts: attemptsLeft, gate },
      );
    } catch (e) {
      if (e instanceof AttemptDenied) return deniedFallback(emit, e, s.role);
      const pe = e instanceof ProviderError ? e : new ProviderError("upstream", "unexpected error");
      return providerFallback(deps, emit, pe, s.role);
    }
    attemptsLeft -= res.attempts;
    if (res.skipped.length > 0) logEvent("warn", "model_fallback", { role: s.role, skipped: res.skipped.length, used: res.model });

    emit({
      event: "usage",
      data: {
        role: s.role,
        model: res.model,
        inputTokens: lastUsage.inputTokens,
        outputTokens: lastUsage.outputTokens,
        mission: { inputTokens: mission.inputTokens, outputTokens: mission.outputTokens, limitIn, limitOut },
      },
    });
    for (const sk of res.skipped) {
      emit({ event: "log", data: { kind: "info", sentence: `Model ${sk.model} was skipped (${sk.kind}); the next model in the chain was used.`, code: sk.kind } });
    }

    const parsed = extractJson(res.text);
    const budget: TokenBudget = { inputUsed: mission.inputTokens, outputUsed: mission.outputTokens, inputLimit: limitIn, outputLimit: limitOut };
    const verdict: ValidationResult<T> = parsed.ok
      ? s.validate(parsed.value, budget)
      : { ok: false, violations: [{ rule: 1, code: "not_json", path: "(root)", message: parsed.error }] };

    if (verdict.ok) {
      if (verdict.withheld && verdict.withheld.length > 0) {
        // Only the failing commentary is dropped; the rest of the answer is used.
        emit({
          event: "log",
          data: {
            kind: "validator",
            sentence: "AI commentary was withheld because it did not pass the screen; the rest of the answer was used.",
            code: "commentary_withheld",
            errors: describeViolations(verdict.withheld),
            model: res.model,
          },
        });
        logEvent("info", "commentary_withheld", { role: s.role, fields: verdict.withheld.length, codes: [...new Set(verdict.withheld.map((w) => w.code))].join(",") });
      }
      emit({ event: "tool_call", data: { name: s.toolName, args: verdict.value, model: res.model, repaired } });
      return { status: "ok", result: verdict.value, model: res.model, usage: { ...total }, repaired };
    }

    // A reply cut off by max_tokens is not repaired: asking again would resend everything and
    // most likely be cut off again. It ends the turn.
    if (res.finishReason === "length") {
      emit({ event: "log", data: { kind: "fallback", sentence: "The model's answer was cut off before it finished; it was not used.", code: "output_truncated", model: res.model } });
      return fallback("output_rejected", outputRejectedMessage(s.role), "deterministic_search");
    }

    const errors = describeViolations(verdict.violations);
    if (attempt === 0) {
      emit({
        event: "log",
        data: { kind: "validator", sentence: "Model output was rejected by the validator; asking once for a corrected answer.", errors, model: res.model },
      });
      repaired = true;
      chain = [res.model]; // repair on the model that answered, not down the whole chain
      messages = [
        ...s.messages,
        { role: "assistant", content: res.text.slice(0, 4000) },
        {
          role: "user",
          content: `Your previous reply was rejected by the validator:\n${errors.map((x) => `- ${x}`).join("\n")}\nReturn a corrected JSON object only, following every rule in the system message. Commentary describes mechanism in plain words: no numbers, results, comparisons or directions of change.`,
        },
      ];
      continue;
    }
    emit({
      event: "log",
      data: { kind: "fallback", sentence: outputRejectedMessage(s.role), errors, code: "output_rejected", model: res.model },
    });
    return fallback("output_rejected", outputRejectedMessage(s.role), "deterministic_search");
  }
  return fallback("output_rejected", outputRejectedMessage(s.role), "deterministic_search");
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

/** Areas go into a prompt, so every one must be a real gazetteer entry (an ID-shaped string is not enough). */
function checkAreas(catalog: Catalog, mission: PlanRequest["mission"]): Issue[] {
  const issues: Issue[] = [];
  mission.constraints.areas.forEach((id, i) => {
    if (!catalog.gazetteerById.has(id)) issues.push({ path: `mission.constraints.areas.${i}`, message: "area is not in the gazetteer" });
  });
  if (new Set(mission.constraints.areas).size !== mission.constraints.areas.length) issues.push({ path: "mission.constraints.areas", message: "areas must be unique" });
  return issues;
}

/** Recomputes the cost tier from the catalog so the model never sees a client-supplied tier. */
const trustedRows = (catalog: Catalog, rows: readonly EvaluationRow[]): EvaluationRow[] =>
  rows.map((r) => ({ ...r, costTier: bundleCostTier(catalog, r.candidateIds) }));

function done(emit: Emit, o: Outcome<unknown>): void {
  emit({ event: "done", data: o });
}

/** A request that contradicts itself is answered without any model call and without using quota. */
function inconsistent(issues: readonly Issue[], message: string): Response {
  return sseResponse(async (emit) => {
    emit({ event: "error", data: { code: "invalid_request", message: issues[0].message } });
    emit({ event: "done", data: fallback("output_rejected", message, "deterministic_search") });
  });
}

/* ---------------------------------- handlers -------------------------------- */

type Handler = (request: Request, deps: AgentDeps) => Promise<Response>;

export const handleParse: Handler = async (request, deps) => {
  const deadlineAt = deps.now() + deps.config.routeDeadlineMs;
  const g = guardPost(request, deps.config) ?? frontDoorCheck(request, deps.config, deps.frontDoor, "ai");
  if (g) return g;
  const body = await readBody<ParseRequest>(request, ParseRequestSchema);
  if (!body.ok) return body.res;
  const pre = await preflight(deps, "parser", "parse");
  if (!pre.ok) return pre.res;
  const b = await begin(deps, request, body.value.missionId, { kind: "parse" });
  if (!b.ok) return b.res;
  const catalog = pre.catalog;
  return streamOutcome(b.begun, async (emit) => {
    const jsonSchema = toJsonSchema(ParsedMissionSchema);
    return runStructured({
      deps, emit, account: b.begun.account, clientKey: b.begun.clientKey, role: "parser", toolName: "parse", schemaName: PARSE_SCHEMA_NAME, jsonSchema,
      messages: buildParseMessages(catalog, body.value.text, jsonSchema),
      maxOut: 700, deadlineAt, signal: request.signal,
      validate: (raw, budget) => validateParseOutput(raw, { catalog, budget }),
    });
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
  const deadlineAt = deps.now() + deps.config.routeDeadlineMs;
  const g = guardPost(request, deps.config) ?? frontDoorCheck(request, deps.config, deps.frontDoor, "ai");
  if (g) return g;
  const body = await readBody<PlanRequest>(request, PlanRequestSchema);
  if (!body.ok) return body.res;
  const req = body.value;
  const pre = await preflight(deps, "planner", "plan");
  if (!pre.ok) return pre.res;
  const catalog = pre.catalog;

  const issues = [...checkAreas(catalog, req.mission), ...checkHistory(catalog, req.mission, req.bundles, req.evaluations)];
  const action = expectedAction(req.phase, req.round);
  if (req.phase === "finalize" && req.evaluations.length < 3) issues.push({ path: "evaluations", message: "finalize needs at least three evaluated bundles" });
  if (req.phase === "search" && req.round > 1 && req.evaluations.length === 0) issues.push({ path: "evaluations", message: "refine needs evaluated bundles" });
  if (issues.length > 0) return inconsistent(issues, "The planning request was inconsistent and was not sent to a model.");

  const eligible = eligibleCandidates(catalog, constraintsOf(req.mission));
  if (eligible.length === 0) {
    return refuse("no_eligible_candidates", fallback("catalog_unavailable", "No catalog intervention fits these constraints.", "deterministic_search"));
  }

  // Rounds: 3 search rounds plus one finalize turn per mission.
  const b = await begin(deps, request, req.missionId, { kind: "plan" });
  if (!b.ok) return b.res;

  return streamOutcome(b.begun, async (emit) => {
    const rows = trustedRows(catalog, req.evaluations);
    const known = knownFrom(req.bundles, rows);
    const excluded = req.phase === "finalize" ? computeExcluded(rows.map((r) => r.bundleId), req.dropped, req.critique?.veto ?? []) : new Set<string>();
    const ids = eligible.map((c) => c.id) as [string, ...string[]];
    // The model is asked for candidate IDs only; the application assigns the bundle IDs afterwards.
    const jsonSchema = toJsonSchema(plannerModelSchemaFor(action, z.enum(ids)));
    return runStructured({
      deps, emit, account: b.begun.account, clientKey: b.begun.clientKey, role: "planner", toolName: action, schemaName: PLAN_SCHEMA_NAME, jsonSchema,
      messages: buildPlanMessages({ req, action, eligible: eligible.map(promptView), rows, baseline: req.baseline, excluded, jsonSchema }),
      maxOut: 1800, deadlineAt, signal: request.signal,
      validate: (raw, budget) =>
        validatePlannerOutput(raw, { catalog, mission: req.mission, phase: req.phase, round: req.round, known, excludedBundleIds: excluded, budget }),
    });
  });
};

function usedViews(catalog: Catalog, rows: readonly EvaluationRow[]) {
  const ids = new Set(rows.flatMap((r) => r.candidateIds));
  return [...ids].map((id) => catalog.byId.get(id)).filter((c) => c !== undefined).map(promptView);
}

export const handleCritique: Handler = async (request, deps) => {
  const deadlineAt = deps.now() + deps.config.routeDeadlineMs;
  const g = guardPost(request, deps.config) ?? frontDoorCheck(request, deps.config, deps.frontDoor, "ai");
  if (g) return g;
  const body = await readBody<CritiqueRequest>(request, CritiqueRequestSchema);
  if (!body.ok) return body.res;
  const req = body.value;
  const pre = await preflight(deps, "critic", "critique");
  if (!pre.ok) return pre.res;
  const catalog = pre.catalog;
  const issues = [...checkAreas(catalog, req.mission), ...checkHistory(catalog, req.mission, [], req.evaluations)];
  if (issues.length > 0) return inconsistent(issues, "The critique request was inconsistent and was not sent to a model.");
  const b = await begin(deps, request, req.missionId, { kind: "critique" });
  if (!b.ok) return b.res;
  return streamOutcome(b.begun, async (emit) => {
    const rows = trustedRows(catalog, req.evaluations);
    const known = knownFrom([], rows);
    const jsonSchema = toJsonSchema(CritiqueSchema);
    return runStructured({
      deps, emit, account: b.begun.account, clientKey: b.begun.clientKey, role: "critic", toolName: "critique", schemaName: CRITIQUE_SCHEMA_NAME, jsonSchema,
      messages: buildCritiqueMessages({ req, used: usedViews(catalog, rows), rows, baseline: req.baseline, jsonSchema }),
      maxOut: 1200, deadlineAt, signal: request.signal,
      validate: (raw, budget) => validateCritiqueOutput(raw, { catalog, known, budget }),
    });
  });
};

export const handleNarrate: Handler = async (request, deps) => {
  const deadlineAt = deps.now() + deps.config.routeDeadlineMs;
  const g = guardPost(request, deps.config) ?? frontDoorCheck(request, deps.config, deps.frontDoor, "ai");
  if (g) return g;
  const body = await readBody<NarrateRequest>(request, NarrateRequestSchema);
  if (!body.ok) return body.res;
  const req = body.value;
  const pre = await preflight(deps, "narrator", "narrate");
  if (!pre.ok) return pre.res;
  const catalog = pre.catalog;
  const issues = [...checkAreas(catalog, req.mission), ...checkHistory(catalog, req.mission, [], req.evaluations)];
  const scored = new Set(req.evaluations.map((r) => r.bundleId));
  req.finalists.forEach((f, i) => {
    if (!scored.has(f.bundleId)) issues.push({ path: `finalists.${i}.bundleId`, message: "finalist was not evaluated" });
  });
  if (new Set(req.finalists.map((f) => f.bundleId)).size !== 3) issues.push({ path: "finalists", message: "finalists must be distinct" });
  if (issues.length > 0) return inconsistent(issues, "The narration request was inconsistent and was not sent to a model.");
  const b = await begin(deps, request, req.missionId, { kind: "narrate" });
  if (!b.ok) return b.res;
  return streamOutcome(b.begun, async (emit) => {
    const rows = trustedRows(catalog, req.evaluations);
    const jsonSchema = toJsonSchema(NarrationSchema);
    const finalistIds = req.finalists.map((f) => f.bundleId);
    return runStructured({
      deps, emit, account: b.begun.account, clientKey: b.begun.clientKey, role: "narrator", toolName: "narrate", schemaName: NARRATE_SCHEMA_NAME, jsonSchema,
      messages: buildNarrateMessages({ req, used: usedViews(catalog, rows), rows, baseline: req.baseline, jsonSchema }),
      maxOut: 1200, deadlineAt, signal: request.signal,
      validate: (raw, budget) => validateNarrationOutput(raw, { catalog, finalistIds, budget }),
    });
  });
};

/**
 * Wire protocol between the browser and /api/agent/* and /api/closures.
 * Request bodies are zod-validated structured payloads; nothing here carries prompt text.
 */
import { z } from "zod";
import { StressSpecSchema } from "./stress";
import {
  BaselineRowSchema,
  BundleIdSchema,
  CandidateIdSchema,
  CONCERN_KINDS,
  ConfirmedMissionSchema,
  EvaluationRowSchema,
} from "./tools";

export const MissionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

const BundleRefSchema = z.strictObject({ id: BundleIdSchema, candidateIds: z.array(CandidateIdSchema).min(1).max(3) });

export const ParseRequestSchema = z.strictObject({
  missionId: MissionIdSchema,
  // Free text is only ever placed inside a fixed template as quoted data.
  text: z.string().trim().min(3).max(300),
  /**
   * Cloudflare Turnstile token from the page's widget. Sent with the mission start (this request);
   * required by the server only when WS_TURNSTILE_SECRET is configured.
   */
  turnstileToken: z.string().min(1).max(2048).optional(),
});
export type ParseRequest = z.infer<typeof ParseRequestSchema>;

/**
 * The critic's review as the planner sees it: bundle and kind only. No client-authored text is
 * accepted here; the server writes the sentence for each kind itself.
 */
const CritiqueContextSchema = z.strictObject({
  concerns: z.array(z.strictObject({ bundleId: BundleIdSchema, kind: z.enum(CONCERN_KINDS) })).max(24),
  veto: z.array(BundleIdSchema).max(12),
});

/**
 * One stress test and the simulator's results under it. The spec is a member of the closed set
 * (stress.ts); the label is written by the server from the spec, never accepted from the client.
 */
export const StressResultSchema = z.strictObject({
  stress: StressSpecSchema,
  /** The no-intervention baseline under the same stress, when the simulator provides one. */
  baseline: BaselineRowSchema.optional(),
  evaluations: z.array(EvaluationRowSchema).min(1).max(12),
});
export type StressResultRequest = z.infer<typeof StressResultSchema>;

export const PlanRequestSchema = z.strictObject({
  missionId: MissionIdSchema,
  mission: ConfirmedMissionSchema,
  phase: z.enum(["search", "finalize"]),
  round: z.number().int().min(1).max(3),
  bundles: z.array(BundleRefSchema).max(12),
  evaluations: z.array(EvaluationRowSchema).max(12),
  baseline: BaselineRowSchema.optional(),
  dropped: z.array(BundleIdSchema).max(12).default([]),
  critique: CritiqueContextSchema.optional(),
  /** Stress tests run so far, each with the simulator's results for the leading bundles. */
  stresses: z.array(StressResultSchema).max(3).default([]),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const CritiqueRequestSchema = z.strictObject({
  missionId: MissionIdSchema,
  mission: ConfirmedMissionSchema,
  round: z.number().int().min(1).max(3),
  evaluations: z.array(EvaluationRowSchema).min(1).max(12),
  baseline: BaselineRowSchema.optional(),
  dropped: z.array(BundleIdSchema).max(12).default([]),
  /** Stress tests already run (the critic may not repeat one). */
  stresses: z.array(StressResultSchema).max(3).default([]),
});
export type CritiqueRequest = z.infer<typeof CritiqueRequestSchema>;

export const ClosuresRequestSchema = z.strictObject({});

/* ------------------------------ outcomes ----------------------------- */

export type FallbackReason =
  | "budget_exhausted"
  | "evaluation_failed"
  | "mission_budget_exhausted"
  | "rate_limited"
  | "planner_unavailable"
  | "output_rejected"
  | "upstream_error"
  | "catalog_unavailable"
  | "round_limit"
  /** Turnstile is enforced and the mission start carried no valid token (`next` is retry_later). */
  | "verification_failed";

export type FallbackNext = "deterministic_search" | "recorded_tour" | "retry_later";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type Outcome<T> =
  | { status: "ok"; result: T; model: string; usage: Usage; repaired: boolean }
  | {
      status: "fallback";
      reason: FallbackReason;
      message: string;
      next: FallbackNext;
      retryAfterS?: number;
    };

export const UI_MESSAGES = {
  plannerUnavailable: "AI planner unavailable. Explore manually.",
  budgetExhausted: "Daily AI budget reached; try the recorded run.",
  /** Planner output rejected. Only accurate when the run really does switch to deterministic search. */
  outputRejected: "Planner output rejected; deterministic search used.",
  parserRejected: "The goal could not be read from your text (parser output rejected). Rephrase it, or explore manually.",
  criticRejected: "Critic output rejected; the deterministic critic ran the stress test instead.",
  deterministicLabel: "Deterministic search (not AI)",
  verificationFailed: "Human verification did not pass. Reload the page and try again, or use the recorded run.",
  verificationUnavailable: "Human verification is unavailable right now. Try again shortly, or use the recorded run.",
  busy: "Many new missions are starting right now. Try again shortly, or use the recorded run.",
} as const;

/**
 * UI hook for the graceful budget path. True when the daily AI budget (global or this connection's)
 * is used up: show `outcome.message` ("Daily AI budget reached; try the recorded run.") and offer
 * the recorded run (`outcome.next === "recorded_tour"`) instead of an error. /api/health reports the
 * same state as `degradedReason: "budget_exhausted"` once this process has seen it.
 */
export function isBudgetExhausted(o: Outcome<unknown>): boolean {
  return o.status === "fallback" && o.reason === "budget_exhausted";
}

export type AgentRole = "parser" | "planner" | "critic" | "extractor";

/** The rejection message for the role that produced the rejected output. Never claims a mode switch. */
export function outputRejectedMessage(role: AgentRole): string {
  switch (role) {
    case "parser":
      return UI_MESSAGES.parserRejected;
    case "critic":
      return UI_MESSAGES.criticRejected;
    case "extractor":
      return "Closure extraction output rejected; source links are shown without extracted closures.";
    default:
      return UI_MESSAGES.outputRejected;
  }
}

/* --------------------------- SSE event shapes ------------------------- */

export type LogKind = "decision" | "validator" | "fallback" | "info";

/** Metrics of one model step (one HTTP request to a route, attempts and repair turn included). */
export interface StepMetrics {
  role: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface MissionUsage {
  inputTokens: number;
  outputTokens: number;
  limitIn: number;
  limitOut: number;
}

export type AgentEvent =
  | { event: "status"; data: { phase: string; message: string; model?: string } }
  | { event: "log"; data: { kind: LogKind; sentence: string; code?: string; errors?: string[]; model?: string } }
  | { event: "tool_call"; data: { name: string; args: unknown; model: string; repaired: boolean } }
  | {
      event: "usage";
      data: { role: string; model: string; inputTokens: number; outputTokens: number; latencyMs: number; mission: MissionUsage };
    }
  | {
      /** Optional model reasoning, already screened by the server (plain text only). Shown in a collapsed, labeled section. */
      event: "reasoning";
      data: StepMetrics & { text: string };
    }
  | { event: "error"; data: { code: string; message: string } }
  | { event: "done"; data: Outcome<unknown> };

export type AgentEventName = AgentEvent["event"];
export const AGENT_EVENT_NAMES: readonly AgentEventName[] = ["status", "log", "tool_call", "usage", "reasoning", "error", "done"];

/* ------------------------------ evidence ----------------------------- */

export const EVIDENCE_TOPICS = ["detours", "traffic", "freight"] as const;
export type EvidenceTopic = (typeof EVIDENCE_TOPICS)[number];

/** POST /api/evidence. The topic is an enum: the query text is built by the server and no client text is accepted. */
export const EvidenceRequestSchema = z.strictObject({ topic: z.enum(EVIDENCE_TOPICS) });
export type EvidenceRequest = z.infer<typeof EvidenceRequestSchema>;

/** One news result, sanitized to plain characters. Nothing here has been checked against anything. */
export interface EvidenceSource {
  title: string;
  url: string;
  /** Hostname without "www.". */
  domain: string;
  /** ISO date (YYYY-MM-DD) when the search result carried a valid one. */
  publishedDate?: string;
  /** At most 240 plain characters from the result text. */
  snippet: string;
  confidence: "unverified";
}

export type EvidenceResponse =
  | {
      status: "ok";
      topic: EvidenceTopic;
      retrievedAt: string;
      cached: boolean;
      /** Set when served from the in-process cache; the UI labels it. */
      cachedNotice?: string;
      sources: EvidenceSource[];
      message: string;
    }
  | {
      status: "unavailable";
      reason: "no_key" | "cap_reached" | "upstream_error" | "rate_limited" | "disabled" | "protection_unavailable";
      message: string;
      retryAfterS?: number;
    };

/* ------------------------------ closures ----------------------------- */

/**
 * A ProposedMutation is a PROPOSAL and carries no authority. The only way to turn a proposal into
 * a mutation record is POST /api/closures/confirm with the proposal's single-use `confirmToken`,
 * which the browser may send only after an explicit user action (see lib/agent/closures.ts).
 */
export type ProposedMutation =
  | { kind: "close_link"; linkId: string }
  | { kind: "close_edges"; edges: number[]; label: string };

export interface ClosureProposal {
  id: string;
  road: string;
  matchedName: string;
  gazetteerId: string;
  mutation: ProposedMutation;
  provenance: { url: string; quote: string; retrievedAt: string };
  /** Every proposal comes from a news snippet nobody has verified. The UI must say so next to the source link and quote. */
  verification: "unverified";
  /**
   * How firmly the quote states a current closure. "low" means the UI must show `reviewHint` and
   * ask the reader to read the source before confirming (headline fragments, past-tense wording,
   * announced-only closures, an ambiguous road name resolved to the one closable entry).
   */
  confidence: "high" | "low";
  reviewHint?: string;
  startDate?: string;
  endDate?: string;
  /** Server-issued, single use, short lived. Present only when the server can honor a confirmation. */
  confirmToken?: string;
}

export interface ClosureUnmatched {
  road: string;
  quote: string;
  sourceUrl: string;
  reason:
    | "not_in_model_area"
    | "ambiguous"
    | "unsupported_kind"
    | "already_ended"
    | "not_yet_started"
    | "unclear_status"
    | "partial_closure"
    | "completed_event"
    | "hypothetical_scenario"
    | "hearsay";
}

export interface ClosureSource {
  title: string;
  source: string;
  url: string;
  snippet: string;
}

export type ClosuresResponse =
  | {
      status: "ok";
      retrievedAt: string;
      cached: boolean;
      /** Set when served from the cache or after the daily cap; the UI labels it. */
      cachedNotice?: string;
      sources: ClosureSource[];
      proposals: ClosureProposal[];
      unmatched: ClosureUnmatched[];
      ungroundedDropped: number;
      message: string;
      model?: string;
    }
  | {
      status: "unavailable";
      reason: "no_key" | "cap_reached" | "upstream_error" | "rate_limited" | "catalog_unavailable" | "disabled" | "protection_unavailable";
      message: string;
      retryAfterS?: number;
    };

/** POST /api/closures/confirm */
export const ConfirmClosureRequestSchema = z.strictObject({ token: z.string().max(3200).regex(/^v1\.[A-Za-z0-9_-]{20,3000}\.[A-Za-z0-9_-]{20,100}$/) });
export type ConfirmClosureRequest = z.infer<typeof ConfirmClosureRequestSchema>;

/** The shape lib/sim/compile.ts accepts for a tavily-origin mutation (a MutationRecord). */
export interface ConfirmedClosureRecord {
  id: string;
  m: ProposedMutation;
  origin: "tavily";
  label: string;
  provenance: { url: string; quote: string; retrievedAt: string };
  /** ISO time the server consumed the confirmation token. */
  confirmedAt: string;
}

export type ConfirmClosureResponse =
  | { status: "ok"; record: ConfirmedClosureRecord }
  | { status: "unavailable"; reason: "invalid_or_used" | "expired" | "wrong_requester" | "rate_limited" | "protection_unavailable"; message: string; retryAfterS?: number };

/**
 * Wire protocol between the browser and /api/agent/* and /api/closures.
 * Request bodies are zod-validated structured payloads; nothing here carries prompt text.
 */
import { z } from "zod";
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
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const CritiqueRequestSchema = z.strictObject({
  missionId: MissionIdSchema,
  mission: ConfirmedMissionSchema,
  round: z.number().int().min(1).max(3),
  evaluations: z.array(EvaluationRowSchema).min(1).max(12),
  baseline: BaselineRowSchema.optional(),
  dropped: z.array(BundleIdSchema).max(12).default([]),
});
export type CritiqueRequest = z.infer<typeof CritiqueRequestSchema>;

export const NarrateRequestSchema = z.strictObject({
  missionId: MissionIdSchema,
  mission: ConfirmedMissionSchema,
  // Only the ids: the planner's tradeoff sentence is not sent back into a prompt.
  finalists: z.array(z.strictObject({ bundleId: BundleIdSchema })).length(3),
  evaluations: z.array(EvaluationRowSchema).min(3).max(12),
  baseline: BaselineRowSchema.optional(),
});
export type NarrateRequest = z.infer<typeof NarrateRequestSchema>;

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
  | "round_limit";

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
  criticRejected: "Critic output rejected; continuing without a critique.",
  narratorRejected: "Narration rejected; finalists are shown without narration.",
  deterministicLabel: "Deterministic search (not AI)",
} as const;

export type AgentRole = "parser" | "planner" | "critic" | "narrator" | "extractor";

/** The rejection message for the role that produced the rejected output. Never claims a mode switch. */
export function outputRejectedMessage(role: AgentRole): string {
  switch (role) {
    case "parser":
      return UI_MESSAGES.parserRejected;
    case "critic":
      return UI_MESSAGES.criticRejected;
    case "narrator":
      return UI_MESSAGES.narratorRejected;
    case "extractor":
      return "Closure extraction output rejected; source links are shown without extracted closures.";
    default:
      return UI_MESSAGES.outputRejected;
  }
}

/* --------------------------- SSE event shapes ------------------------- */

export type LogKind = "decision" | "validator" | "fallback" | "info";

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
      data: { role: string; model: string; inputTokens: number; outputTokens: number; mission: MissionUsage };
    }
  | { event: "error"; data: { code: string; message: string } }
  | { event: "done"; data: Outcome<unknown> };

export type AgentEventName = AgentEvent["event"];
export const AGENT_EVENT_NAMES: readonly AgentEventName[] = ["status", "log", "tool_call", "usage", "error", "done"];

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
export const ConfirmClosureRequestSchema = z.strictObject({ token: z.string().max(4096).regex(/^v1\.[A-Za-z0-9_-]{20,3000}\.[A-Za-z0-9_-]{20,100}$/) });
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

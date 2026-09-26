/**
 * Agent tool schemas (docs/ARCHITECTURE.md 2.7). Shared by the browser state machine and the
 * server routes, which both re-validate every model output.
 *
 * The model returns exactly one action per turn. It never returns a metric: prose fields are
 * digit-free (see prose.ts) and numbers reach the UI only through {{slot}} placeholders.
 */
import { z } from "zod";
import { CostTierSchema, ID_RE, LensSchema, CandidateTypeSchema } from "./catalog";

export const CandidateIdSchema = z.string().regex(ID_RE);
export const BundleIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,15}$/);
export const GazetteerIdSchema = z.string().regex(ID_RE);

export const MAX_BUNDLE_SIZE = 3;
export const MAX_ROUNDS = 3;
export const MAX_EVALUATED_BUNDLES = 12;

const LogSentence = z.string().min(1).max(160);

function bundleSchema(candidateId: z.ZodType<string>) {
  return z.strictObject({
    id: BundleIdSchema,
    candidateIds: z.array(candidateId).min(1).max(MAX_BUNDLE_SIZE),
  });
}

/** The candidateId argument lets the server pin the model to a closed enum in the JSON schema. */
export function makeProposeSchema(candidateId: z.ZodType<string> = CandidateIdSchema) {
  return z.strictObject({
    action: z.literal("propose"),
    log_sentence: LogSentence,
    bundles: z.array(bundleSchema(candidateId)).min(1).max(6),
    hypothesis: z.string().min(1).max(280),
  });
}
export function makeRefineSchema(candidateId: z.ZodType<string> = CandidateIdSchema) {
  return z.strictObject({
    action: z.literal("refine"),
    log_sentence: LogSentence,
    keep: z.array(BundleIdSchema).max(MAX_EVALUATED_BUNDLES),
    drop: z.array(BundleIdSchema).max(MAX_EVALUATED_BUNDLES),
    add: z.array(bundleSchema(candidateId)).max(4),
  });
}
export const FinalistSchema = z.strictObject({
  bundleId: BundleIdSchema,
  tradeoff: z.string().min(1).max(240),
});
export const FinalizeSchema = z.strictObject({
  action: z.literal("finalize"),
  log_sentence: LogSentence,
  finalists: z.array(FinalistSchema).length(3),
});

export const ProposeSchema = makeProposeSchema();
export const RefineSchema = makeRefineSchema();

export type ProposeAction = z.infer<typeof ProposeSchema>;
export type RefineAction = z.infer<typeof RefineSchema>;
export type FinalizeAction = z.infer<typeof FinalizeSchema>;
export type PlannerAction = ProposeAction | RefineAction | FinalizeAction;
export type BundleSpec = { id: string; candidateIds: string[] };

export const PlannerActionSchema = z.discriminatedUnion("action", [ProposeSchema, RefineSchema, FinalizeSchema]);

export type PlannerPhase = "search" | "finalize";
export type PlannerActionName = "propose" | "refine" | "finalize";

/** The one action allowed for a given phase and round. */
export function expectedAction(phase: PlannerPhase, round: number): PlannerActionName {
  if (phase === "finalize") return "finalize";
  return round <= 1 ? "propose" : "refine";
}

export function plannerSchemaFor(action: PlannerActionName, candidateId?: z.ZodType<string>) {
  if (action === "propose") return makeProposeSchema(candidateId);
  if (action === "refine") return makeRefineSchema(candidateId);
  return FinalizeSchema;
}

/* ------------------------------ critic ------------------------------ */

export const CONCERN_KINDS = ["worst_case", "equity", "cost", "feasibility"] as const;
export const CritiqueSchema = z.strictObject({
  action: z.literal("critique"),
  log_sentence: LogSentence,
  concerns: z
    .array(z.strictObject({ bundleId: BundleIdSchema, kind: z.enum(CONCERN_KINDS), note: z.string().min(1).max(240) }))
    .max(24),
  veto: z.array(BundleIdSchema).max(MAX_EVALUATED_BUNDLES).optional(),
});
export type CritiqueOutput = z.infer<typeof CritiqueSchema>;

/* ------------------------------ parser ------------------------------ */

/** Lower is better for every goal metric, so the only operator is "<=". */
export const GOAL_METRICS = ["p50", "p90", "isolatedCount", "equityGap"] as const;
export const GoalMetricSchema = z.enum(GOAL_METRICS);
export type GoalMetric = z.infer<typeof GoalMetricSchema>;

export const ParsedMissionSchema = z.strictObject({
  lens: LensSchema,
  goal: z.strictObject({
    metric: GoalMetricSchema,
    op: z.literal("<="),
    // The numeric target is chosen by the user with a chip picker, never by model text.
    targetRef: z.literal("baseline+X"),
  }),
  constraints: z.strictObject({
    maxCostTier: CostTierSchema,
    types: z.array(CandidateTypeSchema).max(5),
    areas: z.array(GazetteerIdSchema).max(8),
  }),
  log_sentence: LogSentence,
});
export type ParsedMission = z.infer<typeof ParsedMissionSchema>;

/** A mission the user has confirmed, including the chip-picker target. */
export const ConfirmedMissionSchema = z.strictObject({
  lens: LensSchema,
  goal: z.strictObject({
    metric: GoalMetricSchema,
    op: z.literal("<="),
    targetDelta: z.number().finite().min(0).max(1_000_000),
  }),
  constraints: z.strictObject({
    maxCostTier: CostTierSchema,
    types: z.array(CandidateTypeSchema).max(5),
    areas: z.array(GazetteerIdSchema).max(8),
  }),
});
export type ConfirmedMission = z.infer<typeof ConfirmedMissionSchema>;

/* ----------------------------- narrator ----------------------------- */

export const NarrationSchema = z.strictObject({
  action: z.literal("narrate"),
  items: z
    .array(
      z.strictObject({
        bundleId: BundleIdSchema,
        headline: z.string().min(1).max(100),
        body: z.string().min(1).max(420),
      }),
    )
    .min(1)
    .max(3),
});
export type NarrationOutput = z.infer<typeof NarrationSchema>;

/* ---------------------------- evaluation ---------------------------- */

/** One row of the `evaluation` tool message the client builds from simulator results. */
export const EvaluationRowSchema = z.strictObject({
  bundleId: BundleIdSchema,
  candidateIds: z.array(CandidateIdSchema).min(1).max(MAX_BUNDLE_SIZE),
  p50S: z.number().finite().min(-1e7).max(1e7),
  p90S: z.number().finite().min(-1e7).max(1e7),
  pctWithin: z.number().finite().min(0).max(100),
  isolatedCount: z.number().int().min(0).max(100_000),
  equityGapS: z.number().finite().min(-1e7).max(1e7),
  pGoal: z.number().finite().min(0).max(1).nullable(),
  costTier: CostTierSchema,
});
export type EvaluationRow = z.infer<typeof EvaluationRowSchema>;

export const BaselineRowSchema = z.strictObject({
  p50S: z.number().finite().min(-1e7).max(1e7),
  p90S: z.number().finite().min(-1e7).max(1e7),
  pctWithin: z.number().finite().min(0).max(100),
  isolatedCount: z.number().int().min(0).max(100_000),
  equityGapS: z.number().finite().min(-1e7).max(1e7),
});
export type BaselineRow = z.infer<typeof BaselineRowSchema>;

/* ------------------------- Tavily extraction ------------------------ */

export const ExtractedClosureSchema = z.strictObject({
  road: z.string().min(1).max(120),
  from: z.string().max(120).optional(),
  to: z.string().max(120).optional(),
  startDate: z.string().max(40).optional(),
  endDate: z.string().max(40).optional(),
  sourceUrl: z.string().max(500),
  quote: z.string().min(1).max(400),
});
export const ExtractionSchema = z.strictObject({ closures: z.array(ExtractedClosureSchema).max(16) });
export type ExtractedClosure = z.infer<typeof ExtractedClosureSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;

/** JSON Schema (draft 7) for `response_format`. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

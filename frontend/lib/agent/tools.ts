/**
 * Agent tool schemas (docs/ARCHITECTURE.md 2.7). Shared by the browser state machine and the
 * server routes, which both re-validate every model output.
 *
 * The model returns exactly one action per turn. It is never asked for a metric, an outcome or a
 * sentence: its only "why" is a `rationale` SELECTION (a kind from a fixed list, plus an optional
 * catalog id), which the application renders as a labeled line in the decision log (rationale.ts).
 * No model-written text reaches a card or the log. Every headline and result line next to a
 * figure is an application template filled from simulator numbers with the real sign.
 */
import { z } from "zod";
import { CostTierSchema, ID_RE, LensSchema, CandidateTypeSchema } from "./catalog";
import { makeRationaleSchema } from "./rationale";
import { StressSpecSchema } from "./stress";

export const CandidateIdSchema = z.string().regex(ID_RE);
/**
 * Bundle IDs are minted by the application (server and client), never chosen by a model: B1..B12,
 * the first unused slot, in order. A model-authored ID could smuggle a figure into later prose.
 */
export const BUNDLE_ID_RE = /^B(?:1[0-2]|[1-9])$/;
export const BundleIdSchema = z.string().regex(BUNDLE_ID_RE);
export const GazetteerIdSchema = z.string().regex(ID_RE);

export const MAX_BUNDLE_SIZE = 3;
export const MAX_ROUNDS = 3;
export const MAX_EVALUATED_BUNDLES = 12;

/** The next `count` unused bundle IDs (B1..B12) in order. Fewer are returned when the slots run out. */
export function mintBundleIds(taken: Iterable<string>, count: number): string[] {
  const used = new Set(taken);
  const out: string[] = [];
  for (let n = 1; n <= MAX_EVALUATED_BUNDLES && out.length < count; n++) {
    const id = `B${n}`;
    if (!used.has(id)) out.push(id);
  }
  return out;
}

function bundleSchema(candidateId: z.ZodType<string>) {
  return z.strictObject({
    id: BundleIdSchema,
    candidateIds: z.array(candidateId).min(1).max(MAX_BUNDLE_SIZE),
  });
}
/** What a model may write for a new bundle: candidate IDs only. The application assigns the ID. */
function modelBundleSchema(candidateId: z.ZodType<string>) {
  return z.strictObject({ candidateIds: z.array(candidateId).min(1).max(MAX_BUNDLE_SIZE) });
}

/** The candidateId argument lets the server pin the model to a closed enum in the JSON schema. */
export function makeProposeSchema(candidateId: z.ZodType<string> = CandidateIdSchema) {
  return z.strictObject({
    action: z.literal("propose"),
    rationale: makeRationaleSchema(candidateId),
    bundles: z.array(bundleSchema(candidateId)).min(1).max(6),
  });
}
export function makeRefineSchema(candidateId: z.ZodType<string> = CandidateIdSchema) {
  return z.strictObject({
    action: z.literal("refine"),
    rationale: makeRationaleSchema(candidateId),
    keep: z.array(BundleIdSchema).max(MAX_EVALUATED_BUNDLES),
    drop: z.array(BundleIdSchema).max(MAX_EVALUATED_BUNDLES),
    add: z.array(bundleSchema(candidateId)).max(4),
  });
}
/** A finalist is a bundle id and nothing else: there is no model text on a finalist. */
export const FinalistSchema = z.strictObject({ bundleId: BundleIdSchema });
export const FinalizeSchema = z.strictObject({
  action: z.literal("finalize"),
  rationale: makeRationaleSchema(),
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

/* Model-facing forms: the shapes a model is asked for. The server mints bundle IDs after validation. */
export function makeProposeModelSchema(candidateId: z.ZodType<string> = CandidateIdSchema) {
  return z.strictObject({
    action: z.literal("propose"),
    rationale: makeRationaleSchema(candidateId),
    bundles: z.array(modelBundleSchema(candidateId)).min(1).max(6),
  });
}
export function makeRefineModelSchema(candidateId: z.ZodType<string> = CandidateIdSchema) {
  return z.strictObject({
    action: z.literal("refine"),
    rationale: makeRationaleSchema(candidateId),
    keep: z.array(BundleIdSchema).max(MAX_EVALUATED_BUNDLES),
    drop: z.array(BundleIdSchema).max(MAX_EVALUATED_BUNDLES),
    add: z.array(modelBundleSchema(candidateId)).max(4),
  });
}
export type ProposeModelOutput = z.infer<ReturnType<typeof makeProposeModelSchema>>;
export type RefineModelOutput = z.infer<ReturnType<typeof makeRefineModelSchema>>;

export type PlannerPhase = "search" | "finalize";
export type PlannerActionName = "propose" | "refine" | "finalize";

/** The one action allowed for a given phase and round. */
export function expectedAction(phase: PlannerPhase, round: number): PlannerActionName {
  if (phase === "finalize") return "finalize";
  return round <= 1 ? "propose" : "refine";
}

/** Schema of the action as the client sees it (bundle IDs already minted). */
export function plannerSchemaFor(action: PlannerActionName, candidateId?: z.ZodType<string>) {
  if (action === "propose") return makeProposeSchema(candidateId);
  if (action === "refine") return makeRefineSchema(candidateId);
  return FinalizeSchema;
}

/** Schema of what the model is asked to return (no bundle IDs to invent). */
export function plannerModelSchemaFor(action: PlannerActionName, candidateId?: z.ZodType<string>) {
  if (action === "propose") return makeProposeModelSchema(candidateId);
  if (action === "refine") return makeRefineModelSchema(candidateId);
  return FinalizeSchema;
}

/* ------------------------------ critic ------------------------------ */

export const CONCERN_KINDS = ["worst_case", "equity", "cost", "feasibility"] as const;
export type ConcernKind = (typeof CONCERN_KINDS)[number];
/**
 * The critic flags a bundle with a KIND only; the sentence shown to a reader comes from this
 * table, so no model-authored free text travels from the critic into the planner prompt or the log.
 */
export const CONCERN_TEXT: Record<ConcernKind, string> = {
  worst_case: "Worst-case outcomes in the unluckiest futures deserve a second look.",
  equity: "The equity gap between areas deserves a second look.",
  cost: "The cost tier deserves a second look.",
  feasibility: "Lead time or hypothetical status limits how feasible this is.",
};
export const CritiqueSchema = z.strictObject({
  action: z.literal("critique"),
  concerns: z.array(z.strictObject({ bundleId: BundleIdSchema, kind: z.enum(CONCERN_KINDS) })).max(24),
  veto: z.array(BundleIdSchema).max(MAX_EVALUATED_BUNDLES).optional(),
  /** The stress test the critic wants the simulator to run: a choice from the application's closed set (stress.ts). */
  stress: StressSpecSchema,
  rationale: makeRationaleSchema(),
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

/* ---------------------------- evaluation ---------------------------- */

/** One row of the `evaluation` tool message the client builds from simulator results. */
export const EvaluationRowSchema = z.strictObject({
  bundleId: BundleIdSchema,
  candidateIds: z.array(CandidateIdSchema).min(1).max(MAX_BUNDLE_SIZE),
  p50S: z.number().finite().min(0).max(1e7),
  p90S: z.number().finite().min(0).max(1e7),
  pctWithin: z.number().finite().min(0).max(100),
  isolatedCount: z.number().int().min(0).max(100_000),
  equityGapS: z.number().finite().min(0).max(1e7),
  pGoal: z.number().finite().min(0).max(1).nullable(),
  costTier: CostTierSchema,
});
export type EvaluationRow = z.infer<typeof EvaluationRowSchema>;

/**
 * What the evaluator returns for one bundle: the row plus the number of simulated futures that
 * were run FOR THIS ROW. The machine counts futures by summing this field over the rows it
 * accepts; it never uses an aggregate the evaluator claims for a batch.
 */
export const MAX_FUTURES_PER_ROW = 100_000;
export const EvaluatedRowSchema = EvaluationRowSchema.extend({
  futures: z.number().int().min(1).max(MAX_FUTURES_PER_ROW),
  /** Echo of the stress label when the row was scored under a stress. Informational: the machine uses its own label. */
  stressLabel: z.string().max(160).optional(),
});
export type EvaluatedRow = z.infer<typeof EvaluatedRowSchema>;

export const BaselineRowSchema = z.strictObject({
  p50S: z.number().finite().min(0).max(1e7),
  p90S: z.number().finite().min(0).max(1e7),
  pctWithin: z.number().finite().min(0).max(100),
  isolatedCount: z.number().int().min(0).max(100_000),
  equityGapS: z.number().finite().min(0).max(1e7),
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

/**
 * Adds the optional `reasoning` property to a model-facing JSON schema. The strict validation
 * schemas do NOT contain it: the server splits it off before validation and screens it on its
 * own (lib/agent/reasoning.ts), so a bad reasoning string can never reject an answer.
 */
export function withReasoningField(schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  return { ...schema, properties: { ...props, reasoning: { type: "string", maxLength: 600 } } };
}

/** JSON Schema (draft 7) for `response_format`. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

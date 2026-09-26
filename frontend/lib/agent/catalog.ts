/**
 * Intervention catalog and gazetteer contract (docs/ARCHITECTURE.md 2.3).
 *
 * The planner may only reference IDs that exist here. The catalog is loaded
 * from data/snapshot/candidates.json and gazetteer.json. Numeric effects are
 * carried through untouched but are NEVER shown to a model (see promptView).
 */
import { z } from "zod";

export const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const LensSchema = z.enum(["access", "ems"]);
export type Lens = z.infer<typeof LensSchema>;

export const CostTierSchema = z.enum(["$", "$$", "$$$"]);
export type CostTier = z.infer<typeof CostTierSchema>;

export const CANDIDATE_TYPES = [
  "signal_priority",
  "temp_link",
  "prepos_site",
  "hazmat_window",
  "incident_mgmt",
] as const;
export const CandidateTypeSchema = z.enum(CANDIDATE_TYPES);
export type CandidateType = z.infer<typeof CandidateTypeSchema>;

export const COST_TIER_RANK: Record<CostTier, number> = { $: 1, $$: 2, $$$: 3 };

export const CandidateSchema = z.looseObject({
  id: z.string().regex(ID_RE),
  type: CandidateTypeSchema,
  title: z.string().min(1).max(200),
  lens: z.array(LensSchema).min(1),
  costTier: CostTierSchema,
  costSource: z.string().nullable().optional(),
  leadTime: z.enum(["days", "weeks", "months"]),
  hypothetical: z.boolean(),
  effect: z.looseObject({ op: z.string() }),
  assumptions: z.array(z.string()).default([]),
  sources: z.array(z.unknown()).default([]),
  notes: z.string().default(""),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const GAZETTEER_KINDS = ["neighborhood", "road", "facility", "link", "corridor"] as const;

export const GazetteerEntrySchema = z.looseObject({
  id: z.string().regex(ID_RE),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  kind: z.enum(GAZETTEER_KINDS),
  ref: z.looseObject({
    hexes: z.array(z.number()).optional(),
    edges: z.array(z.number()).optional(),
    facility: z.string().optional(),
    link: z.string().optional(),
    corridor: z.string().optional(),
  }),
  lat: z.number(),
  lng: z.number(),
});
export type GazetteerEntry = z.infer<typeof GazetteerEntrySchema>;

export interface Catalog {
  candidates: Candidate[];
  byId: Map<string, Candidate>;
  gazetteer: GazetteerEntry[];
  gazetteerById: Map<string, GazetteerEntry>;
}

/** Parse and index raw JSON. Throws (ZodError) if the files break the contract. */
export function buildCatalog(candidatesJson: unknown, gazetteerJson: unknown = []): Catalog {
  const candidates = z.array(CandidateSchema).parse(candidatesJson);
  const gazetteer = z.array(GazetteerEntrySchema).parse(gazetteerJson);
  const byId = new Map<string, Candidate>();
  for (const c of candidates) {
    if (byId.has(c.id)) throw new Error(`duplicate candidate id ${c.id}`);
    byId.set(c.id, c);
  }
  const gazetteerById = new Map<string, GazetteerEntry>();
  for (const g of gazetteer) {
    if (gazetteerById.has(g.id)) throw new Error(`duplicate gazetteer id ${g.id}`);
    gazetteerById.set(g.id, g);
  }
  return { candidates, byId, gazetteer, gazetteerById };
}

/** The constraint subset the catalog filter needs. */
export interface CatalogConstraints {
  lens: Lens;
  maxCostTier: CostTier;
  /** Empty means "any type". */
  types: readonly CandidateType[];
}

/** Why a candidate is not usable under the mission, or null when it is. */
export function candidateRejection(c: Candidate, k: CatalogConstraints): string | null {
  if (!c.lens.includes(k.lens)) return `is not available for the ${k.lens} lens`;
  if (COST_TIER_RANK[c.costTier] > COST_TIER_RANK[k.maxCostTier]) {
    return `costs more than the allowed tier ${k.maxCostTier}`;
  }
  if (k.types.length > 0 && !k.types.includes(c.type)) return `has type ${c.type}, which is not allowed`;
  return null;
}

export function eligibleCandidates(catalog: Catalog, k: CatalogConstraints): Candidate[] {
  return catalog.candidates.filter((c) => candidateRejection(c, k) === null);
}

/** What a model may see about a candidate: no numeric effect, no notes. */
export interface CandidatePromptView {
  id: string;
  title: string;
  type: CandidateType;
  costTier: CostTier;
  leadTime: string;
  hypothetical: boolean;
}

export function promptView(c: Candidate): CandidatePromptView {
  return {
    id: c.id,
    title: c.title,
    type: c.type,
    costTier: c.costTier,
    leadTime: c.leadTime,
    hypothetical: c.hypothetical,
  };
}

/** The highest tier among a bundle's candidates (unknown IDs are ignored). */
export function bundleCostTier(catalog: Catalog, candidateIds: readonly string[]): CostTier {
  let best: CostTier = "$";
  for (const id of candidateIds) {
    const c = catalog.byId.get(id);
    if (c && COST_TIER_RANK[c.costTier] > COST_TIER_RANK[best]) best = c.costTier;
  }
  return best;
}

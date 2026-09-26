/**
 * Stress tests and candidate bundles as worlds, for the AI layer's evaluator (lib/agent/evaluate.ts).
 *
 *   worldWithStress(world, stress)   the app's stress spec {closedLinks, tod?, label} -> a world with one
 *                                    close_link mutation per closed link, plus the simulator's time of day
 *                                    ("midday" is "mid" here)
 *   bundleWorld(world, bundle)       a world with one apply_candidate mutation per candidate of the bundle
 *
 * The mutations are built by the application, not typed by a user: they are stamped `confirmedAt` at
 * construction, marked origin "agent", and a stress carries provenance {url: "stress-test:<key>", quote: label}
 * so the event log can say where each closure came from.
 */
import type { MutationRecord, TimeOfDay, WorldState } from "./contract";

/** The app's stress spec (lib/agent/stress.ts `StressContext`); declared structurally so lib/sim never imports the agent. */
export interface StressLike {
  closedLinks: readonly string[];
  /** "am" | "midday" | "pm" | "night" (the simulator's own name for midday is "mid"; both are accepted). */
  tod?: string;
  label: string;
}

export interface BundleLike {
  id: string;
  candidateIds: readonly string[];
}

export interface StressApplied {
  label: string;
  closedLinks: string[];
  tod: TimeOfDay | null;
}

const TOD_MAP: Record<string, TimeOfDay> = { am: "am", midday: "mid", mid: "mid", pm: "pm", night: "night" };

/** App time-of-day name -> simulator time of day. Throws RangeError on anything else. */
export function simTod(tod: string): TimeOfDay {
  const t = TOD_MAP[tod];
  if (!t) throw new RangeError(`unknown time of day "${tod}" (expected am, midday, pm or night)`);
  return t;
}

export function worldWithStress(world: WorldState, stress: StressLike | undefined | null, now: string = new Date().toISOString()): { world: WorldState; tod: TimeOfDay | null; applied: StressApplied | null } {
  if (!stress) return { world, tod: null, applied: null };
  const tod = stress.tod === undefined ? null : simTod(stress.tod);
  const closed = [...new Set(stress.closedLinks)];
  const mutations: MutationRecord[] = closed.map((linkId) => ({
    id: `stress-close-${linkId}`,
    m: { kind: "close_link", linkId },
    origin: "agent",
    label: `Stress test: ${stress.label}`,
    provenance: { url: `stress-test:${linkId}`, quote: stress.label, retrievedAt: now },
    confirmedAt: now,
  }));
  const taken = new Set(world.mutations.map((r) => r.id));
  for (const m of mutations) if (taken.has(m.id)) throw new Error(`world already has a mutation with id ${m.id}`);
  return { world: { ...world, mutations: [...world.mutations, ...mutations] }, tod, applied: { label: stress.label, closedLinks: closed, tod } };
}

/** `world` plus the bundle's candidates. A candidate the world already applied fails later, at compile ("applied twice"). */
export function bundleWorld(world: WorldState, bundle: BundleLike, now: string = new Date().toISOString()): WorldState {
  const add: MutationRecord[] = bundle.candidateIds.map((candidateId) => ({
    id: `bundle-${bundle.id}-${candidateId}`,
    m: { kind: "apply_candidate", candidateId },
    origin: "agent",
    label: `Bundle ${bundle.id}: ${candidateId}`,
    confirmedAt: now,
  }));
  return { ...world, mutations: [...world.mutations, ...add] };
}

const TIER_RANK: Record<string, number> = { $: 1, $$: 2, $$$: 3 };

/** Highest cost tier among a bundle's candidates (null if any candidate is unknown to `tiers`). */
export function bundleCostTier(candidateIds: readonly string[], tiers: ReadonlyMap<string, string>): string | null {
  let best: string | null = null;
  for (const id of candidateIds) {
    const t = tiers.get(id);
    if (!t) return null;
    if (best === null || (TIER_RANK[t] ?? 0) > (TIER_RANK[best] ?? 0)) best = t;
  }
  return best;
}

/**
 * Browser side of the closure confirmation contract.
 *
 * A closure found by a news search is a PROPOSAL. Nothing may enter a world from one unless the
 * user explicitly confirmed that proposal, and the type system makes the wrong order awkward:
 *
 *   ClosureProposal  --(user clicks Confirm)-->  UserConfirmation
 *                    --(server redeems the single-use token)-->  ConfirmedTavilyMutation
 *
 *   - `recordUserConfirmation` is the only producer of a UserConfirmation. Call it from the
 *     click handler of an explicit "Confirm" control, never from an effect or a response handler.
 *   - `confirmClosureProposal` needs a UserConfirmation for the SAME proposal, then redeems the
 *     proposal's server-issued, single-use, short-lived token. The mutation, label and provenance
 *     in the result are the ones the server proposed; the caller cannot alter them.
 *   - `toMutationRecord` accepts only a ConfirmedTavilyMutation and yields the record shape that
 *     lib/sim/compile.ts accepts (origin "tavily", provenance, confirmedAt). compile.ts still
 *     refuses any record that lacks confirmedAt or provenance; this module never bypasses that.
 *
 * TRUST BOUNDARY, stated honestly: the client is the user's own browser. Anything this code can do,
 * the user can do by hand, and the sim's compile step cannot verify where a record came from.
 * TypeScript brands cannot stop code that casts around them, so the server token is the
 * enforcement point against everything except the user: it proves that a confirmation round trip
 * happened, that the mutation is the one the server proposed (signed, bound to the requester),
 * and that it was used once. It does not, and cannot, protect against the user themselves.
 * tests (test/ai/round2.test.ts) fail if any other app or library code constructs a
 * tavily-origin record.
 */
import type { MutationRecord } from "../sim/contract";
import type { ClosureProposal, ConfirmClosureResponse, ConfirmedClosureRecord } from "./protocol";

declare const userConfirmation: unique symbol;
declare const confirmedMutation: unique symbol;

export interface UserConfirmation {
  readonly [userConfirmation]: true;
  readonly proposalId: string;
  /** ISO time of the click. */
  readonly at: string;
}

export type ConfirmedTavilyMutation = ConfirmedClosureRecord & { readonly [confirmedMutation]: true };

/** Records that the user explicitly confirmed this proposal. Only a click handler should call it. */
export function recordUserConfirmation(proposal: Pick<ClosureProposal, "id">, at: Date = new Date()): UserConfirmation {
  return { proposalId: proposal.id, at: at.toISOString() } as UserConfirmation;
}

export class ConfirmationError extends Error {}

export async function confirmClosureProposal(
  proposal: ClosureProposal,
  confirmation: UserConfirmation,
  opts: { fetchImpl?: typeof fetch; baseUrl?: string } = {},
): Promise<ConfirmedTavilyMutation> {
  if (confirmation.proposalId !== proposal.id) throw new ConfirmationError("The confirmation is for a different proposal.");
  if (!proposal.confirmToken) throw new ConfirmationError("This proposal cannot be confirmed right now.");
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const res = await f(`${opts.baseUrl ?? ""}/api/closures/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: proposal.confirmToken }),
  });
  let body: ConfirmClosureResponse;
  try {
    body = (await res.json()) as ConfirmClosureResponse;
  } catch {
    throw new ConfirmationError("The confirmation service did not answer.");
  }
  if (body.status !== "ok") throw new ConfirmationError(body.message);
  const r = body.record;
  if (r.origin !== "tavily" || !r.provenance?.url || !r.provenance?.quote || !r.confirmedAt) {
    throw new ConfirmationError("The confirmation service returned an incomplete record.");
  }
  return r as ConfirmedTavilyMutation;
}

/** The record lib/sim/compile.ts takes. Only a redeemed confirmation can be turned into one. */
export function toMutationRecord(c: ConfirmedTavilyMutation): MutationRecord {
  return {
    id: c.id,
    m: c.m,
    origin: "tavily",
    label: c.label,
    provenance: { url: c.provenance.url, quote: c.provenance.quote, retrievedAt: c.provenance.retrievedAt },
    confirmedAt: c.confirmedAt,
  };
}

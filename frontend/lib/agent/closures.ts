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
 * tests (test/ai) fail if any other app or library code constructs a tavily-origin record.
 *
 * RUNTIME RECEIPT: a redeemed confirmation is registered in a module-private WeakSet. The exact
 * call the UI must make before it hands ANY closure record to the world (the store's add-mutation
 * path) is
 *
 *     assertMutationRecordAllowed(record)   // throws unless the record is a receipt-backed result of toMutationRecord
 *
 * for records whose origin is "tavily", and for any close_link / close_edges record that carries
 * a provenance or an "unverified news" label (a hand-built origin "user" record dressed up as a
 * news closure is refused). A user's own manual closure (no provenance, no news label) passes.
 * `assertConfirmedClosure(x)` is the narrower check that x came out of confirmClosureProposal.
 * A copy of a record (spread, JSON round trip) has no receipt and is refused on purpose.
 *
 * SESSION: `fetchClosures()` sends an opaque, app-generated session id (`x-ws-session`) so a
 * confirmation token stays valid when the phone's network changes between search and confirm.
 * ClosuresDrawer should call `fetchClosures()` instead of a bare fetch("/api/closures").
 */
import type { MutationRecord } from "../sim/contract";
import type { ClosureProposal, ClosuresResponse, ConfirmClosureResponse, ConfirmedClosureRecord } from "./protocol";

declare const userConfirmation: unique symbol;
declare const confirmedMutation: unique symbol;

export interface UserConfirmation {
  readonly [userConfirmation]: true;
  readonly proposalId: string;
  /** ISO time of the click. */
  readonly at: string;
}

export type ConfirmedTavilyMutation = ConfirmedClosureRecord & { readonly [confirmedMutation]: true };

/** Objects produced by a redeemed confirmation (and the records built from them). Nothing else is ever added. */
const receipts = new WeakSet<object>();
const producedRecords = new WeakSet<object>();

/** Throws unless `record` is the direct result of a redeemed confirmation. */
export function assertConfirmedClosure(record: unknown): asserts record is ConfirmedTavilyMutation {
  if (typeof record !== "object" || record === null || !receipts.has(record)) {
    throw new ConfirmationError("This closure was not confirmed through the server.");
  }
}

const NEWS_LABEL = /unverified|news report|tavily/i;

/**
 * The gate for every mutation record entering a world: a tavily-origin record must come from
 * toMutationRecord, and a closure that presents itself as news-sourced (provenance or label) must
 * too, whatever its origin field says. Throws ConfirmationError when it does not.
 */
export function assertMutationRecordAllowed(record: MutationRecord): void {
  const closes = record.m.kind === "close_link" || record.m.kind === "close_edges";
  const newsLike = record.provenance !== undefined || NEWS_LABEL.test(record.label);
  if ((record.origin === "tavily" || (closes && newsLike)) && !producedRecords.has(record)) {
    throw new ConfirmationError("A news-sourced closure needs a confirmed proposal.");
  }
}

const SESSION_KEY = "ws_session";
let memorySession: string | null = null;

/** An opaque random id for this browser tab session. It is not an identity and carries nothing personal. */
export function sessionId(): string {
  if (memorySession) return memorySession;
  try {
    const stored = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SESSION_KEY) : null;
    if (stored && /^[A-Za-z0-9_-]{16,64}$/.test(stored)) return (memorySession = stored);
  } catch {
    /* storage may be blocked */
  }
  const bytes = new Uint8Array(18);
  (globalThis.crypto ?? { getRandomValues: (a: Uint8Array) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  memorySession = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(SESSION_KEY, memorySession);
  } catch {
    /* ignore */
  }
  return memorySession;
}

/** POST /api/closures with the session header. Returns the parsed body (an "unavailable" body for a non-JSON answer). */
export async function fetchClosures(opts: { fetchImpl?: typeof fetch; baseUrl?: string; signal?: AbortSignal } = {}): Promise<ClosuresResponse> {
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const res = await f(`${opts.baseUrl ?? ""}/api/closures`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ws-session": sessionId() },
    body: "{}",
    signal: opts.signal,
  });
  try {
    return (await res.json()) as ClosuresResponse;
  } catch {
    return { status: "unavailable", reason: "upstream_error", message: "The closure service did not answer." };
  }
}

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
    headers: { "content-type": "application/json", "x-ws-session": sessionId() },
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
  receipts.add(r);
  return r as ConfirmedTavilyMutation;
}

/** The record lib/sim/compile.ts takes. Only a redeemed confirmation can be turned into one. */
export function toMutationRecord(c: ConfirmedTavilyMutation): MutationRecord {
  assertConfirmedClosure(c);
  const rec: MutationRecord = {
    id: c.id,
    m: c.m,
    origin: "tavily",
    label: c.label,
    provenance: { url: c.provenance.url, quote: c.provenance.quote, retrievedAt: c.provenance.retrievedAt },
    confirmedAt: c.confirmedAt,
  };
  producedRecords.add(rec);
  return rec;
}

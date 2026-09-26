/**
 * Per-mission ledger on the SharedStore.
 *
 * A mission id is only a name the browser chose, so it proves nothing by itself. This ledger
 * makes the id safe to accept:
 *   - Ownership: (mission id, client) pairs are recorded with SET NX. A known id from a client
 *     that has not been seen with it before is charged against that client's quota, exactly like
 *     a new mission, so an id cannot be passed around to get free calls.
 *   - One in-flight request per mission (a lock with a short TTL), so parallel requests cannot all
 *     pass a budget check that runs before any of them records.
 *   - Tokens are charged BEFORE the provider call: estimated input plus max output tokens are
 *     added atomically, then trued up when the real usage is known. Failures keep the input cost.
 *   - A cap on provider calls per mission, counting every attempt.
 *   - Ask caps per route, so a mission cannot loop on a route.
 * Store cost (Upstash commands): about 10 per model call once a mission is known: lock 2, ask 1,
 * mission reserve 1 and settle 1, client and global dollars 2 + 2, plus a lookup of the mission
 * pair (0-1). Everything is a single INCRBY or SET.
 */
import { randomBytes } from "node:crypto";
import { ipKey } from "./ratelimit";
import type { SharedStore } from "./store";

export const MISSION_TTL_MS = 2 * 3600_000;
export const MIN_OUTPUT_TOKENS = 300;
/** Asks per route kind and mission: parse 3, plan 12 (four turns, a retry or two each), critique 9. */
export const TURN_LIMITS: Record<string, number> = { parse: 3, plan: 12, critique: 9 };

export interface MissionCaps {
  inputTokens: number;
  outputTokens: number;
  maxCalls: number;
}

export type ReserveDenied = "input" | "output" | "calls";

export type MissionReservation = {
  ok: true;
  /** max_tokens to send: never more than what is left of the mission's output budget. */
  maxTokens: number;
  reservedIn: number;
  reservedOut: number;
  /** Totals after the reservation (for the usage event). */
  inputTokens: number;
  outputTokens: number;
};

/**
 * A mission's calls, output tokens and input tokens live in ONE integer counter so a reservation,
 * a settlement or a refund is a single INCRBY (1 command): calls x 1e14 + output x 1e7 + input.
 * Each field stays far below its slot (input and output under 1e7 tokens, calls under 90).
 */
const OUT_UNIT = 1e7;
const CALL_UNIT = 1e14;
const FIELD_MAX = 5_000_000;

export function encodeUsage(calls: number, out: number, inn: number): number {
  return calls * CALL_UNIT + out * OUT_UNIT + inn;
}
export function decodeUsage(v: number): { calls: number; out: number; inn: number } {
  const calls = Math.floor(v / CALL_UNIT);
  const rest = v - calls * CALL_UNIT;
  const out = Math.floor(rest / OUT_UNIT);
  return { calls, out, inn: rest - out * OUT_UNIT };
}

const BOUND_CACHE_MAX = 5_000;

export class MissionLedger {
  /** (mission, client) pairs already known on this process, so repeat requests skip a store read. */
  private bound = new Map<string, number>();
  constructor(
    private store: SharedStore,
    private ttlMs: number = MISSION_TTL_MS,
    private now: () => number = Date.now,
  ) {}

  private k(id: string, part: string): string {
    return `m:${id}:${part}`;
  }

  /* ------------------------------- ownership ------------------------------ */

  private remember(key: string): void {
    if (this.bound.size >= BOUND_CACHE_MAX) this.bound.delete(this.bound.keys().next().value as string);
    this.bound.set(key, this.now() + this.ttlMs);
  }

  private knownHere(key: string): boolean {
    const exp = this.bound.get(key);
    if (exp === undefined) return false;
    if (exp <= this.now()) {
      this.bound.delete(key);
      return false;
    }
    return true;
  }

  /** Has this client already been seen with this mission id? (1 command, or none when this process already knows.) */
  async isBound(id: string, ip: string): Promise<boolean> {
    const key = this.k(id, `o:${ipKey(ip)}`);
    if (this.knownHere(key)) return true;
    const yes = (await this.store.get(key)) !== null;
    if (yes) this.remember(key);
    return yes;
  }

  /** Records the pair. True only for the request that created it (check-and-set, 1 command). */
  async bind(id: string, ip: string): Promise<boolean> {
    const key = this.k(id, `o:${ipKey(ip)}`);
    const created = await this.store.setIfAbsent(key, "1", this.ttlMs);
    this.remember(key);
    return created;
  }

  /* ------------------------------ in-flight lock --------------------------- */

  /** One request at a time per mission (1 command). Returns a token to release with, or null when busy. */
  async acquire(id: string, lockMs: number): Promise<string | null> {
    const token = randomBytes(8).toString("hex");
    return (await this.store.setIfAbsent(this.k(id, "lock"), token, lockMs)) ? token : null;
  }

  /** Compare-and-delete (1 command): a request can only release the lock it holds, never a newer one. */
  async release(id: string, token: string): Promise<void> {
    try {
      await this.store.delIfEquals(this.k(id, "lock"), token);
    } catch {
      /* the lock expires on its own */
    }
  }

  /* -------------------------------- tokens -------------------------------- */

  /**
   * Charges one upstream attempt before it happens: one call, `estIn` input tokens and up to
   * `maxOut` output tokens, with one INCRBY (1 command; 2 when a refusal must be refunded, or when
   * only part of the output allowance is left).
   */
  async reserve(id: string, estIn: number, maxOut: number, caps: MissionCaps): Promise<MissionReservation | { ok: false; reason: ReserveDenied }> {
    if (estIn >= FIELD_MAX || maxOut >= FIELD_MAX) return { ok: false, reason: "input" };
    const key = this.k(id, "u");
    const full = encodeUsage(1, maxOut, estIn);
    const v = decodeUsage(await this.store.incrLite(key, full, this.ttlMs));
    const refund = async (reason: ReserveDenied) => {
      await this.store.incrLite(key, -full, this.ttlMs);
      return { ok: false as const, reason };
    };
    if (v.calls > caps.maxCalls) return refund("calls");
    if (v.inn > caps.inputTokens) return refund("input");
    let granted = maxOut;
    let outTotal = v.out;
    if (v.out > caps.outputTokens) {
      // Take only what is left, if that is still enough for a useful answer.
      const left = caps.outputTokens - (v.out - maxOut);
      if (left < MIN_OUTPUT_TOKENS) return refund("output");
      await this.store.incrLite(key, -(maxOut - left) * OUT_UNIT, this.ttlMs);
      granted = left;
      outTotal = v.out - (maxOut - left);
    }
    return { ok: true, maxTokens: granted, reservedIn: estIn, reservedOut: granted, inputTokens: v.inn, outputTokens: outTotal };
  }

  /**
   * Trues the reservation up to what happened (1 command, none when nothing changed). On success
   * pass the real usage. On failure pass the estimated input as `actualIn` and 0 output: a failed
   * attempt still costs at least its input.
   */
  async settle(id: string, r: MissionReservation, actualIn: number, actualOut: number): Promise<{ inputTokens: number; outputTokens: number }> {
    const delta = (actualOut - r.reservedOut) * OUT_UNIT + (actualIn - r.reservedIn);
    if (delta === 0) return { inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    const v = decodeUsage(await this.store.incrLite(this.k(id, "u"), delta, this.ttlMs));
    return { inputTokens: v.inn, outputTokens: v.out };
  }

  /** Returns a refused or abandoned reservation: the call, the input tokens and the output tokens (1 command). */
  async cancel(id: string, r: MissionReservation): Promise<void> {
    await this.store.incrLite(this.k(id, "u"), -encodeUsage(1, r.reservedOut, r.reservedIn), this.ttlMs);
  }

  /** Current totals (1 command). For tests and diagnostics. */
  async usage(id: string): Promise<{ calls: number; inputTokens: number; outputTokens: number }> {
    const v = decodeUsage(Number((await this.store.get(this.k(id, "u"))) ?? 0));
    return { calls: v.calls, inputTokens: v.inn, outputTokens: v.out };
  }

  /* --------------------------------- turns -------------------------------- */

  /**
   * Counts one ask on a route kind ("plan", "critique", ...) and refuses it once the mission has
   * asked `max` times (1 command). A mission cannot loop on a route or ask for endless rounds.
   */
  async claimTurn(id: string, kind: string, max: number): Promise<boolean> {
    const key = this.k(id, `t:${kind}`);
    const n = await this.store.incrLite(key, 1, this.ttlMs);
    if (n > max) {
      await this.store.incrLite(key, -1, this.ttlMs);
      return false;
    }
    return true;
  }
}

/** What runStructured charges: a ledger, a mission id and its caps. */
export interface MissionAccount {
  ledger: MissionLedger;
  id: string;
  caps: MissionCaps;
}

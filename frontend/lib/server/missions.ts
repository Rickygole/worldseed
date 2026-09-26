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
 *   - Turn caps per route, so a mission cannot ask for endless rounds.
 */
import { randomBytes } from "node:crypto";
import { ipKey } from "./ratelimit";
import type { SharedStore } from "./store";

export const MISSION_TTL_MS = 2 * 3600_000;
export const MIN_OUTPUT_TOKENS = 300;
/** The same turn may be asked this many times (a retry or two), never endlessly. */
export const TURN_REPEAT_MAX = 3;

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

export class MissionLedger {
  constructor(
    private store: SharedStore,
    private ttlMs: number = MISSION_TTL_MS,
  ) {}

  private k(id: string, part: string): string {
    return `m:${id}:${part}`;
  }

  /* ------------------------------- ownership ------------------------------ */

  /** Has this client already been seen with this mission id? */
  async isBound(id: string, ip: string): Promise<boolean> {
    return (await this.store.get(this.k(id, `o:${ipKey(ip)}`))) !== null;
  }

  /** Records the pair. True only for the request that created it (check-and-set). */
  async bind(id: string, ip: string): Promise<boolean> {
    return this.store.setIfAbsent(this.k(id, `o:${ipKey(ip)}`), "1", this.ttlMs);
  }

  /* ------------------------------ in-flight lock --------------------------- */

  /** One request at a time per mission. Returns a token to release with, or null when busy. */
  async acquire(id: string, lockMs: number): Promise<string | null> {
    const token = randomBytes(8).toString("hex");
    return (await this.store.setIfAbsent(this.k(id, "lock"), token, lockMs)) ? token : null;
  }

  async release(id: string, token: string): Promise<void> {
    try {
      if ((await this.store.get(this.k(id, "lock"))) === token) await this.store.del(this.k(id, "lock"));
    } catch {
      /* the lock expires on its own */
    }
  }

  /* -------------------------------- tokens -------------------------------- */

  /**
   * Charges one upstream attempt before it happens: one call, `estIn` input tokens and up to
   * `maxOut` output tokens. Every step is a single atomic increment, compared after the fact;
   * a refused reservation is refunded.
   */
  async reserve(id: string, estIn: number, maxOut: number, caps: MissionCaps): Promise<MissionReservation | { ok: false; reason: ReserveDenied }> {
    const calls = await this.store.incr(this.k(id, "calls"), 1, this.ttlMs);
    if (calls.value > caps.maxCalls) {
      await this.store.incr(this.k(id, "calls"), -1, this.ttlMs);
      return { ok: false, reason: "calls" };
    }
    const refundCall = () => this.store.incr(this.k(id, "calls"), -1, this.ttlMs);

    const inn = await this.store.incr(this.k(id, "in"), estIn, this.ttlMs);
    if (inn.value > caps.inputTokens) {
      await this.store.incr(this.k(id, "in"), -estIn, this.ttlMs);
      await refundCall();
      return { ok: false, reason: "input" };
    }

    let out = await this.store.incr(this.k(id, "out"), maxOut, this.ttlMs);
    let granted = maxOut;
    if (out.value > caps.outputTokens) {
      // Take only what is left, if that is still enough for a useful answer.
      const left = caps.outputTokens - (out.value - maxOut);
      await this.store.incr(this.k(id, "out"), -maxOut, this.ttlMs);
      if (left < MIN_OUTPUT_TOKENS) {
        await this.store.incr(this.k(id, "in"), -estIn, this.ttlMs);
        await refundCall();
        return { ok: false, reason: "output" };
      }
      out = await this.store.incr(this.k(id, "out"), left, this.ttlMs);
      granted = left;
      if (out.value > caps.outputTokens) {
        await this.store.incr(this.k(id, "out"), -left, this.ttlMs);
        await this.store.incr(this.k(id, "in"), -estIn, this.ttlMs);
        await refundCall();
        return { ok: false, reason: "output" };
      }
    }
    return { ok: true, maxTokens: granted, reservedIn: estIn, reservedOut: granted, inputTokens: inn.value, outputTokens: out.value };
  }

  /**
   * Trues the reservation up to what happened. On success pass the real usage. On failure pass the
   * estimated input as `actualIn` and 0 output: a failed attempt still costs at least its input.
   */
  async settle(id: string, r: MissionReservation, actualIn: number, actualOut: number): Promise<{ inputTokens: number; outputTokens: number }> {
    const dIn = actualIn - r.reservedIn;
    const dOut = actualOut - r.reservedOut;
    const [i, o] = await Promise.all([
      dIn === 0 ? Promise.resolve(r.inputTokens) : this.store.incr(this.k(id, "in"), dIn, this.ttlMs).then((x) => x.value),
      dOut === 0 ? Promise.resolve(r.outputTokens) : this.store.incr(this.k(id, "out"), dOut, this.ttlMs).then((x) => x.value),
    ]);
    return { inputTokens: i, outputTokens: o };
  }

  /** Returns a refused or abandoned reservation: the call, the input tokens and the output tokens. */
  async cancel(id: string, r: MissionReservation): Promise<void> {
    await Promise.all([
      this.store.incr(this.k(id, "calls"), -1, this.ttlMs),
      this.store.incr(this.k(id, "in"), -r.reservedIn, this.ttlMs),
      this.store.incr(this.k(id, "out"), -r.reservedOut, this.ttlMs),
    ]);
  }

  /* --------------------------------- turns -------------------------------- */

  /**
   * Claims a turn (for example "search:2" on the plan route). A route kind may use at most
   * `maxTurns` distinct turns, and the same turn may be asked at most `maxRepeats` times, so a
   * mission cannot ask for endless rounds or loop on one round.
   */
  async claimTurn(id: string, kind: string, turn: string, maxTurns: number, maxRepeats = TURN_REPEAT_MAX): Promise<boolean> {
    const rk = this.k(id, `tr:${kind}:${turn}`);
    const reps = await this.store.incr(rk, 1, this.ttlMs);
    if (reps.value > maxRepeats) {
      await this.store.incr(rk, -1, this.ttlMs);
      return false;
    }
    if (reps.value === 1) {
      const n = await this.store.incr(this.k(id, `tc:${kind}`), 1, this.ttlMs);
      if (n.value > maxTurns) {
        await this.store.incr(this.k(id, `tc:${kind}`), -1, this.ttlMs);
        await this.store.incr(rk, -1, this.ttlMs);
        return false;
      }
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

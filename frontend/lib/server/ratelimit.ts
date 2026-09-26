/**
 * Per-client limits and the global daily spend ceiling, both on the SharedStore.
 *
 * Counters are "increment first, then compare": one atomic INCRBY decides, so concurrent requests
 * cannot all pass a check that runs before any of them records. A denied request refunds its own
 * increment. A store failure means "deny" (fail closed) with `error: true` so the caller can say
 * the protection layer is unavailable rather than pretend the visitor was rate limited.
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { logEvent } from "./log";
import { StoreError, type SharedStore } from "./store";

export interface LimitRule {
  name: string;
  limit: number;
  windowMs: number;
}

export interface LimitResult {
  allowed: boolean;
  /** The rule that refused the request, when not allowed. */
  blockedBy?: string;
  retryAfterS: number;
  /** True when the store failed (the request is denied, but not because of the visitor's usage). */
  error?: boolean;
}

export interface RateLimiter {
  consume(key: string, rules: readonly LimitRule[]): Promise<LimitResult>;
  /** Gives back one unit for every rule (used when an admitted request is abandoned before use). */
  refund(key: string, rules: readonly LimitRule[]): Promise<void>;
}

export const HOUR_MS = 3600_000;
export const DAY_MS = 24 * HOUR_MS;
export const utcDay = (t: number): string => new Date(t).toISOString().slice(0, 10);

/**
 * The budget "day" starts at `resetHourUtc` (default 08:00 UTC = 01:00 Pacific) instead of at
 * midnight UTC, so the refill never lands in the middle of a US-daytime judging window.
 */
export function budgetWindow(t: number, resetHourUtc: number): string {
  return utcDay(t - resetHourUtc * HOUR_MS);
}

/* --------------------------------- limiter -------------------------------- */

export class StoreRateLimiter implements RateLimiter {
  constructor(private store: SharedStore) {}

  private k(key: string, rule: LimitRule): string {
    return `rl:${key}:${rule.name}`;
  }

  async consume(key: string, rules: readonly LimitRule[]): Promise<LimitResult> {
    let results;
    try {
      results = await Promise.all(rules.map((r) => this.store.incr(this.k(key, r), 1, r.windowMs)));
    } catch (e) {
      if (!(e instanceof StoreError)) throw e;
      logEvent("warn", "limiter_store_error", { reason: e.message });
      return { allowed: false, blockedBy: "store_error", retryAfterS: 30, error: true };
    }
    let blocked: LimitRule | undefined;
    let retry = 0;
    rules.forEach((r, i) => {
      if (results[i].value > r.limit) {
        const wait = Math.ceil((results[i].ttlMs || r.windowMs) / 1000);
        if (!blocked || wait > retry) {
          blocked = r;
          retry = wait;
        }
      }
    });
    if (!blocked) return { allowed: true, retryAfterS: 0 };
    await this.refund(key, rules); // a refused request is not recorded
    return { allowed: false, blockedBy: (blocked as LimitRule).name, retryAfterS: Math.max(1, retry) };
  }

  async refund(key: string, rules: readonly LimitRule[]): Promise<void> {
    await Promise.all(
      rules.map((r) =>
        this.store.incr(this.k(key, r), -1, r.windowMs).catch((e) => {
          if (e instanceof StoreError) logEvent("warn", "limiter_refund_failed", { reason: e.message });
        }),
      ),
    );
  }
}

/* ------------------------------- daily spend ------------------------------- */

export interface BudgetStatus {
  ceilingUsd: number;
  spentUsd: number;
  exhausted: boolean;
}

export interface BudgetReservation {
  /** The ledger window the reservation was made in (settle goes to the same one). */
  key: string;
  micros: number;
}

const toMicros = (usd: number): number => Math.max(0, Math.ceil(usd * 1e6));

/**
 * Global daily spend ceiling in integer micro-dollars. A reservation is added to the shared
 * counter BEFORE the provider call (worst-case cost), then trued up with the real cost. If the
 * function dies between the two, the reservation simply stays charged: the ledger errs high.
 * `reserve` and `status` throw StoreError when the store is down; callers deny in that case.
 */
export class DailyBudget {
  private ceilingMicros: number;
  constructor(
    private store: SharedStore,
    private ceilingUsd: number,
    private now: () => number = Date.now,
    private resetHourUtc = 8,
  ) {
    this.ceilingMicros = toMicros(ceilingUsd);
  }

  private key(): string {
    return `spend:${budgetWindow(this.now(), this.resetHourUtc)}`;
  }

  async status(): Promise<BudgetStatus> {
    const spentMicros = Number((await this.store.get(this.key())) ?? 0) || 0;
    return { ceilingUsd: this.ceilingUsd, spentUsd: spentMicros / 1e6, exhausted: spentMicros >= this.ceilingMicros };
  }

  /** Reserves the worst-case cost of a call. Returns null when the ceiling would be crossed. */
  async reserve(estimateUsd: number): Promise<BudgetReservation | null> {
    const key = this.key();
    const micros = toMicros(estimateUsd);
    const { value } = await this.store.incr(key, micros, 2 * DAY_MS);
    if (value > this.ceilingMicros) {
      await this.store.incr(key, -micros, 2 * DAY_MS).catch(() => undefined);
      return null;
    }
    return { key, micros };
  }

  /** Replaces the reservation with the real cost. Never throws: a failure leaves the ledger high. */
  async settle(reservation: BudgetReservation, actualUsd: number): Promise<void> {
    const diff = toMicros(actualUsd) - reservation.micros;
    if (diff === 0) return;
    try {
      await this.store.incr(reservation.key, diff, 2 * DAY_MS);
    } catch (e) {
      if (e instanceof StoreError) logEvent("warn", "budget_settle_failed", { reason: e.message });
      else throw e;
    }
  }
}

/* ----------------------------- default limits ----------------------------- */

/** Visitors with no identifiable address share one bucket, so it is kept much tighter. */
export const UNKNOWN_IP = "unknown";

export function missionRules(perHour: number, perDay: number, ip: string = ""): LimitRule[] {
  const tight = ip === UNKNOWN_IP;
  const scale = (n: number) => (tight ? Math.max(1, Math.floor(n / 5)) : n);
  return [
    { name: "missions_per_hour", limit: scale(perHour), windowMs: HOUR_MS },
    { name: "missions_per_day", limit: scale(perDay), windowMs: DAY_MS },
  ];
}

/* --------------------------------- client IP -------------------------------- */

/** Canonical bucket for an address: IPv4 as is, IPv4-mapped IPv6 as IPv4, other IPv6 by /64. */
export function bucketIp(raw: string): string | null {
  let s = raw.trim();
  if (s.startsWith("[") && s.includes("]")) s = s.slice(1, s.indexOf("]"));
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const kind = isIP(s);
  if (kind === 4) return s;
  if (kind !== 6) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const fill = s.includes("::") ? Array(Math.max(0, 8 - h.length - t.length)).fill("0") : [];
  const groups = [...h, ...fill, ...t].map((g) => g.toLowerCase().padStart(4, "0"));
  if (groups.length !== 8) return null;
  return `v6:${groups.slice(0, 4).join(":")}/64`;
}

/**
 * The client address, as trustworthy as the headers allow:
 *   1. x-vercel-forwarded-for, then x-real-ip: both are set by the platform edge, not the client.
 *   2. x-forwarded-for: the client is `trustedHops` entries from the RIGHT (the entry our own
 *      proxy appended); anything further left is client-controlled and ignored.
 * IPv6 is bucketed by /64 so rotating within a /64 does not create new identities.
 * No usable address returns "unknown", which callers rate limit as one tight shared bucket.
 */
export function clientIp(headers: { get(name: string): string | null }, opts: { trustedHops?: number } = {}): string {
  const first = (v: string | null) => (v ? v.split(",")[0] : null);
  const platform = first(headers.get("x-vercel-forwarded-for")) ?? headers.get("x-real-ip");
  let raw: string | null | undefined = platform;
  if (!raw || bucketIp(raw) === null) {
    const xff = headers.get("x-forwarded-for");
    if (xff) {
      const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
      const hops = Math.max(1, opts.trustedHops ?? 1);
      raw = parts[Math.max(0, parts.length - hops)];
    }
  }
  return (raw ? bucketIp(raw) : null) ?? UNKNOWN_IP;
}

/**
 * Short stable key for an address, so raw IPs never appear in the store. Set WS_IP_HASH_SALT to a
 * private value to make the keys hard to reverse by trying every IPv4 address.
 */
export function ipKey(ip: string): string {
  return createHash("sha256").update(`ws1:${process.env.WS_IP_HASH_SALT ?? ""}:${ip}`).digest("hex").slice(0, 16);
}

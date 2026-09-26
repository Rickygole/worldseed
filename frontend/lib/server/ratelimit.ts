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

/**
 * Increment-then-compare on the store. One rule costs 2 commands (INCRBY + PEXPIRE NX in one
 * transaction). A refused request keeps its increment on the rule that refused it (the window
 * still ends on schedule) and gives back the rules that would have allowed it, so the common
 * single-rule refusal costs 2 commands.
 */
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
        // The remaining window is only known on the first hit; otherwise the full window is a safe upper bound.
        const wait = Math.ceil((results[i].ttlMs || r.windowMs) / 1000);
        if (!blocked || wait > retry) {
          blocked = r;
          retry = wait;
        }
      }
    });
    if (!blocked) return { allowed: true, retryAfterS: 0 };
    const passed = rules.filter((r) => r !== blocked);
    if (passed.length > 0) await this.refund(key, passed);
    return { allowed: false, blockedBy: (blocked as LimitRule).name, retryAfterS: Math.max(1, retry) };
  }

  async refund(key: string, rules: readonly LimitRule[]): Promise<void> {
    await Promise.all(
      rules.map((r) =>
        this.store.incrLite(this.k(key, r), -1, r.windowMs).catch((e) => {
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
  /** When the reservation also counted against one client's daily allowance. */
  ip?: { key: string };
}

export type BudgetDenied = { denied: "global" | "ip" };

const toMicros = (usd: number): number => Math.max(0, Math.ceil(usd * 1e6));

/**
 * Global daily spend ceiling in integer micro-dollars, plus an optional per-client daily allowance.
 * A reservation is added to the shared counters BEFORE the provider call (worst-case cost), then
 * trued up with the real cost; if the function dies in between the reservation stays charged, so
 * the ledger errs high. Each reserve or settle is one INCRBY (1 command). `reserve`, `reserveFor`
 * and `status` throw StoreError when the store is down; callers deny in that case.
 *
 * The last observed total is kept in process (updated by every reserve and settle), so the
 * preflight and /api/health can read `cached()` without touching the store.
 */
export class DailyBudget {
  private ceilingMicros: number;
  private seen: { window: string; micros: number; at: number } | null = null;
  constructor(
    private store: SharedStore,
    private ceilingUsd: number,
    private now: () => number = Date.now,
    private resetHourUtc = 8,
  ) {
    this.ceilingMicros = toMicros(ceilingUsd);
  }

  private window(): string {
    return budgetWindow(this.now(), this.resetHourUtc);
  }

  private observe(window: string, micros: number): void {
    this.seen = { window, micros, at: this.now() };
  }

  private toStatus(micros: number): BudgetStatus {
    return { ceilingUsd: this.ceilingUsd, spentUsd: micros / 1e6, exhausted: micros >= this.ceilingMicros };
  }

  /** The last total this process saw for the current window, or null. Never touches the store. */
  cached(): BudgetStatus | null {
    return this.seen && this.seen.window === this.window() ? this.toStatus(this.seen.micros) : null;
  }

  /** Reads the ledger (1 command) unless a total newer than `maxAgeMs` is already known in process. */
  async status(maxAgeMs = 0): Promise<BudgetStatus> {
    const c = this.seen;
    if (maxAgeMs > 0 && c && c.window === this.window() && this.now() - c.at <= maxAgeMs) return this.toStatus(c.micros);
    const window = this.window();
    const micros = Number((await this.store.get(`spend:${window}`)) ?? 0) || 0;
    this.observe(window, micros);
    return this.toStatus(micros);
  }

  /** Reserves the worst-case cost of a call. Returns null when the ceiling would be crossed. */
  async reserve(estimateUsd: number): Promise<BudgetReservation | null> {
    const window = this.window();
    const key = `spend:${window}`;
    const micros = toMicros(estimateUsd);
    const value = await this.store.incrLite(key, micros, 2 * DAY_MS);
    this.observe(window, value);
    if (value > this.ceilingMicros) {
      await this.store.incrLite(key, -micros, 2 * DAY_MS).catch(() => undefined);
      this.observe(window, value - micros);
      return null;
    }
    return { key, micros };
  }

  /**
   * Reserves against one client's daily allowance first, then the global ceiling (2 commands).
   * `ipKeyValue` is the hashed client key; `ipCapUsd` the allowance.
   */
  async reserveFor(ipKeyValue: string, ipCapUsd: number, estimateUsd: number): Promise<BudgetReservation | BudgetDenied> {
    const window = this.window();
    const ipKeyName = `spend:ip:${ipKeyValue}:${window}`;
    const micros = toMicros(estimateUsd);
    const ipValue = await this.store.incrLite(ipKeyName, micros, 2 * DAY_MS);
    if (ipValue > toMicros(ipCapUsd)) {
      await this.store.incrLite(ipKeyName, -micros, 2 * DAY_MS).catch(() => undefined);
      return { denied: "ip" };
    }
    let res: BudgetReservation | null;
    try {
      res = await this.reserve(estimateUsd);
    } catch (e) {
      await this.store.incrLite(ipKeyName, -micros, 2 * DAY_MS).catch(() => undefined);
      throw e;
    }
    if (!res) {
      await this.store.incrLite(ipKeyName, -micros, 2 * DAY_MS).catch(() => undefined);
      return { denied: "global" };
    }
    return { ...res, ip: { key: ipKeyName } };
  }

  /** Replaces the reservation with the real cost. Never throws: a failure leaves the ledger high. */
  async settle(reservation: BudgetReservation, actualUsd: number): Promise<void> {
    const diff = toMicros(actualUsd) - reservation.micros;
    if (diff === 0) return;
    try {
      const value = await this.store.incrLite(reservation.key, diff, 2 * DAY_MS);
      this.observe(reservation.key.slice("spend:".length), value);
      if (reservation.ip) await this.store.incrLite(reservation.ip.key, diff, 2 * DAY_MS);
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

/** The single bucket used when no proxy is trusted (local development, or a self-hosted server that is not behind one). */
export const LOCAL_IP = "local";

/**
 * The client address, as trustworthy as the deployment allows:
 *   - Without a trusted proxy (`trustForwarded` false: not serverless and WS_TRUST_FORWARDED unset)
 *     every address header can be forged by the client, so all clients are "local".
 *   - Behind one: x-vercel-forwarded-for, then x-real-ip (both set by the platform edge), then
 *     x-forwarded-for, where the client is `trustedHops` entries from the RIGHT (the entry our own
 *     proxy appended); anything further left is client-controlled and ignored.
 * IPv6 is bucketed by /64 so rotating within a /64 does not create new identities.
 * No usable address returns "unknown", which callers rate limit as one tight shared bucket.
 */
export function clientIp(headers: { get(name: string): string | null }, opts: { trustedHops?: number; trustForwarded?: boolean } = {}): string {
  if (!opts.trustForwarded) return LOCAL_IP;
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

let ipSalt = "";
/** Sets the private salt used for hashed client keys (see createRuntime). */
export function setIpSalt(salt: string): void {
  ipSalt = salt;
}

/**
 * Short stable key for an address, so raw IPs never appear in the store. The salt is private
 * (WS_IP_HASH_SALT, or derived from the store token), which keeps the keys from being reversed by
 * trying every IPv4 address.
 */
export function ipKey(ip: string): string {
  return createHash("sha256").update(`ws1:${ipSalt}:${ip}`).digest("hex").slice(0, 16);
}

/* ------------------------------- front door ------------------------------- */

export type FrontDoorKind = "ai" | "closures" | "confirm";

export interface FrontDoorOptions {
  perIpPerMin: number;
  globalPerMin: number;
  closuresPerIpPerHour: number;
  /** New missions one client may start per day on this process (the shared limits stay authoritative). */
  missionsPerIpPerDay: number;
  now?: () => number;
}

/**
 * The first line of defense, in process memory: it runs BEFORE any store command, so a flood of
 * requests is turned away without costing a single store operation. Sliding windows per client
 * (tighter for "unknown"), an hourly window per client for closure searches, and one process-wide
 * window. It is per process by nature; the shared limits behind it stay authoritative.
 */
export class FrontDoor {
  private hits = new Map<string, number[]>();
  private now: () => number;
  constructor(private o: FrontDoorOptions) {
    this.now = o.now ?? Date.now;
  }

  private allow(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterS: number } {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (list.length >= limit) {
      this.hits.set(key, list);
      return { ok: false, retryAfterS: Math.max(1, Math.ceil((list[0] + windowMs - t) / 1000)) };
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 20_000) {
      for (const [k, v] of this.hits) if (v.length === 0 || t - v[v.length - 1] >= HOUR_MS) this.hits.delete(k);
      while (this.hits.size > 20_000) this.hits.delete(this.hits.keys().next().value as string);
    }
    return { ok: true, retryAfterS: 0 };
  }

  /** Counts a new mission for this client today; refuses once the daily allowance on this process is used. */
  newMission(ip: string): { ok: boolean; retryAfterS: number } {
    const tight = ip === UNKNOWN_IP;
    return this.allow(`missions:${ip}`, tight ? Math.max(1, Math.floor(this.o.missionsPerIpPerDay / 5)) : this.o.missionsPerIpPerDay, DAY_MS);
  }

  check(kind: FrontDoorKind, ip: string): { ok: boolean; retryAfterS: number } {
    const tight = ip === UNKNOWN_IP;
    const perIp = tight ? Math.max(1, Math.floor(this.o.perIpPerMin / 5)) : this.o.perIpPerMin;
    const a = this.allow(`ip:${ip}`, perIp, 60_000);
    if (!a.ok) return a;
    if (kind === "closures") {
      const c = this.allow(`closures:${ip}`, tight ? Math.max(1, Math.floor(this.o.closuresPerIpPerHour / 5)) : this.o.closuresPerIpPerHour, HOUR_MS);
      if (!c.ok) return c;
    }
    return this.allow("global", this.o.globalPerMin, 60_000);
  }
}

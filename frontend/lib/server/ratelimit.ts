/**
 * Rate limits, spend ceiling and per-mission accounting.
 *
 * Everything sits behind small interfaces (`RateLimiter`, `CounterStore`) so an Upstash-backed
 * implementation can replace the in-memory one later without touching callers. The in-memory
 * versions are per server instance: on serverless hosting the limits are approximate, and the
 * global spend ceiling is a best-effort guard (documented weakness, see the report).
 */

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
}

export interface RateLimiter {
  /** Atomically (per instance) checks every rule and records the hit only if all allow it. */
  consume(key: string, rules: readonly LimitRule[]): Promise<LimitResult>;
}

export interface CounterStore {
  get(key: string): Promise<number>;
  /** Adds `amount` and returns the new total. The key expires `ttlMs` after its first write. */
  add(key: string, amount: number, ttlMs: number): Promise<number>;
}

const MAX_KEYS = 20_000;

export class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}

  async consume(key: string, rules: readonly LimitRule[]): Promise<LimitResult> {
    const t = this.now();
    const widest = Math.max(...rules.map((r) => r.windowMs));
    const log = (this.hits.get(key) ?? []).filter((x) => t - x < widest);
    let blocked: LimitRule | undefined;
    let retry = 0;
    for (const r of rules) {
      const inWindow = log.filter((x) => t - x < r.windowMs);
      if (inWindow.length >= r.limit) {
        const wait = Math.ceil((inWindow[inWindow.length - r.limit] + r.windowMs - t) / 1000);
        if (!blocked || wait > retry) {
          blocked = r;
          retry = wait;
        }
      }
    }
    if (blocked) {
      this.hits.set(key, log);
      return { allowed: false, blockedBy: blocked.name, retryAfterS: Math.max(1, retry) };
    }
    log.push(t);
    this.hits.set(key, log);
    if (this.hits.size > MAX_KEYS) {
      for (const [k, v] of this.hits) if (v.length === 0 || t - v[v.length - 1] >= widest) this.hits.delete(k);
      if (this.hits.size > MAX_KEYS) this.hits.delete(this.hits.keys().next().value as string);
    }
    return { allowed: true, retryAfterS: 0 };
  }
}

export class MemoryCounters implements CounterStore {
  private m = new Map<string, { v: number; exp: number }>();
  constructor(private now: () => number = Date.now) {}

  async get(key: string): Promise<number> {
    const e = this.m.get(key);
    if (!e || e.exp <= this.now()) return 0;
    return e.v;
  }

  async add(key: string, amount: number, ttlMs: number): Promise<number> {
    const t = this.now();
    const e = this.m.get(key);
    if (!e || e.exp <= t) {
      this.m.set(key, { v: amount, exp: t + ttlMs });
      if (this.m.size > MAX_KEYS) for (const [k, x] of this.m) if (x.exp <= t) this.m.delete(k);
      return amount;
    }
    e.v += amount;
    return e.v;
  }
}

export const DAY_MS = 24 * 3600_000;
export const utcDay = (t: number): string => new Date(t).toISOString().slice(0, 10);

/* ------------------------------- daily spend ------------------------------- */

export interface BudgetStatus {
  ceilingUsd: number;
  spentUsd: number;
  exhausted: boolean;
}

/** Global daily spend ceiling with reserve/settle so concurrent calls cannot overshoot far. */
export class DailyBudget {
  private reserved = 0;
  constructor(
    private store: CounterStore,
    private ceilingUsd: number,
    private now: () => number = Date.now,
  ) {}

  private key(): string {
    return `spend:${utcDay(this.now())}`;
  }
  /** Stored as micro-dollars so the counter stays an integer. */
  private async spent(): Promise<number> {
    return (await this.store.get(this.key())) / 1e6;
  }

  async status(): Promise<BudgetStatus> {
    const spentUsd = await this.spent();
    return { ceilingUsd: this.ceilingUsd, spentUsd, exhausted: spentUsd + this.reserved >= this.ceilingUsd };
  }

  /** Reserves the worst-case cost of a call. Returns null when the ceiling would be crossed. */
  async reserve(estimateUsd: number): Promise<{ estimateUsd: number } | null> {
    const spent = await this.spent();
    if (spent + this.reserved + estimateUsd > this.ceilingUsd) return null;
    this.reserved += estimateUsd;
    return { estimateUsd };
  }

  /** Replaces the reservation with the real cost (0 when the call failed before billing). */
  async settle(reservation: { estimateUsd: number }, actualUsd: number): Promise<void> {
    this.reserved = Math.max(0, this.reserved - reservation.estimateUsd);
    if (actualUsd > 0) await this.store.add(this.key(), Math.round(actualUsd * 1e6), 2 * DAY_MS);
  }
}

/* ---------------------------- per-mission ledger --------------------------- */

export interface MissionRecord {
  id: string;
  ip: string;
  createdAt: number;
  inputTokens: number;
  outputTokens: number;
  /** "phase:round" keys seen, capped at 3 search rounds plus one finalize. */
  turns: Set<string>;
}

const MISSION_TTL_MS = 2 * 3600_000;
const MISSION_MAX = 5_000;

export class MissionStore {
  private m = new Map<string, MissionRecord>();
  constructor(private now: () => number = Date.now) {}

  get(id: string): MissionRecord | undefined {
    const r = this.m.get(id);
    if (r && this.now() - r.createdAt > MISSION_TTL_MS) {
      this.m.delete(id);
      return undefined;
    }
    return r;
  }

  create(id: string, ip: string): MissionRecord {
    if (this.m.size >= MISSION_MAX) {
      const t = this.now();
      for (const [k, r] of this.m) if (t - r.createdAt > MISSION_TTL_MS) this.m.delete(k);
      if (this.m.size >= MISSION_MAX) this.m.delete(this.m.keys().next().value as string);
    }
    const r: MissionRecord = { id, ip, createdAt: this.now(), inputTokens: 0, outputTokens: 0, turns: new Set() };
    this.m.set(id, r);
    return r;
  }
}

/* ----------------------------- default limits ----------------------------- */

export function missionRules(perHour: number, perDay: number): LimitRule[] {
  return [
    { name: "missions_per_hour", limit: perHour, windowMs: 3600_000 },
    { name: "missions_per_day", limit: perDay, windowMs: DAY_MS },
  ];
}

/** Best-effort client IP. Behind the host's proxy the first x-forwarded-for hop is the client. */
export function clientIp(headers: { get(name: string): string | null }): string {
  const xff = headers.get("x-forwarded-for");
  const ip = (xff ? xff.split(",")[0] : headers.get("x-real-ip"))?.trim();
  return ip && ip.length <= 64 ? ip : "unknown";
}

/**
 * Shared state for every abuse control: the per-IP limiter, the daily spend ledger, mission
 * counters, the closure-search counter, and single-use confirmation markers. It holds counters
 * and markers only: no user text, no model text and no Tavily content is ever written here.
 *
 * Two implementations sit behind one interface:
 *   - MemoryStore: one process only. Fine for tests and a single local server. On a serverless
 *     host every instance gets its own copy, so it is only "instance-local protection".
 *   - UpstashRestStore: plain fetch against an Upstash Redis REST endpoint (no package), shared by
 *     every instance. Selected when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or the
 *     Vercel marketplace names KV_REST_API_URL / KV_REST_API_TOKEN) are set and the host is allowed.
 *
 * Every REST argument is sent as a string (the REST API's wire format). Every operation is a single
 * command or one MULTI/EXEC transaction. A failed store call throws StoreError; callers that guard
 * spend treat that as "deny" (fail closed). Commands are the billed unit on metered plans, so the
 * cost of each operation is documented on it and MeteredStore caps the total per process.
 */

export class StoreError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

/** Thrown, without any network call, when this process has used its own command allowance. */
export class StoreBudgetError extends StoreError {
  constructor() {
    super("store command budget for this process is used up");
    this.name = "StoreBudgetError";
  }
}

export interface IncrResult {
  /** The counter value after the increment. */
  value: number;
  /** Milliseconds until the key expires when this call set the expiry (0 when unknown). */
  ttlMs: number;
}

export interface SharedStore {
  readonly kind: "memory" | "upstash";
  /**
   * Atomic INCRBY plus expiry on first creation (PEXPIRE NX), one transaction, 2 commands. The
   * window starts at the first hit and later hits never extend it. A negative `by` is a refund.
   */
  incr(key: string, by: number, ttlMs: number): Promise<IncrResult>;
  /**
   * Cheaper INCRBY for a key whose expiry was set when it was created: 1 command, plus a second
   * PEXPIRE NX only when the result shows the key was just created.
   */
  incrLite(key: string, by: number, ttlMs: number): Promise<number>;
  /** GET and PTTL in one pipeline: 2 commands. `value` is null when the key does not exist. */
  peek(key: string): Promise<{ value: number | null; ttlMs: number }>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** SET NX with expiry: 1 command. True when this call created the key. */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  /** Atomic get-and-delete (GETDEL): the single-use primitive. */
  take(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  /** Atomic compare-and-delete: deletes only if the value still equals `value`. 1 command. */
  delIfEquals(key: string, value: string): Promise<boolean>;
}

/* --------------------------------- memory --------------------------------- */

const MEMORY_MAX_KEYS = 50_000;

export class MemoryStore implements SharedStore {
  readonly kind = "memory" as const;
  private m = new Map<string, { v: string; exp: number }>();
  constructor(private now: () => number = Date.now) {}

  private live(key: string): { v: string; exp: number } | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (e.exp <= this.now()) {
      this.m.delete(key);
      return undefined;
    }
    return e;
  }

  private sweep(): void {
    if (this.m.size <= MEMORY_MAX_KEYS) return;
    const t = this.now();
    for (const [k, e] of this.m) if (e.exp <= t) this.m.delete(k);
    while (this.m.size > MEMORY_MAX_KEYS) this.m.delete(this.m.keys().next().value as string);
  }

  async incr(key: string, by: number, ttlMs: number): Promise<IncrResult> {
    const t = this.now();
    const e = this.live(key);
    if (!e) {
      this.m.set(key, { v: String(by), exp: t + ttlMs });
      this.sweep();
      return { value: by, ttlMs };
    }
    const value = Number(e.v) + by;
    if (!Number.isFinite(value)) throw new StoreError("value is not an integer");
    e.v = String(value);
    return { value, ttlMs: 0 };
  }

  async incrLite(key: string, by: number, ttlMs: number): Promise<number> {
    return (await this.incr(key, by, ttlMs)).value;
  }

  /** Every live key and value (for tests that check what is, and is not, stored). */
  entries(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of [...this.m.keys()]) {
      const e = this.live(k);
      if (e) out[k] = e.v;
    }
    return out;
  }

  async peek(key: string): Promise<{ value: number | null; ttlMs: number }> {
    const e = this.live(key);
    return e ? { value: Number(e.v), ttlMs: Math.max(0, e.exp - this.now()) } : { value: null, ttlMs: 0 };
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.v ?? null;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.m.set(key, { v: value, exp: this.now() + ttlMs });
    this.sweep();
  }

  async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.live(key)) return false;
    this.m.set(key, { v: value, exp: this.now() + ttlMs });
    this.sweep();
    return true;
  }

  async take(key: string): Promise<string | null> {
    const e = this.live(key);
    if (!e) return null;
    this.m.delete(key);
    return e.v;
  }

  async del(key: string): Promise<void> {
    this.m.delete(key);
  }

  async delIfEquals(key: string, value: string): Promise<boolean> {
    const e = this.live(key);
    if (!e || e.v !== value) return false;
    this.m.delete(key);
    return true;
  }
}

/* ---------------------------------- upstash -------------------------------- */

export interface UpstashOptions {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type RestItem = { result?: unknown; error?: string };

/** Compare-and-delete as one command (Lua): the lock release primitive. */
export const DEL_IF_EQUALS_LUA = "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";

export class UpstashRestStore implements SharedStore {
  readonly kind = "upstash" as const;
  private base: string;
  private token: string;
  private timeoutMs: number;
  private f: typeof fetch;

  constructor(opts: UpstashOptions) {
    this.base = opts.url.replace(/\/+$/, "");
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 3_000;
    this.f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  private async send(path: string, body: unknown): Promise<unknown> {
    this.commandsSent += path === "" ? 1 : (body as unknown[]).length;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.f(`${this.base}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!res.ok) throw new StoreError(`store answered with status ${res.status}`, res.status);
      return await res.json();
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError("store request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  /** REST bodies carry every argument as a string. */
  /** Commands actually sent so far (a pipeline or transaction counts each command). */
  commandsSent = 0;

  private static wire(cmd: (string | number)[]): string[] {
    return cmd.map((c) => String(c));
  }

  private async command(cmd: (string | number)[]): Promise<unknown> {
    const out = (await this.send("", UpstashRestStore.wire(cmd))) as RestItem;
    if (out && typeof out === "object" && typeof out.error === "string") throw new StoreError(`store rejected the command: ${out.error.slice(0, 80)}`, 0);
    return out?.result;
  }

  /** MULTI/EXEC: the commands run atomically and answer in order. */
  private async transaction(cmds: (string | number)[][], path = "/multi-exec"): Promise<unknown[]> {
    const out = (await this.send(path, cmds.map((c) => UpstashRestStore.wire(c)))) as RestItem[];
    if (!Array.isArray(out) || out.length !== cmds.length) throw new StoreError("store answered with an unexpected shape", 0);
    return out.map((item) => {
      if (item && typeof item === "object" && typeof item.error === "string") throw new StoreError(`store rejected the transaction: ${item.error.slice(0, 80)}`, 0);
      return item?.result;
    });
  }

  /** Set once a server rejects the atomic form (Redis before 7.0 has no PEXPIRE NX). */
  private nxUnsupported = false;

  async incr(key: string, by: number, ttlMs: number): Promise<IncrResult> {
    if (!Number.isInteger(by)) throw new StoreError("increment must be an integer");
    const ttl = Math.max(1, Math.ceil(ttlMs));
    let value: unknown;
    let set: unknown = 0;
    if (!this.nxUnsupported) {
      try {
        // One MULTI/EXEC: the counter and its first-hit expiry cannot be separated.
        [value, set] = await this.transaction([
          ["INCRBY", key, by],
          ["PEXPIRE", key, ttl, "NX"],
        ]);
      } catch (e) {
        // Any 4xx (other than auth or quota), a non-array answer or an error item means this server
        // cannot run the atomic form; fall back to the two-step form and remember it if that works.
        const status = e instanceof StoreError ? e.status : undefined;
        const unsupported = status === 0 || (status !== undefined && status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429);
        if (!(e instanceof StoreError) || e instanceof StoreBudgetError || !unsupported) throw e;
        const [v2, pttl] = await this.transaction([
          ["INCRBY", key, by],
          ["PTTL", key],
        ]);
        this.nxUnsupported = true;
        value = v2;
        if (Number(pttl) < 0) {
          await this.command(["PEXPIRE", key, ttl]);
          set = 1;
        }
      }
    } else {
      const [v2, pttl] = await this.transaction([
        ["INCRBY", key, by],
        ["PTTL", key],
      ]);
      value = v2;
      if (Number(pttl) < 0) {
        await this.command(["PEXPIRE", key, ttl]);
        set = 1;
      }
    }
    const n = Number(value);
    if (!Number.isFinite(n)) throw new StoreError("store returned a non-numeric counter");
    return { value: n, ttlMs: Number(set) === 1 ? ttl : 0 };
  }

  async incrLite(key: string, by: number, ttlMs: number): Promise<number> {
    if (!Number.isInteger(by)) throw new StoreError("increment must be an integer");
    const n = Number(await this.command(["INCRBY", key, by]));
    if (!Number.isFinite(n)) throw new StoreError("store returned a non-numeric counter");
    // A result equal to the increment means the counter may just have been created (or reset):
    // make sure it has an expiry. NX leaves an existing expiry alone. On servers without NX the
    // TTL is read first.
    if (by > 0 && n === by) {
      if (this.nxUnsupported) {
        if (Number(await this.command(["PTTL", key])) < 0) await this.command(["PEXPIRE", key, Math.max(1, Math.ceil(ttlMs))]);
      } else {
        try {
          await this.command(["PEXPIRE", key, Math.max(1, Math.ceil(ttlMs)), "NX"]);
        } catch (e) {
          if (!(e instanceof StoreError) || e instanceof StoreBudgetError) throw e;
          if (Number(await this.command(["PTTL", key])) < 0) await this.command(["PEXPIRE", key, Math.max(1, Math.ceil(ttlMs))]);
        }
      }
    }
    return n;
  }

  async peek(key: string): Promise<{ value: number | null; ttlMs: number }> {
    const [v, pttl] = await this.transaction([["GET", key], ["PTTL", key]], "/pipeline");
    const ttl = Number(pttl);
    return { value: v === null || v === undefined ? null : Number(v), ttlMs: Number.isFinite(ttl) && ttl > 0 ? ttl : 0 };
  }

  async get(key: string): Promise<string | null> {
    const r = await this.command(["GET", key]);
    return r === null || r === undefined ? null : String(r);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.command(["SET", key, value, "PX", Math.max(1, Math.ceil(ttlMs))]);
  }

  async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    const r = await this.command(["SET", key, value, "PX", Math.max(1, Math.ceil(ttlMs)), "NX"]);
    return r === "OK";
  }

  async take(key: string): Promise<string | null> {
    const r = await this.command(["GETDEL", key]);
    return r === null || r === undefined ? null : String(r);
  }

  async del(key: string): Promise<void> {
    await this.command(["DEL", key]);
  }

  async delIfEquals(key: string, value: string): Promise<boolean> {
    try {
      return Number(await this.command(["EVAL", DEL_IF_EQUALS_LUA, 1, key, value])) === 1;
    } catch (e) {
      if (!(e instanceof StoreError) || e instanceof StoreBudgetError) throw e;
      // Scripts unavailable: compare, then delete (a small race window instead of none).
      if ((await this.get(key)) !== value) return false;
      await this.del(key);
      return true;
    }
  }
}

/* --------------------------------- metering --------------------------------- */

export interface MeterOptions {
  /** Commands this process may send per clock hour and per UTC day. */
  perHour: number;
  perDay: number;
  now?: () => number;
}

/**
 * Commands each operation may send (the Upstash billing unit). incrLite is 1 in steady state and
 * 2 when its key was just created (the expiry follows); the meter reserves the worst case and, when
 * the inner store counts what it really sent, gives the difference back afterwards.
 */
export const COMMAND_COST = { incr: 2, incrLite: 2, peek: 2, get: 1, set: 1, setIfAbsent: 1, take: 1, del: 1, delIfEquals: 1 } as const;

/**
 * Caps how many commands THIS process may send, so an unauthenticated flood cannot burn a metered
 * plan's monthly quota. Once the allowance is used the wrapper throws StoreBudgetError without any
 * network call, and callers fail closed with a clear message. The worst case per month is
 * (instances) x (perDay) x 31 commands.
 */
export class MeteredStore implements SharedStore {
  private hour = -1;
  private day = -1;
  private usedHour = 0;
  private usedDay = 0;
  private now: () => number;
  constructor(
    private inner: SharedStore,
    private opts: MeterOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  get kind(): "memory" | "upstash" {
    return this.inner.kind;
  }

  /** Commands used so far in the current hour and day (for tests and diagnostics; never exposed publicly). */
  usage(): { hour: number; day: number } {
    this.roll();
    return { hour: this.usedHour, day: this.usedDay };
  }

  private roll(): void {
    const t = this.now();
    const h = Math.floor(t / 3_600_000);
    const d = Math.floor(t / 86_400_000);
    if (h !== this.hour) {
      this.hour = h;
      this.usedHour = 0;
    }
    if (d !== this.day) {
      this.day = d;
      this.usedDay = 0;
    }
  }

  private charge(cost: number): void {
    this.roll();
    if (this.usedHour + cost > this.opts.perHour || this.usedDay + cost > this.opts.perDay) throw new StoreBudgetError();
    this.usedHour += cost;
    this.usedDay += cost;
  }

  /** Runs `fn` after charging its worst-case cost, then trues the meter up to what the inner store really sent. */
  private async metered<T>(cost: number, fn: () => Promise<T>): Promise<T> {
    this.charge(cost);
    const counter = this.inner as { commandsSent?: number };
    const before = counter.commandsSent;
    try {
      return await fn();
    } finally {
      if (before !== undefined && counter.commandsSent !== undefined) {
        const diff = counter.commandsSent - before - cost;
        this.usedHour += diff;
        this.usedDay += diff;
      }
    }
  }

  async incr(key: string, by: number, ttlMs: number): Promise<IncrResult> {
    return this.metered(COMMAND_COST.incr, () => this.inner.incr(key, by, ttlMs));
  }
  async incrLite(key: string, by: number, ttlMs: number): Promise<number> {
    return this.metered(COMMAND_COST.incrLite, () => this.inner.incrLite(key, by, ttlMs));
  }
  async peek(key: string): Promise<{ value: number | null; ttlMs: number }> {
    return this.metered(COMMAND_COST.peek, () => this.inner.peek(key));
  }
  async get(key: string): Promise<string | null> {
    return this.metered(COMMAND_COST.get, () => this.inner.get(key));
  }
  async set(key: string, value: string, ttlMs: number): Promise<void> {
    return this.metered(COMMAND_COST.set, () => this.inner.set(key, value, ttlMs));
  }
  async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    return this.metered(COMMAND_COST.setIfAbsent, () => this.inner.setIfAbsent(key, value, ttlMs));
  }
  async take(key: string): Promise<string | null> {
    return this.metered(COMMAND_COST.take, () => this.inner.take(key));
  }
  async del(key: string): Promise<void> {
    return this.metered(COMMAND_COST.del, () => this.inner.del(key));
  }
  async delIfEquals(key: string, value: string): Promise<boolean> {
    return this.metered(COMMAND_COST.delIfEquals, () => this.inner.delIfEquals(key, value));
  }
}

/* --------------------------------- selection -------------------------------- */

export interface StoreEnv {
  [k: string]: string | undefined;
}

/** Hosts a shared store may live on (suffix match), plus WS_ALLOWED_STORE_HOSTS (exact or suffix). */
export const DEFAULT_STORE_HOSTS: readonly string[] = ["upstash.io", "kv.vercel-storage.com"];

/**
 * The REST endpoint and token from either naming scheme, or null when none is configured or the
 * endpoint is not acceptable: https on an allowed host (the bearer token is sent there), or plain
 * http to localhost for a local emulator.
 */
export function sharedStoreCredentials(env: StoreEnv): { url: string; token: string } | null {
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || "").trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || "").trim();
  if (!url || !token) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1";
  if (local && u.protocol === "http:") return { url: u.toString().replace(/\/+$/, ""), token };
  if (u.protocol !== "https:") return null;
  const allowed = [...DEFAULT_STORE_HOSTS, ...(env.WS_ALLOWED_STORE_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)];
  if (!allowed.some((a) => host === a || host.endsWith(`.${a}`))) return null;
  return { url: u.toString().replace(/\/+$/, ""), token };
}

/** Why credentials were set but refused (for one warning log), or null when nothing was set or all is well. */
export function sharedStoreRefusal(env: StoreEnv): string | null {
  const set = Boolean((env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || "").trim() && (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || "").trim());
  return set && sharedStoreCredentials(env) === null ? "store endpoint must be https on an allowed host" : null;
}

export function createSharedStore(env: StoreEnv, opts: { fetchImpl?: typeof fetch; now?: () => number } = {}): SharedStore {
  const c = sharedStoreCredentials(env);
  if (!c) return new MemoryStore(opts.now);
  const perHour = Number(env.WS_STORE_HOURLY_COMMANDS) > 0 ? Number(env.WS_STORE_HOURLY_COMMANDS) : DEFAULT_STORE_HOURLY_COMMANDS;
  const perDay = Number(env.WS_STORE_DAILY_COMMANDS) > 0 ? Number(env.WS_STORE_DAILY_COMMANDS) : DEFAULT_STORE_DAILY_COMMANDS;
  return new MeteredStore(new UpstashRestStore({ url: c.url, token: c.token, fetchImpl: opts.fetchImpl }), { perHour, perDay, now: opts.now });
}

/** Per-process command allowance: about 100 full missions a day, at most 279,000 commands per instance-month. */
export const DEFAULT_STORE_HOURLY_COMMANDS = 2_400;
export const DEFAULT_STORE_DAILY_COMMANDS = 9_000;

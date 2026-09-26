/**
 * Shared state for every abuse control: the per-IP limiter, the daily spend ledger, mission
 * records, the closure-search counter and cache, and single-use confirmation tokens.
 *
 * Two implementations sit behind one interface:
 *   - MemoryStore: one process only. Fine for tests and a single local server. On a serverless
 *     host every instance gets its own copy, so it is only "instance-local protection".
 *   - UpstashRestStore: plain fetch against an Upstash Redis REST endpoint (no package), shared by
 *     every instance. Selected when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or the
 *     Vercel marketplace names KV_REST_API_URL / KV_REST_API_TOKEN) are set.
 *
 * Every operation is a single atomic command (or one MULTI/EXEC transaction). A failed store call
 * throws StoreError. Callers that guard spend treat that as "deny" (fail closed).
 */

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

export interface IncrResult {
  /** The counter value after the increment. */
  value: number;
  /** Milliseconds until the key expires (0 when unknown). */
  ttlMs: number;
}

export interface SharedStore {
  readonly kind: "memory" | "upstash";
  /**
   * Atomic INCRBY. The key gets `ttlMs` only when it has no expiry yet, so the window starts at the
   * first hit and later hits never extend it. A negative `by` is a refund.
   */
  incr(key: string, by: number, ttlMs: number): Promise<IncrResult>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** SET NX with expiry. True when this call created the key. */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  /** Atomic get-and-delete (GETDEL): the single-use primitive. */
  take(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
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
    return { value, ttlMs: Math.max(0, e.exp - t) };
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
}

/* ---------------------------------- upstash -------------------------------- */

export interface UpstashOptions {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type RestItem = { result?: unknown; error?: string };

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
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.f(`${this.base}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!res.ok) throw new StoreError(`store answered with status ${res.status}`);
      return await res.json();
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError("store request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  private async command(cmd: (string | number)[]): Promise<unknown> {
    const out = (await this.send("", cmd)) as RestItem;
    if (out && typeof out === "object" && typeof out.error === "string") throw new StoreError(`store rejected the command: ${out.error.slice(0, 80)}`);
    return out?.result;
  }

  /** MULTI/EXEC: the commands run atomically and answer in order. */
  private async transaction(cmds: (string | number)[][]): Promise<unknown[]> {
    const out = (await this.send("/multi-exec", cmds)) as RestItem[];
    if (!Array.isArray(out) || out.length !== cmds.length) throw new StoreError("store answered with an unexpected shape");
    return out.map((item) => {
      if (item && typeof item === "object" && typeof item.error === "string") throw new StoreError(`store rejected the transaction: ${item.error.slice(0, 80)}`);
      return item?.result;
    });
  }

  /** Set once a server rejects PEXPIRE ... NX (Redis before 7.0): incr then uses the two-step form. */
  private nxUnsupported = false;

  async incr(key: string, by: number, ttlMs: number): Promise<IncrResult> {
    if (!Number.isInteger(by)) throw new StoreError("increment must be an integer");
    const ttl = Math.max(1, Math.ceil(ttlMs));
    let value: unknown;
    let pttl: unknown;
    if (!this.nxUnsupported) {
      try {
        // One MULTI/EXEC: the counter and its first-hit expiry cannot be separated.
        [value, , pttl] = await this.transaction([
          ["INCRBY", key, by],
          ["PEXPIRE", key, ttl, "NX"],
          ["PTTL", key],
        ]);
      } catch (e) {
        if (!(e instanceof StoreError) || !/syntax|option|unknown|NX/i.test(e.message)) throw e;
        this.nxUnsupported = true;
      }
    }
    if (this.nxUnsupported) {
      // Older servers: INCRBY + PTTL in one transaction, then set the expiry only when the key has none.
      [value, pttl] = await this.transaction([
        ["INCRBY", key, by],
        ["PTTL", key],
      ]);
      if (Number(pttl) < 0) {
        await this.command(["PEXPIRE", key, ttl]);
        pttl = ttl;
      }
    }
    const n = Number(value);
    if (!Number.isFinite(n)) throw new StoreError("store returned a non-numeric counter");
    const remaining = Number(pttl);
    return { value: n, ttlMs: Number.isFinite(remaining) && remaining > 0 ? remaining : 0 };
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
}

/* --------------------------------- selection -------------------------------- */

export interface StoreEnv {
  [k: string]: string | undefined;
}

/** The REST endpoint and token from either naming scheme, or null when none is configured. */
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
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
  return { url: u.toString().replace(/\/+$/, ""), token };
}

export function createSharedStore(env: StoreEnv, opts: { fetchImpl?: typeof fetch; now?: () => number } = {}): SharedStore {
  const c = sharedStoreCredentials(env);
  if (c) return new UpstashRestStore({ url: c.url, token: c.token, fetchImpl: opts.fetchImpl });
  return new MemoryStore(opts.now);
}

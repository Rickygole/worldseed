/**
 * A tiny in-memory stand-in for an Upstash Redis REST endpoint, served through a fake fetch.
 * It records every request so tests can assert the exact commands, and it can be switched to
 * failure modes. No network is involved.
 */
export const FAKE_URL = "https://fake-store.upstash.io";
export const FAKE_TOKEN = "fake-token-not-real";

export interface RecordedRequest {
  path: string;
  auth: string | null;
  body: unknown;
}

export class FakeUpstash {
  requests: RecordedRequest[] = [];
  /** Commands sent so far, counting every command inside a pipeline or transaction (the Upstash billing unit). */
  get commands(): number {
    return this.requests.reduce((n, r) => n + (r.path === "" ? 1 : (r.body as unknown[]).length), 0);
  }
  /** Status to answer transactions with when mode is "txn-4xx". */
  /** "ok" answers normally; "down" rejects like a network failure; "500" answers with a server error; "no-nx" rejects PEXPIRE ... NX like Redis before 7.0. */
  mode: "ok" | "down" | "500" | "error-item" | "no-nx" | "txn-404" | "txn-not-array" | "unauthorized" = "ok";
  private data = new Map<string, { v: string; exp: number | null }>();
  constructor(private now: () => number = Date.now) {}

  private live(key: string) {
    const e = this.data.get(key);
    if (!e) return undefined;
    if (e.exp !== null && e.exp <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  private run(cmd: (string | number)[]): unknown {
    const [name, key, ...args] = cmd.map((c) => (typeof c === "number" ? String(c) : c)) as string[];
    switch (name.toUpperCase()) {
      case "GET":
        return this.live(key)?.v ?? null;
      case "SET": {
        const opts = args.slice(1).map((a) => a.toUpperCase());
        const px = opts.includes("PX") ? Number(args[1 + opts.indexOf("PX") + 1]) : null;
        if (opts.includes("NX") && this.live(key)) return null;
        this.data.set(key, { v: args[0], exp: px === null ? null : this.now() + px });
        return "OK";
      }
      case "INCRBY": {
        const e = this.live(key);
        const n = Number(e?.v ?? 0) + Number(args[0]);
        this.data.set(key, { v: String(n), exp: e?.exp ?? null });
        return n;
      }
      case "PEXPIRE": {
        const e = this.live(key);
        if (!e) return 0;
        if (args[1]?.toUpperCase() === "NX" && e.exp !== null) return 0;
        e.exp = this.now() + Number(args[0]);
        return 1;
      }
      case "PTTL": {
        const e = this.live(key);
        if (!e) return -2;
        return e.exp === null ? -1 : e.exp - this.now();
      }
      case "GETDEL": {
        const e = this.live(key);
        this.data.delete(key);
        return e?.v ?? null;
      }
      case "DEL":
        return this.data.delete(key) ? 1 : 0;
      case "EVAL": {
        // The only script the app sends: compare-and-delete. args = [numkeys, key, value] with the script as `key`.
        const [, script, , k, v] = cmd.map(String) as [string, string, string, string, string];
        if (!script.includes("redis.call('get',KEYS[1])==ARGV[1]")) throw new Error("fake upstash: unsupported script");
        const e = this.live(k);
        if (e && e.v === v) {
          this.data.delete(k);
          return 1;
        }
        return 0;
      }
      default:
        throw new Error(`fake upstash: unsupported command ${name}`);
    }
  }

  get keys(): string[] {
    return [...this.data.keys()].filter((k) => this.live(k));
  }

  fetch: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = url.startsWith(FAKE_URL) ? url.slice(FAKE_URL.length) : url;
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "null"));
    this.requests.push({ path, auth: headers.get("authorization"), body });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    if (this.mode === "down") throw new TypeError("fetch failed");
    if (this.mode === "500") return new Response("boom", { status: 500 });
    if (this.mode === "unauthorized") return new Response("unauthorized", { status: 401 });
    if (this.mode === "txn-404" && path === "/multi-exec" && (body as (string | number)[][]).some((c) => String(c[0]).toUpperCase() === "PEXPIRE" && c.length === 4)) return new Response("not found", { status: 404 });
    if (this.mode === "txn-not-array" && path === "/multi-exec" && (body as (string | number)[][]).some((c) => String(c[0]).toUpperCase() === "PEXPIRE" && c.length === 4)) return json({ result: "OK" });
    if (this.mode === "error-item") return json(path === "" ? { error: "ERR nope" } : [{ error: "ERR nope" }]);
    if (path === "") return json({ result: this.run(body) });
    if (path === "/multi-exec" || path === "/pipeline") {
      const cmds = body as (string | number)[][];
      if (this.mode === "no-nx" && cmds.some((c) => String(c[0]).toUpperCase() === "PEXPIRE" && c.length === 4)) return json(cmds.map(() => ({ error: "ERR syntax error" })));
      return json(cmds.map((c) => ({ result: this.run(c) })));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

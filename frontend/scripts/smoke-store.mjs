#!/usr/bin/env node
/**
 * One-time check of the shared store against a REAL Upstash Redis REST endpoint. NOT run by CI or
 * tests (the tests use a fake). Run it once after provisioning Upstash and before relying on the
 * limits in production:
 *
 *   cd frontend
 *   node --env-file=../.env scripts/smoke-store.mjs
 *
 * Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL / KV_REST_API_TOKEN).
 * It only touches keys that start with "smoke:" and deletes them at the end. It prints the host and
 * one PASS/FAIL line per command the app depends on, and never prints the token. Exit code 0 means
 * every check passed.
 *
 * Every argument is sent as a string, exactly as the app does.
 *
 * --help  prints this text. The script talks to the REAL store named in the environment and spends
 *         a few dozen commands of its allowance; it never calls a model.
 */
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL(import.meta.url), "utf8");
  console.log(src.slice(src.indexOf("/**") + 3, src.indexOf("*/")).replace(/^ \* ?/gm, "").trim());
  process.exit(0);
}
const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").trim().replace(/\/+$/, "");
const token = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "").trim();
if (!url || !token) {
  console.error("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or the KV_REST_API_ names).");
  process.exit(2);
}
let host;
try {
  host = new URL(url).host;
} catch {
  console.error("The store URL is not a valid URL.");
  process.exit(2);
}
if (!/(^|\.)upstash\.io$|(^|\.)kv\.vercel-storage\.com$/.test(host) && !(process.env.WS_ALLOWED_STORE_HOSTS || "").split(",").map((h) => h.trim()).includes(host)) {
  console.error(`Host ${host} is not on the allowlist (*.upstash.io, *.kv.vercel-storage.com, WS_ALLOWED_STORE_HOSTS): the app would refuse it.`);
  process.exit(2);
}
console.log(`Store host: ${host}`);

const strs = (cmd) => cmd.map((c) => String(c));
async function post(path, body) {
  const res = await fetch(`${url}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  let json;
  try {
    json = await res.json();
  } catch {
    json = undefined;
  }
  return { status: res.status, json };
}
const cmd = async (c) => {
  const r = await post("", strs(c));
  if (r.status !== 200 || r.json?.error) throw new Error(`HTTP ${r.status}${r.json?.error ? ` ${String(r.json.error).slice(0, 80)}` : ""}`);
  return r.json.result;
};
const txn = async (cmds, path = "/multi-exec") => {
  const r = await post(path, cmds.map(strs));
  if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`HTTP ${r.status}, ${Array.isArray(r.json) ? "" : "not an array"}`);
  return r.json.map((x) => {
    if (x?.error) throw new Error(String(x.error).slice(0, 80));
    return x.result;
  });
};

const P = `smoke:${Date.now()}:`;
const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push(true);
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ""}`);
  } catch (e) {
    results.push(false);
    console.log(`FAIL  ${name}  (${String(e?.message ?? e).slice(0, 120)})`);
  }
}
const expectEq = (a, b, what) => {
  if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

await check("SET key value PX ms NX creates once", async () => {
  expectEq(await cmd(["SET", `${P}nx`, "v", "PX", 60000, "NX"]), "OK", "first SET NX");
  expectEq(await cmd(["SET", `${P}nx`, "w", "PX", 60000, "NX"]), null, "second SET NX");
});
await check("GET", async () => expectEq(await cmd(["GET", `${P}nx`]), "v", "GET"));
await check("GETDEL is atomic and single use", async () => {
  expectEq(await cmd(["GETDEL", `${P}nx`]), "v", "first GETDEL");
  expectEq(await cmd(["GETDEL", `${P}nx`]), null, "second GETDEL");
});
await check("DEL", async () => {
  await cmd(["SET", `${P}del`, "1", "PX", 60000]);
  expectEq(Number(await cmd(["DEL", `${P}del`])), 1, "DEL count");
});
await check("MULTI/EXEC: INCRBY + PEXPIRE NX (the atomic counter), first hit sets the TTL, later hits keep it", async () => {
  const k = `${P}ctr`;
  const [n1, set1] = await txn([["INCRBY", k, 2], ["PEXPIRE", k, 30000, "NX"]]);
  expectEq(Number(n1), 2, "first INCRBY");
  expectEq(Number(set1), 1, "PEXPIRE NX on a new key");
  const ttl1 = Number(await cmd(["PTTL", k]));
  if (!(ttl1 > 0 && ttl1 <= 30000)) throw new Error(`TTL ${ttl1}`);
  const [n2, set2] = await txn([["INCRBY", k, 1], ["PEXPIRE", k, 30000, "NX"]]);
  expectEq(Number(n2), 3, "second INCRBY");
  expectEq(Number(set2), 0, "PEXPIRE NX must not extend");
  const ttl2 = Number(await cmd(["PTTL", k]));
  if (ttl2 > ttl1) throw new Error("TTL was extended");
  return `ttl ${ttl1} -> ${ttl2} ms`;
});
await check("FALLBACK form: INCRBY + PTTL in a transaction, then PEXPIRE when PTTL is negative", async () => {
  const k = `${P}fb`;
  const [n, pttl] = await txn([["INCRBY", k, 1], ["PTTL", k]]);
  expectEq(Number(n), 1, "INCRBY");
  if (Number(pttl) >= 0) throw new Error(`fresh key already has a TTL (${pttl})`);
  expectEq(Number(await cmd(["PEXPIRE", k, 30000])), 1, "PEXPIRE");
  const ttl = Number(await cmd(["PTTL", k]));
  if (!(ttl > 0)) throw new Error(`TTL ${ttl}`);
});
await check("INCRBY negative (refund)", async () => {
  const k = `${P}ref`;
  await cmd(["INCRBY", k, 5]);
  expectEq(Number(await cmd(["INCRBY", k, -2])), 3, "refund");
  await cmd(["PEXPIRE", k, 30000]);
});
await check("PIPELINE: GET + PTTL", async () => {
  const [v, ttl] = await txn([["GET", `${P}ctr`], ["PTTL", `${P}ctr`]], "/pipeline");
  expectEq(Number(v), 3, "GET");
  if (!(Number(ttl) > 0)) throw new Error(`TTL ${ttl}`);
});
await check("EVAL compare-and-delete (the lock release)", async () => {
  const lua = "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
  const k = `${P}lock`;
  await cmd(["SET", k, "token-a", "PX", 60000, "NX"]);
  expectEq(Number(await cmd(["EVAL", lua, 1, k, "token-b"])), 0, "wrong token");
  expectEq(await cmd(["GET", k]), "token-a", "lock survived the wrong token");
  expectEq(Number(await cmd(["EVAL", lua, 1, k, "token-a"])), 1, "right token");
  expectEq(await cmd(["GET", k]), null, "lock gone");
});
await check("every argument as a string is accepted (numbers sent as strings)", async () => {
  expectEq(await cmd(["SET", `${P}str`, "12", "PX", "60000"]), "OK", "SET with string PX");
});

// cleanup
for (const k of ["nx", "del", "ctr", "fb", "ref", "lock", "str"]) await cmd(["DEL", `${P}${k}`]).catch(() => undefined);

const failed = results.filter((x) => !x).length;
console.log(failed === 0 ? `\nAll ${results.length} checks passed.` : `\n${failed} of ${results.length} checks FAILED. Do not rely on the shared store until they pass.`);
process.exit(failed === 0 ? 0 : 1);

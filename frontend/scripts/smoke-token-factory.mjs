#!/usr/bin/env node
/**
 * First live smoke test for the Token Factory provider. NOT run by CI or tests.
 *
 *   cd frontend
 *   node --env-file=../.env scripts/smoke-token-factory.mjs            # list models + one structured call per role model
 *   node --env-file=../.env scripts/smoke-token-factory.mjs --stream   # also probe streaming
 *
 * Reads NEBIUS_API_KEY and NEBIUS_BASE_URL from the environment (never printed). Optional model
 * overrides: WS_MODEL_PLANNER, WS_MODEL_CRITIC, WS_MODEL_PARSER, WS_MODEL_NARRATOR, WS_MODEL_EXTRACTOR.
 * The output is written so it can be pasted into docs/FEEDBACK_NOTES.md.
 *
 * --measure-screen [--base http://localhost:3000] [--n 10]
 *   Measures how much real-model commentary passes the app's screen. It calls a RUNNING app's own
 *   routes (start it yourself with a real NEBIUS_API_KEY in its environment; this script never reads
 *   or prints the key), runs N synthetic missions (propose, finalize, narrate: about three model
 *   calls each), and prints, per text field, how often the commentary passed, was withheld by the
 *   screen (with the rejection codes), or made the whole answer fall back. Synthetic evaluation
 *   numbers are used only to build valid requests; they are not results. Give the app room for the
 *   run, for example: WS_IP_MISSIONS_PER_HOUR=100 WS_FRONT_DOOR_PER_IP_PER_MIN=300 WS_IP_DAILY_USD=5.
 */
import OpenAI from "openai";

if (process.argv.includes("--measure-screen")) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
  };
  await measureScreen(arg("--base", "http://localhost:3000").replace(/\/+$/, ""), Math.max(1, Number(arg("--n", "10")) || 10));
  process.exit(0);
}

async function measureScreen(base, n) {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const candidates = JSON.parse(readFileSync(join(root, "public", "snapshot", "candidates.json"), "utf8")).filter((c) => (c.lens ?? []).includes("access"));
  if (candidates.length < 6) {
    console.error("Need public/snapshot/candidates.json with at least 6 access-lens candidates (run the prebuild first).");
    process.exit(2);
  }
  const mission = { lens: "access", goal: { metric: "p90", op: "<=", targetDelta: 300 }, constraints: { maxCostTier: "$$$", types: [], areas: [] } };
  const baseline = { p50S: 600, p90S: 1500, pctWithin: 40, isolatedCount: 6, equityGapS: 240 };
  const stats = new Map(); // field -> { total, passed, withheld, codes: Map }
  const note = (field, ok, codes = []) => {
    const s = stats.get(field) ?? { total: 0, passed: 0, withheld: 0, codes: new Map() };
    s.total++;
    if (ok) s.passed++;
    else {
      s.withheld++;
      for (const c of codes) s.codes.set(c, (s.codes.get(c) ?? 0) + 1);
    }
    stats.set(field, s);
  };
  let calls = 0;
  let repaired = 0;
  let fallbacks = 0;
  const post = async (path, body) => {
    calls++;
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(body) });
    const text = await res.text();
    const events = text.split("\n\n").filter(Boolean).map((b) => ({ event: /^event: (.*)$/m.exec(b)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(b)?.[1] ?? "null") }));
    const done = events.find((e) => e.event === "done")?.data ?? (res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null);
    return { events, done, status: res.status };
  };
  const audit = (fields, r) => {
    if (r.done?.status !== "ok") {
      fallbacks++;
      console.log(`  fallback: ${r.done?.reason ?? r.status} (${r.done?.message ?? ""})`);
      return false;
    }
    if (r.done.repaired) repaired++;
    const withheld = new Map();
    for (const e of r.events.filter((x) => x.event === "log" && x.data?.code === "commentary_withheld")) {
      for (const line of e.data.errors ?? []) {
        const m = /rule 5 \((\w+)\) at ([\w.]+):/.exec(line);
        if (m) withheld.set(m[2], [...(withheld.get(m[2]) ?? []), m[1]]);
      }
    }
    for (const f of fields) note(f, !withheld.has(f), withheld.get(f) ?? []);
    return true;
  };
  console.log(`Measuring the commentary screen against ${base} with ${n} synthetic missions (never prints the key).`);
  for (let i = 1; i <= n; i++) {
    const missionId = `measure-${Date.now().toString(36)}-${i}`;
    const propose = await post("/api/agent/plan", { missionId, mission, phase: "search", round: 1, bundles: [], evaluations: [], dropped: [] });
    if (!audit(["commentary", "mechanism_note"], propose)) continue;
    const bundles = propose.done.result.bundles;
    const rows = bundles.slice(0, 3).map((b, k) => ({ bundleId: b.id, candidateIds: b.candidateIds, p50S: 500 + k, p90S: 1300 + 10 * k, pctWithin: 50, isolatedCount: 3, equityGapS: 200, pGoal: 0.4, costTier: "$$$" }));
    if (rows.length < 3) {
      console.log("  fewer than three bundles proposed; skipping finalize");
      continue;
    }
    const fin = await post("/api/agent/plan", { missionId, mission, phase: "finalize", round: 1, bundles: bundles.slice(0, 3).map((b) => ({ id: b.id, candidateIds: b.candidateIds })), evaluations: rows, baseline, dropped: [] });
    if (audit(["commentary", "finalists.0.mechanism_note", "finalists.1.mechanism_note", "finalists.2.mechanism_note"], fin)) {
      const nar = await post("/api/agent/narrate", { missionId, mission, finalists: fin.done.result.finalists.map((f) => ({ bundleId: f.bundleId })), evaluations: rows, baseline });
      audit(["items.0.commentary", "items.1.commentary", "items.2.commentary"], nar);
    }
  }
  console.log(`\nProvider-backed calls made through the app: ${calls}; answers that needed a repair turn: ${repaired}; whole answers that fell back: ${fallbacks}`);
  console.log("Per-field acceptance (passed / total; withheld reasons by code):");
  for (const [field, s] of [...stats].sort()) {
    const codes = [...s.codes].map(([c, k]) => `${c}=${k}`).join(", ");
    console.log(`  ${field.padEnd(30)} ${s.passed}/${s.total} = ${((100 * s.passed) / Math.max(1, s.total)).toFixed(0)}%${codes ? `   withheld by: ${codes}` : ""}`);
  }
  const all = [...stats.values()].reduce((a, s) => ({ t: a.t + s.total, p: a.p + s.passed }), { t: 0, p: 0 });
  console.log(`Overall commentary acceptance: ${all.p}/${all.t} = ${((100 * all.p) / Math.max(1, all.t)).toFixed(0)}%`);
}

const DEFAULTS = {
  planner: ["nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b"],
  critic: ["nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b"],
  parser: ["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "nvidia/Nemotron-3_5-Lightning", "nvidia/nemotron-3-super-120b-a12b"],
  narrator: ["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "nvidia/nemotron-3-super-120b-a12b"],
  extractor: ["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "nvidia/Nemotron-3_5-Lightning", "nvidia/nemotron-3-super-120b-a12b"],
};

const apiKey = process.env.NEBIUS_API_KEY;
const baseURL = process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1/";
const withStream = process.argv.includes("--stream");
// The API key is sent to this URL, so it must be https on an allowed host (same rule as the server).
{
  let u;
  try {
    u = new URL(baseURL);
  } catch {
    console.error("NEBIUS_BASE_URL is not a valid URL.");
    process.exit(2);
  }
  const hosts = ["nebius.com", ...(process.env.WS_ALLOWED_BASE_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)];
  if (u.protocol !== "https:" || u.username || u.password || !hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) {
    console.error("NEBIUS_BASE_URL must be https on an allowed host (nebius.com or WS_ALLOWED_BASE_HOSTS).");
    process.exit(2);
  }
}
if (!apiKey) {
  console.error("NEBIUS_API_KEY is not set. Put it in the root .env (never commit it) and pass --env-file=../.env");
  process.exit(2);
}

function chain(role) {
  const raw = process.env[`WS_MODEL_${role.toUpperCase()}`]?.trim();
  const ids = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (ids.length === 0) return DEFAULTS[role];
  if (ids.length === 1) return [ids[0], ...DEFAULTS[role].filter((m) => m !== ids[0])];
  return ids;
}

const client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 60_000 });
const schema = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" }, word: { type: "string", maxLength: 20 } },
  required: ["ok", "word"],
};
const results = [];

console.log(`Base URL host: ${new URL(baseURL).host}`);
let listed = [];
try {
  const page = await client.models.list();
  listed = (page.data ?? []).map((m) => m.id);
  console.log(`GET /models: ${listed.length} models listed`);
  for (const id of listed.filter((i) => /nemotron/i.test(i))) console.log(`  ${id}`);
} catch (e) {
  console.error(`GET /models failed: status ${e?.status ?? "n/a"} ${String(e?.message ?? e).slice(0, 200)}`);
  process.exit(1);
}
const canon = new Map(listed.map((i) => [i.toLowerCase(), i]));

const models = new Map(); // model -> roles
for (const role of Object.keys(DEFAULTS)) {
  const hit = chain(role).map((m) => canon.get(m.toLowerCase())).find(Boolean);
  console.log(`role ${role}: ${hit ?? "unavailable"}`);
  if (hit) models.set(hit, [...(models.get(hit) ?? []), role]);
}

for (const [model, roles] of models) {
  const t0 = Date.now();
  const row = { model, roles: roles.join(","), jsonSchema: "n/a", ms: 0, usage: "n/a", note: "" };
  try {
    const res = await client.chat.completions.create({
      model,
      max_tokens: 300,
      temperature: 0,
      messages: [
        { role: "system", content: "You are a test harness. Reply with one JSON object only." },
        { role: "user", content: 'Return {"ok": true, "word": "harbor"}.' },
      ],
      response_format: { type: "json_schema", json_schema: { name: "smoke", schema } },
    });
    row.ms = Date.now() - t0;
    const text = res.choices?.[0]?.message?.content ?? "";
    row.usage = `${res.usage?.prompt_tokens ?? "?"} in / ${res.usage?.completion_tokens ?? "?"} out`;
    try {
      const v = JSON.parse(text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim());
      row.jsonSchema = v && v.ok === true && typeof v.word === "string" ? "OK" : "parsed but wrong shape";
    } catch {
      row.jsonSchema = "reply was not JSON";
      row.note = `first 80 chars: ${JSON.stringify(text.slice(0, 80))}`;
    }
  } catch (e) {
    row.ms = Date.now() - t0;
    row.jsonSchema = `FAILED status ${e?.status ?? "n/a"}`;
    row.note = String(e?.message ?? e).slice(0, 160);
  }
  if (withStream) {
    try {
      let n = 0;
      const stream = await client.chat.completions.create({
        model, max_tokens: 60, temperature: 0, stream: true, stream_options: { include_usage: true },
        messages: [{ role: "user", content: "Say the word harbor." }],
      });
      for await (const chunk of stream) if (chunk.choices?.[0]?.delta?.content) n++;
      row.note += ` stream: ${n} content chunks`;
    } catch (e) {
      row.note += ` stream FAILED status ${e?.status ?? "n/a"}`;
    }
  }
  results.push(row);
}

console.log("\nResults (paste into docs/FEEDBACK_NOTES.md with the date):");
for (const r of results) console.log(`- ${r.model} [${r.roles}]: json_schema ${r.jsonSchema}, ${r.ms} ms, ${r.usage}. ${r.note}`.trim());
const bad = results.filter((r) => r.jsonSchema !== "OK");
if (bad.length) {
  console.log("\nIf json_schema failed for a model, the server retries that model once as JSON-in-text automatically; note it in the feedback file.");
}
process.exit(results.length === 0 ? 1 : 0);

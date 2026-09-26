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
 */
import OpenAI from "openai";

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

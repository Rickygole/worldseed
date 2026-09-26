import { beforeEach, describe, expect, it } from "vitest";
import {
  callRole,
  classifyError,
  createTokenFactoryProvider,
  extractJson,
  ProviderError,
  resetDowngrades,
  type OpenAILike,
} from "../../lib/server/tokenfactory";
import { FakeProvider, blockNetwork } from "./fixtures";

beforeEach(() => {
  blockNetwork();
  resetDowngrades();
});

/** Hand-written fake of the OpenAI SDK surface (no network). */
function fakeOpenAI(script: (body: Record<string, unknown>) => unknown): { client: OpenAILike; bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  const client: OpenAILike = {
    chat: {
      completions: {
        create: async (body) => {
          bodies.push(body);
          const r = script(body);
          if (r instanceof Error) throw r;
          return r;
        },
      },
    },
    models: { list: async () => ({ data: [{ id: "a/one" }, { id: "b/two" }] }) },
  };
  return { client, bodies };
}
const httpError = (status: number, message = "boom", headers: Record<string, string> = {}) => Object.assign(new Error(message), { status, headers });
const completion = (text: string) => ({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7 } });
const base = { messages: [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "u" }], schemaName: "x", jsonSchema: { type: "object" }, maxTokens: 100, timeoutMs: 500 };

describe("classifyError", () => {
  it("maps HTTP statuses to kinds", () => {
    expect(classifyError(httpError(429, "slow down", { "retry-after": "7" }))).toMatchObject({ kind: "rate_limited", retryAfterS: 7 });
    expect(classifyError(httpError(401)).kind).toBe("auth");
    expect(classifyError(httpError(404)).kind).toBe("model_not_found");
    expect(classifyError(httpError(400, "response_format json_schema is not supported")).kind).toBe("schema_unsupported");
    expect(classifyError(httpError(400, "bad temperature")).kind).toBe("bad_request");
    expect(classifyError(httpError(503)).kind).toBe("upstream");
    expect(classifyError(Object.assign(new Error("x"), { name: "APIConnectionTimeoutError" })).kind).toBe("timeout");
  });
});

describe("createTokenFactoryProvider", () => {
  it("sends a json_schema response_format, max_tokens and reads usage", async () => {
    const { client, bodies } = fakeOpenAI(() => completion('{"ok":true}'));
    const p = createTokenFactoryProvider(client);
    const res = await p.complete({ ...base, model: "m", mode: "json_schema", temperature: 0.2 });
    expect(res).toMatchObject({ text: '{"ok":true}', usage: { inputTokens: 11, outputTokens: 7 } });
    expect(bodies[0]).toMatchObject({ model: "m", max_tokens: 100, response_format: { type: "json_schema", json_schema: { name: "x" } } });
    expect(bodies[0]).not.toHaveProperty("tools");
  });
  it("json_text mode sends no response_format", async () => {
    const { client, bodies } = fakeOpenAI(() => completion("{}"));
    await createTokenFactoryProvider(client).complete({ ...base, model: "m", mode: "json_text", temperature: 0 });
    expect(bodies[0]).not.toHaveProperty("response_format");
  });
  it("times out even if the client ignores the abort signal", async () => {
    const { client } = fakeOpenAI(() => new Promise(() => {}) as never);
    const p = createTokenFactoryProvider({ ...client, chat: { completions: { create: () => new Promise(() => {}) } } });
    await expect(p.complete({ ...base, model: "m", mode: "json_schema", temperature: 0, timeoutMs: 20 })).rejects.toMatchObject({ kind: "timeout" });
  });
  it("streams deltas and reads usage from the final chunk", async () => {
    const chunks = [
      { choices: [{ delta: { content: '{"a"' } }] },
      { choices: [{ delta: { content: ":1}" }, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } },
    ];
    const { client, bodies } = fakeOpenAI(() => (async function* () { yield* chunks; })());
    const seen: string[] = [];
    const res = await createTokenFactoryProvider(client).complete({ ...base, model: "m", mode: "json_schema", temperature: 0, onDelta: (d) => seen.push(d) });
    expect(res.text).toBe('{"a":1}');
    expect(seen).toEqual(['{"a"', ":1}"]);
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 3 });
    expect(bodies[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });
  it("lists model IDs", async () => {
    const { client } = fakeOpenAI(() => completion("{}"));
    expect(await createTokenFactoryProvider(client).listModels()).toEqual(["a/one", "b/two"]);
  });
  it("never makes a real network call", async () => {
    const { client } = fakeOpenAI(() => completion("{}"));
    await createTokenFactoryProvider(client).listModels();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("callRole fallback chain", () => {
  const deadlineAt = () => Date.now() + 30_000;
  it("falls through to the next model on 404, 429, timeout and 5xx", async () => {
    for (const kind of ["model_not_found", "rate_limited", "timeout", "upstream"] as const) {
      const p = new FakeProvider([new ProviderError(kind, "x"), "{}"]);
      const r = await callRole(p, ["m1", "m2"], { ...base, deadlineAt: deadlineAt() });
      expect(r.model).toBe("m2");
      expect(r.skipped).toEqual([{ model: "m1", kind }]);
    }
  });
  it("throws the last error when every model fails (429)", async () => {
    const p = new FakeProvider([new ProviderError("rate_limited", "x", 429, 9), new ProviderError("rate_limited", "y", 429, 9)]);
    await expect(callRole(p, ["m1", "m2"], { ...base, deadlineAt: deadlineAt() })).rejects.toMatchObject({ kind: "rate_limited" });
  });
  it("auth errors are fatal and do not try other models", async () => {
    const p = new FakeProvider([new ProviderError("auth", "no"), "{}"]);
    await expect(callRole(p, ["m1", "m2"], { ...base, deadlineAt: deadlineAt() })).rejects.toMatchObject({ kind: "auth" });
    expect(p.calls).toHaveLength(1);
  });
  it("retries once as JSON-in-text when a model rejects response_format, and remembers it", async () => {
    const p = new FakeProvider([new ProviderError("schema_unsupported", "response_format"), "{}", "{}"]);
    const r = await callRole(p, ["m1"], { ...base, deadlineAt: deadlineAt() });
    expect(r.mode).toBe("json_text");
    expect(p.calls.map((c) => c.mode)).toEqual(["json_schema", "json_text"]);
    expect(p.calls[1].messages[0].content).toContain("single JSON object");
    await callRole(p, ["m1"], { ...base, deadlineAt: deadlineAt() });
    expect(p.calls[2].mode).toBe("json_text");
  });
  it("stops when the route deadline is nearly spent", async () => {
    const p = new FakeProvider(["{}"]);
    await expect(callRole(p, ["m1"], { ...base, deadlineAt: Date.now() + 100 })).rejects.toMatchObject({ kind: "timeout" });
    expect(p.calls).toHaveLength(0);
  });
  it("does not swallow an abort", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const p = new FakeProvider([new ProviderError("aborted", "x")]);
    await expect(callRole(p, ["m1", "m2"], { ...base, deadlineAt: deadlineAt(), signal: ctl.signal })).rejects.toMatchObject({ kind: "aborted" });
  });
});

describe("extractJson", () => {
  it("parses plain JSON, fenced JSON and JSON after a think block", () => {
    expect(extractJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractJson('<think>hmm 12 things</think>{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractJson('Sure! {"a":1} hope that helps')).toEqual({ ok: true, value: { a: 1 } });
  });
  it("reports malformed JSON", () => {
    expect(extractJson('{"a":')).toMatchObject({ ok: false });
    expect(extractJson("")).toMatchObject({ ok: false });
  });
});

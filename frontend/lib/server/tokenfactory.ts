/**
 * Token Factory provider (OpenAI-compatible) behind an interface, so tests inject a fake client.
 *
 * Default path is JSON-schema structured output (`response_format`). It never depends on native
 * tool calling. If a model rejects the schema format, the call is retried once as JSON-in-text with
 * the schema embedded in the system prompt; validation and the repair turn happen in the caller.
 */
import OpenAI from "openai";
import { logEvent } from "./log";
import { capsFor } from "./models";

export type ProviderErrorKind =
  | "rate_limited"
  | "timeout"
  | "auth"
  | "model_not_found"
  | "schema_unsupported"
  | "bad_request"
  | "upstream"
  | "network"
  | "aborted";

export class ProviderError extends Error {
  /** Upstream calls that were made before this error surfaced (set by callRole). */
  attempts?: number;
  constructor(
    public kind: ProviderErrorKind,
    message: string,
    public status?: number,
    public retryAfterS?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/* ------------------------------ attempt gating ----------------------------- */

export type DenyReason = "mission_input" | "mission_output" | "mission_calls" | "daily_budget" | "ip_budget" | "store_error" | "provider_backoff";

/** Thrown by a gate to stop before an upstream attempt (budget, cap, backoff). Nothing was sent. */
export class AttemptDenied extends Error {
  attempts = 0;
  constructor(
    public reason: DenyReason,
    public retryAfterS?: number,
  ) {
    super(`attempt denied: ${reason}`);
    this.name = "AttemptDenied";
  }
}

export type AttemptOutcome =
  | { ok: true; usage: { inputTokens: number; outputTokens: number }; text: string; model: string }
  | { ok: false; kind: ProviderErrorKind };

/**
 * Charged around EVERY upstream attempt, not once per request: a request that falls through a
 * model chain or retries as JSON-in-text makes several billable calls, and each one is reserved
 * before it is sent and settled after, success or failure.
 */
export interface AttemptGate {
  before(model: string): Promise<{ maxTokens: number; handle: unknown }>;
  after(handle: unknown, outcome: AttemptOutcome): Promise<void>;
}

/** Shared pause after a provider 429: honors Retry-After, otherwise backs off exponentially. */
export class ProviderBackoff {
  private until = 0;
  private strikes = 0;
  constructor(private now: () => number = Date.now) {}

  /** Seconds left in the pause (0 when calls may go out). */
  remainingS(): number {
    return Math.max(0, Math.ceil((this.until - this.now()) / 1000));
  }

  hit(retryAfterS?: number): number {
    const dflt = 2 * 2 ** Math.min(this.strikes, 5);
    const s = Math.min(120, Math.max(1, Math.ceil(retryAfterS && retryAfterS > 0 ? retryAfterS : dflt)));
    this.strikes++;
    this.until = Math.max(this.until, this.now() + s * 1000);
    return s;
  }

  ok(): void {
    this.strikes = 0;
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type StructuredMode = "json_schema" | "json_text";

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  mode: StructuredMode;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  signal?: AbortSignal;
  /** When set, the upstream call is streamed and deltas are reported here (never shown raw). */
  onDelta?: (text: string) => void;
}

export interface CompletionResult {
  text: string;
  model: string;
  mode: StructuredMode;
  usage: { inputTokens: number; outputTokens: number };
  finishReason?: string;
}

export interface LlmProvider {
  listModels(signal?: AbortSignal): Promise<string[]>;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

/** The slice of the OpenAI SDK we use. Tests pass a hand-written fake. */
export interface OpenAILike {
  chat: { completions: { create(body: Record<string, unknown>, opts?: Record<string, unknown>): Promise<unknown> } };
  models: { list(opts?: Record<string, unknown>): Promise<unknown> };
}

export function createOpenAIClient(cfg: { apiKey: string; baseURL: string }): OpenAILike {
  return new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, maxRetries: 0 }) as unknown as OpenAILike;
}

/* ------------------------------ error mapping ------------------------------ */

export function classifyError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const err = e as { status?: number; name?: string; message?: string; headers?: Record<string, string> | Headers };
  const status = typeof err?.status === "number" ? err.status : undefined;
  const message = String(err?.message ?? "upstream error").slice(0, 300);
  const name = String(err?.name ?? "");
  if (name === "AbortError") return new ProviderError("aborted", "aborted");
  if (/timeout/i.test(name)) return new ProviderError("timeout", message, status);
  if (status === 429) {
    let ra: number | undefined;
    const h = err.headers;
    const raw = h instanceof Headers ? h.get("retry-after") : h?.["retry-after"];
    if (raw && Number.isFinite(Number(raw))) ra = Number(raw);
    return new ProviderError("rate_limited", message, 429, ra);
  }
  if (status === 401 || status === 403) return new ProviderError("auth", message, status);
  if (status === 404) return new ProviderError("model_not_found", message, status);
  if (status === 408 || status === 504) return new ProviderError("timeout", message, status);
  if (status === 400 || status === 422) {
    return new ProviderError(/response_format|json_schema|json schema|guided|structured/i.test(message) ? "schema_unsupported" : "bad_request", message, status);
  }
  if (status !== undefined && status >= 500) return new ProviderError("upstream", message, status);
  if (/connection|fetch failed|ECONN|ENOTFOUND/i.test(name + message)) return new ProviderError("network", message);
  return new ProviderError("upstream", message, status);
}

/** Runs `fn` with a timeout that works even if the underlying client ignores the abort signal. */
async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, parent?: AbortSignal): Promise<T> {
  const ctl = new AbortController();
  const onParent = () => ctl.abort();
  if (parent?.aborted) throw new ProviderError("aborted", "aborted");
  parent?.addEventListener("abort", onParent, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(ctl.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ctl.abort();
          reject(new ProviderError("timeout", `no response within ${ms} ms`));
        }, ms);
      }),
    ]);
  } catch (e) {
    if (parent?.aborted) throw new ProviderError("aborted", "aborted");
    throw classifyError(e);
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener("abort", onParent);
  }
}

/* --------------------------------- provider -------------------------------- */

interface ChatCompletionShape {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}
interface ChunkShape {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export function createTokenFactoryProvider(client: OpenAILike): LlmProvider {
  return {
    async listModels(signal) {
      const res = (await withTimeout(() => client.models.list({ signal }), 8_000, signal)) as {
        data?: { id: string }[];
      } & AsyncIterable<{ id: string }>;
      if (Array.isArray(res?.data)) return res.data.map((m) => m.id);
      const ids: string[] = [];
      if (res && Symbol.asyncIterator in Object(res)) for await (const m of res) ids.push(m.id);
      return ids;
    },

    async complete(req) {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
      };
      if (req.mode === "json_schema") {
        body.response_format = { type: "json_schema", json_schema: { name: req.schemaName, schema: req.jsonSchema } };
      }
      return withTimeout(async (signal) => {
        if (req.onDelta) {
          const stream = (await client.chat.completions.create(
            { ...body, stream: true, stream_options: { include_usage: true } },
            { signal },
          )) as AsyncIterable<ChunkShape>;
          let text = "";
          let usage: ChunkShape["usage"] = null;
          let finish: string | undefined;
          for await (const chunk of stream) {
            const d = chunk.choices?.[0]?.delta?.content;
            if (d) {
              text += d;
              req.onDelta(d);
            }
            finish = chunk.choices?.[0]?.finish_reason ?? finish;
            if (chunk.usage) usage = chunk.usage;
          }
          return {
            text,
            model: req.model,
            mode: req.mode,
            usage: { inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0 },
            finishReason: finish,
          };
        }
        const res = (await client.chat.completions.create(body, { signal })) as ChatCompletionShape;
        return {
          text: res.choices?.[0]?.message?.content ?? "",
          model: req.model,
          mode: req.mode,
          usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
          finishReason: res.choices?.[0]?.finish_reason ?? undefined,
        };
      }, req.timeoutMs, req.signal);
    },
  };
}

/* ------------------------- fallback chain and JSON text -------------------- */

export interface RoleCallRequest {
  messages: ChatMessage[];
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  temperature?: number;
  timeoutMs: number;
  /** Absolute epoch ms after which no further model may be tried. */
  deadlineAt: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}

export interface RoleCallResult extends CompletionResult {
  /** Models that failed before this one answered, with why. */
  skipped: { model: string; kind: ProviderErrorKind }[];
  /** Upstream calls made for this answer, the failed ones included. */
  attempts: number;
}

export interface RoleCallOptions {
  /** Hard cap on upstream calls for this invocation (default 3). */
  maxAttempts?: number;
  gate?: AttemptGate;
}

export const DEFAULT_MAX_ATTEMPTS = 3;

/** Models that rejected `response_format` this process lifetime; they get JSON-in-text. */
const downgraded = new Set<string>();
export function resetDowngrades(): void {
  downgraded.clear();
}

/** Prompt builders already embed the schema; this only forbids anything but the JSON object. */
function withSchemaInPrompt(messages: ChatMessage[]): ChatMessage[] {
  const note = "Respond with a single JSON object matching the schema above, and nothing else: no prose, no code fences.";
  const idx = messages.findIndex((m) => m.role === "system");
  if (idx < 0) return [{ role: "system", content: note }, ...messages];
  return messages.map((m, i) => (i === idx ? { ...m, content: `${m.content}\n\n${note}` } : m));
}

/**
 * Tries models in order, at most `maxAttempts` upstream calls in total. Falls through on missing
 * model, timeout and upstream error, and retries a schema rejection once as JSON-in-text. Auth
 * errors, aborts and rate limits (429) stop the chain at once: another model would only add load.
 * Every attempt goes through the optional gate (reserve before, settle after).
 */
export async function callRole(
  provider: LlmProvider,
  models: readonly string[],
  req: RoleCallRequest,
  now: () => number = Date.now,
  opts: RoleCallOptions = {},
): Promise<RoleCallResult> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const skipped: RoleCallResult["skipped"] = [];
  let attempts = 0;
  let last: ProviderError = new ProviderError("model_not_found", "no model available");
  outer: for (const model of models) {
    const remaining = req.deadlineAt - now();
    if (remaining < 1_500) {
      last = new ProviderError("timeout", "out of time before trying another model");
      break;
    }
    const timeoutMs = Math.min(req.timeoutMs, remaining - 500);
    let mode: StructuredMode = capsFor(model).supportsJsonSchema && !downgraded.has(model) ? "json_schema" : "json_text";
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempts >= maxAttempts) break outer;
      let maxTokens = req.maxTokens;
      let handle: unknown;
      if (opts.gate) {
        try {
          ({ maxTokens, handle } = await opts.gate.before(model));
        } catch (e) {
          if (e instanceof AttemptDenied) e.attempts = attempts;
          throw e;
        }
      }
      attempts++;
      try {
        const res = await provider.complete({
          model,
          mode,
          messages: mode === "json_text" ? withSchemaInPrompt(req.messages) : req.messages,
          schemaName: req.schemaName,
          jsonSchema: req.jsonSchema,
          maxTokens,
          temperature: req.temperature ?? 0.2,
          timeoutMs,
          signal: req.signal,
          onDelta: req.onDelta,
        });
        if (opts.gate) await opts.gate.after(handle, { ok: true, usage: res.usage, text: res.text, model: res.model });
        return { ...res, skipped, attempts };
      } catch (e) {
        const pe = classifyError(e);
        if (opts.gate) await opts.gate.after(handle, { ok: false, kind: pe.kind });
        pe.attempts = attempts;
        if (pe.kind === "aborted" || pe.kind === "auth" || pe.kind === "rate_limited") throw pe;
        if (pe.kind === "schema_unsupported" && mode === "json_schema") {
          downgraded.add(model);
          logEvent("warn", "model_downgraded", { model, to: "json_text" });
          mode = "json_text";
          continue;
        }
        skipped.push({ model, kind: pe.kind });
        last = pe;
        break;
      }
    }
  }
  last.attempts = attempts;
  throw last;
}

/** Pulls one JSON value out of model text: strips think blocks and code fences. */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    // Fall through to brace matching below.
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return { ok: true, value: JSON.parse(t.slice(start, end + 1)) };
    } catch {
      /* not JSON */
    }
  }
  return { ok: false, error: "the output was not valid JSON" };
}

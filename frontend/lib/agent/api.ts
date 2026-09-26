/**
 * Browser-side client for the agent routes. The machine talks to the `AgentApi` interface so
 * tests can inject a fake; `createFetchAgentApi` is the real implementation.
 */
import {
  AGENT_EVENT_NAMES,
  type AgentEvent,
  type CritiqueRequest,
  type NarrateRequest,
  type Outcome,
  type ParseRequest,
  type PlanRequest,
} from "./protocol";
import type { CritiqueOutput, NarrationOutput, ParsedMission, PlannerAction } from "./tools";

export interface CallOptions {
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
}

export interface AgentApi {
  parse(req: ParseRequest, opts?: CallOptions): Promise<Outcome<ParsedMission>>;
  plan(req: PlanRequest, opts?: CallOptions): Promise<Outcome<PlannerAction>>;
  critique(req: CritiqueRequest, opts?: CallOptions): Promise<Outcome<CritiqueOutput>>;
  narrate(req: NarrateRequest, opts?: CallOptions): Promise<Outcome<NarrationOutput>>;
}

/** Incremental Server-Sent Events parser. Feed it text chunks; it yields complete events. */
export class SseParser {
  private buf = "";
  push(chunk: string): AgentEvent[] {
    this.buf += chunk.replace(/\r\n/g, "\n");
    const out: AgentEvent[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf("\n\n")) >= 0) {
      const block = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      const ev = parseBlock(block);
      if (ev) out.push(ev);
    }
    return out;
  }
}

function parseBlock(block: string): AgentEvent | null {
  let name = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!(AGENT_EVENT_NAMES as readonly string[]).includes(name) || data.length === 0) return null;
  try {
    return { event: name, data: JSON.parse(data.join("\n")) } as AgentEvent;
  } catch {
    return null;
  }
}

function fallbackUnreachable(message: string): Outcome<never> {
  return { status: "fallback", reason: "upstream_error", message, next: "deterministic_search" };
}

async function call<T>(url: string, body: unknown, opts: CallOptions = {}, fetchImpl: typeof fetch): Promise<Outcome<T>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream, application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    return fallbackUnreachable("Could not reach the planner service.");
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream")) {
    // Pre-flight rejection (rate limit, invalid payload) is a JSON outcome body.
    try {
      const json = (await res.json()) as Outcome<T>;
      if (json && typeof json === "object" && "status" in json) return json;
    } catch {
      /* fall through */
    }
    return fallbackUnreachable(`Planner service returned status ${res.status}.`);
  }
  if (!res.body) return fallbackUnreachable("Planner service returned an empty stream.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  let done: Outcome<T> | null = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
      opts.onEvent?.(ev);
      if (ev.event === "done") done = ev.data as Outcome<T>;
    }
  }
  return done ?? fallbackUnreachable("The planner stream ended early.");
}

export function createFetchAgentApi(opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): AgentApi {
  const base = opts.baseUrl ?? "";
  const f: typeof fetch = opts.fetchImpl ?? ((...a) => fetch(...a));
  return {
    parse: (req, o) => call(`${base}/api/agent/parse`, req, o, f),
    plan: (req, o) => call(`${base}/api/agent/plan`, req, o, f),
    critique: (req, o) => call(`${base}/api/agent/critique`, req, o, f),
    narrate: (req, o) => call(`${base}/api/agent/narrate`, req, o, f),
  };
}

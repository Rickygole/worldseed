/** Server-Sent Events helper for the agent routes. */
import type { AgentEvent } from "../agent/protocol";

export type Emit = (e: AgentEvent) => void;

/** Emit sink for internal calls that have no client stream. */
export const noopEmit: Emit = () => {};

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

export function formatSse(e: AgentEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

/**
 * Streams whatever `run` emits. The stream always ends with a `done` event; if `run` throws, an
 * `error` event is sent first and `done` carries a structured fallback, never a stack trace.
 */
export function sseResponse(run: (emit: Emit) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sawDone = false;
      let closed = false;
      const emit: Emit = (e) => {
        if (closed) return;
        if (e.event === "done") sawDone = true;
        try {
          controller.enqueue(enc.encode(formatSse(e)));
        } catch {
          closed = true;
        }
      };
      try {
        await run(emit);
      } catch {
        emit({ event: "error", data: { code: "internal_error", message: "The planner service hit an internal error." } });
      }
      if (!sawDone) {
        emit({
          event: "done",
          data: {
            status: "fallback",
            reason: "upstream_error",
            message: "The planner service hit an internal error.",
            next: "deterministic_search",
          },
        });
      }
      if (!closed) controller.close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

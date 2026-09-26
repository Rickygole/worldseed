import { beforeEach, describe, expect, it } from "vitest";
import { SseParser, createFetchAgentApi } from "../../lib/agent/api";
import { formatSse, sseResponse } from "../../lib/server/sse";
import { fillSlots, makeSlotResolver } from "../../lib/agent/slots";
import { BASELINE, blockNetwork, readSse, row } from "./fixtures";

beforeEach(blockNetwork);

describe("SSE", () => {
  it("round-trips all six event types through the server helper and the client parser", async () => {
    const res = sseResponse(async (emit) => {
      emit({ event: "status", data: { phase: "x", message: "hi" } });
      emit({ event: "log", data: { kind: "info", sentence: "line one\nline two" } });
      emit({ event: "tool_call", data: { name: "propose", args: { a: 1 }, model: "m", repaired: false } });
      emit({ event: "usage", data: { role: "planner", model: "m", inputTokens: 1, outputTokens: 2, mission: { inputTokens: 1, outputTokens: 2, limitIn: 3, limitOut: 4 } } });
      emit({ event: "error", data: { code: "c", message: "m" } });
      emit({ event: "done", data: { status: "fallback", reason: "upstream_error", message: "m", next: "retry_later" } });
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect((await readSse(res.clone())).map((e) => e.event)).toEqual(["status", "log", "tool_call", "usage", "error", "done"]);
    const parsed = new SseParser().push(await res.text());
    expect(parsed).toHaveLength(6);
    expect((parsed[1].data as { sentence: string }).sentence).toBe("line one\nline two");
  });
  it("parses events split across arbitrary chunk boundaries and ignores comments and unknown events", () => {
    const text = formatSse({ event: "status", data: { phase: "p", message: "m" } }) + ": keepalive\n\nevent: weird\ndata: {}\n\n" + formatSse({ event: "done", data: { status: "ok", result: 1, model: "m", usage: { inputTokens: 0, outputTokens: 0 }, repaired: false } });
    const p = new SseParser();
    const out = [];
    for (let i = 0; i < text.length; i += 7) out.push(...p.push(text.slice(i, i + 7)));
    expect(out.map((e) => e.event)).toEqual(["status", "done"]);
  });
  it("always ends with done, even if the run throws or forgets to", async () => {
    const thrown = await readSse(sseResponse(async () => { throw new Error("internal detail"); }));
    expect(thrown.map((e) => e.event)).toEqual(["error", "done"]);
    expect(JSON.stringify(thrown)).not.toContain("internal detail");
    expect((await readSse(sseResponse(async () => {}))).at(-1)!.event).toBe("done");
  });
  it("the fetch client turns a dropped stream or a network error into a structured fallback", async () => {
    const truncated = createFetchAgentApi({ fetchImpl: (async () => new Response("event: status\ndata: {}\n\n", { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch });
    const o = await truncated.plan({} as never);
    expect(o).toMatchObject({ status: "fallback", reason: "upstream_error" });
    const down = createFetchAgentApi({ fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    expect(await down.parse({} as never)).toMatchObject({ status: "fallback" });
  });
  it("the fetch client passes through a JSON 429 outcome", async () => {
    const body = { status: "fallback", reason: "rate_limited", message: "slow", next: "recorded_tour", retryAfterS: 30 };
    const api = createFetchAgentApi({ fetchImpl: (async () => new Response(JSON.stringify(body), { status: 429, headers: { "content-type": "application/json" } })) as unknown as typeof fetch });
    expect(await api.plan({} as never)).toEqual(body);
  });
});

describe("slot filling", () => {
  const ctx = { baseline: BASELINE, rows: [row("B2", ["SP-EASTERN"], { p90S: 1260, pGoal: 0.72, isolatedCount: 2 })] };
  const f = (t: string, focus?: string) => fillSlots(t, makeSlotResolver({ ...ctx, focusBundleId: focus }));
  it("fills from simulator results with sign and units", () => {
    expect(f("{{finalist.B2.p90.delta}}")).toBe("-4.0 min");
    expect(f("{{finalist.B2.p90.baseline}}")).toBe("25.0 min");
    expect(f("{{finalist.B2.pGoal}}")).toBe("72%");
    expect(f("{{finalist.B2.isolated.delta}}")).toBe("-4");
    expect(f("{{p90.current}}", "B2")).toBe("21.0 min");
    expect(f("{{finalist.B2.cost}}")).toBe("$");
  });
  it("never leaves a raw placeholder or a made-up number for unresolved slots", () => {
    expect(f("{{finalist.B9.p90.delta}}")).toBe("n/a");
    expect(f("{{7}}")).toBe("n/a");
    expect(f("{{p90.delta}}")).toBe("n/a");
    expect(fillSlots("{{p90.delta}}", makeSlotResolver({ rows: ctx.rows, focusBundleId: "B2" }))).toBe("n/a");
  });
});

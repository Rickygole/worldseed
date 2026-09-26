import { beforeEach, describe, expect, it } from "vitest";
import { SseParser, createFetchAgentApi } from "../../lib/agent/api";
import { formatSse, sseResponse } from "../../lib/server/sse";
import { fillSlots, makeSlotResolver } from "../../lib/agent/slots";
import { BASELINE, blockNetwork, readSse, row } from "./fixtures";

beforeEach(blockNetwork);

describe("SSE", () => {
  it("round-trips the event types through the server helper and the client parser", async () => {
    const res = sseResponse(async (emit) => {
      emit({ event: "status", data: { phase: "x", message: "hi" } });
      emit({ event: "log", data: { kind: "info", sentence: "line one\nline two" } });
      emit({ event: "tool_call", data: { name: "propose", args: { a: 1 }, model: "m", repaired: false } });
      emit({ event: "usage", data: { role: "planner", model: "m", inputTokens: 1, outputTokens: 2, latencyMs: 5, mission: { inputTokens: 1, outputTokens: 2, limitIn: 3, limitOut: 4 } } });
      emit({ event: "reasoning", data: { role: "critic", model: "m", inputTokens: 1, outputTokens: 2, latencyMs: 5, text: "Plain words." } });
      emit({ event: "error", data: { code: "c", message: "m" } });
      emit({ event: "done", data: { status: "fallback", reason: "upstream_error", message: "m", next: "retry_later" } });
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect((await readSse(res.clone())).map((e) => e.event)).toEqual(["status", "log", "tool_call", "usage", "reasoning", "error", "done"]);
    const parsed = new SseParser().push(await res.text());
    expect(parsed).toHaveLength(7);
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
  it("fills from simulator results; the direction word comes from the real sign", () => {
    expect(f("{{finalist.B2.p90.delta}}")).toBe("4.0 min better");
    expect(f("{{finalist.B2.p90.baseline}}")).toBe("25.0 min");
    expect(f("{{finalist.B2.pGoal}}")).toBe("72%");
    expect(f("{{finalist.B2.isolated.delta}}")).toBe("4 groups better");
    expect(f("{{p90.current}}", "B2")).toBe("21.0 min");
    expect(f("{{finalist.B2.cost}}")).toBe("$");
  });
  it("finding P1.2: a worsening is printed as worse, whatever verb the prose used", () => {
    const worse = { baseline: BASELINE, rows: [row("B2", ["SP-EASTERN"], { p90S: 1600, pctWithin: 35, isolatedCount: 9, equityGapS: 240 })] };
    const g = (t: string) => fillSlots(t, makeSlotResolver({ ...worse, focusBundleId: "B2" }));
    expect(g("Reduces the worst case by {{p90.delta}}.")).toBe("Reduces the worst case by 1.7 min worse.");
    expect(g("{{isolated.delta}}")).toBe("3 groups worse");
    expect(g("{{pctWithin.delta}}")).toBe("5.0 points worse"); // higher is better for this metric
    expect(g("{{equityGap.delta}}")).toBe("no change");
    expect(fillSlots("{{pctWithin.delta}}", makeSlotResolver({ baseline: BASELINE, rows: [row("B2", ["SP-EASTERN"], { pctWithin: 60 })], focusBundleId: "B2" }))).toBe("20.0 points better");
  });
  it("finding P1.2: a card cannot quote another bundle or resolve a baseline through a missing row", () => {
    const two = { baseline: BASELINE, rows: [row("B1", ["SP-BROENING"], { p90S: 900 }), row("B2", ["SP-EASTERN"], { p90S: 1600 })] };
    const g = (t: string, focus?: string) => fillSlots(t, makeSlotResolver({ ...two, focusBundleId: focus }));
    expect(g("{{bundle.B2.p90.delta}}", "B1")).toBe("n/a"); // B1's card naming B2
    expect(g("{{bundle.B1.p90.delta}}", "B1")).toBe("10.0 min better");
    expect(g("{{bundle.GHOST.p90.baseline}}", "B1")).toBe("n/a");
    expect(g("{{bundle.B9.p90.baseline}}", "B1")).toBe("n/a");
    expect(g("{{bundle.B9.p90.baseline}}")).toBe("n/a"); // named bundle without a scored row
    expect(g("{{p90.baseline}}", "B1")).toBe("25.0 min"); // the baseline itself needs no row
  });
  it("guard: the resolver refuses slots the prose screen would refuse", () => {
    expect(f("{{p90.delta.extra}}", "B2")).toBe("n/a");
    expect(f("{{finalist.B99.p90}}", "B2")).toBe("n/a");
    expect(f("{{p90; drop}}", "B2")).toBe("n/a");
  });
  it("never leaves a raw placeholder or a made-up number for unresolved slots", () => {
    expect(f("{{finalist.B9.p90.delta}}")).toBe("n/a");
    expect(f("{{7}}")).toBe("n/a");
    expect(f("{{p90.delta}}")).toBe("n/a");
    expect(fillSlots("{{p90.delta}}", makeSlotResolver({ rows: ctx.rows, focusBundleId: "B2" }))).toBe("n/a");
  });
});

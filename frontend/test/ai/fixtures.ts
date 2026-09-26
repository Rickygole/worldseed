/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Test fixtures. Everything here is hand-written and FAKE: a small stand-in catalog and gazetteer
 * (the real ones are built by the pipeline), a scripted fake provider, and a fake evaluator.
 */
import { vi } from "vitest";
import { buildCatalog, type Catalog } from "../../lib/agent/catalog";
import type { EvaluateFn } from "../../lib/agent/evaluate";
import { createFetchAgentApi } from "../../lib/agent/api";
import type { BaselineRow, ConfirmedMission, EvaluationRow } from "../../lib/agent/tools";
import { bundleCostTier } from "../../lib/agent/catalog";
import { handleCritique, handleNarrate, handleParse, handlePlan, type AgentDeps } from "../../lib/server/agentService";
import { readConfig, type ServerConfig } from "../../lib/server/config";
import { ModelResolver, buildRoleChains } from "../../lib/server/models";
import { MissionLedger } from "../../lib/server/missions";
import { DailyBudget, FrontDoor, StoreRateLimiter } from "../../lib/server/ratelimit";
import type { Runtime } from "../../lib/server/runtime";
import { MemoryStore, StoreError, type SharedStore } from "../../lib/server/store";
import type { SearchClient } from "../../lib/server/tavily";
import type { CompletionRequest, CompletionResult, LlmProvider } from "../../lib/server/tokenfactory";
import { ProviderBackoff, ProviderError } from "../../lib/server/tokenfactory";

/** Any accidental real network call fails the test. */
export function blockNetwork(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("network is blocked in tests");
    }),
  );
}

const eff = { op: "corridor_speed", corridor: "C-FAKE", factor: 1.1 };
const cand = (id: string, type: string, lens: string[], costTier: string, title: string) => ({
  id, type, title, lens, costTier, costSource: null, leadTime: "weeks", hypothetical: true, effect: eff,
  assumptions: [], sources: [], notes: "internal note with 999 numbers",
});

export const FAKE_CANDIDATES = [
  cand("SP-BROENING", "signal_priority", ["access", "ems"], "$", "Signal retiming, fake corridor A"),
  cand("SP-EASTERN", "signal_priority", ["access"], "$", "Signal retiming, fake corridor B"),
  cand("SP-HARBOR", "signal_priority", ["access"], "$$", "Signal retiming, fake corridor C"),
  cand("TL-FERRY", "temp_link", ["access"], "$$$", "Temporary ferry link, fake"),
  cand("TL-DUNDALK", "temp_link", ["access"], "$$", "Temporary connector, fake"),
  cand("PP-EAST", "prepos_site", ["ems"], "$", "Pre-positioned unit, fake east site"),
  cand("PP-WEST", "prepos_site", ["ems"], "$$", "Pre-positioned unit, fake west site"),
  cand("HZ-ESCORT", "hazmat_window", ["access"], "$", "Escorted hazmat window, fake"),
  cand("IM-I895", "incident_mgmt", ["access", "ems"], "$", "Incident management, fake tunnel corridor"),
  cand("TL-LONG", "temp_link", ["access"], "$$$", "Long temporary link, fake"),
];

export const FAKE_GAZETTEER = [
  { id: "G-DUNDALK", name: "Dundalk", aliases: ["dundalk md"], kind: "neighborhood", ref: { hexes: [1, 2] }, lat: 39.25, lng: -76.52 },
  { id: "G-KEYBRIDGE", name: "Francis Scott Key Bridge", aliases: ["key bridge", "I-695 Key Bridge"], kind: "link", ref: { link: "L-KEYBRIDGE" }, lat: 39.217, lng: -76.528 },
  { id: "G-BROENING", name: "Broening Highway", aliases: ["broening hwy"], kind: "road", ref: { edges: [1, 2, 3] }, lat: 39.26, lng: -76.55 },
  { id: "G-EASTERN", name: "Eastern Avenue", aliases: ["eastern ave"], kind: "road", ref: { edges: [10, 11] }, lat: 39.28, lng: -76.55 },
  { id: "G-I895", name: "Harbor Tunnel Thruway (I-895)", aliases: ["I-895", "harbor tunnel"], kind: "corridor", ref: { corridor: "C-I895" }, lat: 39.25, lng: -76.6 },
  { id: "G-HAWKINS", name: "Hawkins Point", aliases: [], kind: "neighborhood", ref: { hexes: [5] }, lat: 39.21, lng: -76.57 },
];

export function fakeCatalog(): Catalog {
  return buildCatalog(FAKE_CANDIDATES, FAKE_GAZETTEER);
}

export const MISSION: ConfirmedMission = {
  lens: "access",
  goal: { metric: "p90", op: "<=", targetDelta: 300 },
  constraints: { maxCostTier: "$$$", types: [], areas: [] },
};

export const BASELINE: BaselineRow = { p50S: 600, p90S: 1500, pctWithin: 40, isolatedCount: 6, equityGapS: 240 };

export function row(bundleId: string, candidateIds: string[], over: Partial<EvaluationRow> = {}): EvaluationRow {
  return {
    bundleId, candidateIds, p50S: 500, p90S: 1200, pctWithin: 55, isolatedCount: 3, equityGapS: 120, pGoal: 0.5,
    costTier: bundleCostTier(fakeCatalog(), candidateIds), ...over,
  };
}

/* ------------------------------ fake provider ------------------------------ */

export interface ScriptedReply {
  text: string;
  finishReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  delayMs?: number;
}
export type Scripted = string | ScriptedReply | ProviderError | Error | ((req: CompletionRequest) => string | Promise<string>);

export class FakeProvider implements LlmProvider {
  calls: CompletionRequest[] = [];
  listCalls = 0;
  models: string[] | Error;
  usage: { inputTokens: number; outputTokens: number };
  constructor(public script: Scripted[] = [], models?: string[] | Error, usage = { inputTokens: 1200, outputTokens: 300 }) {
    this.models = models ?? [
      "nvidia/Nemotron-3-Ultra-550b-a55b",
      "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
      "nvidia/nemotron-3-super-120b-a12b",
    ];
    this.usage = usage;
  }
  async listModels(): Promise<string[]> {
    this.listCalls++;
    if (this.models instanceof Error) throw this.models;
    return this.models;
  }
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(req);
    const next = this.script.shift();
    if (next === undefined) throw new Error("FakeProvider: script exhausted");
    if (next instanceof Error) throw next;
    if (typeof next === "object" && "text" in next) {
      if (next.delayMs) await new Promise((r) => setTimeout(r, next.delayMs));
      return { text: next.text, model: req.model, mode: req.mode, usage: next.usage ?? this.usage, finishReason: next.finishReason ?? "stop" };
    }
    const text = typeof next === "function" ? await next(req) : next;
    return { text, model: req.model, mode: req.mode, usage: this.usage, finishReason: "stop" };
  }
}

/* --------------------------------- deps ------------------------------------ */

export interface TestServer {
  deps: AgentDeps;
  provider: FakeProvider;
  clock: { t: number };
  config: ServerConfig;
  store: MemoryStore;
  fetchImpl: typeof fetch;
}

const JSON_HEADERS = { "content-type": "application/json" };

export function makeServer(script: Scripted[] = [], cfg: Partial<ServerConfig> = {}, provider?: FakeProvider): TestServer {
  const clock = { t: Date.UTC(2026, 8, 26, 12, 0, 0) };
  const now = () => clock.t;
  // Tests behave like a deployment behind a trusted proxy: the x-forwarded-for header identifies the client.
  const config = { ...readConfig({ NEBIUS_API_KEY: "test-key-not-real" }), trustForwarded: true, ...cfg };
  const p = provider ?? new FakeProvider(script);
  const store = new MemoryStore(now);
  const deps: AgentDeps = {
    config,
    provider: p,
    resolver: new ModelResolver({ provider: p, chains: buildRoleChains({}), cacheMs: config.modelsCacheMs, now }),
    limiter: new StoreRateLimiter(store),
    budget: new DailyBudget(store, config.dailyBudgetUsd, now, config.budgetResetHourUtc),
    missions: new MissionLedger(store, undefined, now),
    backoff: new ProviderBackoff(now),
    // The front door is generous here so tests exercise the store-backed limits; front-door tests set their own.
    frontDoor: new FrontDoor({ perIpPerMin: 100_000, globalPerMin: 1_000_000, closuresPerIpPerHour: 100_000, missionsPerIpPerDay: 100_000, now }),
    signals: { storeDownAt: 0 },
    loadCatalog: async () => fakeCatalog(),
    now,
  };
  const handlers: Record<string, (r: Request, d: AgentDeps) => Promise<Response>> = {
    "/api/agent/parse": handleParse,
    "/api/agent/plan": handlePlan,
    "/api/agent/critique": handleCritique,
    "/api/agent/narrate": handleNarrate,
  };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const h = handlers[url];
    if (!h) throw new Error(`unrouted ${url}`);
    return h(new Request(`http://localhost${url}`, { method: "POST", body: init?.body as string, headers: { ...JSON_HEADERS, "x-forwarded-for": "203.0.113.7" } }), deps);
  }) as unknown as typeof fetch;
  return { deps, provider: p, clock, config, store, fetchImpl };
}

/** A store whose every operation fails, for fail-closed tests. */
export function brokenStore(): SharedStore {
  const fail = async () => {
    throw new StoreError("store is down (test)");
  };
  return { kind: "memory", incr: fail, incrLite: fail, peek: fail, get: fail, set: fail, setIfAbsent: fail, take: fail, del: fail, delIfEquals: fail };
}

/** A Runtime around a test server: the same store, limiter and budget the agent routes use. */
export function makeRuntime(server: TestServer, search: SearchClient | null = null): Runtime {
  return { agent: server.deps, store: server.store, search, closures: { inflight: null, cache: null }, confirmSecret: "test-confirm-secret-not-real" };
}

export function post(path: string, body: unknown, ip = "203.0.113.7", headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { ...JSON_HEADERS, "x-forwarded-for": ip, ...headers },
  });
}

export function apiFor(server: TestServer) {
  return createFetchAgentApi({ fetchImpl: server.fetchImpl });
}

/** Reads an SSE Response into its events. */
export async function readSse(res: Response): Promise<{ event: string; data: any }[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((b) => {
      const ev = /^event: (.*)$/m.exec(b)?.[1] ?? "";
      const data = /^data: (.*)$/m.exec(b)?.[1] ?? "null";
      return { event: ev, data: JSON.parse(data) };
    });
}

export const doneOf = (events: { event: string; data: any }[]) => events.find((e) => e.event === "done")!.data;

/* ------------------------------ scripted replies ---------------------------- */

/** Model-form replies: bundles carry candidate IDs only (a stray `id` in the input is dropped). */
const noIds = (bundles: { id?: string; candidateIds: string[] }[]) => bundles.map((b) => ({ candidateIds: b.candidateIds }));
export const proposeReply = (bundles: { id?: string; candidateIds: string[] }[], over: Record<string, unknown> = {}) =>
  JSON.stringify({ action: "propose", commentary: "Starting with a broad mix of signal and link mechanisms across types.", bundles: noIds(bundles), mechanism_note: "Retiming and a connector act on the detour.", ...over });
export const refineReply = (add: { id?: string; candidateIds: string[] }[], keep: string[] = [], drop: string[] = [], over: Record<string, unknown> = {}) =>
  JSON.stringify({ action: "refine", commentary: "Extending a promising mechanism with another candidate.", keep, drop, add: noIds(add), ...over });
export const finalizeReply = (ids: string[], over: Record<string, unknown> = {}) =>
  JSON.stringify({
    action: "finalize", commentary: "These finalists differ in mechanism and cost tier.",
    finalists: ids.map((bundleId) => ({ bundleId, mechanism_note: "Relies on a hypothetical connector." })), ...over,
  });
export const critiqueReply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ action: "critique", concerns: [{ bundleId: "B1", kind: "worst_case" }], veto: [], ...over });
export const narrateReply = (ids: string[]) =>
  JSON.stringify({
    action: "narrate",
    items: ids.map((bundleId) => ({ bundleId, commentary: "Retimes signals on the corridor and depends on a hypothetical link." })),
  });
export const parseReply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    lens: "access", goal: { metric: "p90", op: "<=", targetRef: "baseline+X" },
    constraints: { maxCostTier: "$$", types: [], areas: ["G-DUNDALK"] }, ...over,
  });

/* -------------------------------- evaluator -------------------------------- */

/** Deterministic fake simulator: more/cheaper candidates score better. Every row carries its own futures count. */
export function fakeEvaluator(opts: { futures?: number; dropIds?: string[]; calls?: string[][] } = {}): EvaluateFn {
  const futures = opts.futures ?? 100;
  return async (bundles, ctx) => {
    opts.calls?.push(bundles.map((b) => b.id));
    const scored = bundles.filter((b) => !(opts.dropIds ?? []).includes(b.id));
    const rows = scored.map((b) => {
      const w = b.candidateIds.reduce((n, id) => n + (id.length % 5), 0);
      return { ...row(b.id, b.candidateIds, { p90S: 1500 - 40 * w - 10 * b.candidateIds.length, pGoal: Math.min(0.95, 0.1 * w) }), futures };
    });
    ctx.onProgress?.(scored.length * futures, scored.length * futures);
    return { rows, baseline: BASELINE };
  };
}

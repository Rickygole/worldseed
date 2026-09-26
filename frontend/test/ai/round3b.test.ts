/**
 * Round-3 integrity tests: no model text on cards, rationale as a selection, displayed-value
 * direction, evaluated-row bounds, closure confirmation for the biggest roads, session binding,
 * the production secret, the runtime receipt, and the guards that earlier reviews found untested.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentApi } from "../../lib/agent/api";
import { buildCatalog } from "../../lib/agent/catalog";
import type { EvaluateFn } from "../../lib/agent/evaluate";
import { assertConfirmedClosure, assertMutationRecordAllowed, confirmClosureProposal, ConfirmationError, recordUserConfirmation, toMutationRecord } from "../../lib/agent/closures";
import { AgentMachine, CARD_TEXT_LABEL } from "../../lib/agent/machine";
import { proseIssues } from "../../lib/agent/prose";
import { RATIONALE_KINDS, RATIONALE_LABEL, RATIONALE_TEXT, renderRationale, type RationaleKind } from "../../lib/agent/rationale";
import { ConfirmClosureRequestSchema, type ClosureProposal } from "../../lib/agent/protocol";
import { cardLines, makeSlotResolver } from "../../lib/agent/slots";
import { EvaluatedRowSchema, type BaselineRow, type EvaluationRow } from "../../lib/agent/tools";
import { handleClosureConfirm, handleClosures, handleHealth } from "../../lib/server/handlers";
import { setLogSink } from "../../lib/server/log";
import { setIpSalt } from "../../lib/server/ratelimit";
import { createRuntime, type Runtime } from "../../lib/server/runtime";
import { MemoryStore } from "../../lib/server/store";
import { matchClosures, type SearchClient, type TavilyResult } from "../../lib/server/tavily";
import { resetDowngrades } from "../../lib/server/tokenfactory";
import { BASELINE, BASELINE as BASE, FAKE_CANDIDATES, MISSION, apiFor, blockNetwork, critiqueReply, fakeCatalog, fakeEvaluator, finalizeReply, makeRuntime, makeServer, parseReply, post, proposeReply, refineReply, row } from "./fixtures";

beforeEach(() => {
  blockNetwork();
  resetDowngrades();
  setLogSink(() => undefined);
  setIpSalt("");
});

const root = path.resolve(__dirname, "../..");
const realGazetteer = JSON.parse(readFileSync(path.resolve(root, "../data/snapshot/gazetteer.json"), "utf8"));
const realCatalog = buildCatalog(FAKE_CANDIDATES, realGazetteer);

/* ------------------------------------------------------------------------------------------ */
describe("R2-1 (integrity): finalist cards carry application and catalog text only", () => {
  const b = (id: string, ...candidateIds: string[]) => ({ id, candidateIds });
  const script = () => [
    parseReply(),
    proposeReply([b("B1", "SP-BROENING"), b("B2", "SP-EASTERN"), b("B3", "SP-HARBOR"), b("B4", "TL-DUNDALK")], { rationale: { kind: "worst_case", focus: "SP-HARBOR" } }),
    critiqueReply({ concerns: [{ bundleId: "B1", kind: "worst_case" }], stress: { kind: "close_link", linkId: "L-HARBORTUNNEL" } }),
    refineReply([b("B5", "SP-BROENING", "SP-EASTERN")], ["B1", "B2"], ["B4"]),
    critiqueReply({ concerns: [{ bundleId: "B5", kind: "equity" }], veto: [], stress: { kind: "close_link", linkId: "L-FORTMCHENRY" } }),
    refineReply([b("B6", "HZ-ESCORT", "IM-I895")], ["B5"], []),
    finalizeReply(["B5", "B6", "B3"]),
  ];
  async function run() {
    const server = makeServer(script());
    const m = new AgentMachine({ api: apiFor(server), evaluate: fakeEvaluator(), catalog: fakeCatalog(), newMissionId: () => "mission-r3-1" });
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    return { m, server };
  }

  it("every string on every card is a template, a catalog title, or the catalog's own description: nothing a model wrote", async () => {
    for (const _round of [1]) {
      void _round;
      const { m, server } = await run();
      const cat = fakeCatalog();
      const ids = m.getState().finalists.map((f) => f.bundleId);
      expect(ids).toEqual(["B5", "B6", "B3"]);
      const replies = server.provider.calls.length;
      expect(replies).toBe(7);
      for (const id of ids) {
        const card = m.card(id)!;
        const f = m.getState().finalists.find((x) => x.bundleId === id)!;
        expect(card.headline).toBe(`${id}: ${f.candidateIds.map((c) => cat.byId.get(c)!.title).join(" + ")}`);
        expect(card.commentary).toBe(f.candidateIds.map((c) => cat.byId.get(c)!.mechanism ?? "").filter(Boolean).join(" "));
        expect(card.commentaryLabel).toBe(CARD_TEXT_LABEL);
        expect(card.mechanismNote).toBe("");
        for (const line of card.lines) expect(line).toMatch(/^(?:Cross-harbor travel time|Station-to-neighborhood travel time|Reached within the goal|Isolated groups|Equity gap|Chance of meeting the goal|Cost tier)/);
        const whole = JSON.stringify(card);
        for (const t of Object.values(RATIONALE_TEXT)) expect(whole).not.toContain(t);
        expect(whole).not.toContain("planner");
        expect(whole).not.toContain(RATIONALE_LABEL);
      }
      // the rationale exists only as labeled log lines
      const lines = m.getState().log.filter((l) => l.kind === "commentary").map((l) => l.sentence);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((l) => l.startsWith(RATIONALE_LABEL))).toBe(true);
      expect(lines.some((l) => l.includes("Focus: SP-HARBOR (cost tier $$)"))).toBe(true); // the focus is rendered from the catalog, not from model text
    }
  });

  it("every rationale sentence passes the prose screen, states no result, and every kind is a defined sentence (shown/blanked rate)", () => {
    let shown = 0;
    let total = 0;
    for (const kind of RATIONALE_KINDS) {
      for (const focus of [undefined, "SP-BROENING"]) {
        total++;
        const text = renderRationale({ kind, focus }, fakeCatalog());
        if (text !== "") shown++;
        expect(text, `${kind} ${focus ?? ""}`).not.toBe("");
      }
      expect(proseIssues(RATIONALE_TEXT[kind], { allowedTokens: [], profile: "rationale" }), kind).toEqual([]);
      expect(RATIONALE_TEXT[kind]).not.toMatch(/\d/);
    }
    process.stdout.write(`rationale: ${shown}/${total} selections rendered (blanked ${total - shown}); model free text reaching the UI: 0 by construction\n`);
    expect(shown).toBe(total);
  });

  it("guard: a sentence that fails the screen is never rendered, and the machine then skips the log entry", async () => {
    const original = RATIONALE_TEXT.worst_case;
    try {
      (RATIONALE_TEXT as Record<RationaleKind, string>).worst_case = "It cuts the worst case by 12 minutes.";
      expect(renderRationale({ kind: "worst_case" }, fakeCatalog())).toBe("");
      const { m } = await run();
      const lines = m.getState().log.filter((l) => l.kind === "commentary").map((l) => l.sentence);
      expect(lines.some((l) => l.includes("12 minutes"))).toBe(false); // skipped, not shown
      expect(m.getState().log.some((l) => l.kind === "commentary" && l.sentence.endsWith(": "))).toBe(false); // and no empty label either
      expect(lines.length).toBeGreaterThan(0); // the other selections still show
    } finally {
      (RATIONALE_TEXT as Record<RationaleKind, string>).worst_case = original;
    }
  });

  it("a catalog description with digits or markup is dropped, never shown on a card", () => {
    const cat = buildCatalog(
      [
        { ...FAKE_CANDIDATES[0], id: "OK-1", mechanism: "Retimes signals along a corridor." },
        { ...FAKE_CANDIDATES[1], id: "BAD-1", mechanism: "Cuts travel time by 12 percent." },
        { ...FAKE_CANDIDATES[2], id: "BAD-2", mechanism: "See <a href=x>this</a>." },
        { ...FAKE_CANDIDATES[3], id: "BAD-3", mechanism: "x".repeat(700) },
      ],
      [],
    );
    expect(cat.byId.get("OK-1")!.mechanism).toBe("Retimes signals along a corridor.");
    for (const id of ["BAD-1", "BAD-2", "BAD-3"]) expect(cat.byId.get(id)!.mechanism).toBeUndefined();
    const real = readFileSync(path.resolve(root, "../data/snapshot/candidates.json"), "utf8");
    const all = buildCatalog(JSON.parse(real), []);
    expect(all.candidates.filter((c) => c.mechanism === undefined)).toEqual([]); // every real description passes the guard
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R2-5 (integrity): direction and size come from the DISPLAYED values", () => {
  const base: BaselineRow = { p50S: 1500, p90S: 1500, pctWithin: 40, isolatedCount: 6, equityGapS: 1500 };
  const mk = (over: Partial<EvaluationRow>): EvaluationRow => row("B1", ["SP-BROENING"], { p50S: 1500, p90S: 1500, pctWithin: 40, isolatedCount: 6, equityGapS: 1500, pGoal: 0.5, ...over });

  it("figures that display as equal say 'no change', never '0.1 min better'", () => {
    const line = cardLines(mk({ p90S: 1500.04 * 1 - 0.05 }), base, "access")[1]; // 24.99917 min displays as 25.0
    expect(line).toBe("Cross-harbor travel time, worst case (90th percentile): 25.0 min (baseline 25.0 min; no change)");
    expect(cardLines(mk({ p90S: 1499 }), base, "access")[1]).toContain("no change"); // 24.98 displays as 25.0
    expect(cardLines(mk({ p90S: 1494 }), base, "access")[1]).toBe("Cross-harbor travel time, worst case (90th percentile): 24.9 min (baseline 25.0 min; 0.1 min better)");
    expect(cardLines(mk({ p90S: 1506 }), base, "access")[1]).toContain("0.1 min worse");
  });

  it("property: for 5,000 random rows the words always agree with the displayed numbers", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 5_000; i++) {
      const cur = Math.round(rnd() * 3000 * 10) / 10;
      const b = Math.round(rnd() * 3000 * 10) / 10;
      const bl = { ...base, p90S: b, p50S: b, equityGapS: b, pctWithin: rnd() * 100, isolatedCount: Math.floor(rnd() * 20) };
      const r = mk({ p90S: cur, p50S: cur, equityGapS: cur, pctWithin: rnd() * 100, isolatedCount: Math.floor(rnd() * 20) });
      for (const line of cardLines(r, bl, "access").slice(0, 5)) {
        const m = /: ([\d.]+)(?: min|%)? \(baseline ([\d.]+)(?: min|%)?; (.+)\)$/.exec(line);
        expect(m, line).not.toBeNull();
        const shownCur = Number(m![1]);
        const shownBase = Number(m![2]);
        const what = m![3];
        if (shownCur === shownBase) expect(what, line).toBe("no change");
        else expect(what, line).toMatch(/better|worse/);
        if (what !== "no change") {
          const size = Number(/^([\d.]+)/.exec(what)![1]);
          expect(Math.abs(size - Math.abs(shownCur - shownBase)), line).toBeLessThan(0.051);
        }
      }
    }
  });

  it("guard: with no baseline the lines show the value alone (no baseline clause, no delta)", () => {
    const lines = cardLines(mk({}), undefined, "access");
    expect(lines[0]).toBe("Cross-harbor travel time, median: 25.0 min");
    expect(lines.slice(0, 5).some((l) => l.includes("baseline"))).toBe(false);
    const resolve = makeSlotResolver({ rows: [mk({})], focusBundleId: "B1" });
    expect(resolve("p90.baseline")).toBeUndefined();
    expect(resolve("p90.delta")).toBeUndefined();
    expect(resolve("p90.current")).toBe("25.0 min");
  });

  it("guard: a null pGoal shows the fixed 'not computed' line", () => {
    const lines = cardLines(mk({ pGoal: null }), base, "access");
    expect(lines.at(-2)).toBe("Chance of meeting the goal: not computed");
    expect(cardLines(mk({ pGoal: 0.5 }), base, "access").at(-2)).toBe("Chance of meeting the goal: 50% of sampled futures");
  });

  it("the EMS lens names its own travel time", () => {
    expect(cardLines(mk({}), base, "ems")[0]).toContain("Station-to-neighborhood");
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R2-6 (integrity): evaluated rows are bounded", () => {
  const goodRow = (id: string, c: string[], over: Record<string, unknown> = {}) => ({ ...row(id, c), futures: 100, ...over });

  it("futures must be an integer from 1 to the bound; times must be finite and not negative (schema)", () => {
    const ok = (o: Record<string, unknown>) => EvaluatedRowSchema.safeParse(goodRow("B1", ["SP-BROENING"], o)).success;
    expect(ok({})).toBe(true);
    expect(ok({ futures: 1 })).toBe(true);
    expect(ok({ futures: 100_000 })).toBe(true);
    for (const f of [0, -1, 1.5, 100_001, 10_000_000, Number.NaN, Number.POSITIVE_INFINITY]) expect(ok({ futures: f }), String(f)).toBe(false);
    for (const k of ["p50S", "p90S"]) for (const v of [-1, -1e-9, Number.NaN, Number.POSITIVE_INFINITY, 1e8]) expect(ok({ [k]: v }), `${k}=${v}`).toBe(false);
    // the equity gap is signed: a negative finite value is fine, non-finite and absurd values are not
    for (const v of [-1, -300.5, 0, 240]) expect(ok({ equityGapS: v }), `equityGapS=${v}`).toBe(true);
    for (const v of [Number.NaN, Number.NEGATIVE_INFINITY, 1e8, -1e8]) expect(ok({ equityGapS: v }), `equityGapS=${v}`).toBe(false);
    expect(ok({ p50S: 0, p90S: 0, equityGapS: 0 })).toBe(true);
  });

  const machineWith = (evaluate: EvaluateFn, extra: { maxFutures?: number } = {}) => {
    const server = makeServer([parseReply(), proposeReply([{ candidateIds: ["SP-BROENING"] }, { candidateIds: ["SP-EASTERN"] }, { candidateIds: ["SP-HARBOR"] }]), refineReply([]), finalizeReply(["B1", "B2", "B3"])]);
    return new AgentMachine({ api: apiFor(server), evaluate, catalog: fakeCatalog(), newMissionId: () => "mission-bounds-1", ...extra });
  };
  const evaluatorWith = (mut: (i: number) => Record<string, unknown>): EvaluateFn => async (bundles) => ({ baseline: BASE, rows: bundles.map((x, i) => ({ ...row(x.id, x.candidateIds), futures: 100, ...mut(i) })) });

  it("the machine refuses rows with futures 0 or 10,000,000, or negative times, and counts only the rows it accepted", async () => {
    const m = machineWith(evaluatorWith((i) => (i === 0 ? { futures: 0 } : i === 1 ? { futures: 10_000_000 } : {})));
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(s.rows.map((r) => r.bundleId)).toEqual(["B3", ...s.rows.map((r) => r.bundleId).slice(1)].slice(0, s.rows.length));
    expect(s.rows.some((r) => r.bundleId === "B1" || r.bundleId === "B2")).toBe(false);
    expect(s.counts.futuresEvaluated).toBe((s.rows.length + s.counts.stressEvaluations) * 100); // never the refused rows' claims
    expect(s.log.some((l) => l.kind === "validator" && l.errors?.some((e) => e.includes("malformed_row")))).toBe(true);
    const neg = machineWith(evaluatorWith((i) => (i === 0 ? { p90S: -5 } : {})));
    await neg.start("cut access time");
    await neg.confirmGoal(MISSION);
    expect(neg.getState().rows.some((r) => r.bundleId === "B1")).toBe(false);
  });

  it("the configured futures per bundle is the ceiling: a row claiming more is refused, one at the ceiling is accepted", async () => {
    const m = machineWith(evaluatorWith((i) => ({ futures: i === 0 ? 501 : 500 })), { maxFutures: 500 });
    await m.start("cut access time");
    await m.confirmGoal(MISSION);
    const s = m.getState();
    expect(s.rows.some((r) => r.bundleId === "B1")).toBe(false);
    expect(s.rows.some((r) => r.bundleId === "B2")).toBe(true);
    expect(s.counts.futuresEvaluated).toBe((s.rows.length + s.counts.stressEvaluations) * 500);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R2-3 (security): confirmation tokens sign ids and provenance only, so the biggest roads confirm end to end", () => {
  const ROADS = ["Baltimore Beltway (I 695)", "Baltimore Annapolis Boulevard (MD 648)", "Edmondson Avenue (US 40)", "Ritchie Highway (MD 2)", "Washington Boulevard (US 1)"];
  const results: TavilyResult[] = ROADS.map((name, i) => ({
    title: "FAKE",
    url: `https://news.example.test/big${i}`,
    content: `FAKE. In Baltimore, the ${name} is closed through Friday due to a chemical spill, MDOT said.`,
  }));
  const search: SearchClient = { async search() { return results; } };
  const extraction = JSON.stringify({
    closures: ROADS.map((road, i) => ({ road, sourceUrl: results[i].url, quote: results[i].content.replace(/^FAKE\.\s*/, "") })),
  });
  const setup = (headers: Record<string, string> = {}) => {
    const server = makeServer([extraction]);
    server.deps.loadCatalog = async () => realCatalog;
    const runtime: Runtime = makeRuntime(server, search);
    return { server, runtime, headers };
  };
  const list = async (runtime: Runtime, ip = "203.0.113.7", headers: Record<string, string> = {}) => (await handleClosures(post("/api/closures", {}, ip, headers), runtime)).json();
  const confirm = (runtime: Runtime, token: string, ip = "203.0.113.7", headers: Record<string, string> = {}) => handleClosureConfirm(post("/api/closures/confirm", { token }, ip, headers), runtime);

  it("Beltway, Baltimore Annapolis Boulevard, Edmondson Avenue, Ritchie Highway and Washington Boulevard all confirm, with the full edge list from the server's gazetteer", async () => {
    const { runtime } = setup();
    const out = await list(runtime);
    expect(out.status).toBe("ok");
    const byId = new Map<string, ClosureProposal>((out.proposals as ClosureProposal[]).map((p) => [p.gazetteerId, p]));
    const want = ["G-RD-BALTIMORE-BELTWAY", "G-RD-BALTIMORE-ANNAPOLIS-BOULEVARD", "G-RD-EDMONDSON-AVENUE", "G-RD-RITCHIE-HIGHWAY", "G-RD-WASHINGTON-BOULEVARD"];
    expect([...byId.keys()].sort()).toEqual([...want].sort());
    const rows: string[] = [];
    for (const id of want) {
      const p = byId.get(id)!;
      expect(p.confirmToken!.length).toBeLessThan(1500); // was 3,297 characters for the Beltway
      expect(ConfirmClosureRequestSchema.safeParse({ token: p.confirmToken }).success, id).toBe(true);
      const res = await confirm(runtime, p.confirmToken!);
      expect(res.status, id).toBe(200);
      const body = await res.json();
      const entry = realCatalog.gazetteerById.get(id)!;
      expect(body.record.m).toEqual({ kind: "close_edges", edges: entry.ref.edges, label: entry.name });
      expect(body.record.m.edges.length).toBe(entry.ref.edges!.length);
      expect(body.record.provenance.url).toBe(p.provenance.url);
      rows.push(`${entry.name}: ${entry.ref.edges!.length} edges, token ${p.confirmToken!.length} chars`);
    }
    process.stdout.write(`big roads confirmed end to end: ${rows.join("; ")}\n`);
  });

  it("the token schema limit is sane: an oversized token is refused before any lookup", async () => {
    const { runtime } = setup();
    const huge = `v1.${"a".repeat(3100)}.${"b".repeat(43)}`;
    expect(ConfirmClosureRequestSchema.safeParse({ token: huge }).success).toBe(false);
    expect((await confirm(runtime, huge)).status).toBe(400);
  });

  it("the client cannot influence the mutation: a token whose gazetteer id was swapped fails its signature", async () => {
    const { runtime } = setup();
    const out = await list(runtime);
    const p = out.proposals[0] as ClosureProposal;
    const [v, body, sig] = p.confirmToken!.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    payload.p.gazetteerId = "G-RD-WASHINGTON-BOULEVARD";
    const forged = `${v}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    expect((await confirm(runtime, forged)).status).toBe(410);
  });

  it("a token for a gazetteer entry that is not in the server's catalog (or cannot be closed) is refused", async () => {
    const { runtime, server } = setup();
    const out = await list(runtime);
    const p = out.proposals[0] as ClosureProposal;
    server.deps.loadCatalog = async () => fakeCatalog(); // the entry no longer exists
    const res = await confirm(runtime, p.confirmToken!);
    expect(res.status).toBe(410);
    expect((await res.json()).reason).toBe("invalid_or_used");
  });

  it("proposals carry a confidence and a source-read hint when the wording is weak; the road field is always plain text", () => {
    const R = (content: string): TavilyResult => ({ title: "FAKE", url: "https://news.example.test/w", content: `FAKE. ${content}` });
    const res = [R("Baltimore update: Boston Street closed indefinitely, MDTA says.")];
    const g = [{ road: "Boston Street", sourceUrl: res[0].url, quote: "Baltimore update: Boston Street closed indefinitely, MDTA says." }];
    const m = matchClosures(g, realCatalog, "2026-09-26T12:00:00.000Z", res);
    expect(m.proposals[0]).toMatchObject({ confidence: "low", verification: "unverified" });
    expect(m.proposals[0].reviewHint).toMatch(/Read the source/);
  });

  it("guard: a road name with markup is shown as fixed text on a proposal and on an unmatched item, never as the extractor wrote it", () => {
    const content = "FAKE. Baltimore: Boston Street [1] is closed tonight due to a fire.";
    const res: TavilyResult[] = [{ title: "FAKE", url: "https://news.example.test/m", content }];
    const g = [{ road: "Boston Street [1]", sourceUrl: res[0].url, quote: "Baltimore: Boston Street [1] is closed tonight due to a fire." }];
    const m = matchClosures(g, realCatalog, "2026-09-26T12:00:00.000Z", res);
    const shown = [...m.proposals.map((p) => p.road), ...m.unmatched.map((u) => u.road)];
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((r) => r === "(unreadable road name)")).toBe(true);
    const link = matchClosures([{ road: "http://evil.example/x", sourceUrl: res[0].url, quote: "Baltimore: Boston Street [1] is closed tonight due to a fire. http://evil.example/x" }], realCatalog, "2026-09-26T12:00:00.000Z", res);
    expect([...link.proposals.map((p) => p.road), ...link.unmatched.map((u) => u.road)].every((r) => r === "(unreadable road name)")).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R2-6/R2-7 (integrity, security): tokens bind to an app-generated session, else the address; the secret is required in production", () => {
  const results: TavilyResult[] = [{ title: "FAKE", url: "https://news.example.test/s", content: "FAKE. In Baltimore, Boston Street is closed through Friday due to a water main break, MDOT said." }];
  const search: SearchClient = { async search() { return results; } };
  const extraction = JSON.stringify({ closures: [{ road: "Boston Street", sourceUrl: results[0].url, quote: "In Baltimore, Boston Street is closed through Friday due to a water main break, MDOT said." }] });
  const setup = () => {
    const server = makeServer([extraction]);
    server.deps.loadCatalog = async () => realCatalog;
    return makeRuntime(server, search);
  };
  const list = async (rt: Runtime, ip: string, headers: Record<string, string> = {}) => ((await (await handleClosures(post("/api/closures", {}, ip, headers), rt)).json()) as { proposals: ClosureProposal[] });
  const confirm = (rt: Runtime, token: string, ip: string, headers: Record<string, string> = {}) => handleClosureConfirm(post("/api/closures/confirm", { token }, ip, headers), rt);
  const SID = "sess-abcdefghijklmnop0123";

  it("a phone that changes network between search and confirm still redeems its own token (same session, new address)", async () => {
    const rt = setup();
    const { proposals } = await list(rt, "203.0.113.7", { "x-ws-session": SID });
    const res = await confirm(rt, proposals[0].confirmToken!, "198.51.100.44", { "x-ws-session": SID }); // mobile network handover
    expect(res.status).toBe(200);
  });

  it("a different session on the SAME address cannot redeem it, and neither can the same address without the session", async () => {
    const rt = setup();
    const { proposals } = await list(rt, "203.0.113.7", { "x-ws-session": SID });
    expect((await confirm(rt, proposals[0].confirmToken!, "203.0.113.7", { "x-ws-session": "other-session-abcdefghij123" })).status).toBe(403);
    expect((await confirm(rt, proposals[0].confirmToken!, "203.0.113.7")).status).toBe(403);
    expect((await confirm(rt, proposals[0].confirmToken!, "203.0.113.7", { "x-ws-session": SID })).status).toBe(200); // the owner still can
  });

  it("without a session header the binding is the address bucket; a malformed session id falls back to it (never trusted as an id)", async () => {
    const rt = setup();
    const a = await list(rt, "203.0.113.7");
    expect((await confirm(rt, a.proposals[0].confirmToken!, "198.51.100.9")).status).toBe(403); // other address
    const b = await list(rt, "203.0.113.7", { "x-ws-session": "short" });
    expect((await confirm(rt, b.proposals[0].confirmToken!, "203.0.113.7", { "x-ws-session": "another" })).status).toBe(200); // both fall back to the address
  });

  it("production requires WS_CONFIRM_SECRET: without it closures answer 'disabled' and health does not offer them; there is no per-process random secret and no derived one", async () => {
    for (const env of [{ VERCEL: "1" }, { NODE_ENV: "production" }, { VERCEL: "1", UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "tok-not-real" }]) {
      const rt = createRuntime({ NEBIUS_API_KEY: "k", TAVILY_API_KEY: "t", ...env }, { store: new MemoryStore() });
      expect(rt.confirmSecret, JSON.stringify(env)).toBe("");
      const res = await handleClosures(post("/api/closures", {}), rt);
      expect(await res.json()).toMatchObject({ status: "unavailable", reason: "disabled" });
      expect((await (await handleHealth(rt)).json()).tavily.configured).toBe(false);
      const c = await handleClosureConfirm(post("/api/closures/confirm", { token: `v1.${"a".repeat(30)}.${"b".repeat(43)}` }), rt);
      expect(c.status).toBe(503);
    }
    const ok = createRuntime({ NEBIUS_API_KEY: "k", TAVILY_API_KEY: "t", VERCEL: "1", WS_CONFIRM_SECRET: "a-long-random-secret-not-real" }, { store: new MemoryStore() });
    expect(ok.confirmSecret).toBe("a-long-random-secret-not-real");
    expect((await (await handleHealth(ok)).json()).tavily.configured).toBe(true);
  });

  it("outside production an unset secret is random per process (development convenience), and differs between processes", () => {
    const a = createRuntime({ NEBIUS_API_KEY: "k" }, { store: new MemoryStore() });
    const b = createRuntime({ NEBIUS_API_KEY: "k" }, { store: new MemoryStore() });
    expect(a.confirmSecret.length).toBeGreaterThan(20);
    expect(a.confirmSecret).not.toBe(b.confirmSecret);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("R2-4 (integrity): a runtime receipt for confirmed closures, and a broader static ban on constructing news records", () => {
  const proposal = (): ClosureProposal => ({
    id: "closure-1",
    road: "Boston Street",
    matchedName: "Boston Street",
    gazetteerId: "G-RD-BOSTON-STREET",
    mutation: { kind: "close_edges", edges: [1, 2, 3], label: "Boston Street" },
    provenance: { url: "https://news.example.test/a", quote: "Boston Street is closed.", retrievedAt: "2026-09-26T12:00:00.000Z" },
    verification: "unverified",
    confidence: "high",
    confirmToken: "v1.aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbb",
  });
  const serve = (record: unknown) => (async () => new Response(JSON.stringify({ status: "ok", record }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const server = () => ({ id: "tavily-G-RD-BOSTON-STREET-abc", m: { kind: "close_edges", edges: [1, 2, 3], label: "Boston Street" }, origin: "tavily", label: "Boston Street (unverified news report)", provenance: { url: "https://news.example.test/a", quote: "Boston Street is closed.", retrievedAt: "2026-09-26T12:00:00.000Z" }, confirmedAt: "2026-09-26T12:01:00.000Z" });

  it("a redeemed confirmation carries a runtime receipt; a copy, a hand-built record and a JSON round trip do not", async () => {
    const p = proposal();
    const confirmed = await confirmClosureProposal(p, recordUserConfirmation(p), { fetchImpl: serve(server()) });
    expect(() => assertConfirmedClosure(confirmed)).not.toThrow();
    expect(() => assertConfirmedClosure({ ...confirmed })).toThrow(ConfirmationError);
    expect(() => assertConfirmedClosure(JSON.parse(JSON.stringify(confirmed)))).toThrow(ConfirmationError);
    expect(() => assertConfirmedClosure(server())).toThrow(ConfirmationError);
    expect(() => assertConfirmedClosure(null)).toThrow(ConfirmationError);
    expect(() => toMutationRecord({ ...confirmed } as never)).toThrow(ConfirmationError);
  });

  it("assertMutationRecordAllowed: the record made from a receipt passes; tavily-origin and news-dressed 'user' closures without one are refused; a manual closure passes", async () => {
    const p = proposal();
    const confirmed = await confirmClosureProposal(p, recordUserConfirmation(p), { fetchImpl: serve(server()) });
    const rec = toMutationRecord(confirmed);
    expect(() => assertMutationRecordAllowed(rec)).not.toThrow();
    expect(() => assertMutationRecordAllowed({ ...rec })).toThrow(ConfirmationError); // a copy has no receipt
    expect(() => assertMutationRecordAllowed({ ...rec, origin: "user" })).toThrow(ConfirmationError); // relabeling it does not help
    const handBuilt = { id: "x", m: { kind: "close_link" as const, linkId: "L-KEYBRIDGE" }, origin: "user" as const, label: "Close Key Bridge", provenance: { url: "https://news.example.test/a", quote: "closed", retrievedAt: "2026-09-26T12:00:00.000Z" }, confirmedAt: "2026-09-26T12:01:00.000Z" };
    expect(() => assertMutationRecordAllowed(handBuilt)).toThrow(ConfirmationError); // news provenance on a user record
    const { provenance: _p, ...noProv } = handBuilt;
    void _p;
    expect(() => assertMutationRecordAllowed({ ...noProv, label: "Boston Street (unverified news report)", m: { kind: "close_edges", edges: [1], label: "x" } })).toThrow(ConfirmationError); // news label, no provenance
    expect(() => assertMutationRecordAllowed({ ...noProv, origin: "tavily" })).toThrow(ConfirmationError);
    expect(() => assertMutationRecordAllowed(noProv)).not.toThrow(); // the user's own manual closure (what the command bar builds)
    expect(() => assertMutationRecordAllowed({ ...noProv, m: { kind: "scale_corridor_speed", corridorId: "C-1", factor: 1.1 }, origin: "agent" })).not.toThrow();
  });

  it("confirmClosureProposal refuses an incomplete server answer and never adds a receipt for it", async () => {
    const p = proposal();
    const bad = { ...server(), provenance: undefined };
    await expect(confirmClosureProposal(p, recordUserConfirmation(p), { fetchImpl: serve(bad) })).rejects.toThrow(ConfirmationError);
    await expect(confirmClosureProposal({ ...p, confirmToken: undefined }, recordUserConfirmation(p), {})).rejects.toThrow(ConfirmationError);
    await expect(confirmClosureProposal(p, recordUserConfirmation({ id: "other" }), {})).rejects.toThrow(ConfirmationError);
  });

  /* ---- static scan (TypeScript AST) ---- */
  const walk = (dir: string, out: string[] = []): string[] => {
    if (!existsSync(dir)) return out;
    for (const n of readdirSync(dir)) {
      if (n === "node_modules" || n === ".next") continue;
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(n)) out.push(p);
    }
    return out;
  };
  const SOURCE = [...walk(path.join(root, "app")), ...walk(path.join(root, "components")), ...walk(path.join(root, "lib"))]
    .map((f) => path.relative(root, f))
    .filter((f) => !f.startsWith("lib/sim/"));
  /** The only files that may name the tavily origin as a value: the browser confirmation module, the server redeemer, and the protocol type. */
  const ALLOWED = new Set(["lib/agent/closures.ts", "lib/server/tavily.ts", "lib/agent/protocol.ts"]);

  /** String values an expression can take, or null when it is not a literal expression. */
  function literalValues(n: ts.Node): string[] | null {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text];
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n)) return literalValues(n.expression);
    if (ts.isConditionalExpression(n)) {
      const a = literalValues(n.whenTrue);
      const b = literalValues(n.whenFalse);
      return a && b ? [...a, ...b] : null;
    }
    if (ts.isArrowFunction(n) && n.parameters.length === 0 && !ts.isBlock(n.body)) return literalValues(n.body);
    return null;
  }

  /** True when a parameter's declared type is a union of string literals that excludes "tavily" (or a function returning one). */
  function typeExcludesTavily(t: ts.TypeNode | undefined): boolean {
    if (!t) return false;
    if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) return t.literal.text !== "tavily";
    if (ts.isUnionTypeNode(t)) return t.types.every((x) => typeExcludesTavily(x));
    if (ts.isParenthesizedTypeNode(t)) return typeExcludesTavily(t.type);
    if (ts.isFunctionTypeNode(t)) return typeExcludesTavily(t.type);
    return false;
  }
  /** An identifier whose enclosing function declares it with a literal type that cannot be "tavily". */
  function identifierIsSafelyTyped(id: ts.Identifier): boolean {
    for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
      if (ts.isFunctionLike(n)) {
        const p = n.parameters.find((x) => ts.isIdentifier(x.name) && x.name.text === id.text);
        if (p) return typeExcludesTavily(p.type);
      }
    }
    return false;
  }

  interface Finding {
    file: string;
    text: string;
  }
  function originAssignments(): { all: Finding[]; nonLiteral: Finding[]; tavily: Finding[] } {
    const all: Finding[] = [];
    const nonLiteral: Finding[] = [];
    const tavily: Finding[] = [];
    for (const f of SOURCE) {
      if (f.endsWith(".d.ts")) continue;
      const text = readFileSync(path.join(root, f), "utf8");
      const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (n: ts.Node) => {
        let name: string | undefined;
        let value: ts.Node | undefined;
        if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) {
          name = n.name.text;
          value = n.initializer;
        } else if (ts.isShorthandPropertyAssignment(n)) {
          name = n.name.text;
          value = n.name;
        } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left)) {
          name = n.left.name.text;
          value = n.right;
        } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isElementAccessExpression(n.left) && ts.isStringLiteral(n.left.argumentExpression)) {
          name = n.left.argumentExpression.text;
          value = n.right;
        }
        if (name === "origin" && value) {
          const rec = { file: f, text: value.getText(sf).slice(0, 80) };
          all.push(rec);
          const lits = literalValues(value);
          if (lits === null && ts.isIdentifier(value) && identifierIsSafelyTyped(value)) {
            /* a parameter typed "user" | "agent": the type system already excludes "tavily" */
          } else if (lits === null) nonLiteral.push(rec);
          else if (lits.includes("tavily")) tavily.push(rec);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return { all, nonLiteral, tavily };
  }

  it("no file outside the confirmation module and the server redeemer assigns origin \"tavily\" (AST, not a grep: shorthand, conditionals and property assignments are all seen)", () => {
    const { tavily } = originAssignments();
    const outside = tavily.filter((h) => !ALLOWED.has(h.file));
    expect(outside).toEqual([]);
    expect(tavily.some((h) => h.file === "lib/agent/closures.ts")).toBe(true); // the scan does see the allowed file
    expect(tavily.some((h) => h.file === "lib/server/tavily.ts")).toBe(true);
  });

  it("the string \"tavily\" is not used as a value anywhere in app, components or lib except the allowed files", () => {
    const hits: string[] = [];
    for (const f of SOURCE) {
      if (ALLOWED.has(f)) continue;
      const text = readFileSync(path.join(root, f), "utf8");
      const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (n: ts.Node) => {
        if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text.toLowerCase() === "tavily") hits.push(f);
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect([...new Set(hits)]).toEqual([]);
  });

  it("origin is never assigned a non-literal value in lib/ui, components or app (a computed origin could smuggle 'tavily' in)", () => {
    const { nonLiteral } = originAssignments();
    const ui = nonLiteral.filter((h) => h.file.startsWith("lib/ui/") || h.file.startsWith("components/") || h.file.startsWith("app/"));
    expect(ui, `computed origin values: ${JSON.stringify(ui)}`).toEqual([]);
  });

  it("the AST scan itself catches each way of building a record (self-test on synthetic sources)", () => {
    const probe = (src: string) => {
      const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true);
      const out: string[][] = [];
      const visit = (n: ts.Node) => {
        if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "origin") out.push(literalValues(n.initializer) ?? ["<non-literal>"]);
        if (ts.isShorthandPropertyAssignment(n) && n.name.text === "origin") out.push(["<non-literal>"]);
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return out.flat();
    };
    expect(probe(`const a = { origin: "tavily" }`)).toEqual(["tavily"]);
    expect(probe("const a = { origin: `tavily` }")).toEqual(["tavily"]);
    expect(probe(`const a = { origin: cond ? "tavily" : "user" }`)).toEqual(["tavily", "user"]); // both branches are read
    expect(probe(`const a = { origin: someVar }`)).toEqual(["<non-literal>"]);
    expect(probe(`const origin = f(); const a = { origin }`)).toEqual(["<non-literal>"]);
    expect(probe(`const a = { origin: () => (x ? "agent" : "tavily") }`)).toEqual(["agent", "tavily"]);
  });
});

/* ------------------------------------------------------------------------------------------ */
describe("test debt: guards the reviewer showed were untested", () => {
  it("guard: 'doesn't reach' (a negative contraction) is caught by the contraction rule and by nothing else", () => {
    const issues = proseIssues("It doesn't reach the shore.", { allowedTokens: [], profile: "card" });
    expect(issues.map((i) => i.code)).toEqual(["negation"]);
    expect(issues[0].message).toContain("contraction");
    expect(proseIssues("It does reach the shore.", { allowedTokens: [], profile: "card" })).toEqual([]);
  });
  it("guard: 'a pair of ...' is a count and is caught by the pair rule and by nothing else; 'pair a link with a site' is a verb and passes", () => {
    const issues = proseIssues("A pair of links join the shores.", { allowedTokens: [], profile: "card" });
    expect(issues.map((i) => i.code)).toEqual(["magnitude"]);
    expect(issues[0].word).toBe("pair of");
    expect(proseIssues("Pair a link with a site on the shore.", { allowedTokens: [], profile: "card" })).toEqual([]);
  });
});

/* keep the imported names used even when a test above is edited */
void BASELINE;
void (null as unknown as AgentApi);

describe("R2-2 (security): the machine hands a fresh Turnstile token to the mission start", () => {
  it("sends the token from the hook with the parse request, sends none without a hook, and shows the server's verification message when it is refused", async () => {
    const seen: (string | undefined)[] = [];
    const api: AgentApi = {
      parse: async (req) => {
        seen.push((req as { turnstileToken?: string }).turnstileToken);
        return { status: "fallback", reason: "verification_failed", message: "Human verification did not pass. Reload the page and try again, or use the recorded run.", next: "retry_later" };
      },
      plan: async () => { throw new Error("unexpected"); },
      critique: async () => { throw new Error("unexpected"); },
    };
    const withHook = new AgentMachine({ api, evaluate: fakeEvaluator(), catalog: fakeCatalog(), turnstileToken: async () => "tok-123" });
    await withHook.start("cut access time");
    const without = new AgentMachine({ api, evaluate: fakeEvaluator(), catalog: fakeCatalog() });
    await without.start("cut access time");
    expect(seen).toEqual(["tok-123", undefined]);
    expect(withHook.getState().degraded).toMatchObject({ reason: "verification_failed", next: "retry_later" });
    expect(withHook.getState().degraded?.message).toContain("Human verification");
  });
});

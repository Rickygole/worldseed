import { describe, expect, it } from "vitest";
import type { AssumptionRecord } from "../../lib/sim/contract";
import { ContractError } from "../../lib/sim/csr";
import { SimEngine } from "../../lib/sim/engine";
import { DEFAULT_FUTURES_PARAMS, describeFuturesParams, resolveFuturesParams } from "../../lib/sim/sample";
import { buildHarbor, HARBOR_ID, rec } from "./fixtures";

const a = (id: string, value: AssumptionRecord["value"], extra: Partial<AssumptionRecord> = {}): AssumptionRecord => ({ id, label: id, value, unit: null, status: "assumption", source: null, ...extra });

describe("futures parameters come from assumptions.json when present", () => {
  it("absent: the code defaults, and nothing is reported as coming from the snapshot", () => {
    const r = resolveFuturesParams([a("A-CALL-TO-WHEELS", 60), a("A-BBOX", "x")]);
    expect(r.params).toEqual(DEFAULT_FUTURES_PARAMS);
    expect(r.fromSnapshot).toBe(false);
    expect(r.usedIds).toEqual([]);
  });

  it("individual records override individual defaults; the rest keep the defaults", () => {
    const r = resolveFuturesParams([
      a("A-FUTURES-RHO", 0.3, { min: 0, max: 1 }),
      a("A-DIVERSION", 1.4, { unit: "x" }),
      a("A-DIVERSION-LINK", "L-KEYBRIDGE"),
      a("A-DIVERSION-CORRIDORS", "C-I895-TUNNEL"),
      a("A-FUTURES-CLOSURES", "L-HARBORTUNNEL, L-FORTMCHENRY"),
      a("A-FUTURES-INCIDENTS", 150),
      a("A-FUTURES-MEDIAN-AM", "motorway 2, trunk 1.9"),
      a("A-FUTURES-SIGMA", "motorway 0, residential 0.2"),
    ]);
    expect(r.params.rho).toBe(0.3);
    expect(r.params.diversion).toEqual({ whenClosedLink: "L-KEYBRIDGE", corridors: ["C-I895-TUNNEL"], factor: 1.4 });
    expect(r.params.closureEligible).toEqual(["L-HARBORTUNNEL", "L-FORTMCHENRY"]);
    expect(r.params.incidents).toBe(150);
    expect(r.params.median.am.motorway).toBe(2);
    expect(r.params.median.am.trunk).toBe(1.9);
    expect(r.params.median.am.primary).toBe(DEFAULT_FUTURES_PARAMS.median.am.primary);
    expect(r.params.median.pm).toEqual(DEFAULT_FUTURES_PARAMS.median.pm);
    expect(r.params.sigma.motorway).toBe(0);
    expect(r.params.sigma.residential).toBe(0.2);
    expect(r.params.sigma.trunk).toBe(DEFAULT_FUTURES_PARAMS.sigma.trunk);
    expect(r.fromSnapshot).toBe(true);
    expect(r.usedIds).toContain("A-FUTURES-RHO");
    expect(r.usedIds).toHaveLength(8);
  });

  it("A-FUTURES-PARAMS (one JSON object) works, and individual records win over it", () => {
    const r = resolveFuturesParams([a("A-FUTURES-PARAMS", JSON.stringify({ rho: 0.8, incidents: 50 })), a("A-FUTURES-RHO", 0.1)]);
    expect(r.params.incidents).toBe(50);
    expect(r.params.rho).toBe(0.1);
  });

  it("documented min/max are enforced, and malformed values fail loudly naming the record", () => {
    expect(() => resolveFuturesParams([a("A-DIVERSION", 3, { min: 1, max: 2 })])).toThrow(/A-DIVERSION.*above its documented max/);
    expect(() => resolveFuturesParams([a("A-DIVERSION", 0.5, { min: 1, max: 2 })])).toThrow(/below its documented min/);
    expect(() => resolveFuturesParams([a("A-FUTURES-RHO", 2)])).toThrow(/rho must be in/);
    expect(() => resolveFuturesParams([a("A-FUTURES-INCIDENTS", 1.5)])).toThrow(/positive integer/);
    expect(() => resolveFuturesParams([a("A-FUTURES-MEDIAN-PM", "motorway fast")])).toThrow(ContractError);
    expect(() => resolveFuturesParams([a("A-FUTURES-CLOSURES", 5)])).toThrow(/comma-separated/);
  });

  it("describeFuturesParams round-trips through resolveFuturesParams", () => {
    const rows = describeFuturesParams(DEFAULT_FUTURES_PARAMS, false);
    const back = resolveFuturesParams(rows.filter((r) => r.id !== "A-FUTURES-MODEL"));
    expect(back.params.median).toEqual(DEFAULT_FUTURES_PARAMS.median);
    expect(back.params.sigma).toEqual(DEFAULT_FUTURES_PARAMS.sigma);
    expect(back.params.rho).toBe(DEFAULT_FUTURES_PARAMS.rho);
    expect(back.params.diversion.factor).toBe(DEFAULT_FUTURES_PARAMS.diversion.factor);
    expect(back.params.closureEligible).toEqual(DEFAULT_FUTURES_PARAMS.closureEligible);
    expect(back.params.incidents).toBe(DEFAULT_FUTURES_PARAMS.incidents);
  });

  it("the engine uses what the snapshot says: a snapshot with rho 0 versus 0.9 gives different spreads, and info lists the ids", async () => {
    const h = buildHarbor();
    const w = { snapshotId: HARBOR_ID, mutations: [] as ReturnType<typeof rec>[] };
    const mk = (rho: number) => new SimEngine({ snapshot: { ...h.snap, assumptions: [a("A-FUTURES-RHO", rho)] }, params: h.params });
    const lo = mk(0);
    const hi = mk(0.9);
    expect(lo.futuresParams.rho).toBe(0);
    expect(lo.info.paramSources.futuresFromSnapshot).toEqual(["A-FUTURES-RHO"]);
    const o = { n: 200, seed: 1, tod: "pm" as const, closureProb: 0, headline: "p50S" as const };
    const x = await lo.runFutures(w, "access", o);
    const y = await hi.runFutures(w, "access", o);
    expect(y.headline.p90 - y.headline.p10).toBeGreaterThan(x.headline.p90 - x.headline.p10);
    expect(new SimEngine({ snapshot: h.snap, params: h.params }).info.paramSources.futuresFromSnapshot).toEqual([]);
    expect(lo.info.futuresParams.find((r) => r.id === "A-FUTURES-RHO")?.value).toBe(0);
  });
});

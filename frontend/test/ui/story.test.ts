import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONGESTED_MEDIAN_ADDED_S, FAST_ERR, MEAN_ADDED_RANGE_S, PEOPLE_GT10_RANGE, REPORTED_DETOUR, SPEED_VARIANT_PCT, STUDY_CONCLUSIONS, STUDY_REFERENCE, STUDY_VARIANTS } from "../../lib/ui/methodology";
import { fmtPct2, isBridgeOnly, recoveredPct, sceneView, worstAreaLabel, PENINSULA_LABEL, type SearchSnapshot, type StoryInput } from "../../lib/ui/storyFigures";
import { PRIVACY_RETENTION_DAYS, T } from "../../lib/ui/storyCopy";
import type { SimOutput } from "../../lib/sim/types";

const root = path.resolve(__dirname, "../..");
const OUT = path.resolve(root, "../pipeline/sensitivity/out");

describe("study constants match the sensitivity study outputs (pipeline/sensitivity/out)", () => {
  const sensPath = path.join(OUT, "sensitivity.json");
  const have = existsSync(sensPath);
  if (!have) console.log(`[story.test] skipped: ${sensPath} is absent (the pipeline outputs are not in this checkout)`);
  const variants: { name: string; popLossGt10: number; xhAddedMeanS: number; xhAddedP50S: number }[] = have ? JSON.parse(readFileSync(sensPath, "utf8")).variants : [];
  const v = (name: string) => variants.find((x) => x.name === name);

  it.skipIf(!have)("PEOPLE_GT10_RANGE: speeds +20% (low) and T = 24 min (high)", () => {
    expect(Math.round(v("speed x1.2: all edges")!.popLossGt10)).toBe(PEOPLE_GT10_RANGE.lo);
    expect(Math.round(v("T = 24 min")!.popLossGt10)).toBe(PEOPLE_GT10_RANGE.hi);
  });
  it.skipIf(!have)("MEAN_ADDED_RANGE_S and SPEED_VARIANT_PCT: all-edge speed variants", () => {
    expect(v("speed x1.2: all edges")!.xhAddedMeanS).toBeCloseTo(MEAN_ADDED_RANGE_S.lo, 1);
    expect(v("speed x0.8: all edges")!.xhAddedMeanS).toBeCloseTo(MEAN_ADDED_RANGE_S.hi, 1);
    expect(SPEED_VARIANT_PCT).toBe(20);
  });
  it.skipIf(!have)("CONGESTED_MEDIAN_ADDED_S: tunnel time x1.25 / x1.5 only after the closure", () => {
    expect(v("tunnel time x1.25 only AFTER bridge closure (diversion)")!.xhAddedP50S).toBeCloseTo(CONGESTED_MEDIAN_ADDED_S.lo, 1);
    expect(v("tunnel time x1.5 only AFTER bridge closure (diversion)")!.xhAddedP50S).toBeCloseTo(CONGESTED_MEDIAN_ADDED_S.hi, 1);
  });
  it.skipIf(!have)("/methodology tables: reference run, conclusion scoreboard and selected variants", () => {
    const d = JSON.parse(readFileSync(sensPath, "utf8"));
    const r = d.reference;
    expect(Math.round(r.popLossGt10)).toBe(STUDY_REFERENCE.peopleGt10);
    expect(Math.round(r.xhAddedMeanS * 10) / 10).toBe(STUDY_REFERENCE.meanAddedS);
    expect(Math.round(r.regAddedMeanS * 10) / 10).toBe(STUDY_REFERENCE.regionalAddedS);
    expect(Math.round(r.emsBaseP90S * 10) / 10).toBe(STUDY_REFERENCE.emsP90S);
    expect(Math.round(r.popCovered)).toBe(STUDY_REFERENCE.popCovered);
    expect(d.variants.length).toBe(STUDY_REFERENCE.variants);
    for (const c of STUDY_CONCLUSIONS) expect(d.variants.filter((x: { C: Record<string, boolean> }) => x.C[c.id]).length, c.id).toBe(c.held);
    for (const row of STUDY_VARIANTS) {
      const x = v(row.name)!;
      expect(Math.round(x.popLossGt10), row.name).toBe(row.peopleGt10);
      expect(Math.round(x.xhAddedMeanS * 10) / 10, row.name).toBe(row.meanAddedS);
      expect(Math.round(x.xhAddedP50S * 10) / 10, row.name).toBe(row.medianAddedS);
    }
  });
  const valPath = path.join(OUT, "validation.json");
  it.skipIf(!existsSync(valPath))("REPORTED_DETOUR.modelAddedMin: Dundalk to Ferndale in validation.json", () => {
    const named: { from: string; to: string; modelAddedMin: number }[] = JSON.parse(readFileSync(valPath, "utf8")).named;
    const d = named.find((x) => x.from === "Dundalk" && x.to === "Ferndale")!;
    expect(Math.round(d.modelAddedMin * 10) / 10).toBe(REPORTED_DETOUR.modelAddedMin);
  });
  const fvePath = path.join(OUT, "fast_vs_exact.json");
  it.skipIf(!existsSync(fvePath))("FAST_ERR: default (64 anchors per shore) and futures settings (16 and 32)", () => {
    const w = JSON.parse(readFileSync(fvePath, "utf8")).worlds.keybridge_removed.variants as { K: number; headline: { popLossGt10pct: { relErrPct: number } } }[];
    const err = (k: number) => Math.abs(w.find((x) => x.K === k)!.headline.popLossGt10pct.relErrPct);
    expect(Math.round(err(64))).toBe(FAST_ERR.defaultPct);
    expect(Math.floor(Math.min(err(16), err(32)))).toBeGreaterThanOrEqual(FAST_ERR.futuresPct.lo - 1);
    expect(Math.round(Math.max(err(16), err(32)))).toBe(FAST_ERR.futuresPct.hi);
  });
});

describe("privacy.retentionDays matches the limiter's daily-cap key TTL", () => {
  it("2 * DAY_MS in lib/server/ratelimit.ts", () => {
    const src = readFileSync(path.join(root, "lib/server/ratelimit.ts"), "utf8");
    const m = [...src.matchAll(/(\d+)\s*\*\s*DAY_MS/g)].map((x) => Number(x[1]));
    expect(m.length).toBeGreaterThan(0);
    expect(Math.max(...m)).toBe(PRIVACY_RETENTION_DAYS);
  });
});

describe("slot formats and accessors", () => {
  it("worstAreaLabel collapses the peninsula and keeps other names", () => {
    expect(worstAreaLabel(["Edgemere", "Water View", "Lodge Forest"])).toBe(PENINSULA_LABEL);
    expect(worstAreaLabel(["Edgemere", "Curtis Bay"])).toBe(`${PENINSULA_LABEL} and Curtis Bay`);
    expect(worstAreaLabel([])).toBe("");
  });
  it("recoveredPct names the share of the added count that an option wins back", () => {
    expect(recoveredPct(0, 20000, 15000)).toBeCloseTo(25);
    expect(recoveredPct(0, 0, 0)).toBeNull();
    expect(fmtPct2(24.6)).toBe("25");
    expect(fmtPct2(143)).toBe("100");
    expect(fmtPct2(-3)).toBe("0");
  });
});

// ---- scene views from minimal simulator-shaped results ------------------------------------------------------

function out(o: { xhPeople: number; regional: number; ems: number; within?: number }): SimOutput {
  return {
    minutes: new Float32Array(0),
    computeMs: 1,
    detail: {
      lens: "xharbor",
      lenses: {
        xharbor: { p50S: 0, p90S: 0, xharbor: { popMeanMeanTimeS: 1200, popLossGt10pct: o.xhPeople, lowWageLossGt10pct: 0, addedP99S: 0, addedMaxS: 0, popLossGt25pct: 0, popCovered: 1e6, lowWageCovered: 1e5 } },
        access: { popAddedS: o.regional, p90S: 1000 },
        ems: { p90S: o.ems, pctWithin: o.within ?? 96 },
      },
      xharbor: { worstBlockGroups: { byLossPct: [], byAddedS: [] }, headline: { baselineMeanJobs: 250000 } },
    },
  } as unknown as SimOutput;
}

const search: SearchSnapshot = {
  phase: "idle",
  mode: null,
  aiAvailable: false,
  plannerModel: null,
  screening: null,
  futuresDone: 0,
  futuresPlanned: 0,
  futuresPerOption: 24,
  seed: 7,
  catalogCount: 16,
  targetDeltaS: 60,
  costTier: "$$",
  finalists: [],
  appliedBundleId: null,
  stopped: false,
};

function input(p: Partial<StoryInput>): StoryInput {
  return {
    baseline: out({ xhPeople: 0, regional: 0, ems: 366 }),
    current: out({ xhPeople: 20100, regional: 3, ems: 366 }),
    scenario: { removedLinks: ["key_bridge"] },
    trips: null,
    aux: null,
    params: { emsThresholdS: 480, call_to_wheels_delay_min: 1 },
    osmDate: "2024-03-01T00:00:00Z",
    facts: { shoresWithStations: 2, fireStations: 74, ambulanceStations: 2, anchorCount: 7, budgetMin: 30 },
    revealed: new Set(),
    bridgeOnly: null,
    topWorld: null,
    routeShown: false,
    settling: false,
    search,
    nextStep: "The local story",
    ...p,
  };
}

describe("scene views", () => {
  it("the range chip shows the study range only in the reference world", () => {
    const ref = sceneView("averages", input({}));
    expect(isBridgeOnly({ removedLinks: ["key_bridge"] })).toBe(true);
    expect(ref.chip?.text).toMatch(/6,700 to 96,000/);
    const other = sceneView("averages", input({ scenario: { removedLinks: ["key_bridge"], mutations: [{ id: "x", m: { kind: "close_link", linkId: "L-HARBORTUNNEL" }, origin: "user", label: "x", confirmedAt: "" }] } }));
    expect(other.chip?.text).toBe(T.averages.rangeNotTested);
  });
  it("first response: the both-shores sentence needs two shores with stations", () => {
    expect(sceneView("held", input({})).sentence).toBe(T.held.both);
    expect(sceneView("held", input({ facts: { shoresWithStations: 1, fireStations: 74, ambulanceStations: 2, anchorCount: 7, budgetMin: 30 } })).sentence).toBe(T.held.unchanged);
  });
  it("the crossing rolls from 0 to about 3 seconds", () => {
    const before = sceneView("crossing", input({ scenario: { removedLinks: [] }, current: out({ xhPeople: 0, regional: 0, ems: 366 }) }));
    const after = sceneView("crossing", input({}));
    expect(before.figure?.value).toBe(0);
    expect(after.figure?.value).toBe(3);
    expect(after.sentence).toMatch(/about 3 seconds longer/);
  });
  it("scenes 2 to 5 show the gate when the bridge is restored", () => {
    expect(sceneView("averages", input({ scenario: { removedLinks: [] } })).state).toBe("gate");
    expect(sceneView("fix", input({ scenario: { removedLinks: [] } })).state).toBe("gate");
  });
  it("the search names the planner: Deterministic search (no AI) when the AI planner is unavailable", () => {
    const v = sceneView("fix", input({}));
    expect(v.note).toMatch(/^Deterministic search \(no AI\)/);
    const ai = sceneView("fix", input({ search: { ...search, aiAvailable: true, plannerModel: "Nemotron-X" } }));
    expect(ai.note).toBe("AI planner: Nemotron-X");
  });
  it("after an option: the recovered share on the named measure and the residual count", () => {
    const applied = sceneView(
      "fix",
      input({
        scenario: { removedLinks: ["key_bridge"], mutations: [{ id: "o", m: { kind: "apply_candidate", candidateId: "C1" }, origin: "user", label: "o", confirmedAt: "" }] },
        current: out({ xhPeople: 15000, regional: -2, ems: 366 }),
        bridgeOnly: out({ xhPeople: 20000, regional: 3, ems: 366 }),
        search: { ...search, phase: "applied", finalists: [{ bundleId: "B1", title: "x", costTier: "$$", pGoal: 0.8 }], appliedBundleId: "B1" },
      }),
    );
    expect(applied.figure?.format(applied.figure.value)).toBe("25%");
    expect(applied.chip?.text).toBe("Still affected: about 15,000 people");
    expect(applied.sentence).toBe(T.fix.helps);
    expect(applied.how.some((c) => /Measure: people who reach over 10% fewer jobs/.test(c.body))).toBe(true);
  });
});

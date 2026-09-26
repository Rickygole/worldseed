import { describe, expect, it } from "vitest";
import { buildCatalog } from "../../lib/agent/catalog";
import { EvaluatedRowSchema, type ConfirmedMission } from "../../lib/agent/tools";
import type { FuturesOptions, FuturesResult, LensId, LensMetrics } from "../../lib/sim/contract";
import type { RealSimulator } from "../../lib/sim/real";
import type { Scenario } from "../../lib/sim/types";
import { createEvaluator } from "../../lib/ui/agentBridge";

const catalog = buildCatalog([
  { id: "CP-A", type: "signal_priority", title: "Hypothetical scenario option: A", lens: ["access"], costTier: "$", leadTime: "weeks", hypothetical: true, effect: { op: "corridor_speed" } },
]);
const mission: ConfirmedMission = { lens: "access", goal: { metric: "p90", op: "<=", targetDelta: 60 }, constraints: { maxCostTier: "$$", types: [], areas: [] } };
const base: Scenario = { removedLinks: ["key_bridge"] };

/** Fake simulator: p90 = 1000 s + 100 s per closed link - 10 s per option, the same in every future. */
function fakeSim() {
  const calls: { scenario: Scenario; lens: LensId; opts: FuturesOptions }[] = [];
  const sim = {
    runFutures: async (scenario: Scenario, lens: LensId, opts: FuturesOptions, run?: { onProgress?: (d: number, t: number) => void }) => {
      calls.push({ scenario, lens, opts });
      const muts = scenario.mutations ?? [];
      const closed = muts.filter((m) => m.m.kind === "close_link").length + scenario.removedLinks.length;
      const options = muts.filter((m) => m.m.kind === "apply_candidate").length;
      const p90 = 1000 + 100 * closed - 10 * options;
      const samples: LensMetrics[] = Array.from({ length: opts.n }, () => ({ lens, p50S: p90 / 2, p90S: p90, pctWithin: 90, isolatedBg: [], equityGapS: -3 }));
      run?.onProgress?.(opts.n, opts.n);
      return { samples, meta: { ms: 10, workers: 2 } } as unknown as FuturesResult;
    },
  } as unknown as RealSimulator;
  return { sim, calls };
}

describe("createEvaluator", () => {
  it("scores options paired with the pre-collapse network and doing nothing, with real futures counts", async () => {
    const { sim, calls } = fakeSim();
    const ev = createEvaluator({ sim, catalog, base, origin: () => "user", knownLinks: new Set(["L-HARBORTUNNEL"]) });
    const out = await ev([{ id: "B1", candidateIds: ["CP-A"] }], { mission, round: 1 });
    expect(calls).toHaveLength(3); // pre-collapse, doing nothing, B1
    expect(calls[0].scenario.removedLinks).toEqual([]);
    expect(calls.every((c) => c.lens === "xharbor" && c.opts.seed === calls[0].opts.seed)).toBe(true);
    const row = out.rows[0];
    expect(EvaluatedRowSchema.safeParse(row).success).toBe(true);
    expect(row.futures).toBe(calls[2].opts.n);
    // option 1090 vs pre-collapse 1000 + 60 target: never met
    expect(row.pGoal).toBe(0);
    // the baseline row is doing nothing (1100), so the planner's "benefit" is 10 s
    expect(out.baseline?.p90S).toBe(1100);
    expect(row.equityGapS).toBe(-3); // signed
  });

  it("runs a stress in every world, like for like, and maps midday to the simulator's mid", async () => {
    const { sim, calls } = fakeSim();
    const ev = createEvaluator({ sim, catalog, base, origin: () => "user", knownLinks: new Set(["L-HARBORTUNNEL"]) });
    const out = await ev([{ id: "B1", candidateIds: ["CP-A"] }], { mission, round: 2, stress: { closedLinks: ["L-HARBORTUNNEL"], tod: "midday", label: "Harbor Tunnel closed during the midday" } });
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.scenario.mutations?.some((m) => m.m.kind === "close_link" && m.m.linkId === "L-HARBORTUNNEL")).toBe(true);
      expect(c.opts.tod).toBe("mid");
    }
    expect(out.baseline?.p90S).toBe(1200); // doing nothing under the same stress
    expect(out.rows[0].p90S).toBe(1190);
    expect(out.rows[0].stressLabel).toBe("Harbor Tunnel closed during the midday");
  });

  it("returns no rows for a stress it cannot run, instead of unstressed rows under a stress label", async () => {
    const { sim, calls } = fakeSim();
    const ev = createEvaluator({ sim, catalog, base, origin: () => "user", knownLinks: new Set(["L-HARBORTUNNEL"]) });
    const out = await ev([{ id: "B1", candidateIds: ["CP-A"] }], { mission, round: 2, stress: { closedLinks: ["L-HANOVER"], label: "Hanover Street corridor closed" } });
    expect(out.rows).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

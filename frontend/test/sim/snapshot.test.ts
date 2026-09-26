import { afterEach, describe, expect, it, vi } from "vitest";
import { ContractError } from "../../lib/sim/csr";
import { SimEngine } from "../../lib/sim/engine";
import { CONTRACT_MODEL_DEFAULTS, fetchReader, loadSnapshot, modelParamsFromAssumptions, SnapshotMissingError } from "../../lib/sim/snapshot";
import { buildHarbor, harborReader } from "./fixtures";

const h = buildHarbor();

describe("loadSnapshot", () => {
  it("loads the pipeline file set and validates cross-file references", async () => {
    const { snapshot, params, paramSources } = await loadSnapshot(harborReader(h));
    expect(snapshot.id).toBe(h.snap.id);
    expect(snapshot.graph.nodeCount).toBe(h.snap.graph.nodeCount);
    expect(snapshot.hexes.count).toBe(h.snap.hexes.count);
    expect(Array.from(snapshot.hexes.pop)).toEqual(Array.from(h.snap.hexes.pop));
    expect(snapshot.hexes.h3[3]).toBe("fx-3");
    expect(snapshot.facilities).toHaveLength(4);
    expect(snapshot.candidates).toHaveLength(4);
    // values come from assumptions.json, converted to the neutral internal unit
    expect(params.call_to_wheels_delay_min).toBe(1.5);
    expect(params.emsThresholdS).toBe(420);
    expect(params.accessCapS).toBe(CONTRACT_MODEL_DEFAULTS.accessCapS);
    expect(paramSources.fromSnapshot).toEqual(["A-CALL-TO-WHEELS", "A-EMS-THRESHOLD"]);
    expect(paramSources.defaulted).toContain("A-ACCESS-CAP");
  });

  it("optional files may be absent; the result says so instead of inventing data", async () => {
    const { snapshot } = await loadSnapshot(harborReader(h, {}, ["candidates.json", "assumptions.json", "manifest.json"]));
    expect(snapshot.candidates).toEqual([]);
    expect(snapshot.assumptions).toEqual([]);
    expect(snapshot.manifest).toBeNull();
    expect(snapshot.id).toBe(h.snap.id); // falls back to hexes.meta.json
  });

  it("required files missing -> SnapshotMissingError naming the file", async () => {
    await expect(loadSnapshot(harborReader(h, {}, ["destinations.json"]))).rejects.toThrow(SnapshotMissingError);
    await expect(loadSnapshot(harborReader(h, {}, ["graph.bin"]))).rejects.toThrow(/graph\.bin/);
  });

  it("contract deviations are reported with file and field, not adapted to", async () => {
    const badFac = h.snap.facilities.map((f, i) => (i === 0 ? { ...f, node: 10_000_000 } : f));
    await expect(loadSnapshot(harborReader(h, { "facilities.json": badFac }))).rejects.toThrow(/facilities\.json.*F-WEST/);
    const badKind = h.snap.facilities.map((f, i) => (i === 0 ? { ...f, kind: "fire_boat" } : f));
    await expect(loadSnapshot(harborReader(h, { "facilities.json": badKind }))).rejects.toThrow(ContractError);
    const badCand = [{ ...h.snap.candidates[1], effect: { op: "corridor_speed", corridor: "C-NOPE", factor: 1.1 } }];
    await expect(loadSnapshot(harborReader(h, { "candidates.json": badCand }))).rejects.toThrow(/C-NOPE/);
    const badOp = [{ ...h.snap.candidates[0], effect: { op: "teleport" } }];
    await expect(loadSnapshot(harborReader(h, { "candidates.json": badOp }))).rejects.toThrow(/candidates\.json/);
    await expect(loadSnapshot(harborReader(h, { "destinations.json": [{ id: "D", name: "n", node: 0 }] }))).rejects.toThrow(/destinations\.json/);
  });

  it("modelParamsFromAssumptions handles units and rejects nonsense", () => {
    const rec = (id: string, value: number | string, unit: string | null) => ({ id, label: id, value, unit, status: "assumption" as const });
    expect(modelParamsFromAssumptions([rec("A-CALL-TO-WHEELS", 60, "s")]).params.call_to_wheels_delay_min).toBe(1);
    expect(modelParamsFromAssumptions([rec("A-CALL-TO-WHEELS", 1.25, "min")]).params.call_to_wheels_delay_min).toBe(1.25);
    expect(() => modelParamsFromAssumptions([rec("A-CALL-TO-WHEELS", 60, "hours")])).toThrow(ContractError);
    expect(() => modelParamsFromAssumptions([rec("A-EMS-THRESHOLD", "eight minutes", null)])).toThrow(ContractError);
    expect(modelParamsFromAssumptions([]).defaulted).toHaveLength(5);
  });

  it("an engine built from the loaded snapshot uses the snapshot's constants", async () => {
    const eng = await SimEngine.fromReader(harborReader(h));
    expect(eng.params.call_to_wheels_delay_min).toBe(1.5);
    const r = eng.runDeterministic({ snapshotId: h.snap.id, mutations: [] }, "ems");
    // a station's own hex: delay + 0 + snapS
    const stationHex = h.snap.facilities[0].node; // hex index == node index in the fixture
    expect(r.field[stationHex]).toBeCloseTo(90 + 12, 3);
  });
});

describe("fetchReader", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps 404 and HTML-instead-of-JSON to SnapshotMissingError, and returns bytes otherwise", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("gone.json")) return new Response("nope", { status: 404 });
      if (url.endsWith("spa.json")) return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
      if (url.endsWith("boom.json")) return new Response("x", { status: 500 });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/octet-stream" } });
    });
    const read = fetchReader("/snapshot");
    await expect(read("gone.json")).rejects.toThrow(SnapshotMissingError);
    await expect(read("spa.json")).rejects.toThrow(SnapshotMissingError);
    await expect(read("boom.json")).rejects.toThrow(/HTTP 500/);
    expect(new Uint8Array(await read("graph.bin"))).toEqual(new Uint8Array([1, 2, 3]));
  });
});

const without = <T extends object>(o: T, key: string): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

describe("schema policy: additive fields tolerated, required fields enforced", () => {
  const withExtras = () => {
    const hc = buildHarbor(12, 8, "candidateLinks");
    const extras = {
      "graph.meta.json": { ...hc.graphMeta, someFutureField: { a: 1 }, units: { edgeTimeS: "seconds" }, noCorridor: 65535 },
      "assumptions.json": [
        { id: "A-CALL-TO-WHEELS", label: "delay", value: 60, unit: "s", status: "assumption", source: null, min: 30, max: 120, note: "n", futureKey: 1 },
        { id: "A-CANDIDATES-HYPOTHETICAL", label: "flag", value: true, unit: null, status: "assumption", source: null },
      ],
      "candidates.json": hc.snap.candidates.map((c) => ({
        ...c, kind: "temporary_link", mechanism: "text", refs: { nodes: [1, 2] }, costSource: null, params: { x: 1 }, lens: [...c.lens, "xharbor"],
        effect: c.effect.op === "add_source" ? { ...c.effect, delayS: 30 } : c.effect,
      })),
      "facilities.json": hc.snap.facilities.map((f) => ({ ...f, osm: null, ed: null, sources: ["imap"], anythingElse: 1 })),
      "destinations.json": hc.snap.destinations.map((d) => ({ ...d, lowWageJobs: 1, medoidBlock: "x", nameDistM: 3 })),
      "blockgroups.json": [{ geoid: "24510", i: 0, county: "Baltimore city", pop: 1000, hexes: [0, 1], households: 5, areaShareInStudyArea: 0.9, extra: true }],
      "manifest.json": { snapshotId: hc.snap.id, totalBytes: 1, notes: ["x"], osm: { a: 1 } },
    };
    return { hc, reader: harborReader(hc, extras) };
  };

  it("accepts unknown extra fields everywhere and exposes candidate links as links", async () => {
    const { hc, reader } = withExtras();
    const { snapshot } = await loadSnapshot(reader);
    expect(snapshot.candidates.every((c) => c.lens.includes("xharbor"))).toBe(true);
    expect(snapshot.assumptions[0]).toMatchObject({ min: 30, max: 120 });
    expect(snapshot.assumptions[1].value).toBe(true);
    expect(snapshot.blockGroups[0].geoid).toBe("24510");
    const g = snapshot.graph;
    const i = g.linkIndex.get("L-TEMPLINK") as number;
    expect(g.links[i]).toMatchObject({ candidate: true, edges: hc.candEdges });
    expect(g.edgeLink[hc.candEdges[0]]).toBe(i);
    expect(g.meta.links.some((l) => l.id === "L-TEMPLINK")).toBe(false);
  });

  it("still fails loudly, naming the field, on a missing or wrongly typed required field", async () => {
    const hc = buildHarbor();
    const cases: [string, unknown, RegExp][] = [
      ["facilities.json", hc.snap.facilities.map((f, i) => (i === 1 ? without(f, "node") : f)), /facilities\.json[\s\S]*node/],
      ["facilities.json", hc.snap.facilities.map((f, i) => (i === 0 ? { ...f, active: "yes" } : f)), /facilities\.json[\s\S]*active/],
      ["destinations.json", hc.snap.destinations.map((d) => without(d, "jobs")), /destinations\.json[\s\S]*jobs/],
      ["assumptions.json", [{ id: "A-X", label: "x", value: { nested: 1 }, status: "assumption" }], /assumptions\.json[\s\S]*value/],
      ["assumptions.json", [{ id: "A-X", label: "x", value: 1, status: "guess" }], /assumptions\.json[\s\S]*status/],
      ["assumptions.json", [{ id: "A-X", label: "x", value: 1, status: "assumption", min: "low" }], /assumptions\.json[\s\S]*min/],
      ["candidates.json", hc.snap.candidates.map((c) => without(c, "costTier")), /candidates\.json[\s\S]*costTier/],
      ["blockgroups.json", [{ geoid: "1", i: 0, county: "c", hexes: [] }], /blockgroups\.json[\s\S]*pop/],
      ["manifest.json", { pipelineVersion: "1" }, /manifest\.json[\s\S]*snapshotId/],
      ["hexes.meta.json", { count: 3, buffers: {} }, /hexes\.meta\.json[\s\S]*h3/],
      ["graph.meta.json", { ...hc.graphMeta, corridors: [{ id: "C" }] }, /graph\.meta\.json[\s\S]*name/],
      ["graph.meta.json", { ...hc.graphMeta, candidateLinks: [{ id: "L", edges: "none" }] }, /graph\.meta\.json[\s\S]*edges/],
    ];
    for (const [file, value, re] of cases) {
      const p = loadSnapshot(harborReader(hc, { [file]: value }));
      await expect(p, file).rejects.toThrow(ContractError);
      await expect(p, file).rejects.toThrow(re);
    }
  });

  it("a candidate link whose edges are not CANDIDATE-flagged is rejected", async () => {
    const hc = buildHarbor(12, 8, "candidateLinks");
    const bad = { ...hc.graphMeta, candidateLinks: [{ id: "L-BAD", edges: hc.bridgeEdges }] };
    await expect(loadSnapshot(harborReader(hc, { "graph.meta.json": bad }))).rejects.toThrow(/L-BAD.*CANDIDATE/);
  });
});

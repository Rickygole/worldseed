import { describe, expect, it } from "vitest";
import { ContractError, parseGraph } from "../../lib/sim/csr";
import { buildGraph, pack, type EdgeSpec } from "./fixtures";

const CORR = [{ id: "C-A", name: "Corridor A" }];

const tiny: EdgeSpec[] = [
  { from: 0, to: 1, timeS: 10, flags: 1, corridor: 0 },
  { from: 1, to: 2, timeS: 20 },
  { from: 2, to: 0, timeS: 30, cls: 2 },
  { from: 1, to: 0, timeS: 5 },
];

describe("graph.bin parsing", () => {
  it("round-trips typed arrays and CSR through graph.meta.json", () => {
    const { graph } = buildGraph({
      N: 3,
      edges: tiny,
      links: [{ id: "L-A", name: "Link A", edges: [0, 3] }],
      corridors: [{ id: "C-A", name: "Corridor A" }],
    });
    expect(graph.nodeCount).toBe(3);
    expect(graph.edgeCount).toBe(4);
    expect(Array.from(graph.edgeFrom)).toEqual([0, 1, 2, 1]);
    expect(Array.from(graph.edgeTo)).toEqual([1, 2, 0, 0]);
    expect(Array.from(graph.edgeTimeS)).toEqual([10, 20, 30, 5]);
    expect(Array.from(graph.edgeFlags)).toEqual([1, 0, 0, 0]);
    expect(Array.from(graph.edgeCorridor)).toEqual([0, 0xffff, 0xffff, 0xffff]);
    expect(Array.from(graph.fwdOff)).toEqual([0, 1, 3, 4]);
    expect(Array.from(graph.revOff)).toEqual([0, 2, 3, 4]);
    expect(graph.linkIndex.get("L-A")).toBe(0);
    expect(Array.from(graph.edgeLink)).toEqual([0, -1, -1, 0]);
    expect(graph.corridorIndex.get("C-A")).toBe(0);
    expect(graph.flag.CANDIDATE).toBe(16);
  });

  it("views the fetched buffer directly when offsets are aligned (no copy)", () => {
    const { graph, raw } = buildGraph({ N: 3, edges: tiny, corridors: CORR });
    expect(graph.edgeTimeS.buffer).toBe(raw);
  });

  it("copes with an unaligned offset by copying", () => {
    const { meta, raw } = buildGraph({ N: 3, edges: tiny, corridors: CORR });
    // shift everything by 1 byte so f32/u32 buffers are unaligned
    const shifted = new ArrayBuffer(raw.byteLength + 8);
    new Uint8Array(shifted).set(new Uint8Array(raw), 1);
    const m2 = JSON.parse(JSON.stringify(meta));
    for (const b of Object.values(m2.buffers) as { offset: number }[]) b.offset += 1;
    const g = parseGraph(m2, shifted);
    expect(Array.from(g.edgeTimeS)).toEqual([10, 20, 30, 5]);
  });

  it("names the field when the contract is violated", () => {
    const { meta, raw } = buildGraph({ N: 3, edges: tiny, corridors: CORR });
    const missing = JSON.parse(JSON.stringify(meta));
    delete missing.buffers.edgeClass;
    expect(() => parseGraph(missing, raw)).toThrow(/edgeClass/);

    const wrongType = JSON.parse(JSON.stringify(meta));
    wrongType.buffers.edgeTimeS.type = "f64";
    expect(() => parseGraph(wrongType, raw)).toThrow(/edgeTimeS.*f64/);

    const wrongLen = JSON.parse(JSON.stringify(meta));
    wrongLen.buffers.fwdOff.length = 3;
    expect(() => parseGraph(wrongLen, raw)).toThrow(/fwdOff.*length 3/);

    const beyond = JSON.parse(JSON.stringify(meta));
    beyond.buffers.revEdge.offset = raw.byteLength;
    expect(() => parseGraph(beyond, raw)).toThrow(/exceeds file size/);

    const noFlags = JSON.parse(JSON.stringify(meta));
    delete noFlags.flags.CANDIDATE;
    expect(() => parseGraph(noFlags, raw)).toThrow(/CANDIDATE/);

    expect(() => parseGraph({ nodeCount: "x" }, raw)).toThrow(ContractError);
  });

  it("rejects an inconsistent CSR", () => {
    const { meta, raw } = buildGraph({ N: 3, edges: tiny, corridors: CORR });
    const bad = raw.slice(0);
    // corrupt fwdEdge[0] to point at an edge that does not start at node 0
    const at = meta.buffers.fwdEdge.offset;
    new Uint32Array(bad, at, 1)[0] = 1;
    expect(() => parseGraph(meta, bad)).toThrow(/fwd CSR/);
  });

  it("rejects negative or non-finite edge times", () => {
    const { meta, raw } = buildGraph({ N: 3, edges: tiny, corridors: CORR });
    const bad = raw.slice(0);
    new Float32Array(bad, meta.buffers.edgeTimeS.offset, 1)[0] = -1;
    expect(() => parseGraph(meta, bad)).toThrow(/edgeTimeS/);
  });

  it("pack() lays buffers out 8-byte aligned like the pipeline", () => {
    const { buffers } = pack([["a", "u8", [1, 2, 3]], ["b", "f64", [1.5]]]);
    expect(buffers.a.offset).toBe(0);
    expect(buffers.b.offset).toBe(8);
  });
});

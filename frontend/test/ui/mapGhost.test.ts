import { describe, expect, it } from "vitest";
import { fmtAddedShort, ghostLabelText, ghostPeak, nextGhost, type GhostField } from "../../components/map/ghost";

const f = (elev: number[], o: Partial<GhostField> = {}): GhostField => ({
  elev: Float32Array.from(elev),
  minutes: Float32Array.from(elev.map((e) => e / 95)),
  lens: "xharbor",
  worldKey: "base",
  bridgeRemoved: false,
  mutations: 0,
  ...o,
});

describe("the before ghost: when it exists", () => {
  it("scene 1: the bridge coming out makes the previous field the ghost", () => {
    const prev = f([0, 0], { lens: "access" });
    const now = f([300, 50], { lens: "access", worldKey: "removed", bridgeRemoved: true });
    const g = nextGhost(null, prev, now, "crossing");
    expect(g?.scene).toBe("crossing");
    expect(Array.from(g!.elev)).toEqual([0, 0]);
  });

  it("scene 5: an idea going in makes the bridge-removed field the ghost", () => {
    const prev = f([400, 200], { worldKey: "removed", bridgeRemoved: true });
    const now = f([350, 200], { worldKey: "removed+idea", bridgeRemoved: true, mutations: 3 });
    expect(nextGhost(null, prev, now, "fix")?.elev[0]).toBe(400);
  });

  it("never compares two different quantities: a lens change clears it", () => {
    const g = nextGhost(null, f([0]), f([300], { worldKey: "removed", bridgeRemoved: true }), "crossing");
    expect(g).not.toBeNull();
    expect(nextGhost(g, f([300], { worldKey: "removed", bridgeRemoved: true }), f([10], { lens: "ems", worldKey: "removed", bridgeRemoved: true }), "crossing")).toBeNull();
    // A world change that also switched lens is not a before/after either.
    expect(nextGhost(null, f([0], { lens: "xharbor" }), f([300], { lens: "access", worldKey: "removed", bridgeRemoved: true }), "crossing")).toBeNull();
  });

  it("only the scene's own action counts: a deep link's automatic removal in scene 5 makes none", () => {
    expect(nextGhost(null, f([0]), f([300], { worldKey: "removed", bridgeRemoved: true }), "fix")).toBeNull();
    // Undoing an idea is not 'what could help' either.
    expect(nextGhost(null, f([350], { worldKey: "idea", mutations: 3 }), f([400], { worldKey: "removed" }), "fix")).toBeNull();
  });

  it("no ghost outside the two scenes, and none without a previous field", () => {
    for (const scene of ["averages", "held", "freight", "explore", null]) {
      expect(nextGhost(null, f([0]), f([300], { worldKey: "removed", bridgeRemoved: true, mutations: 1 }), scene)).toBeNull();
    }
    expect(nextGhost(null, null, f([300]), "crossing")).toBeNull();
  });

  it("a refresh of the same world keeps the ghost it has", () => {
    const g = nextGhost(null, f([0]), f([300], { worldKey: "removed", bridgeRemoved: true }), "crossing");
    expect(nextGhost(g, f([300], { worldKey: "removed", bridgeRemoved: true }), f([300], { worldKey: "removed", bridgeRemoved: true }), "crossing")).toBe(g);
  });
});

describe("the before ghost: the number on the terrain", () => {
  it("the label goes where the change is largest: the biggest drop, else the biggest rise", () => {
    expect(ghostPeak([500, 500, 0], [480, 380, 300])).toEqual({ index: 1, kind: "drop" });
    expect(ghostPeak([0, 0, 0], [50, 300, 120])).toEqual({ index: 1, kind: "rise" });
    expect(ghostPeak([10, 10], [10, 12]).index).toBe(-1);
    // Never on a hex where nobody lives.
    expect(ghostPeak([0, 0, 0], [50, 300, 120], undefined, (i) => i !== 1)).toEqual({ index: 2, kind: "rise" });
  });

  it("prints honest minutes: one decimal, before and after in plain words, no rounding up of a small change", () => {
    expect(fmtAddedShort(4.92)).toBe("+4.9");
    expect(fmtAddedShort(-0.2)).toBe("+0.0");
    expect(ghostLabelText(4.92, 4.41, "EDGEMERE")).toBe("EDGEMERE  WORST: WAS +4.9, NOW +4.4 MIN");
    expect(ghostLabelText(0, 3.4, null)).toBe("WORST: +3.4 MIN");
    expect(ghostLabelText(0, 3.4, "SPARROWS POINT")).not.toMatch(/→/);
  });
});

import { describe, expect, it } from "vitest";
import { deltaTone, SPARK_POINTS, sparkTail } from "../../lib/ui/ribbon";

describe("ribbon deltas and sparklines", () => {
  it("colors by direction times whether up is good for the metric", () => {
    expect(deltaTone(15000, 0.5)).toBe("worse");
    expect(deltaTone(-5, 0.5)).toBe("better");
    expect(deltaTone(0.2, 0.5)).toBe("flat");
    expect(deltaTone(3, 0.5, true)).toBe("better");
    expect(deltaTone(-3, 0.5, true)).toBe("worse");
    expect(deltaTone(Number.NaN, 0.5)).toBe("flat");
  });
  it("sparklines show the last twelve runs", () => {
    const h = Array.from({ length: 24 }, (_, i) => i);
    expect(SPARK_POINTS).toBe(12);
    expect(sparkTail(h)).toEqual(h.slice(12));
    expect(sparkTail([4, 5])).toEqual([4, 5]);
  });
});

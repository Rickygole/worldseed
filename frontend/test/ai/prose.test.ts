import { describe, expect, it } from "vitest";
import { proseIssues } from "../../lib/agent/prose";

const codes = (t: string, tokens: string[] = []) => proseIssues(t, { allowedTokens: tokens }).map((i) => i.code);

describe("prose guard (rule 5: no numbers in model prose)", () => {
  it("accepts plain prose and ordinal words", () => {
    expect(codes("The first option retimes signals; the second adds a connector.")).toEqual([]);
  });
  it("rejects digits", () => {
    expect(codes("This cuts delay by 12 minutes")).toContain("digits");
    expect(codes("about 3x better")).toContain("digits");
  });
  it("rejects full-width and superscript digits that hide a number", () => {
    expect(codes("cuts delay by １２ minutes")).toContain("digits");
    expect(codes("area is 5²")).toContain("digits");
  });
  it("removes well-formed slot placeholders before checking", () => {
    expect(codes("Worst case changes by {{p90.delta}} and {{finalist.B2.pGoal}}.")).toEqual([]);
  });
  it("rejects malformed or unknown slots so digits cannot hide in them", () => {
    expect(codes("Saves {{12 minutes}} overall")).toContain("bad_slot");
    expect(codes("Saves {{p90.delta.extra}}")).toContain("bad_slot");
    expect(codes("Saves {{ nope }}")).toContain("bad_slot");
    expect(codes("Broken {{p90.delta")).toContain("bad_slot");
  });
  it("allows exact catalog and bundle IDs that contain digits, but nothing else", () => {
    expect(codes("B2 beats B3 on cost", ["B2", "B3"])).toEqual([]);
    expect(codes("B2 beats B3 on cost")).toContain("digits");
    expect(codes("Use IM-I895 here", ["IM-I895"])).toEqual([]);
    expect(codes("Use IM-I8951 here", ["IM-I895"])).toContain("digits");
  });
  it("rejects spelled-out quantities", () => {
    expect(codes("saves twelve minutes")).toContain("number_word");
    expect(codes("a twenty-five percent gain")).toContain("number_word");
    expect(codes("cuts delay by percent")).toContain("number_word");
    expect(codes("one option is cheaper")).toEqual([]);
  });
  it("rejects links, markup and operational-emergency vocabulary", () => {
    expect(codes("see https://example.com")).toContain("link");
    expect(codes("<b>bold</b>")).toContain("link");
    const w = ["dis", "patch"].join("");
    expect(codes(`improves ${w} times`)).toContain("wording");
    expect(codes("this will save lives")).toContain("wording");
  });
});

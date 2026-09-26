import { describe, expect, it } from "vitest";
import { isValidSlot, normalizeProse, proseIssues } from "../../lib/agent/prose";

const codes = (t: string, tokens: string[] = [], owner?: string) =>
  proseIssues(t, { allowedTokens: tokens, slots: owner ? { ownerBundleId: owner } : undefined }).map((i) => i.code);
const clean = (t: string) => expect(proseIssues(t), JSON.stringify(t)).toEqual([]);

describe("prose screen: accepts plain descriptive prose", () => {
  it("accepts mechanism language, ordinal words and hyphenated compounds", () => {
    clean("The first option retimes signals along a corridor; the second adds a temporary connector.");
    clean("This bundle leaves the isolated groups unresolved and depends on a hypothetical link.");
    clean("A worst-case review of the corridor is still needed.");
    clean("One option is a connector, the other retimes signals.");
    clean("Trying signal and link mixes across types.");
  });
  it("removes well-formed baseline slots anywhere", () => {
    expect(codes("The baseline is {{p90.baseline}} and {{pctWithin.baseline}}.")).toEqual([]);
  });
});

describe("prose screen: digits in any script (rule 5)", () => {
  it("rejects ASCII, full-width, superscript, Arabic-Indic, circled and vulgar-fraction digits", () => {
    for (const t of ["This cuts delay by 12 minutes", "about 3x better", "cuts delay by １２ minutes", "area is 5²", "Saves ١٢ minutes", "Saves ⑫ minutes", "Cuts by ½.", "Saves 0xC minutes."]) {
      expect(codes(t), t).toContain("digits");
    }
  });
  it("rejects Aegean and Tamil numerals (category No/Nl)", () => {
    expect(codes("Saves \u{10107}\u{10108} minutes.")).toContain("digits");
    expect(codes("Saves ௰ minutes.")).toContain("digits");
  });
  it("allows exact catalog and minted bundle IDs that contain digits, but nothing else", () => {
    expect(codes("B2 beats B3 on cost", ["B2", "B3"])).not.toContain("digits");
    expect(codes("B2 sits next to B3", ["B2", "B3"])).toEqual([]);
    expect(codes("B2 sits next to B3")).toContain("digits");
    expect(codes("Use IM-I895 here", ["IM-I895"])).toEqual([]);
    expect(codes("Use IM-I8951 here", ["IM-I895"])).toContain("digits");
  });
  it("guard: an allowed id is matched as a whole token, not inside a longer one (word boundary)", () => {
    expect(codes("XB2 wins", ["B2"])).toContain("digits"); // preceded by a letter
    expect(codes("B2X wins", ["B2"])).toContain("digits"); // followed by a letter
    expect(codes("B2_ wins", ["B2"])).toContain("digits"); // followed by an id character
    expect(codes("(B2)", ["B2"])).toContain("charset");
    expect(codes("Compare B2, B3 and B2.", ["B2", "B3"])).toEqual([]);
  });
  it("NFKC folding cannot hide a digit (guard: normalization)", () => {
    expect(normalizeProse("１２")).toBe("12");
    expect(codes("Saves １２")).toContain("digits");
    expect(codes("Saves ②")).toContain("digits");
  });
});

describe("prose screen: number words and numerals (with or without a unit)", () => {
  it("rejects bare number words, dozens, fractions and multipliers", () => {
    for (const t of ["about twelve", "a dozen extra minutes", "twelve.", "Cuts the worst case by twelve.", "Saves twelve fewer minutes of travel.", "Halves the worst case and doubles coverage.", "Saves about a quarter of an hour.", "Nine in ten homes now reach care.", "Coverage rises to ninety pct.", "a twofold gain", "twelve mn saved", "the count is two"]) {
      expect(codes(t), t).toContain("number_word");
    }
  });
  it("rejects number words hidden by whitespace tricks and invisible characters", () => {
    for (const t of ["Cuts the worst case by twelve  minutes.", "Cuts the worst case by twelve\nminutes.", "Cuts the worst case by twelve\tminutes.", "Cuts the worst case by twelve minutes.", "Cuts the worst case by twel​ve minutes.", "Cuts the worst case by twelve‍minutes.", "Cuts the worst case by tw­elve minutes.", "A twelve–minute improvement."]) {
      expect(codes(t), JSON.stringify(t)).toContain("number_word");
    }
  });
  it("rejects number words glued to other letters", () => {
    expect(codes("Saves twelveminutes")).toContain("number_word");
    expect(codes("a hundredfold gain")).toContain("number_word");
  });
  it("rejects common non-English number words and CJK numerals", () => {
    for (const t of ["Gagne douze minutes au pire cas.", "Spart zwolf Minuten.", "Ahorra doce minutos.", "Risparmia dodici minuti.", "节省十二分钟"]) {
      expect(proseIssues(t), t).not.toEqual([]);
    }
    expect(codes("Spart zwölf Minuten.")).toContain("charset");
  });
  it("rejects Roman numerals (ASCII and single-character forms) but not ordinary words", () => {
    expect(codes("Saves XII minutes.")).toContain("number_word");
    expect(codes("Saves xii minutes.")).toContain("number_word");
    expect(codes("Saves Ⅻ minutes.")).toContain("number_word"); // NFKC folds it to XII
    expect(codes("Phase IV results")).toContain("number_word");
    clean("A mix of interventions; the mild option; a civil review; a livid reaction.");
  });
  it("rejects look-alike letters that read as digits", () => {
    expect(codes("Saves lO minutes.")).toContain("number_word");
    expect(codes("Saves Ƽ minutes.")).toContain("charset"); // tone-five is not plain ASCII
  });
  it("rejects HTML entities and markup for fractions", () => {
    expect(codes("Cuts it by &frac12; and &half;.")).toContain("charset");
  });
  it("still allows 'one' as a pronoun, but not where it reads as a quantity", () => {
    clean("The one that leaves some gaps.");
    clean("It is one of the connectors, and only one option retimes signals.");
    expect(codes("one minute saved")).toContain("number_word");
    expect(codes("The worst case is one.")).toContain("number_word");
    expect(codes("It leaves only one.")).toContain("number_word");
    expect(codes("Coverage changes by one.")).toContain("number_word");
  });
});

describe("prose screen: direction and size are the application's job", () => {
  it("rejects comparative and direction words", () => {
    for (const t of ["Reduces the worst case.", "This option is cheaper.", "A faster corridor.", "Improves access.", "It is better than B2.", "Cuts delay a lot.", "More homes reach care.", "Fewer groups are isolated.", "It is the best option.", "Raises the equity gap.", "Halves the worst case."]) {
      expect(proseIssues(t).map((i) => i.code), t).toEqual(expect.arrayContaining([expect.stringMatching(/direction|number_word/)]));
    }
  });
});

describe("prose screen: slots", () => {
  it("rejects malformed or unknown slots so digits cannot hide in them", () => {
    expect(codes("Saves {{12 minutes}} overall")).toContain("bad_slot");
    expect(codes("Saves {{p90.delta.extra}}")).toContain("bad_slot");
    expect(codes("Saves {{ nope }}")).toContain("bad_slot");
    expect(codes("Broken {{p90.delta")).toContain("bad_slot");
  });
  it("finding 6 guard: isValidSlot only accepts minted bundle ids", () => {
    expect(isValidSlot("finalist.B2.p90.delta")).toBe(true);
    expect(isValidSlot("bundle.B12.pGoal")).toBe(true);
    expect(isValidSlot("bundle.GHOST.p90.baseline")).toBe(false);
    expect(isValidSlot("finalist.B13.p90")).toBe(false);
    expect(isValidSlot("p90.delta")).toBe(true);
  });
  it("an item may use only its OWN bundle's figures; another bundle's slot is refused", () => {
    expect(codes("Now {{p90.current}} against {{p90.baseline}}.", [], "B1")).toEqual([]);
    expect(codes("Now {{finalist.B1.p90.current}}.", [], "B1")).toEqual([]);
    expect(codes("Now {{bundle.B2.p90.delta}}.", [], "B1")).toContain("bad_slot");
    expect(codes("Now {{bundle.GHOST.p90.baseline}}.", [], "B1")).toContain("bad_slot");
    expect(codes("Odds {{bundle.NEVER.pGoal}}.", [], "B1")).toContain("bad_slot");
  });
  it("without an owner only baseline figures are allowed (log sentences, hypotheses, tradeoffs)", () => {
    expect(codes("Baseline is {{p90.baseline}}.")).toEqual([]);
    expect(codes("Now {{p90.delta}}.")).toContain("bad_slot");
    expect(codes("Odds {{pGoal}}.")).toContain("bad_slot");
    expect(codes("Cost {{cost}}.")).toContain("bad_slot");
  });
});

describe("prose screen: links, markup and emergency vocabulary", () => {
  it("rejects links, brackets, slashes, at-signs and markup", () => {
    expect(codes("see https://example.com")).toContain("link");
    expect(codes("<b>bold</b>")).toEqual(expect.arrayContaining(["link"]));
    expect(codes("See [here](javascript:alert) or evil.example.com")).toEqual(expect.arrayContaining(["charset", "link"]));
    expect(codes("see [x](//evil)")).toContain("charset");
    expect(codes("mail me at a@b")).toContain("charset");
    expect(codes("visit evil.example.com now")).toContain("link");
    expect(codes("Price $$ tier")).toContain("charset");
  });
  it("rejects operational-emergency vocabulary, including split and look-alike forms", () => {
    const w = ["dis", "patch"].join("");
    expect(codes(`improves ${w} times`)).toContain("wording");
    expect(codes(`Improves ${["dis", "​", "patch"].join("")} of units.`)).toContain("wording");
    expect(codes(`${["Dis", "patch"].join("")} units`)).toContain("wording");
    expect(codes(["A ", "real", "time", " tool"].join(""))).toContain("wording");
    expect(codes(["A ", "real-", "time", " tool"].join(""))).toContain("wording");
    expect(codes(["a ", "triage", " step"].join(""))).toContain("wording");
    expect(codes(["Helps ", "prioritize", " ", "responders", "."].join(""))).toContain("wording");
    expect(codes(["A ", "responder", " tool"].join(""))).toContain("wording");
    expect(codes("This could save a life.")).toContain("wording");
    expect(codes("this will save lives")).toContain("wording");
    expect(codes("lives saved")).toContain("wording");
    expect(codes("a life-saving plan")).toContain("wording");
  });
});

describe("prose screen: allowlist charset", () => {
  it("rejects anything outside letters, spaces and basic punctuation", () => {
    for (const t of ["50% more", "a #tag", "up ~ down", "a*b", "snake_case", "pipe | pipe", "back\\slash", "eq = eq", "été"]) {
      expect(proseIssues(t), t).not.toEqual([]);
    }
    clean("Plain sentence, with a colon: and a semicolon; it’s fine — really.");
  });
});

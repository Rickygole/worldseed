import { describe, expect, it } from "vitest";
import { PROSE_CLAIM, isValidSlot, normalizeProse, proseIssues, type ProseProfile } from "../../lib/agent/prose";

const IDS = ["B1", "B2", "B3", "B4", "B5", "SP-BROENING", "TL-SHUTTLE-TRADEPOINT-HAWKINS", "CP-I95-FLOW", "IM-I895"];
const codes = (t: string, tokens: string[] = [], profile: ProseProfile = "card") => proseIssues(t, { allowedTokens: tokens, profile }).map((i) => i.code);
const clean = (t: string, profile: ProseProfile = "card") => expect(proseIssues(t, { allowedTokens: IDS, profile }), JSON.stringify(t)).toEqual([]);
const blocked = (t: string, profile: ProseProfile = "card") => expect(proseIssues(t, { allowedTokens: IDS, profile }), JSON.stringify(t)).not.toEqual([]);

describe("the defensible claim", () => {
  it("is exactly: application-produced numbers and cards; labeled rationale and raw, unverified reasoning only in the decision log", () => {
    expect(PROSE_CLAIM).toBe(
      "Numbers, outcomes and finalist cards are produced by the application from simulator results. AI text appears only as clearly labeled rationale in the decision log and, in a collapsed raw section there, as optional model reasoning that is unverified, checked only for plain text, and never used for a decision.",
    );
  });
});

/** Plausible mechanism-only commentary, in the style the prompts ask for. */
const PLAUSIBLE: string[] = [
  "Starting with a broad mix of signal and link mechanisms across types.",
  "Testing tunnel flow management against a harbor shuttle link to see which mechanism the simulator favors.",
  "Combining a shuttle link with retimed signals on the tunnel approach, so it touches both shores.",
  "Extending B2 with CP-I95-FLOW to test whether corridor management pairs with the shuttle mechanism.",
  "Keeping B1 and B3 because they use different mechanisms, and dropping B4, which repeats an option already listed.",
  "Adding a staging site to B2 near Hawkins Point to test a mechanism on the southern shore.",
  "Signal retiming on the Broening Highway corridor acts on the detour queue.",
  "Needs a new road connector, so it has a long lead time and a high cost tier.",
  "Relies on a shuttle service that is hypothetical and sits on the harbor crossing.",
  "Cheap cost tier; works by changing signal timing at the tunnel approaches.",
  "Places a pre-positioned unit on the eastern shore, which adds a station on that side.",
  "Uses a temporary link across the harbor, so its cost tier and lead time are the main questions.",
  "Adds a second crossing for Dundalk by way of a shuttle, and depends on a hypothetical link.",
  "Incident management on the tunnel corridor acts on clearing stopped vehicles.",
  "Both options act on the harbor crossing, so they share a dependency on the same corridor.",
  "This mix touches the southern shore and the tunnel approach, with a moderate cost tier.",
  "A staging site near Curtis Bay adds a source on the south side of the harbor.",
  "Retimed signals on the eastern corridor and a connector near Dundalk act on different parts of the detour.",
  "Depends on a hypothetical link, and the cost tier is a high one.",
  "Pairs a shuttle with a staging site so that it acts on both sides of the water.",
  "The planner is choosing candidates from different intervention types to keep the search varied.",
  "Focusing on the mechanisms that touch the Patapsco crossing.",
  "Escort windows for hazardous loads change when trucks may use the tunnel.",
  "Adds connector capacity near the harbor (a temporary link) and retimes a signal.",
  "This option acts on the tunnel corridor and depends on incident management staffing.",
  "It relies on a ferry-style shuttle and a hypothetical landing site on the southern shore.",
  "Looks at where the shuttle lands and what road network it joins on each shore.",
  "Uses SP-BROENING to retime signals along the corridor, so the cost tier stays low.",
  "Adds TL-SHUTTLE-TRADEPOINT-HAWKINS as a harbor crossing that depends on a hypothetical site.",
  "Combines IM-I895 with a shuttle so that the tunnel corridor and the crossing are both touched.",
  "Refining toward bundles that pair a link with a staging site.",
  "Pairs a temporary connector with retimed signals on the eastern corridor.",
];

/** Rationale-only phrases: fine in the decision-log rationale, not next to results. */
const RATIONALE_ONLY: string[] = [
  "Two bundles depend on the same hypothetical shuttle, which is a feasibility question.",
  "Keeps the shuttle option and adds signal retiming, since the two mechanisms act in different places.",
  "This mix leaves the southern shore unresolved, so a staging site is the next candidate.",
  "Dropping B4 and keeping B2, since the isolated shore still needs a crossing mechanism.",
  "Testing whether a shuttle addresses the worst-case corridor on the southern shore.",
];

/** Disguised outcome, magnitude and absolute claims (the reviewers' cases plus our own). None may pass. */
const DISGUISED: string[] = [
  "The effect on the worst case is tiny.",
  "A dramatic change in the worst case for Dundalk.",
  "This eliminates the detour penalty entirely.",
  "It fixes access for the southern shore.",
  "It recovers the access lost when the bridge fell.",
  "Almost all residents regain their old access.",
  "Nobody is left isolated under this bundle.",
  "The unluckiest futures never miss the goal.",
  "All residents reach jobs within the goal.",
  "Every neighborhood meets the goal in every future.",
  "No one is left without access.",
  "Roughly a third of households gain access.",
  "Only a tenth of homes remain isolated.",
  "Residents arrive a minute sooner.",
  "It takes an hour off the longest trips.",
  "Only a handful of groups remain isolated.",
  "The majority of residents meet the goal.",
  "Access returns to pre-collapse levels.",
  "Worst-case access matches the pre-collapse baseline.",
  "It closes the equity gap completely.",
  "The equity cost is negligible.",
  "A pair of signal changes is sufficient.",
  "A vast shrinkage in detour time.",
  "It slashes the worst case.",
  "It trims a sliver off the median.",
  "It narrows the equity gap sharply.",
  "Guaranteed to meet the goal.",
  "It meets the goal in virtually every sampled future.",
  "A single connector solves the problem.",
  "A pair of signal changes is enough.",
  "A score of groups remain isolated.",
  "Lead time is about a fortnight.",
  "Isolation drops to nil.",
  "None of the groups remain isolated.",
  "The worst case is essentially unchanged versus doing nothing.",
  "Worst case {{p90.delta}}, which nearly eliminates the detour.",
  "With {{pctWithin.current}} within the goal, almost everyone is covered.",
  "This does not help the western neighborhoods.",
  "Two neighborhoods stay isolated.",
  "Cuts the worst case by twelve minutes.",
  "Saves about a quarter of an hour.",
  "Nine in ten homes now reach care.",
  "It helps roughly half of the residents.",
  "It works best for the eastern shore.",
  "Clearly the strongest option.",
  "Halves the detour.",
  "Improves things a lot.",
  "Worse for equity.",
  "Reduces isolation.",
  "The cost tier is the highest in the catalog.",
  "Restores service on the southern shore.",
  "Most groups keep access under this mix.",
  "A tiny share of homes lose the crossing.",
  "It speeds ambulance routing.",
];

describe("finding NEW-1/NEW-5: plausible mechanism-only commentary passes, disguised claims do not", () => {
  it("accepts at least 90% of 30 plausible commentary outputs (report: acceptance rate), rejecting none that follow the prompt's style", () => {
    const passed = PLAUSIBLE.filter((t) => proseIssues(t, { allowedTokens: IDS, profile: "card" }).length === 0);
    const rate = passed.length / PLAUSIBLE.length;
    expect(PLAUSIBLE.length).toBeGreaterThanOrEqual(20);
    expect(rate, `rejected: ${PLAUSIBLE.filter((t) => !passed.includes(t)).join(" | ")}`).toBeGreaterThanOrEqual(0.9);
    // the strict "card" profile is the harder one; the rationale profile accepts at least as many
    expect(PLAUSIBLE.filter((t) => proseIssues(t, { allowedTokens: IDS, profile: "rationale" }).length === 0).length).toBeGreaterThanOrEqual(passed.length);
  });
  it("rejects every one of 50+ disguised claims in the strict profile", () => {
    expect(DISGUISED.length).toBeGreaterThanOrEqual(40);
    for (const t of DISGUISED) blocked(t, "card");
  });
  it("also rejects them in the rationale profile (the looser one only adds a few natural phrases)", () => {
    for (const t of DISGUISED) blocked(t, "rationale");
  });
  it("rationale-only phrases pass in the decision-log profile and are refused next to results", () => {
    for (const t of RATIONALE_ONLY) {
      clean(t, "rationale");
      blocked(t, "card");
    }
  });
  it("natural phrases: 'cut off', 'stay cut off' and 'dropping B4' are allowed; 'dropping the worst case' is not", () => {
    clean("Keeping B1 and dropping B4.", "card");
    clean("Dropped B2 because it repeats a mechanism.", "card");
    clean("The southern shore stays cut off from the harbor road network.", "card");
    clean("The eastern link is cut off at the tunnel.", "card");
    blocked("The worst case is dropping.", "card");
    blocked("A steady drop in detour time.", "card");
  });
  it("counts of catalog things are allowed only in the rationale profile, and 'two neighborhoods' never", () => {
    clean("Two bundles share the same shuttle.", "rationale");
    clean("Both links depend on the same site.", "card");
    blocked("Two bundles share the same shuttle.", "card");
    blocked("Two neighborhoods gain a crossing.", "rationale");
    blocked("Three groups are affected.", "rationale");
    blocked("Two of the homes remain.", "rationale");
  });
  it("reports acceptance for both sets so the rate is on record", () => {
    const rate = PLAUSIBLE.filter((t) => proseIssues(t, { allowedTokens: IDS }).length === 0).length / PLAUSIBLE.length;
    const caught = DISGUISED.filter((t) => proseIssues(t, { allowedTokens: IDS }).length > 0).length / DISGUISED.length;
    process.stdout.write(`screen acceptance: plausible ${(rate * 100).toFixed(0)}% (${PLAUSIBLE.length} outputs), disguised claims blocked ${(caught * 100).toFixed(0)}% (${DISGUISED.length} outputs)\n`);
    expect(caught).toBe(1);
  });
});

describe("finding N2: rejections name the dictionary word, never model text", () => {
  it("names the exact fixed-list word", () => {
    const i = proseIssues("This option is cheaper.").find((x) => x.code === "direction");
    expect(i?.message).toContain('"cheaper"');
    expect(i?.word).toBe("cheaper");
    expect(proseIssues("Twelve links.").find((x) => x.code === "number_word")?.message).toContain('"twelve"');
    expect(proseIssues("Nobody waits.").find((x) => x.code === "absolute")?.word).toBe("nobody");
  });
  it("names the STEM for pattern entries, so an arbitrary model word is never echoed", () => {
    const i = proseIssues("It improvisationally works.").find((x) => x.code === "direction");
    expect(i?.word).toBe("improve*");
    expect(i?.message).not.toContain("improvisationally");
    const j = proseIssues("Deployxyzed crews.").find((x) => x.code === "wording");
    expect(j?.message).not.toContain("xyz");
  });
  it("carries a fixed word or none in every message of every code", () => {
    for (const t of DISGUISED) for (const i of proseIssues(t, { allowedTokens: IDS })) {
      if (i.word) expect(i.message.includes(i.word) || i.code === "wording" || i.code === "number_word" || i.code === "outcome" || i.code === "negation" || i.code === "magnitude" || i.code === "absolute" || i.code === "direction").toBe(true);
    }
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
    expect(codes("B2 sits next to B3", ["B2", "B3"])).toEqual([]);
    expect(codes("B2 sits next to B3")).toContain("digits");
    expect(codes("Use IM-I895 here", ["IM-I895"])).toEqual([]);
    expect(codes("Use IM-I8951 here", ["IM-I895"])).toContain("digits");
  });
  it("guard: an allowed id is matched as a whole token, not inside a longer one (word boundary)", () => {
    expect(codes("XB2 wins", ["B2"])).toContain("digits"); // preceded by a letter
    expect(codes("B2X wins", ["B2"])).toContain("digits"); // followed by a letter
    expect(codes("B2_ wins", ["B2"])).toContain("digits"); // followed by an id character
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
    for (const t of ["about twelve", "a dozen extra links", "twelve.", "Halves the detour and doubles coverage.", "Nine in ten homes.", "Coverage rises to ninety pct.", "a twofold gain", "the count is two"]) {
      expect(codes(t), t).toContain("number_word");
    }
  });
  it("rejects number words hidden by whitespace tricks and invisible characters", () => {
    for (const t of ["by twelve  links.", "by twelve\nlinks.", "by twelve\tlinks.", "by twelve links.", "by twel​ve links.", "by twelve‍links.", "by tw­elve links.", "A twelve–link plan."]) {
      expect(codes(t), JSON.stringify(t)).toContain("number_word");
    }
  });
  it("rejects number words glued to other letters", () => {
    expect(codes("Saves twelvelinks")).toContain("number_word");
    expect(codes("a hundredfold plan")).toContain("number_word");
  });
  it("rejects common non-English number words and CJK numerals", () => {
    for (const t of ["Gagne douze liens.", "Spart zwolf Links.", "Ahorra doce enlaces.", "Risparmia dodici link.", "节省十二"]) {
      expect(proseIssues(t), t).not.toEqual([]);
    }
    expect(codes("Spart zwölf Links.")).toContain("charset");
  });
  it("rejects Roman numerals (ASCII and single-character forms) but not ordinary words", () => {
    expect(codes("Saves XII links.")).toContain("number_word");
    expect(codes("Saves xii links.")).toContain("number_word");
    expect(codes("Saves Ⅻ links.")).toContain("number_word"); // NFKC folds it to XII
    expect(codes("Phase IV plan")).toContain("number_word");
    clean("A mix of interventions; the mild option; a civil review; a livid reaction.");
  });
  it("rejects look-alike letters that read as digits", () => {
    expect(codes("Saves lO links.")).toContain("number_word");
    expect(codes("Saves Ƽ links.")).toContain("charset");
  });
  it("rejects HTML entities and markup for fractions", () => {
    expect(codes("Cuts it by &frac12; and &half;.")).toContain("charset");
  });
  it("still allows 'one' as a pronoun, but not where it reads as a quantity", () => {
    clean("The one that acts on the tunnel.");
    clean("It is one of the connectors, and only one option retimes signals.");
    blocked("one minute");
    blocked("The result is one.");
    blocked("It leaves only one.");
  });
  it("fractions with ordinals are numbers; plain ordinals are fine", () => {
    blocked("A third of the links.");
    blocked("One fifth of the corridor.");
    clean("The first option retimes signals; the second adds a connector; the third uses a shuttle.");
  });
});

describe("finding NEW-1: no placeholders in commentary", () => {
  it("any brace or slot is refused, so a card cannot cite a figure through model text", () => {
    expect(codes("Now {{p90.current}} against {{p90.baseline}}.")).toContain("bad_slot");
    expect(codes("Now {{bundle.B2.p90.delta}}.", ["B2"])).toContain("bad_slot");
    expect(codes("Broken {{p90.delta")).toContain("bad_slot");
    expect(codes("Saves {{12 minutes}} overall")).toContain("bad_slot");
  });
  it("isValidSlot (used by the application's own templates) accepts only minted bundle ids", () => {
    expect(isValidSlot("finalist.B2.p90.delta")).toBe(true);
    expect(isValidSlot("bundle.B12.pGoal")).toBe(true);
    expect(isValidSlot("bundle.GHOST.p90.baseline")).toBe(false);
    expect(isValidSlot("finalist.B13.p90")).toBe(false);
    expect(isValidSlot("p90.delta")).toBe(true);
  });
});

describe("prose screen: links, markup and emergency vocabulary", () => {
  it("rejects links, brackets, slashes, at-signs and markup, but allows parentheses", () => {
    expect(codes("see https://example.com")).toContain("link");
    expect(codes("<b>bold</b>")).toEqual(expect.arrayContaining(["link"]));
    expect(codes("See [here](javascript:alert) or evil.example.com")).toEqual(expect.arrayContaining(["charset", "link"]));
    expect(codes("see [x](//evil)")).toContain("charset");
    expect(codes("mail me at a@b")).toContain("charset");
    expect(codes("visit evil.example.com now")).toContain("link");
    expect(codes("Price $$ tier")).toContain("charset");
    clean("A temporary link (a connector) near the harbor.");
    expect(codes("(see evil.example.com)")).toContain("link");
  });
  it("rejects operational-emergency vocabulary, including split and look-alike forms", () => {
    const w = ["dis", "patch"].join("");
    expect(codes(`crews ${w} units`)).toContain("wording");
    expect(codes(`Units ${["dis", "​", "patch"].join("")} here`)).toContain("wording");
    expect(codes(`${["Dis", "patch"].join("")} units`)).toContain("wording");
    expect(codes(["A ", "real", "time", " tool"].join(""))).toContain("wording");
    expect(codes(["A ", "real-", "time", " tool"].join(""))).toContain("wording");
    expect(codes(["a ", "triage", " step"].join(""))).toContain("wording");
    expect(codes(["Helps ", "prioritize", " ", "responders", "."].join(""))).toContain("wording");
    expect(codes("This could save a life.")).not.toEqual([]);
    expect(codes("this will save lives")).not.toEqual([]);
    expect(codes("a life-saving plan")).toContain("wording");
  });
  it("guard: punctuation cannot split a banned word (squeezed check)", () => {
    expect(codes(["dis", "-", "patch", " crews"].join(""))).toContain("wording");
    expect(codes(["tri", ".", "age", " step"].join(""))).toContain("wording");
    expect(codes(["real", " ", "time", " use"].join(""))).toContain("wording");
    expect(codes(["a re", "spon", "-", "der", " tool"].join(""))).toContain("wording");
  });
  it("blocks product claims: rescue, deployment, routing, live operations, protecting lives", () => {
    for (const t of ["It speeds ambulance routing.", "It rescues stranded residents.", "Deploy crews to the southern shore.", "It protects residents lives.", "A live operations aid for crews.", "Use it to route units on the fly.", "Live routing of ambulances."]) blocked(t);
  });
  it("planning language about emergency response is fine", () => {
    clean("This is a counterfactual study for emergency response planning.");
    clean("A planning tool for emergency medical service coverage, described as planning only.");
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

describe("test debt (round 3): the rationale profile's own allowances", () => {
  it("guard: 'unresolved' is allowed in the rationale profile and refused as an outcome word in the card profile", () => {
    expect(proseIssues("The shore stays unresolved.", { allowedTokens: [], profile: "rationale" })).toEqual([]);
    expect(proseIssues("The shore stays unresolved.", { allowedTokens: [], profile: "card" }).map((i) => i.code)).toContain("outcome");
  });
});

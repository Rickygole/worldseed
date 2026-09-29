import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildParseMessages } from "../../lib/server/prompts/parse";
import { buildPlanMessages } from "../../lib/server/prompts/plan";
import { buildCritiqueMessages } from "../../lib/server/prompts/critique";
import { buildExtractMessages } from "../../lib/server/prompts/extract";
import { promptView } from "../../lib/agent/catalog";
import { BASELINE, MISSION, fakeCatalog, row } from "./fixtures";

const root = path.resolve(__dirname, "../..");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(n)) out.push(p);
  }
  return out;
}
const ownFiles = [
  ...walk(path.join(root, "lib/agent")),
  ...walk(path.join(root, "lib/server")),
  ...walk(path.join(root, "app/api")),
  path.join(root, "next.config.ts"),
  path.join(root, "scripts/smoke-token-factory.mjs"),
];
// Product wording: operational-emergency vocabulary is not how this planning tool is described.
// Fragments are joined so the words do not appear as literals in this file.
const PRODUCT_WORDS = new RegExp(
  [
    ["dis", "patch"].join(""),
    ["tri", "age"].join(""),
    ["real[- ]?", "time"].join(""),
    ["prioriti", "[sz]\\w*"].join(""),
    ["respon", "ders?\\b"].join(""),
    ["lives?\\s+", "saved"].join(""),
    ["save[sd]?\\s+(?:a\\s+)?", "li(?:fe|ves)"].join(""),
    ["hazmat[- ]?", "rout", "ing"].join(""),
    // "route guidance" is allowed ONLY in the negated disclaimer ("Simulation, not route guidance", "not route guidance").
    ["(?<!not\\s)(?<!not, )rout(?:e|ing)[- ]", "guid", "ance"].join(""),
    ["traffic[- ]", "manage", "ment"].join(""),
    ["safety[- ]", "critical"].join(""),
    ["compli", "ance[- ]tool"].join(""),
    ["turn[- ]by[- ]", "turn"].join(""),
    // The bare word is ordinary interface vocabulary (keyboard navigation); only the product sense is banned.
    ["\\bnavi", "gation[- ](?:system|app|tool|software|device)"].join(""),
  ].join("|"),
  "i",
);

describe("repo hygiene for the AI layer", () => {
  it("owns a non-trivial set of files", () => {
    expect(ownFiles.length).toBeGreaterThan(30);
  });
  it("never uses the forbidden operational wording in source, comments or identifiers", () => {
    for (const f of ownFiles) expect(readFileSync(f, "utf8"), f).not.toMatch(PRODUCT_WORDS);
  });
  it("finding 12: the same wording check over components/, lib/ui, lib/store.ts, lib/sim, lib/workers and the app shell (other owners' files)", () => {
    // Files owned by the UI and simulator agents are scanned, never edited here. A hit is reported as
    // file:line. A file listed below is a KNOWN hit the owner has been told about; remove the entry
    // when the owner rewords it, so the check covers the file again. Required disclaimer phrases are
    // handled by the pattern itself (the negated "not route guidance" form does not match), not by this list.
    const KNOWN_HITS = new Set(["components/IntroOverlay.tsx", "components/TopBar.tsx", "components/DisclaimerBanner.tsx", "components/AboutDialog.tsx", "lib/workers/pool.ts", "lib/sim/types.ts"]);
    const others = [
      ...walk(path.join(root, "components")),
      ...walk(path.join(root, "lib/ui")),
      ...walk(path.join(root, "lib/sim")),
      ...walk(path.join(root, "lib/workers")),
      path.join(root, "app/page.tsx"),
      path.join(root, "app/layout.tsx"),
      path.join(root, "lib/store.ts"),
    ].filter((f) => existsSync(f));
    const found: string[] = [];
    for (const f of others) {
      const rel = path.relative(root, f);
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (PRODUCT_WORDS.test(line)) found.push(`${rel}:${i + 1}`);
      });
    }
    const unknown = found.filter((h) => !KNOWN_HITS.has(h.replace(/:\d+$/, "")));
    expect(unknown, `wording hits (file:line): ${unknown.join(", ")}`).toEqual([]);
    process.stdout.write(`wording scan: ${others.length} files in components/, lib/ui, lib/sim, lib/workers, app shell and lib/store.ts; known hits ${found.length}: ${found.join(", ") || "none"}\n`);
  });
  it("the wording pattern allows the negated disclaimer and refuses the product phrases, and leaves the bare word navigation alone", () => {
    const phrase = (...p: string[]) => p.join("");
    expect(PRODUCT_WORDS.test("Simulation, not " + phrase("route ", "guid", "ance") + ".")).toBe(false);
    expect(PRODUCT_WORDS.test("This is not " + phrase("route ", "guid", "ance"))).toBe(false);
    for (const t of [phrase("It gives route ", "guid", "ance."), phrase("hazmat ", "rout", "ing"), phrase("traffic ", "manage", "ment"), phrase("safety", "-critical"), phrase("a compli", "ance tool"), phrase("turn-by-", "turn"), phrase("a navi", "gation system")]) expect(PRODUCT_WORDS.test(t), t).toBe(true);
    expect(PRODUCT_WORDS.test("Keyboard navigation moves between panels.")).toBe(false);
  });
  it("never names an assistant vendor or attributes generation", () => {
    const bad = new RegExp(["cla" + "ude", "anthr" + "opic", "co-authored" + "-by"].join("|"), "i");
    for (const f of ownFiles) expect(readFileSync(f, "utf8"), f).not.toMatch(bad);
  });
  it("keeps keys server-side: no NEXT_PUBLIC_ anywhere, and no env reads in browser code", () => {
    for (const f of ownFiles) expect(readFileSync(f, "utf8"), f).not.toContain("NEXT_PUBLIC_");
    for (const f of walk(path.join(root, "lib/agent"))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toContain("process.env");
      expect(src, f).not.toMatch(/from ["']\.\.\/server/);
    }
  });
  it("contains no key-shaped strings", () => {
    for (const f of ownFiles) expect(readFileSync(f, "utf8"), f).not.toMatch(/tvly-[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{20,}/);
  });
});

describe("prompts", () => {
  const catalog = fakeCatalog();
  const rows = [row("B1", ["SP-BROENING"]), row("B2", ["SP-EASTERN"]), row("B3", ["SP-HARBOR"])];
  const schema = { type: "object" };
  const all = () => [
    buildParseMessages(catalog, "reduce access time near Dundalk", schema),
    buildPlanMessages({ req: { missionId: "mission-0001", mission: MISSION, phase: "search", round: 1, bundles: [], evaluations: [], dropped: [], stresses: [] }, action: "propose", eligible: catalog.candidates.map(promptView), rows: [], excluded: new Set(), jsonSchema: schema }),
    buildCritiqueMessages({ req: { missionId: "mission-0001", mission: MISSION, round: 2, evaluations: rows, dropped: [], stresses: [] }, used: catalog.candidates.map(promptView), rows, baseline: BASELINE, jsonSchema: schema }),
    buildExtractMessages([{ url: "https://x.test/1", title: "FAKE", content: "FAKE text" }], schema),
  ];
  it("frame every task as counterfactual planning with a human deciding", () => {
    for (const msgs of all()) {
      const sys = msgs[0].content;
      expect(sys).toContain("counterfactual infrastructure-planning");
      expect(sys).toContain("human planner");
      expect(sys).toMatch(/Never claim/);
    }
  });
  it("use none of the forbidden operational words", () => {
    for (const msgs of all()) for (const m of msgs) expect(m.content).not.toMatch(PRODUCT_WORDS);
  });
  it("tell the model it writes no sentence: it selects a rationale kind, and never describes results (plan and critic prompts)", () => {
    for (const msgs of [all()[1], all()[2]]) {
      expect(msgs[0].content).toContain("you never write a sentence");
      expect(msgs[0].content).toContain("RATIONALE");
      expect(msgs[0].content).toContain("Never describe results or outcomes");
      expect(msgs[0].content).not.toContain("AI commentary");
    }
  });
  it("the parser and critic prompts ask for no free text at all", () => {
    expect(all()[0][0].content).toContain("no free-text fields");
    expect(all()[2][0].content).not.toContain("log_sentence");
  });
  it("the critic prompt offers the closed stress list and the optional reasoning rule, and asks for no numbers in words", () => {
    const sys = all()[2][0].content;
    expect(sys).toContain("STRESS TEST");
    expect(sys).toContain("L-HARBORTUNNEL");
    expect(sys).toContain("time_of_day");
    expect(sys).toContain("Optional reasoning");
    expect(sys).toContain("no digits");
  });
  it("never expose numeric effects or notes from the catalog", () => {
    const text = all().map((m) => m.map((x) => x.content).join("\n")).join("\n");
    expect(text).not.toContain("factor");
    expect(text).not.toContain("corridor_speed");
    expect(text).not.toContain("999");
  });
});

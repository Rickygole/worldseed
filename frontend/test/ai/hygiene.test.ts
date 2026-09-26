import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildParseMessages } from "../../lib/server/prompts/parse";
import { buildPlanMessages } from "../../lib/server/prompts/plan";
import { buildCritiqueMessages } from "../../lib/server/prompts/critique";
import { buildNarrateMessages } from "../../lib/server/prompts/narrate";
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
  [["dis", "patch"].join(""), ["tri", "age"].join(""), ["real[- ]?", "time"].join(""), ["prioriti", "[sz]\\w*"].join(""), ["respon", "ders?\\b"].join(""), ["lives?\\s+", "saved"].join(""), ["save[sd]?\\s+(?:a\\s+)?", "li(?:fe|ves)"].join("")].join("|"),
  "i",
);

describe("repo hygiene for the AI layer", () => {
  it("owns a non-trivial set of files", () => {
    expect(ownFiles.length).toBeGreaterThan(30);
  });
  it("never uses the forbidden operational wording in source, comments or identifiers", () => {
    for (const f of ownFiles) expect(readFileSync(f, "utf8"), f).not.toMatch(PRODUCT_WORDS);
  });
  it("finding 12: the same wording check over components/, lib/sim, lib/workers and the app shell (other owners' files)", () => {
    // Files owned by the UI and simulator agents are scanned, never edited here. A hit is reported by
    // this test; a file listed below is a KNOWN hit the owner has been told about. Remove the entry
    // when the owner rewords it, so the check covers the file again.
    const KNOWN_HITS = new Set(["components/IntroOverlay.tsx", "components/TopBar.tsx", "components/DisclaimerBanner.tsx", "components/AboutDialog.tsx", "lib/workers/pool.ts", "lib/sim/types.ts"]);
    const others = [
      ...walk(path.join(root, "components")),
      ...walk(path.join(root, "lib/sim")),
      ...walk(path.join(root, "lib/workers")),
      path.join(root, "app/page.tsx"),
      path.join(root, "app/layout.tsx"),
      path.join(root, "lib/store.ts"),
    ].filter((f) => existsSync(f));
    const hits = others.filter((f) => PRODUCT_WORDS.test(readFileSync(f, "utf8"))).map((f) => path.relative(root, f));
    expect(hits.filter((h) => !KNOWN_HITS.has(h))).toEqual([]);
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
    buildPlanMessages({ req: { missionId: "mission-0001", mission: MISSION, phase: "search", round: 1, bundles: [], evaluations: [], dropped: [] }, action: "propose", eligible: catalog.candidates.map(promptView), rows: [], excluded: new Set(), jsonSchema: schema }),
    buildCritiqueMessages({ req: { missionId: "mission-0001", mission: MISSION, round: 2, evaluations: rows, dropped: [] }, used: catalog.candidates.map(promptView), rows, baseline: BASELINE, jsonSchema: schema }),
    buildNarrateMessages({ req: { missionId: "mission-0001", mission: MISSION, finalists: rows.map((r) => ({ bundleId: r.bundleId })) as never, evaluations: rows }, used: [], rows, baseline: BASELINE, jsonSchema: schema }),
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
  it("tell the model it writes no sentence: it selects a rationale kind, and never describes results (plan and narrate prompts)", () => {
    for (const msgs of [all()[1], all()[3]]) {
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
  it("the narrator prompt shows no result and no direction, only ids, candidates and cost tiers", () => {
    const user = all()[3][1].content;
    expect(user).not.toMatch(/better|worse|baseline|p90|min\b|%/);
    expect(user).toMatch(/cost/);
  });
  it("never expose numeric effects or notes from the catalog", () => {
    const text = all().map((m) => m.map((x) => x.content).join("\n")).join("\n");
    expect(text).not.toContain("factor");
    expect(text).not.toContain("corridor_speed");
    expect(text).not.toContain("999");
  });
});

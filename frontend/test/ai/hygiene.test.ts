import { readdirSync, readFileSync, statSync } from "node:fs";
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
  path.join(root, "scripts/smoke-token-factory.mjs"),
];

describe("repo hygiene for the AI layer", () => {
  it("owns a non-trivial set of files", () => {
    expect(ownFiles.length).toBeGreaterThan(30);
  });
  it("never uses the forbidden operational wording in source, comments or identifiers", () => {
    const words = new RegExp(["dis" + "patch", "tri" + "age", "real[- ]" + "time"].join("|"), "i");
    for (const f of ownFiles) expect(readFileSync(f, "utf8"), f).not.toMatch(words);
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
    buildNarrateMessages({ req: { missionId: "mission-0001", mission: MISSION, finalists: rows.map((r) => ({ bundleId: r.bundleId, tradeoff: "A tradeoff." })) as never, evaluations: rows }, used: [], rows, baseline: BASELINE, jsonSchema: schema }),
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
    const words = new RegExp(["dis" + "patch", "tri" + "age", "real[- ]" + "time", "prioriti[sz]e responders"].join("|"), "i");
    for (const msgs of all()) for (const m of msgs) expect(m.content).not.toMatch(words);
  });
  it("tell the model never to output numbers and to use placeholders", () => {
    for (const msgs of all().slice(0, 4)) expect(msgs[0].content).toContain("you never output a number");
  });
  it("never expose numeric effects or notes from the catalog", () => {
    const text = all().map((m) => m.map((x) => x.content).join("\n")).join("\n");
    expect(text).not.toContain("factor");
    expect(text).not.toContain("corridor_speed");
    expect(text).not.toContain("999");
  });
});

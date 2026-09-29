import { describe, expect, it } from "vitest";
import { defaultPathSamples, INTRO, STEPS, T } from "../../lib/ui/storyCopy";

/**
 * The story's default path must stay plain (owner rule, 2026-09-26): each sentence at or below a 9th-grade
 * Flesch-Kincaid level and about 18 words, rendered with sample slot values. Syllables are counted with the
 * usual vowel-group heuristic; a number counts as a two-syllable word.
 */
export function syllables(word: string): number {
  if (/\d/.test(word)) return 2;
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function words(text: string): string[] {
  return text.split(/\s+/).filter((t) => /[a-z0-9]/i.test(t));
}

export function fkGrade(text: string): number {
  const ws = words(text);
  const sentences = Math.max(1, (text.match(/[.!?](\s|$)/g) ?? []).length);
  const syl = ws.reduce((a, w) => a + syllables(w), 0);
  return 0.39 * (ws.length / sentences) + 11.8 * (syl / ws.length) - 15.59;
}

// "futures" (plural, the search's term) is jargon; "a better future" is everyday English and a mandated label.
const JARGON = /\b(lens|xharbor|p50|p90|futures|stress test|deterministic|paired|bundles?|corridor factor|GEOID|isochrone|anchors?)\b/i;

describe("story copy readability (default path)", () => {
  const samples = defaultPathSamples();

  it("covers every scene", () => {
    expect(samples.length).toBeGreaterThanOrEqual(20);
  });

  for (const s of samples) {
    it(`${s.id}: grade 9 or below, about 18 words or fewer`, () => {
      const g = fkGrade(s.text);
      const n = words(s.text).length;
      // Printed so the report can quote every grade.
      console.log(`[readability] ${s.id.padEnd(18)} grade ${g.toFixed(1).padStart(5)}  words ${String(n).padStart(2)}  ${s.text}`);
      expect(g, s.text).toBeLessThanOrEqual(9);
      expect(n, s.text).toBeLessThanOrEqual(19);
    });
  }

  it("uses no technical jargon in sentences, number labels, buttons or step labels", () => {
    const labels = [
      ...samples.map((s) => s.text),
      ...Object.values(STEPS),
      INTRO.sentence,
      INTRO.primary,
      T.crossing.unit,
      T.crossing.action,
      T.averages.unit,
      T.averages.action,
      T.held.unit,
      T.held.action,
      T.freight.unit,
      T.freight.action,
      T.fix.readyUnit,
      T.fix.screenUnit,
      T.fix.searchUnit,
      T.fix.recoveredUnit,
      T.fix.actionReady,
      T.fix.actionFinalists,
      T.explore.unit,
      T.explore.action,
    ];
    for (const l of labels) expect(l, l).not.toMatch(JARGON);
  });

  it("the heuristic behaves on known words", () => {
    expect(syllables("bridge")).toBe(1);
    expect(syllables("people")).toBe(2);
    expect(syllables("simulated")).toBeGreaterThanOrEqual(3);
    expect(fkGrade("The cat sat on the mat.")).toBeLessThan(3);
  });
});

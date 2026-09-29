import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pathForScene, routeOf, sceneForSlug, SCENE_SLUG, STORY_SLUGS } from "../../lib/ui/routes";
import { STORY_STEPS } from "../../lib/ui/story";

const app = path.resolve(__dirname, "../../app");

describe("routes", () => {
  it("every story scene has one slug and one URL, and they round-trip", () => {
    expect(Object.keys(SCENE_SLUG).sort()).toEqual([...STORY_STEPS].sort());
    expect(new Set(STORY_SLUGS).size).toBe(STORY_SLUGS.length);
    for (const id of STORY_STEPS) {
      const p = pathForScene(id);
      expect(p).toMatch(/^\/story\/[a-z-]+$/);
      expect(routeOf(p)).toEqual({ kind: "story", scene: id });
      expect(sceneForSlug(p.split("/").pop())).toBe(id);
    }
  });
  it("the scene URLs are short and readable", () => {
    expect(pathForScene("crossing")).toBe("/story/crossing");
    expect(pathForScene("averages")).toBe("/story/local-impact");
    expect(pathForScene("held")).toBe("/story/held");
    expect(pathForScene("freight")).toBe("/story/freight");
    expect(pathForScene("fix")).toBe("/story/help");
    expect(pathForScene("intro")).toBe("/");
  });
  it("classifies every page", () => {
    expect(routeOf("/").kind).toBe("intro");
    expect(routeOf("/explore").kind).toBe("explore");
    expect(routeOf("/explore/").kind).toBe("explore");
    expect(routeOf("/about").kind).toBe("doc");
    expect(routeOf("/methodology").kind).toBe("doc");
    expect(routeOf("/story/nope")).toEqual({ kind: "doc", scene: null });
    expect(routeOf("/_not-found").kind).toBe("doc");
    expect(sceneForSlug(null)).toBeNull();
  });
  it("each route has a page file in app/", () => {
    for (const f of ["page.tsx", "story/[scene]/page.tsx", "explore/page.tsx", "about/page.tsx", "methodology/page.tsx", "not-found.tsx", "layout.tsx"]) {
      expect(existsSync(path.join(app, f)), f).toBe(true);
    }
    // No other top-level page folders than the ones the router knows (api is server-only).
    const dirs = readdirSync(app, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect(dirs).toEqual(["about", "api", "explore", "methodology", "story"]);
  });
});

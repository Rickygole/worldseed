/**
 * The app's pages and their URLs. Pure: no React, no router (tested in test/ui/routes.test.ts).
 *
 *   /                     intro (scene 0)
 *   /story/<slug>         one guided-story scene per URL
 *   /explore              Expert mode (the analyst workspace)
 *   /about, /methodology  documents over the (persistent) map
 */
import type { SceneId } from "./mapDirector";

export type StorySceneId = Exclude<SceneId, "intro">;
export type PageKind = "intro" | "story" | "explore" | "doc";

/** Short, readable slugs; the internal scene ids stay what the map director uses. */
export const SCENE_SLUG: Record<StorySceneId, string> = {
  crossing: "crossing",
  averages: "local-impact",
  held: "held",
  freight: "freight",
  fix: "help",
  explore: "your-turn",
};

const SLUG_SCENE: Record<string, StorySceneId> = Object.fromEntries(Object.entries(SCENE_SLUG).map(([k, v]) => [v, k as StorySceneId]));

export const STORY_SLUGS: string[] = Object.values(SCENE_SLUG);

export const pathForScene = (id: SceneId): string => (id === "intro" ? "/" : `/story/${SCENE_SLUG[id]}`);

export const sceneForSlug = (slug: string | undefined | null): StorySceneId | null => (slug ? (SLUG_SCENE[slug] ?? null) : null);

/**
 * What a pathname shows. An unknown story slug is a 404 page, which the shell treats like a document (the same
 * answer on the server, where the pathname is the prerendered not-found page, and in the browser).
 */
export function routeOf(pathname: string | null | undefined): { kind: PageKind; scene: StorySceneId | null } {
  const p = (pathname ?? "/").replace(/\/+$/, "") || "/";
  if (p === "/") return { kind: "intro", scene: null };
  if (p === "/explore") return { kind: "explore", scene: null };
  if (p === "/about" || p === "/methodology") return { kind: "doc", scene: null };
  const m = /^\/story\/([^/]+)$/.exec(p);
  if (m && sceneForSlug(m[1])) return { kind: "story", scene: sceneForSlug(m[1]) };
  return { kind: "doc", scene: null };
}

// ---- the visitor's place in the story (session storage; the intro redirects there once started) ----

export const INTRO_SEEN_KEY = "worldseed.intro.seen";
const LAST_SCENE_KEY = "worldseed.story.last";

export function markStarted(): void {
  try {
    sessionStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {}
}

export function hasStarted(): boolean {
  try {
    return sessionStorage.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberScene(id: StorySceneId): void {
  try {
    sessionStorage.setItem(LAST_SCENE_KEY, id);
  } catch {}
}

export function lastScene(): StorySceneId | null {
  try {
    const v = sessionStorage.getItem(LAST_SCENE_KEY);
    return v && v in SCENE_SLUG ? (v as StorySceneId) : null;
  } catch {
    return null;
  }
}

/** Where "Back to the story" goes: the last scene visited, or the intro. */
export const storyHome = (): string => {
  const s = lastScene();
  return s ? pathForScene(s) : "/";
};

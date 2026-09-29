/**
 * Pages and modes. The URL decides the mode: /explore is Expert mode, everything else is the story (or a document
 * over the map). Nothing is reset when switching: the world, the search and the lens carry over (STORY.md
 * section 8). Returning to the story re-pins the scene's lens and camera without re-running the simulation.
 */
import { useApp, type UiMode } from "../store";
import { goToScene } from "./mapDirector";
import { navigate } from "./nav";
import { pathForScene, storyHome, type StorySceneId } from "./routes";
import { clearRoute, setHeldEncoding, useStory } from "./story";

const NOTE_KEY = "worldseed.expert.noted";

/** Link targets for the mode switch. */
export async function setUiMode(mode: UiMode): Promise<void> {
  navigate(mode === "expert" ? "/explore" : storyHome());
}

export function toggleUiMode(): Promise<void> {
  return setUiMode(useApp.getState().mode === "story" ? "expert" : "story");
}

/** Navigate to a story scene (the scene page then enters it). */
export function goToStory(id: StorySceneId | "intro"): void {
  navigate(pathForScene(id));
}

/** Called by the /explore page when it mounts: map-only state for the free workspace. */
export function enterExpert(): void {
  const app = useApp.getState();
  if (app.mode !== "expert") useStory.setState({ expertFromStory: app.scene !== "intro" });
  clearRoute();
  void setHeldEncoding(false);
  app.setMode("expert");
  void goToScene("explore");
}

/** Story and document pages. */
export function enterStoryMode(): void {
  const app = useApp.getState();
  if (app.mode !== "story") app.setMode("story");
}

/** The one-time "Everything from the story is here" note in Expert mode. */
export function expertNoteSeen(): boolean {
  try {
    return localStorage.getItem(NOTE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markExpertNoteSeen(): void {
  try {
    localStorage.setItem(NOTE_KEY, "1");
  } catch {}
}

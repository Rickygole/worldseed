/**
 * Switching between the guided story and Expert mode. Nothing is reset: the world, the search and the lens
 * carry over (STORY.md section 8). Returning to the story re-pins the scene's lens and camera without
 * re-running the simulation.
 */
import { useApp, type UiMode } from "../store";
import { goToScene } from "./mapDirector";
import { clearRoute, goScene, setHeldEncoding, useStory } from "./story";

const NOTE_KEY = "worldseed.expert.noted";

export async function setUiMode(mode: UiMode): Promise<void> {
  const app = useApp.getState();
  if (app.mode === mode) return;
  if (mode === "expert") {
    clearRoute();
    void setHeldEncoding(false);
    useStory.setState({ expertFromStory: true });
    app.setMode("expert");
    void goToScene("explore");
    return;
  }
  app.setMode("story");
  await goScene(app.scene === "intro" ? "crossing" : app.scene, { auto: false });
}

export function toggleUiMode(): Promise<void> {
  return setUiMode(useApp.getState().mode === "story" ? "expert" : "story");
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

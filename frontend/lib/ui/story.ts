/**
 * Story orchestration: which world, lens and camera each scene needs, and the scene actions.
 *
 * The map director (lib/ui/mapDirector.ts) owns the camera and map-only layers; this module owns the store:
 * it removes the bridge, sets the lens, runs the search and applies options through the same store actions
 * Expert mode uses. Every scene can be entered from any other (arrow keys, the story bar, a URL), so each
 * one first makes sure the world on screen is the world it describes.
 *
 * Two scenes reveal on their action (STORY.md): "Show the peninsula" and "Show both shores" switch the lens
 * and fly the camera. Until then the map stays on the previous view, so the number lands before the map moves.
 */
import { create } from "zustand";
import { isBridgeRemoved, simInfo, useApp } from "../store";
import type { LensId } from "../sim/contract";
import type { Scenario, SimOutput } from "../sim/types";
import { goToScene, setFreightTripHighlight, type SceneId } from "./mapDirector";
import { getMachine, useSearch } from "./search";
import { withBundle } from "./agentBridge";
import { isBaseline, type StoryFacts } from "./storyFigures";
import { budgetMinutes, loadAssumptions, loadAux, loadFacilities, shoresWithStations, stationCounts } from "./snapshotAux";
import { STEPS } from "./storyCopy";
import { navigate } from "./nav";
import { pathForScene, rememberScene } from "./routes";
import { emsShowsChange, setEmsChangeBase } from "./lenses";

export type StoryScene = Exclude<SceneId, "intro">;
export const STORY_STEPS: StoryScene[] = ["crossing", "averages", "held", "freight", "fix", "explore"];

/** The lens each scene shows once its map view is on. The crossing uses regional access: the same scale as cross-harbor, so it looks as small as it is. */
const SCENE_LENS: Partial<Record<SceneId, LensId>> = { crossing: "access", averages: "xharbor", held: "ems", freight: "xharbor", fix: "xharbor" };
/**
 * Scenes whose map move waits for the scene's action. "averages" keeps the previous (regional) view until
 * "Show me where", so the number lands on the average before the map shows the local story. "held" switches to
 * the station-time view at once (the map must agree with "did not change") and pulls the camera back on its action.
 */
const REVEAL_ON_ACTION = new Set<SceneId>(["averages", "held"]);
const LENS_ON_ENTER = new Set<SceneId>(["held"]);

const BRIDGE_ONLY: Scenario = { removedLinks: ["key_bridge"] };

/** The story's mission: the canonical cross-harbor goal (the same one the guided tour used). */
export const STORY_MISSION = { lens: "access" as const, metric: "p90" as const, targetDelta: 60, maxCostTier: "$$" as const };
export const STORY_GOAL_TEXT = "Keep the slow end of cross-harbor trips within one minute of before the collapse, options up to $$";

interface StoryState {
  /** The Key Bridge-removed world without options (the "down from" count after an option). */
  bridgeOnly: SimOutput | null;
  /** The top finalist's world (free-flow, cross-harbor lens), for the recovery before and after apply. */
  topWorld: { bundleId: string; out: SimOutput } | null;
  /** The world after the story applied an option, so the scene can be revisited. */
  appliedScenario: Scenario | null;
  /** The freight trip whose routes are drawn in the hazmat scene. */
  routeTrip: string | null;
  /** Scenes whose map reveal has been done. */
  revealed: ReadonlySet<SceneId>;
  /** A scene change is still settling its world (the card shows skeletons, never stale numbers). */
  settling: boolean;
  /** The last story search was stopped before finalists (futures done when stopped). */
  stoppedAt: number | null;
  facts: StoryFacts;
  keysOpen: boolean;
  /** Expert mode was opened from the story (shows the one-time "Nothing was reset" note). */
  expertFromStory: boolean;
  /** A short note after a deep link had to rebuild or redirect ("Continuing from the start"). */
  routeNote: string | null;
}

export const useStory = create<StoryState>(() => ({
  bridgeOnly: null,
  topWorld: null,
  appliedScenario: null,
  routeTrip: null,
  revealed: new Set(),
  settling: false,
  stoppedAt: null,
  facts: { shoresWithStations: null, fireStations: null, ambulanceStations: null, anchorCount: null, budgetMin: null },
  keysOpen: false,
  expertFromStory: false,
  routeNote: null,
}));

export const stepIndex = (id: SceneId): number | null => {
  const i = STORY_STEPS.indexOf(id as StoryScene);
  return i < 0 ? null : i;
};

export const stepLabel = (id: SceneId | null): string | null => (id && id !== "intro" ? STEPS[id] : null);

let enterSeq = 0;

/**
 * Scenes 2 to 5 describe a world without the Key Bridge link. Walking forward from the pre-collapse world
 * removes it (the story's own step); any other world is left as the user made it, and the copy switches to
 * its "in this scenario" templates (STORY.md section 11). A restored link shows the gate instead.
 */
async function ensureWorld(id: SceneId, auto: boolean): Promise<void> {
  const app = useApp.getState();
  if (app.status !== "ready") return;
  const needsRemoval = id === "averages" || id === "held" || id === "freight" || id === "fix";
  if (needsRemoval && auto && isBaseline(app.scenario)) await app.removeBridge();
  if (id === "fix") void loadBridgeOnly();
}

async function loadBridgeOnly(): Promise<void> {
  if (useStory.getState().bridgeOnly) return;
  try {
    const out = await useApp.getState().peek(BRIDGE_ONLY, "xharbor");
    useStory.setState({ bridgeOnly: out });
  } catch {
    /* the sentence then waits (never a stale number) */
  }
}

/**
 * "What held" draws the change in station time (flat when nothing changed); every other scene and Expert mode
 * draw absolute station times. The baseline EMS field is a cached run.
 */
export async function setHeldEncoding(on: boolean): Promise<void> {
  const app = useApp.getState();
  if (on === emsShowsChange()) return;
  if (!on) {
    setEmsChangeBase(null);
    if (app.lens === "ems") app.refreshView();
    return;
  }
  try {
    const base = await app.peek({ removedLinks: [] }, "ems");
    setEmsChangeBase(base.minutes);
    if (useApp.getState().lens === "ems") useApp.getState().refreshView();
  } catch {
    setEmsChangeBase(null);
  }
}

/** The scene's map view: camera and map-only layers (map director) and the lens (store). */
async function setSceneLens(id: SceneId): Promise<void> {
  if (id === "held") await setHeldEncoding(true);
  else await setHeldEncoding(false);
  const lens = SCENE_LENS[id];
  if (lens && useApp.getState().lens !== lens) await useApp.getState().setLens(lens);
}

async function showMap(id: SceneId, opts: { instant?: boolean } = {}): Promise<void> {
  void goToScene(id, opts);
  await setSceneLens(id);
}

/** Go to a scene: the card updates at once; the world is made right; the map moves unless the scene reveals on its action. */
export async function goScene(id: SceneId, opts: { instant?: boolean; auto?: boolean } = {}): Promise<void> {
  const seq = ++enterSeq;
  const app = useApp.getState();
  const prev = app.scene;
  app.setScene(id);
  if (id !== "intro") rememberScene(id);
  if (prev === "freight" && id !== "freight") clearRoute();
  const deferMap = REVEAL_ON_ACTION.has(id) && !useStory.getState().revealed.has(id);
  useStory.setState({ settling: true });
  try {
    if (!deferMap) await showMap(id, opts);
    else if (LENS_ON_ENTER.has(id)) await setSceneLens(id);
    else await setHeldEncoding(false);
    if (seq !== enterSeq) return;
    await ensureWorld(id, opts.auto ?? true);
  } finally {
    if (seq === enterSeq) useStory.setState({ settling: false });
  }
}

/**
 * A deep link or a refresh lands on a scene before the snapshot has loaded: once the world is ready, make it
 * the world the scene describes (idempotent; the camera does not fly again).
 */
export async function ensureSceneWorld(id: SceneId): Promise<void> {
  if (useApp.getState().scene !== id) return;
  useStory.setState({ settling: true });
  try {
    const deferMap = REVEAL_ON_ACTION.has(id) && !useStory.getState().revealed.has(id);
    if (!deferMap || LENS_ON_ENTER.has(id)) await setSceneLens(id);
    await ensureWorld(id, true);
  } finally {
    useStory.setState({ settling: false });
  }
}

/** The action of a reveal scene: fly and switch the lens. */
export async function revealScene(): Promise<void> {
  const id = useApp.getState().scene;
  const revealed = new Set(useStory.getState().revealed);
  revealed.add(id);
  useStory.setState({ revealed });
  await showMap(id);
}

export function nextScene(): SceneId | null {
  const cur = useApp.getState().scene;
  if (cur === "intro") return "crossing";
  const i = stepIndex(cur);
  return i === null || i >= STORY_STEPS.length - 1 ? null : STORY_STEPS[i + 1];
}

export function prevScene(): SceneId | null {
  const cur = useApp.getState().scene;
  const i = stepIndex(cur);
  if (i === null) return null;
  return i === 0 ? "intro" : STORY_STEPS[i - 1];
}

// ---------------------------------------------------------------------------------------------- facts

let factsPromise: Promise<void> | null = null;

/** Accessors the copy needs beyond a simulator run: stations per shore, anchors, the time budget. */
export function loadFacts(): Promise<void> {
  factsPromise ??= (async () => {
    const [aux, facilities, assumptions] = await Promise.all([loadAux(), loadFacilities(), loadAssumptions()]);
    const counts = stationCounts(facilities);
    const trips = simInfo()?.trips;
    const anchors = trips ? new Set(trips.trips.filter((t) => t.kind === "cross_harbor").flatMap((t) => [t.origin, t.destination])).size : null;
    useStory.setState({
      facts: {
        shoresWithStations: shoresWithStations(aux.hexes, facilities),
        fireStations: counts.fire,
        ambulanceStations: counts.ambulance,
        anchorCount: anchors,
        budgetMin: budgetMinutes(assumptions),
      },
    });
  })().catch(() => {
    factsPromise = null;
  });
  return factsPromise;
}

// ---------------------------------------------------------------------------------------------- actions

export async function removeBridgeInStory(): Promise<void> {
  const app = useApp.getState();
  if (!isBridgeRemoved(app)) await app.removeBridge();
}

/** Show one freight trip's car and hazmat routes on the map: the cross-harbor trip with the longest hazmat detour. */
export async function showRoute(): Promise<void> {
  const app = useApp.getState();
  const cross = (app.trips?.trips ?? []).filter((t) => t.kind === "cross_harbor");
  let best: { id: string; added: number } | null = null;
  for (const t of cross) {
    const a = t.classes.hazmat_truck?.addedMinutes;
    if (typeof a === "number" && (!best || a > best.added)) best = { id: t.id, added: a };
  }
  if (!best) return;
  useStory.setState({ routeTrip: best.id });
  setFreightTripHighlight(best.id);
  await app.selectTrip(best.id);
}

export function clearRoute(): void {
  if (!useStory.getState().routeTrip) return;
  useStory.setState({ routeTrip: null });
  setFreightTripHighlight(null);
  void useApp.getState().selectTrip(null);
}

/**
 * Run the story's search. With the AI planner available, the goal text goes through the parser and the
 * planner (the goal is then pinned to the story mission before it is confirmed); otherwise, or if parsing
 * fails, the same mission runs as the deterministic search (no AI). The button press is the confirmation.
 */
export async function runStorySearch(): Promise<void> {
  const s = useSearch.getState();
  if (!getMachine()) await s.boot();
  const phase = useSearch.getState().m?.phase ?? "idle";
  if (phase !== "idle") useSearch.getState().resetSearch();
  useStory.setState({ appliedScenario: null, topWorld: null, stoppedAt: null });
  if (useSearch.getState().health.status === "available") {
    try {
      await useSearch.getState().find(STORY_GOAL_TEXT);
      if (getMachine()?.getState().phase === "confirmGoal") {
        useSearch.getState().setDraft(STORY_MISSION);
        await useSearch.getState().confirmAndRun();
        return;
      }
    } catch {
      /* fall through to the deterministic search */
    }
    if ((getMachine()?.getState().phase ?? "idle") !== "idle") useSearch.getState().resetSearch();
  }
  useSearch.getState().setDraft(STORY_MISSION);
  useSearch.setState({ stage: "confirm" });
  await useSearch.getState().confirmAndRun();
}

export function stopStorySearch(): void {
  useStory.setState({ stoppedAt: useSearch.getState().futures.done });
  useSearch.getState().cancel();
}

/** Opens the explicit apply confirmation for the top finalist. Nothing changes before "Apply in simulation" there. */
export function askApplyTop(): void {
  const f = useSearch.getState().m?.finalists[0];
  if (f) useSearch.getState().askApply(f.bundleId);
}

/** Replay: the pre-collapse world, no search, back to the first scene. */
export async function replayStory(): Promise<void> {
  clearRoute();
  useSearch.getState().resetSearch();
  useStory.setState({ appliedScenario: null, topWorld: null, revealed: new Set(), stoppedAt: null });
  await useApp.getState().resetWorld();
  navigate(pathForScene("crossing"));
}

// ---------------------------------------------------------------------------------------------- subscriptions

let lastPhase: string | undefined;
let topKey = "";
useSearch.subscribe((s) => {
  const phase = s.m?.phase;
  // Remember the world an option was applied in, so the fix scene can be revisited after going back.
  if (phase !== lastPhase) {
    lastPhase = phase;
    if (phase === "applied") useStory.setState({ appliedScenario: useApp.getState().scenario });
  }
  // The top finalist's free-flow world, for the recovery shown before anything is applied.
  const top = phase === "finalists" ? s.m?.finalists[0] : undefined;
  const key = top && s.base ? `${s.base.key}|${top.bundleId}` : "";
  if (key && key !== topKey) {
    topKey = key;
    const scenario = withBundle(s.base!.scenario, top!.bundleId, top!.candidateIds, "user", s.catalog);
    void useApp
      .getState()
      .peek(scenario, "xharbor")
      .then((out) => {
        if (topKey === key) useStory.setState({ topWorld: { bundleId: top!.bundleId, out } });
      })
      .catch(() => {});
  }
});

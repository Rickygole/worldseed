/**
 * Regression test for a red-team finding: Expert mode's crossing picker can close the Harbor Tunnel or Fort
 * McHenry Tunnel (lib/store.ts toggleCrossing), and "Back to the story" (lib/ui/modes.ts) carries the world
 * over unchanged. The guided story only ever models the Key Bridge removed - every scene's number and copy
 * assumes that single world - so a leftover tunnel closure must never reach a scene: it used to leak straight
 * through (scene 1 showed the tunnel's regional-delay number as the Key Bridge's own; scenes 2-3's "Remove"
 * action then added the bridge closure on top instead of replacing the tunnel, doubling the affected count).
 * This exercises the real store and the real story orchestration (goScene/ensureWorld), not a mock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../../lib/store";
import { goScene, useStory, watchStoryWorld } from "../../lib/ui/story";
import { closedCrossingIds } from "../../lib/ui/crossings";
import type { MutationRecord } from "../../lib/sim";
import { SKIP_REASON, SNAPSHOT_DIR, snapshotExists } from "../sim/snapshotPath";
import { fsReader } from "../../lib/sim/node";
import { SnapshotMissingError } from "../../lib/sim/snapshot";

afterEach(() => vi.unstubAllGlobals());

function stubSnapshotFetch(): void {
  const read = fsReader(SNAPSHOT_DIR);
  vi.stubGlobal("fetch", async (url: string) => {
    try {
      const buf = await read(url.replace("/snapshot/", ""));
      return new Response(buf, { status: 200, headers: { "content-type": url.endsWith(".json") ? "application/json" : "application/octet-stream" } });
    } catch (e) {
      if (e instanceof SnapshotMissingError) return new Response("nf", { status: 404 });
      throw e;
    }
  });
}

async function ready(): Promise<void> {
  if (useApp.getState().status === "ready") return;
  stubSnapshotFetch();
  await useApp.getState().init();
  expect(useApp.getState().status).toBe("ready");
}

describe.skipIf(!snapshotExists)(`Expert-mode crossing closures never carry into the story${snapshotExists ? "" : ` [SKIPPED: ${SKIP_REASON}]`}`, () => {
  it("closing the Harbor Tunnel in Expert mode, then entering scene 1, resets to the Key-Bridge-only world (not baseline-with-tunnel)", async () => {
    await ready();
    await useApp.getState().resetWorld();

    // Expert mode: close the Harbor Tunnel (the crossing picker).
    await useApp.getState().toggleCrossing("harbor_tunnel");
    expect(useApp.getState().scenario.removedLinks).toEqual(["harbor_tunnel"]);

    // "Back to the story": land on scene 1. Nothing in modes.ts resets the world on its own; goScene must.
    await goScene("crossing");
    expect(useApp.getState().scenario.removedLinks).toEqual([]);
    expect(useApp.getState().scenario.mutations ?? []).toEqual([]);
  });

  it("closing the Fort McHenry Tunnel, then entering scene 2 ('averages', which needs the bridge removed), lands on the Key-Bridge-only world, not bridge+tunnel", async () => {
    await ready();
    await useApp.getState().resetWorld();

    await useApp.getState().toggleCrossing("fort_mchenry");
    expect(useApp.getState().scenario.removedLinks).toEqual(["fort_mchenry"]);

    await goScene("averages");
    // The tunnel closure must be gone, and the Key Bridge must be the only removed link - never both at once
    // (the old bug: the scene's "Remove" action added the bridge on top of the tunnel instead of replacing it).
    expect(useApp.getState().scenario.removedLinks).toEqual(["key_bridge"]);
  });

  it("closing both tunnels and applying the bridge from Cmd-K, then entering the story, still lands on Key-Bridge-only", async () => {
    await ready();
    await useApp.getState().resetWorld();

    await useApp.getState().toggleCrossing("harbor_tunnel");
    await useApp.getState().toggleCrossing("fort_mchenry");
    await useApp.getState().removeBridge();
    expect(new Set(useApp.getState().scenario.removedLinks)).toEqual(new Set(["harbor_tunnel", "fort_mchenry", "key_bridge"]));

    await goScene("held");
    expect(useApp.getState().scenario.removedLinks).toEqual(["key_bridge"]);

    await useApp.getState().resetWorld();
  });

  // The same bug class, found again via a bypass: closedCrossingIds only recognizes the three named
  // crossings, so a closure that reaches the world a different way (a road-level close_edges mutation,
  // or a change made without navigating) used to leak straight through. hasOutsideClosures and the
  // reactive guard (watchStoryWorld) must catch these too.
  it("a road-level close_edges mutation (Cmd-K's 'close i 895', or a confirmed Tavily closure) is not one of the three named crossings, but still resets on scene entry", async () => {
    await ready();
    await useApp.getState().resetWorld();

    const roadClosure: MutationRecord = { id: "user-close-test-road", m: { kind: "close_edges", edges: [0, 1, 2], label: "Close I-895 (test)" }, origin: "user", label: "Close I-895 (test)", confirmedAt: new Date().toISOString() };
    await useApp.getState().applyScenario({ removedLinks: [], mutations: [roadClosure] });
    expect(useApp.getState().scenario.mutations).toEqual([roadClosure]);
    // The old, narrower check (closedCrossingIds: removedLinks or a close_link mutation for one of the
    // three named crossings) sees nothing closed here - exactly the hole the bypass used.
    expect(closedCrossingIds(useApp.getState().scenario).size).toBe(0);

    await goScene("averages");
    expect(useApp.getState().scenario.removedLinks).toEqual(["key_bridge"]);
    expect(useApp.getState().scenario.mutations ?? []).toEqual([]);
  });

  it("closing a crossing while already on a story scene resets live (no navigation needed)", async () => {
    await ready();
    await useApp.getState().resetWorld();
    await goScene("averages"); // a clean, Key-Bridge-only world
    expect(useApp.getState().scenario.removedLinks).toEqual(["key_bridge"]);

    // As if StoryPage/AppShell were mounted on a story route: the guard is live without any goScene call.
    const unsub = watchStoryWorld(() => true);
    try {
      await useApp.getState().toggleCrossing("harbor_tunnel");
      expect(new Set(useApp.getState().scenario.removedLinks)).toEqual(new Set(["key_bridge", "harbor_tunnel"]));
      // The subscription's reset is asynchronous (it waits out `busy` and runs resetWorld); give it a moment.
      await vi.waitFor(() => expect(useApp.getState().scenario.removedLinks).toEqual(["key_bridge"]));
      expect(useApp.getState().scenario.mutations ?? []).toEqual([]);
    } finally {
      unsub();
      await useApp.getState().resetWorld();
    }
  });

  it("a crossing-picker click still in flight when entering the story does not race the reset (ensureWorld waits out `busy`)", async () => {
    await ready();
    await useApp.getState().resetWorld();

    // Fire the toggle but do not await it yet: goScene must not read the pre-toggle scenario.
    const toggling = useApp.getState().toggleCrossing("harbor_tunnel");
    expect(useApp.getState().busy).toBe(true); // the toggle has already landed synchronously up to its first await

    await goScene("crossing");
    await toggling;

    expect(useApp.getState().scenario.removedLinks).toEqual([]);
    expect(useApp.getState().scenario.mutations ?? []).toEqual([]);
  });
});

/**
 * Regression test for the red-team recheck's follow-up finding: the fix above (hasOutsideClosures) accepted
 * ANY `apply_candidate` mutation as "the story's own", not just the one the story's own search flow actually
 * applied (useStory's `appliedScenario`). That let two other candidate-apply paths silently change a story
 * scene's headline number without ever being flagged as an outside closure: Expert mode's finalist-apply
 * picker (lib/ui/search.ts `onApply`), and FreightPanel's own hazmat-escort apply action (components/
 * FreightPanel.tsx). Both go through plain `applyScenario` with an `apply_candidate` mutation, same as the
 * story's own candidate apply - so only comparing it against the one recorded `appliedScenario` tells them
 * apart. The legitimate case (the story's own scene-5 apply surviving a later scene revisit) must still work.
 */
describe.skipIf(!snapshotExists)(`A candidate-apply outside the story's own recorded one is never mistaken for it${snapshotExists ? "" : ` [SKIPPED: ${SKIP_REASON}]`}`, () => {
  afterEach(() => useStory.setState({ appliedScenario: null }));

  const finalist = (id: string, candidateId: string): MutationRecord => ({
    id,
    m: { kind: "apply_candidate", candidateId },
    origin: "user",
    label: `Hypothetical option ${candidateId}`,
    confirmedAt: new Date().toISOString(),
  });

  it("applying an Expert-mode search finalist (e.g. CP-HARBOR-TUNNEL-APPROACHES), then entering the story, resets to the Key-Bridge-only world", async () => {
    await ready();
    await useApp.getState().resetWorld();
    await goScene("averages"); // a clean, Key-Bridge-only world (scene 2's own baseline)
    expect(useApp.getState().scenario.removedLinks).toEqual(["key_bridge"]);

    // Expert mode: a finalist from the 16-candidate search is applied directly (the same shape `onApply` in
    // lib/ui/search.ts produces), with nothing recorded in useStory's appliedScenario.
    const mut = finalist("option-B1-CP-HARBOR-TUNNEL-APPROACHES", "CP-HARBOR-TUNNEL-APPROACHES");
    await useApp.getState().applyScenario({ removedLinks: ["key_bridge"], mutations: [mut] });
    expect(useApp.getState().scenario.mutations).toEqual([mut]);
    expect(useStory.getState().appliedScenario).toBeNull();

    // Back to the story: scene 2's headline number must not silently reflect this candidate.
    await goScene("held");
    expect(useApp.getState().scenario.removedLinks).toEqual(["key_bridge"]);
    expect(useApp.getState().scenario.mutations ?? []).toEqual([]);

    await useApp.getState().resetWorld();
  });

  it("applying a FreightPanel hazmat-escort candidate, then entering the story, resets to the Key-Bridge-only world", async () => {
    await ready();
    await useApp.getState().resetWorld();
    await goScene("freight"); // bridge removed (scene 4's own world)
    expect(useApp.getState().scenario.removedLinks).toEqual(["key_bridge"]);

    // FreightPanel's own Apply action (EscortOptions in components/FreightPanel.tsx) applies one hazmat
    // escort option directly; it never touches useStory's appliedScenario.
    const mut = finalist("option-HW-HW-HARBOR-TUNNEL-ESCORT", "HW-HARBOR-TUNNEL-ESCORT");
    await useApp.getState().applyScenario({ removedLinks: ["key_bridge"], mutations: [mut] });
    expect(useApp.getState().scenario.mutations).toEqual([mut]);

    await goScene("fix");
    expect(useApp.getState().scenario.removedLinks).toEqual(["key_bridge"]);
    expect(useApp.getState().scenario.mutations ?? []).toEqual([]);

    await useApp.getState().resetWorld();
  });

  it("the story's own candidate-apply (scene 5's Apply) is NOT reset when a later scene is entered", async () => {
    await ready();
    await useApp.getState().resetWorld();
    await goScene("fix");
    expect(useApp.getState().scenario.removedLinks).toEqual(["key_bridge"]);

    // The story's own apply: a candidate applied through the normal store path, with useStory's
    // appliedScenario recorded to exactly the resulting scenario - the same thing the search subscription at
    // the bottom of lib/ui/story.ts does the moment its own search flow reaches "applied".
    const mut = finalist("option-B1-CP-HARBOR-TUNNEL-APPROACHES", "CP-HARBOR-TUNNEL-APPROACHES");
    await useApp.getState().applyScenario({ removedLinks: ["key_bridge"], mutations: [mut] });
    useStory.setState({ appliedScenario: useApp.getState().scenario });

    // Revisiting a later scene must not undo the story's own applied idea.
    await goScene("explore");
    expect(useApp.getState().scenario.removedLinks).toEqual(["key_bridge"]);
    expect(useApp.getState().scenario.mutations).toEqual([mut]);

    // And back on "fix" itself, where the applied idea is shown.
    await goScene("fix");
    expect(useApp.getState().scenario.removedLinks).toEqual(["key_bridge"]);
    expect(useApp.getState().scenario.mutations).toEqual([mut]);

    await useApp.getState().resetWorld();
  });
});

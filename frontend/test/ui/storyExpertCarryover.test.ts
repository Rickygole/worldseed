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
import { goScene } from "../../lib/ui/story";
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
});

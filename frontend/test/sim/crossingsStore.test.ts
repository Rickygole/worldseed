/**
 * Regression tests for two red-team findings on the Expert mode crossing picker:
 *   1. Cmd-K's generic "close <name>" shortcut used to create a `close_link` mutation for a tunnel instead
 *      of going through the same path as the picker, so closing Harbor Tunnel from the picker and then
 *      "Remove Key Bridge" from Cmd-K would silently drop the tunnel closure (removeBridge/restoreBridge/
 *      toggleCrossing used to replace `removedLinks` wholesale instead of adding to or filtering it).
 *   2. Nothing blocked a second scenario-mutating call while the first was still computing, so the second
 *      could read a stale pre-run scenario and clobber the first's result once both resolved.
 * These exercise the actual store (the same functions Cmd-K and Expert mode's picker call), not a mock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../../lib/store";
import { LINK_GRAPH_IDS, LINK_ID_BY_GRAPH_ID } from "../../lib/sim/types";
import { SnapshotMissingError } from "../../lib/sim/snapshot";
import { fsReader } from "../../lib/sim/node";
import { SKIP_REASON, SNAPSHOT_DIR, snapshotExists } from "./snapshotPath";

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

describe.skipIf(!snapshotExists)(`Expert mode crossing picker vs Cmd-K, through the store${snapshotExists ? "" : ` [SKIPPED: ${SKIP_REASON}]`}`, () => {
  it("LINK_ID_BY_GRAPH_ID (what Cmd-K resolves a gazetteer link match against) covers every crossing the picker has, both ways", () => {
    expect(LINK_ID_BY_GRAPH_ID["L-KEYBRIDGE"]).toBe("key_bridge");
    expect(LINK_ID_BY_GRAPH_ID["L-HARBORTUNNEL"]).toBe("harbor_tunnel");
    expect(LINK_ID_BY_GRAPH_ID["L-FORTMCHENRY"]).toBe("fort_mchenry");
    for (const [id, graphId] of Object.entries(LINK_GRAPH_IDS)) expect(LINK_ID_BY_GRAPH_ID[graphId]).toBe(id);
  });

  it("picker closes Harbor Tunnel, then Cmd-K removes the Key Bridge: both stay closed, then each reopens independently", async () => {
    await ready();
    await useApp.getState().resetWorld();

    await useApp.getState().toggleCrossing("harbor_tunnel");
    expect(useApp.getState().scenario.removedLinks).toEqual(["harbor_tunnel"]);

    // Cmd-K's "Remove Key Bridge" command calls removeBridge() directly, exactly as before this fix.
    await useApp.getState().removeBridge();
    expect(new Set(useApp.getState().scenario.removedLinks)).toEqual(new Set(["harbor_tunnel", "key_bridge"]));

    // Restoring the bridge (Cmd-K or the picker) must not reopen the tunnel.
    await useApp.getState().restoreBridge();
    expect(useApp.getState().scenario.removedLinks).toEqual(["harbor_tunnel"]);

    await useApp.getState().toggleCrossing("harbor_tunnel");
    expect(useApp.getState().scenario.removedLinks).toEqual([]);
  });

  it("a second scenario-mutating call while the first is still running is rejected, not raced", async () => {
    await ready();
    await useApp.getState().resetWorld();

    // Both calls happen in the same synchronous tick: `first` is already past its `busy = true` write (set
    // synchronously before its first await) by the time `second` runs its own guard, so `second` must no-op.
    const first = useApp.getState().toggleCrossing("fort_mchenry");
    expect(useApp.getState().busy).toBe(true);
    const second = useApp.getState().removeBridge();
    await Promise.all([first, second]);

    expect(useApp.getState().scenario.removedLinks).toEqual(["fort_mchenry"]);
    await useApp.getState().resetWorld();
  });
});

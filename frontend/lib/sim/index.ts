import { createMockSimulator } from "./mock";
import { createRealSimulator, type RealSimulator } from "./real";
import type { RunOptions, Scenario, SimOutput, Simulator, SimulatorMeta, World } from "./types";

export * from "./types";
export type * from "./contract";
export { createRealSimulator, DEFAULT_LENS, DEFAULT_SNAPSHOT_URL } from "./real";
export type { RealSimulator } from "./real";
export { formatRunnerLabel } from "./runner";

/**
 * The Simulator the app uses: the snapshot-backed browser simulator.
 *
 * The mock (lib/sim/mock.ts) is an explicit dev fallback that is used ONLY when the snapshot files are
 * absent (graph.meta.json returns 404, as before the pipeline has run or before `predev`/`prebuild` copied
 * data/snapshot into public/snapshot). A snapshot that is present but invalid is an error, never a silent
 * fallback. The mock's world carries a non-empty `provenance`, which is what makes the footer show its
 * "Demo data" chip; the real world's provenance is empty, so real data never shows that chip.
 *
 * Construction has no side effects (safe during server rendering); workers start in loadWorld().
 */
class AutoSimulator implements Simulator {
  private readonly real: RealSimulator = createRealSimulator();
  private mock: Simulator | null = null;
  private active: Simulator = this.real;

  get meta(): SimulatorMeta {
    return this.active.meta;
  }

  /** The snapshot-backed simulator (futures, explain, snapshot info), or null while the mock is active. */
  get snapshotBacked(): RealSimulator | null {
    return this.active === this.real ? this.real : null;
  }

  async loadWorld(): Promise<World> {
    try {
      const w = await this.real.loadWorld();
      this.active = this.real;
      return w;
    } catch (e) {
      if (!isSnapshotAbsent(e)) throw e;
      console.warn("WorldSeed: snapshot files not found under /snapshot/; using the DEMO mock simulator (dev fallback).");
      this.mock ??= createMockSimulator();
      this.active = this.mock;
      return this.mock.loadWorld();
    }
  }

  run(world: World, scenario: Scenario, opts?: RunOptions): Promise<SimOutput> {
    return this.active.run(world, scenario, opts);
  }
}

/** Errors that crossed a worker boundary lose their class, so match on the name as well. */
function isSnapshotAbsent(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  return !!err && err.name === "SnapshotMissingError" && /graph\.meta\.json/.test(err.message ?? "");
}

export type SimulatorHandle = Simulator & { readonly snapshotBacked: RealSimulator | null };

/**
 * Single swap point. Keep it a factory so the store never imports an implementation directly. The returned
 * object also exposes `snapshotBacked` (futures, explain, snapshot info) once the real snapshot is loaded.
 */
export function createSimulator(): SimulatorHandle {
  return new AutoSimulator();
}

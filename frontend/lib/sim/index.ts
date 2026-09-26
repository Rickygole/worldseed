import type { Simulator } from "./types";
import { createMockSimulator } from "./mock";

export * from "./types";

/**
 * Single swap point. When the snapshot-backed runner exists, return it here.
 * Keep it a factory so the store never imports an implementation directly.
 */
export function createSimulator(): Simulator {
  return createMockSimulator();
}

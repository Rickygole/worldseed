import { defineConfig } from "vitest/config";

// Snapshot-backed tests load ~7 MB of data and run timing loops, which can
// exceed the 5 s default on a busy machine.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 60_000 },
});

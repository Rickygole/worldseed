import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** data/snapshot relative to this file: frontend/test/sim -> repo root. */
export const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "snapshot");

const REQUIRED = ["graph.bin", "graph.meta.json", "hexes.bin", "hexes.meta.json", "facilities.json", "destinations.json", "golden.json", "manifest.json"];
export const missingSnapshotFiles = REQUIRED.filter((f) => !existsSync(join(SNAPSHOT_DIR, f)));
export const snapshotExists = missingSnapshotFiles.length === 0;
export const SKIP_REASON = `pipeline snapshot not found in ${SNAPSHOT_DIR} (missing: ${missingSnapshotFiles.join(", ") || "none"}); run the pipeline (make snapshot) to enable`;

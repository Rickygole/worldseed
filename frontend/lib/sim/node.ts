/**
 * Node-only helpers (tests, CLI). Never import this from browser code: it pulls in node:fs.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SnapshotMissingError, type SnapshotReader } from "./snapshot";

export function fsReader(dir: string): SnapshotReader {
  return async (file) => {
    try {
      const b = await readFile(join(dir, file));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new SnapshotMissingError(file, `no such file in ${dir}`);
      throw e;
    }
  };
}

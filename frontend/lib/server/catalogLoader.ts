/**
 * Loads candidates.json and gazetteer.json for the server. The pipeline writes them to
 * data/snapshot/ and the frontend build copies them to public/snapshot/. If neither exists the
 * loader throws, and the routes answer with a structured degraded response.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildCatalog, type Catalog } from "../agent/catalog";

export function defaultCatalogDirs(cwd: string = process.cwd()): string[] {
  return [path.join(cwd, "public", "snapshot"), path.join(cwd, "..", "data", "snapshot")];
}

async function readJson(dirs: readonly string[], file: string): Promise<unknown | undefined> {
  for (const d of dirs) {
    try {
      return JSON.parse(await readFile(path.join(d, file), "utf8"));
    } catch {
      /* try the next directory */
    }
  }
  return undefined;
}

export function createCatalogLoader(dirs: readonly string[] = defaultCatalogDirs(), ttlMs = 10 * 60_000): () => Promise<Catalog> {
  let cached: { at: number; catalog: Catalog } | null = null;
  return async () => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.catalog;
    const candidates = await readJson(dirs, "candidates.json");
    if (candidates === undefined) throw new Error("candidates.json not found");
    const gazetteer = (await readJson(dirs, "gazetteer.json")) ?? [];
    const catalog = buildCatalog(candidates, gazetteer);
    cached = { at: Date.now(), catalog };
    return catalog;
  };
}

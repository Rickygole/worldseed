/**
 * Loads candidates.json and gazetteer.json for the server.
 *
 * The pipeline writes them to data/snapshot/ and the frontend prebuild copies them to
 * public/snapshot/. On a serverless host the route functions do not see public/ (it is served from
 * the CDN) unless the files are traced into them: next.config.ts lists both files in
 * outputFileTracingIncludes for /api/**, and the fs reads below use literal process.cwd() paths so
 * the tracer sees them too. data/snapshot is only a local-development fallback.
 *
 * If neither exists the loader throws, the routes answer with a structured degraded response, and
 * one structured log line says which directories were tried.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildCatalog, type Catalog } from "../agent/catalog";
import { logEvent } from "./log";

export const CATALOG_FILES = ["candidates.json", "gazetteer.json"] as const;

// Built from parts on purpose: a literal directory path here would make the build tracer include
// the whole snapshot directory (a 5 MB graph the AI routes never read) in every route function.
const SNAPSHOT_PARTS = ["public", "snapshot"];
const PIPELINE_PARTS = ["..", "data", "snapshot"];

export function defaultCatalogDirs(cwd: string = process.cwd()): string[] {
  return [path.join(cwd, ...SNAPSHOT_PARTS), path.join(cwd, ...PIPELINE_PARTS)];
}

/**
 * The two files with literal path segments. The build's file tracer follows these and includes
 * exactly these files in each route's function, instead of the whole snapshot directory (which
 * holds a 5 MB graph the AI routes never read).
 */
function literalPath(cwd: string, file: (typeof CATALOG_FILES)[number]): string {
  return file === "candidates.json"
    ? path.join(cwd, "public", "snapshot", "candidates.json")
    : path.join(cwd, "public", "snapshot", "gazetteer.json");
}

async function readJson(dirs: readonly string[], file: (typeof CATALOG_FILES)[number]): Promise<unknown | undefined> {
  const [first, ...rest] = dirs;
  // The traced location first (a literal path under the working directory), then any other directory.
  const paths = first === defaultCatalogDirs()[0] ? [literalPath(process.cwd(), file)] : [path.join(first ?? "", file)];
  for (const d of rest) paths.push(path.join(d, file));
  for (const p of paths) {
    try {
      return JSON.parse(await readFile(p, "utf8"));
    } catch {
      /* try the next location */
    }
  }
  return undefined;
}

export function createCatalogLoader(
  dirs: readonly string[] = defaultCatalogDirs(),
  ttlMs = 10 * 60_000,
  failureTtlMs = 15_000,
): () => Promise<Catalog> {
  let cached: { at: number; catalog: Catalog } | null = null;
  let failedAt = 0;
  let inflight: Promise<Catalog> | null = null;

  const load = async (): Promise<Catalog> => {
    const candidates = await readJson(dirs, "candidates.json");
    if (candidates === undefined) {
      logEvent("warn", "catalog_unavailable", { file: "candidates.json", dirsTried: dirs.length });
      throw new Error("candidates.json not found");
    }
    const gazetteer = await readJson(dirs, "gazetteer.json");
    if (gazetteer === undefined) logEvent("warn", "catalog_gazetteer_missing", { dirsTried: dirs.length });
    let catalog: Catalog;
    try {
      catalog = buildCatalog(candidates, gazetteer ?? []);
    } catch {
      logEvent("warn", "catalog_unavailable", { file: "candidates.json or gazetteer.json", reason: "not a list" });
      throw new Error("catalog files are malformed");
    }
    if (catalog.warnings.length > 0) logEvent("warn", "catalog_partial", { warnings: catalog.warnings.length, first: catalog.warnings[0] });
    return catalog;
  };

  return async () => {
    const t = Date.now();
    if (cached && t - cached.at < ttlMs) return cached.catalog;
    if (!cached && failedAt && t - failedAt < failureTtlMs) throw new Error("catalog could not be loaded (recent failure)");
    inflight ??= load()
      .then((catalog) => {
        cached = { at: Date.now(), catalog };
        failedAt = 0;
        return catalog;
      })
      .catch((e) => {
        failedAt = Date.now();
        if (cached) return cached.catalog; // keep serving the last good catalog
        throw e;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}

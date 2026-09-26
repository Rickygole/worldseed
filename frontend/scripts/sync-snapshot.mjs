// Copies the committed pipeline artifacts (data/snapshot/*) into public/snapshot/ so the browser can fetch
// them from /snapshot/. Runs on `predev` and `prebuild`.
//
//  - Checks every shipped file listed in manifest.json against its sha256 and size. A mismatch is a warning,
//    or a failure when WS_REQUIRE_SNAPSHOT=1.
//  - Skips golden.json and access_sensitivity.json: they are for tests and pipeline analysis, not the app.
//  - If the snapshot has not been built yet it warns and exits 0, and the app falls back to the DEMO mock
//    (its footer shows "Demo data"). Set WS_REQUIRE_SNAPSHOT=1 (CI, production deploys) to fail instead.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "..", "data", "snapshot");
const dest = join(root, "public", "snapshot");
const DEV_ONLY = new Set(["golden.json", "access_sensitivity.json"]);
const required = process.env.WS_REQUIRE_SNAPSHOT === "1";

function stop(message) {
  if (required) {
    console.error(`sync-snapshot: ${message}`);
    process.exit(1);
  }
  console.warn(`sync-snapshot: ${message}`);
  process.exit(0);
}

if (!existsSync(join(src, "graph.meta.json")) || !existsSync(join(src, "graph.bin"))) {
  stop(`no snapshot at ${src} (graph.meta.json / graph.bin missing). The app will use the demo mock until the pipeline has run.`);
}

if (existsSync(join(src, "manifest.json"))) {
  const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
  for (const [name, info] of Object.entries(manifest.files ?? {})) {
    if (DEV_ONLY.has(name)) continue; // not shipped to the browser
    const p = join(src, name);
    if (!existsSync(p)) {
      console.error(`sync-snapshot: manifest lists ${name} but it is missing from ${src}`);
      process.exit(1);
    }
    const buf = readFileSync(p);
    const sha = createHash("sha256").update(buf).digest("hex");
    if (buf.length !== info.bytes || sha !== info.sha256) {
      const msg = `${name} does not match manifest.json (size or sha256). Re-run the pipeline manifest step.`;
      if (required) {
        console.error(`sync-snapshot: ${msg}`);
        process.exit(1);
      }
      console.warn(`sync-snapshot: WARNING ${msg} (copying anyway; WS_REQUIRE_SNAPSHOT=1 makes this fatal)`);
    }
  }
} else {
  console.warn("sync-snapshot: no manifest.json; skipping integrity check");
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
let n = 0;
let bytes = 0;
for (const f of readdirSync(src)) {
  const p = join(src, f);
  if (DEV_ONLY.has(f) || !statSync(p).isFile()) continue;
  copyFileSync(p, join(dest, f));
  n++;
  bytes += statSync(p).size;
}
console.log(`synced ${n} snapshot files (${(bytes / 1e6).toFixed(1)} MB) to public/snapshot`);

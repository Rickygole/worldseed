#!/usr/bin/env node
/**
 * Generates THIRD_PARTY_LICENSES.md at the repository root.
 *
 *   node scripts/gen-third-party-licenses.mjs           # write THIRD_PARTY_LICENSES.md
 *   node scripts/gen-third-party-licenses.mjs --check   # exit 1 if the file on disk is stale
 *   node scripts/gen-third-party-licenses.mjs --stdout  # print instead of writing
 *
 * Node built-ins only; nothing to install. The output is deterministic: no timestamps, sorted
 * everywhere, and it depends only on the input files below.
 *
 * Inputs
 *   frontend/package.json, frontend/package-lock.json   the npm dependency set (lockfile is the list)
 *   frontend/node_modules/                              read for license text and copyright lines of the
 *                                                       DIRECT dependencies; the lockfile "license" field
 *                                                       is used for everything else
 *   pipeline/pyproject.toml, pipeline/uv.lock           the Python dependency set
 *   pipeline/.venv (site-packages, dist-info METADATA)  installed metadata (license per package); packages
 *                                                       that are not installed are reported as "unverified"
 *
 * Regenerate after any dependency change (npm install / uv sync), then review the "Needs a human look"
 * section at the top of the output. Run `bash scripts/check-repo-hygiene.sh --include-untracked` afterwards.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = path.join(ROOT, "frontend");
const PIPELINE = path.join(ROOT, "pipeline");
const OUT = path.join(ROOT, "THIRD_PARTY_LICENSES.md");

const args = new Set(process.argv.slice(2));
for (const a of args) {
  if (!["--check", "--stdout", "--help", "-h"].includes(a)) {
    console.error(`unknown argument: ${a}`);
    process.exit(2);
  }
}
if (args.has("--help") || args.has("-h")) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  console.log(src.slice(src.indexOf("/**") + 3, src.indexOf("*/")).replace(/^ \* ?/gm, "").trim());
  process.exit(0);
}

// ---------------------------------------------------------------- helpers

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const readText = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const exists = (p) => fs.existsSync(p);
const sha12 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 12);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const mdEsc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

/**
 * Classify an SPDX-style expression (or free text from Python metadata).
 *   ok        permissive
 *   elect     dual-licensed with a permissive alternative (we rely on the permissive one)
 *   attention weak copyleft, attribution-required data license, LGPL/GPL/AGPL, unknown, unlicensed, or unparsed
 */
const PERMISSIVE = [
  /^MIT(-0)?$/i, /^ISC$/i, /^BSD([- ]?(2|3|4)[- ]?Clause)?( License)?$/i, /^0BSD$/i, /^Apache([- ]?(Software License|2\.0|License 2\.0))?(-2\.0)?$/i,
  /^Unlicense$/i, /^CC0-1\.0$/i, /^BlueOak-1\.0\.0$/i, /^Python-2\.0$/i, /^Zlib$/i, /^PSF(-2\.0)?$/i, /^MIT License$/i, /^BSD License$/i,
  /^Apache Software License$/i, /^BSD Zero Clause$/i, /^BSD-[234]-Clause(-[A-Za-z-]+)?$/i,
];
const isPermissiveAtom = (t) => PERMISSIVE.some((re) => re.test(t.trim()));

function classify(expr) {
  const raw = String(expr ?? "").trim();
  if (!raw) return { level: "attention", why: "no license declared" };
  if (/unlicensed|see license|custom|proprietary|unknown/i.test(raw)) return { level: "attention", why: "unknown or custom license" };
  const flat = raw.replace(/[()]/g, " ");
  // OR: any permissive alternative is enough. AND: every part must be permissive.
  const orParts = flat.split(/\s+OR\s+/i).map((s) => s.trim()).filter(Boolean);
  const partVerdicts = orParts.map((alt) => {
    const ands = alt.split(/\s+AND\s+/i).map((s) => s.trim()).filter(Boolean);
    const bad = ands.filter((a) => !isPermissiveAtom(a));
    return { alt, bad };
  });
  const clean = partVerdicts.filter((p) => p.bad.length === 0);
  if (orParts.length === 1) {
    const { bad } = partVerdicts[0];
    if (bad.length === 0) return { level: "ok" };
    return { level: "attention", why: `not permissive: ${bad.join(", ")}` };
  }
  if (clean.length > 0) return { level: "elect", why: `dual-licensed; permissive option: ${clean.map((c) => c.alt).join(" / ")}` };
  return { level: "attention", why: `no permissive alternative: ${partVerdicts.map((p) => p.bad.join(", ")).join(" / ")}` };
}

const LICENSE_FILE_RE = /^(licen[sc]e|copying)(\.(md|txt))?$/i;
const NOTICE_FILE_RE = /^notice(\.(md|txt))?$/i;

/** Copyright lines that start a line ("Copyright (c) 2018 Framer B.V."), excluding template placeholders. */
function copyrightLines(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!/^(Copyright\b|\(c\)\s*\d{4}|©)/.test(l)) continue;
    if (/^Copyright\s+(notice|owner|holder|and|law)\b/.test(l)) continue;
    if (/\[yyyy\]|\{yyyy\}|<year>|\[name of copyright owner\]/i.test(l)) continue;
    if (!out.includes(l)) out.push(l);
  }
  return out;
}

const normText = (t) => t.split("\n").filter((l) => copyrightLines(l).length === 0).join(" ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- npm

const pkgJson = JSON.parse(readText(path.join(FRONTEND, "package.json")));
const lock = JSON.parse(readText(path.join(FRONTEND, "package-lock.json")));
const directRuntime = new Set(Object.keys(pkgJson.dependencies ?? {}));
const directDev = new Set(Object.keys(pkgJson.devDependencies ?? {}));

/** Every lockfile entry as { name, version, license, dev, optional, key }. */
const npmAll = [];
for (const [key, v] of Object.entries(lock.packages ?? {})) {
  if (key === "") continue;
  const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
  npmAll.push({ key, name, version: v.version, license: v.license ?? "", dev: !!v.dev, optional: !!v.optional, peer: !!v.peer, entry: v });
}
npmAll.sort((a, b) => cmp(a.name, b.name) || cmp(a.version, b.version) || cmp(a.key, b.key));

// Reverse dependency map by package name (who asks for X), from the lockfile.
const dependents = new Map();
for (const p of npmAll) {
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const dep of Object.keys(p.entry[field] ?? {})) {
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      dependents.get(dep).add(p.name);
    }
  }
}
for (const d of [...directRuntime, ...directDev]) {
  if (!dependents.has(d)) dependents.set(d, new Set());
  dependents.get(d).add("(this project)");
}

/** Read the installed package for a lock entry key, if node_modules has it. */
function installedManifest(key) {
  const p = path.join(FRONTEND, key, "package.json");
  if (!exists(p)) return null;
  try {
    return JSON.parse(readText(p));
  } catch {
    return null;
  }
}
const manifestLicense = (m) => {
  if (!m) return "";
  if (typeof m.license === "string") return m.license;
  if (m.license && typeof m.license.type === "string") return m.license.type;
  if (Array.isArray(m.licenses)) return m.licenses.map((l) => l.type).filter(Boolean).join(" OR ");
  return "";
};

// Direct dependencies (top-level node_modules entries).
const directRows = [];
const directTexts = []; // runtime direct deps with their license file text, for the appendix
for (const name of [...directRuntime, ...directDev].sort(cmp)) {
  const key = `node_modules/${name}`;
  const ent = lock.packages[key];
  if (!ent) {
    directRows.push({ name, version: "unverified (not in lockfile)", license: "unverified", scope: directRuntime.has(name) ? "runtime" : "dev", copyright: "unverified", spec: (pkgJson.dependencies ?? pkgJson.devDependencies)[name] });
    continue;
  }
  const m = installedManifest(key);
  const lic = manifestLicense(m) || ent.license || "";
  let cp = [];
  let licText = null;
  let licFile = null;
  let noticeText = null;
  let authorNote = "";
  if (m) {
    const files = fs.readdirSync(path.join(FRONTEND, key)).sort(cmp);
    licFile = files.find((f) => LICENSE_FILE_RE.test(f)) ?? null;
    const noticeFile = files.find((f) => NOTICE_FILE_RE.test(f)) ?? null;
    if (licFile) {
      licText = readText(path.join(FRONTEND, key, licFile));
      cp = copyrightLines(licText);
    }
    if (noticeFile) {
      noticeText = readText(path.join(FRONTEND, key, noticeFile)).trim();
      for (const l of copyrightLines(noticeText)) if (!cp.includes(l)) cp.push(l);
    }
    if (cp.length === 0) {
      const a = typeof m.author === "string" ? m.author : m.author?.name;
      authorNote = a ? `no copyright line in the package's license file; package.json author: ${a.replace(/\s*<[^>]*>/, "")}` : "no copyright line found (unverified)";
    }
  } else {
    authorNote = "package not installed here; copyright unverified (license from lockfile)";
  }
  const scope = directRuntime.has(name) ? "runtime" : "dev";
  directRows.push({
    name,
    version: ent.version,
    license: lic,
    scope,
    copyright: cp.length ? cp.join("; ") : authorNote,
    spec: (pkgJson.dependencies ?? {})[name] ?? (pkgJson.devDependencies ?? {})[name],
  });
  if (scope === "runtime" && licText) directTexts.push({ name, version: ent.version, license: lic, file: licFile, text: licText, notice: noticeText });
}

// Cross-check lock license vs installed manifest license (installed packages only).
const mismatches = [];
for (const p of npmAll) {
  const m = installedManifest(p.key);
  if (!m) continue;
  const inst = manifestLicense(m);
  if (inst && p.license && inst !== p.license) mismatches.push(`${p.name}@${p.version}: lockfile "${p.license}" vs installed "${inst}"`);
  if (!inst && !p.license) mismatches.push(`${p.name}@${p.version}: no license field in lockfile or installed manifest`);
}

// Transitive: every lock entry that is not a top-level direct dependency.
const directKeys = new Set([...directRuntime, ...directDev].map((n) => `node_modules/${n}`));
const transitive = npmAll.filter((p) => !directKeys.has(p.key));
const byLicense = new Map();
for (const p of transitive) {
  const id = p.license || "UNKNOWN (no license field)";
  if (!byLicense.has(id)) byLicense.set(id, { runtime: new Set(), dev: new Set() });
  const label = `${p.name}@${p.version}${p.optional ? "*" : ""}`;
  byLicense.get(id)[p.dev ? "dev" : "runtime"].add(label);
}

// ---------------------------------------------------------------- Python

function parseUvLock(text) {
  const blocks = text.split(/^\[\[package\]\]\s*$/m).slice(1);
  const pkgs = [];
  for (const b of blocks) {
    const name = /^name = "([^"]+)"/m.exec(b)?.[1];
    const version = /^version = "([^"]+)"/m.exec(b)?.[1];
    const virtual = /^source = \{ virtual = /m.test(b);
    if (name) pkgs.push({ name, version: version ?? "unverified", virtual });
  }
  return pkgs;
}
const normPy = (n) => n.toLowerCase().replace(/[-_.]+/g, "-");

const uvText = readText(path.join(PIPELINE, "uv.lock"));
const pyprojText = readText(path.join(PIPELINE, "pyproject.toml"));
const uvPkgs = parseUvLock(uvText).filter((p) => !p.virtual);
const depBlock = /^dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(pyprojText)?.[1] ?? "";
const pyDirect = new Set([...depBlock.matchAll(/"\s*([A-Za-z0-9_.-]+)/g)].map((m) => normPy(m[1])));

// Installed metadata.
const venvLib = path.join(PIPELINE, ".venv", "lib");
const installedPy = new Map();
let sitePackages = null;
if (exists(venvLib)) {
  const pyDir = fs.readdirSync(venvLib).filter((d) => /^python\d/.test(d)).sort(cmp)[0];
  if (pyDir && exists(path.join(venvLib, pyDir, "site-packages"))) sitePackages = path.join(venvLib, pyDir, "site-packages");
}
if (sitePackages) {
  for (const d of fs.readdirSync(sitePackages).filter((x) => x.endsWith(".dist-info")).sort(cmp)) {
    const metaPath = path.join(sitePackages, d, "METADATA");
    if (!exists(metaPath)) continue;
    const meta = readText(metaPath);
    const header = meta.split(/\n\n/)[0];
    const get = (k) => [...header.matchAll(new RegExp(`^${k}: (.*)$`, "gm"))].map((m) => m[1].trim());
    const name = get("Name")[0];
    if (!name) continue;
    installedPy.set(normPy(name), { dir: path.join(sitePackages, d), version: get("Version")[0], expr: get("License-Expression")[0] ?? "", field: get("License")[0] ?? "", classifiers: get("Classifier").filter((c) => c.startsWith("License ::")), files: get("License-File") });
  }
}

const COPYLEFT_TEXT_RE = /GNU (Lesser |Library )?General Public License|GNU Affero/i;
/** Describe what kind of GNU license text a file holds, so the note is not misleading. */
function describeCopyleft(text) {
  if (!COPYLEFT_TEXT_RE.test(text)) return null;
  if (/GNU LESSER GENERAL PUBLIC LICENSE|GNU Lesser General Public License/.test(text) && /^\s*GNU LESSER GENERAL PUBLIC LICENSE\s*$/m.test(text)) return "full LGPL text";
  if (/Runtime Library Exception/i.test(text)) return "GNU GPL text with the GCC Runtime Library Exception (a bundled component; read the file for which one)";
  return "mentions the GNU GPL (possibly incidental, for example a history clause); review";
}
function pyLicense(p) {
  const inst = installedPy.get(normPy(p.name));
  if (!inst) return { license: "unverified (not installed in pipeline/.venv)", source: "none", level: "attention", why: "license metadata unavailable", bundled: [] };
  let license = "";
  let source = "";
  if (inst.expr) {
    license = inst.expr;
    source = "License-Expression";
  } else if (inst.field && inst.field.length <= 60 && !/^Copyright/i.test(inst.field) && !/\n/.test(inst.field)) {
    license = inst.field;
    source = "License field";
  } else if (inst.classifiers.length) {
    license = inst.classifiers.map((c) => c.replace(/^License :: (OSI Approved :: )?/, "")).join(" / ");
    source = "trove classifier only";
  } else {
    license = "unverified (no license metadata)";
    source = "none";
  }
  // Look for bundled copyleft license texts among the declared license files.
  const bundled = [];
  const seen = new Set();
  const stack = [inst.dir];
  while (stack.length) {
    const d = stack.pop();
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, f.name);
      if (f.isDirectory()) stack.push(fp);
      else if (/^(license|copying|notice|authors)|licen[sc]e/i.test(f.name) && !seen.has(fp)) {
        seen.add(fp);
        try {
          const d2 = describeCopyleft(readText(fp));
          if (d2) bundled.push({ file: path.relative(inst.dir, fp).split(path.sep).join("/"), what: d2 });
        } catch {
          /* unreadable, ignore */
        }
      }
    }
  }
  bundled.sort((a, b) => cmp(a.file, b.file));
  let c = source === "none" ? { level: "attention", why: "no license metadata" } : classify(license);
  if (/^dual license$/i.test(license) && inst.classifiers.length) {
    const labels = inst.classifiers.map((x) => x.replace(/^License :: (OSI Approved :: )?/, ""));
    license = `Dual License (classifiers: ${labels.join(" / ")})`;
    source = "License field plus trove classifiers";
    c = labels.every(isPermissiveAtom) ? { level: "elect", why: "dual-licensed; both classifiers are permissive, but the exact variants are not stated" } : { level: "attention", why: "dual license with a non-permissive classifier" };
  }
  return { license, source, level: c.level, why: c.why, bundled, versionInstalled: inst.version };
}

const pyRows = uvPkgs.map((p) => ({ ...p, direct: pyDirect.has(normPy(p.name)), ...pyLicense(p) })).sort((a, b) => cmp(normPy(a.name), normPy(b.name)));

// ---------------------------------------------------------------- attention list

const attention = [];
for (const p of npmAll) {
  const c = classify(p.license);
  if (c.level === "ok") continue;
  attention.push({ eco: "npm", name: p.name, version: p.version, license: p.license || "none", level: c.level, why: c.why, scope: p.dev ? "dev" : "runtime", optional: p.optional });
}
for (const r of pyRows) {
  if (r.level !== "ok") attention.push({ eco: "python", name: r.name, version: r.version, license: r.license, level: r.level, why: r.why, scope: "build-time", optional: false });
  for (const b of r.bundled) attention.push({ eco: "python", name: r.name, version: r.version, license: r.license, level: "attention", why: `${b.file}: ${b.what}`, scope: "build-time", optional: false });
}

// Group attention entries by (eco, license, level, why-kind) so 15 platform variants of one package read as one line.
function groupAttention() {
  const groups = new Map();
  for (const a of attention) {
    const family = a.name.replace(/-(android|darwin|freebsd|linux|linuxmusl|win32|wasm32)[a-z0-9_-]*$/, "");
    const k = [a.eco, a.license, a.level, a.scope, family, a.why].join("\u0000");
    if (!groups.has(k)) groups.set(k, { ...a, family, members: [] });
    groups.get(k).members.push(`${a.name}@${a.version}${a.optional ? "*" : ""}`);
  }
  return [...groups.values()].sort((a, b) => cmp(a.level, b.level) || cmp(a.eco, b.eco) || cmp(a.license, b.license) || cmp(a.family, b.family));
}
const attGroups = groupAttention();

function requiredBy(name) {
  const s = dependents.get(name);
  return s ? [...s].sort(cmp) : [];
}

// ---------------------------------------------------------------- fonts (fixed text, OFL body embedded)

const OFL_BODY = String.raw`-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.`;

// ---------------------------------------------------------------- render

const L = [];
const w = (s = "") => L.push(s);

w("# Third-party licenses");
w();
w("Generated by `node scripts/gen-third-party-licenses.mjs`. Do not edit by hand; regenerate after any dependency change.");
w("This is an inventory of the licenses of software and fonts used by WorldSeed, not legal advice. Data and service attributions");
w("(OpenStreetMap, Census, Maryland iMAP, OpenFreeMap, model and search providers) are in `docs/ATTRIBUTIONS.md`, `NOTICE` and");
w("`data/snapshot/LICENSE.md`. WorldSeed's own code is MIT (see `LICENSE`).");
w();
w("Inputs (short sha256): " + [`frontend/package-lock.json ${sha12(path.join(FRONTEND, "package-lock.json"))}`, `frontend/package.json ${sha12(path.join(FRONTEND, "package.json"))}`, `pipeline/uv.lock ${sha12(path.join(PIPELINE, "uv.lock"))}`, `pipeline/pyproject.toml ${sha12(path.join(PIPELINE, "pyproject.toml"))}`].join(", ") + ".");
w();
w("How to read it:");
w();
w("- npm: the lockfile is the list of packages (" + npmAll.length + " entries, " + directRuntime.size + " direct runtime and " + directDev.size + " direct dev dependencies). License ids come from the installed package's `package.json` for direct dependencies and from the lockfile `license` field for the rest.");
w("- \"runtime\" means reachable from `dependencies` in `frontend/package.json` (the `dev` flag is not set in the lockfile). It includes server-side code and optional platform packages; it does not mean every package ends up in the browser bundle.");
w("- `*` after a package marks an optional dependency (only installed on matching platforms).");
w("- Python packages are used only to rebuild `data/snapshot/` (build time). They are not deployed with the demo.");
w();

// --- attention
w("## Needs a human look");
w();
w("Anything below is not a plain permissive license (MIT, ISC, BSD, Apache-2.0, 0BSD, Unlicense, CC0, BlueOak, Python-2.0, Zlib) or could not be verified. Each is listed once per package family.");
w();
if (attGroups.length === 0) {
  w("None found.");
} else {
  for (const g of attGroups) {
    const tag = g.level === "attention" ? "ATTENTION" : "ELECTED PERMISSIVE OPTION";
    const who = g.eco === "npm" ? requiredBy(g.family === g.name ? g.name : g.members[0].replace(/@[^@]*$/, "").replace(/\*$/, "")) : [];
    w(`- **${tag}** [${g.eco}, ${g.scope}] \`${g.license}\`: ${g.members.length > 4 ? `${g.family} family, ${g.members.length} packages (${g.members.slice(0, 3).join(", ")}, ...)` : g.members.join(", ")}. ${g.why}.` + (who.length ? ` Required by: ${who.slice(0, 5).join(", ")}${who.length > 5 ? ", ..." : ""}.` : ""));
  }
}
w();
w("Notes on the items above (facts from this repository at the time the script was written; re-check if the code changes):");
w();
w("- The LGPL-3.0-or-later `@img/sharp-libvips-*` and related `@img/sharp-*` packages are optional dependencies of `sharp`, which `next` lists as an optional dependency (used by its image optimizer). Only the packages matching the build platform are installed. The app source has no `next/image` usage. Whether a libvips binary is present in the deployed Vercel function is unverified. If it is, LGPL obligations apply to that shared library (offer of source, no additional restrictions on relinking); the simplest resolution is to confirm it is absent from the deployment.");
w("- `jszip` is offered as `MIT OR GPL-3.0-or-later`; WorldSeed relies on the MIT option.");
w("- `lightningcss` (MPL-2.0) is a build-time dependency of the CSS toolchain (dev). MPL-2.0 is file-level copyleft and applies only if its source files are modified and distributed. Nothing is modified here.");
w("- `caniuse-lite` (CC-BY-4.0) is a browser-support data package pulled in by `next` and `browserslist`. Whether any of that data reaches visitors is unverified. CC-BY-4.0 asks for attribution; this line is that attribution: caniuse-lite data, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).");
w("- `axe-core` (MPL-2.0) is dev-only (accessibility linting).");
w("- Python: `certifi` is MPL-2.0 (file-level copyleft, unmodified, build-time only). the `shapely` wheel ships a `LICENSE_GEOS` file holding LGPL text (the GEOS library it bundles); build-time only, not distributed with the demo. `numpy` and `scipy` wheels ship GPL text with the GCC Runtime Library Exception for bundled runtime libraries. `pandas` mentions the GPL only in the history clause of the Python license text (incidental). `colorama` and `tzdata` are in `uv.lock` but not installed in `pipeline/.venv`, so their licenses are unverified here.");
w();

// --- summary
w("## npm summary by license");
w();
w("| License | Transitive runtime | Transitive dev-only | Status |");
w("|---|---:|---:|---|");
const licRows = [...byLicense.entries()].map(([id, v]) => ({ id, r: v.runtime.size, d: v.dev.size })).sort((a, b) => b.r + b.d - (a.r + a.d) || cmp(a.id, b.id));
for (const r of licRows) {
  const c = classify(r.id === "UNKNOWN (no license field)" ? "" : r.id);
  w(`| ${mdEsc(r.id)} | ${r.r} | ${r.d} | ${c.level === "ok" ? "permissive" : c.level === "elect" ? "dual-licensed, permissive option" : "ATTENTION"} |`);
}
w();

// --- direct npm
w("## npm: direct dependencies");
w();
w("Versions are the ones pinned in `frontend/package-lock.json`. Copyright lines are copied from the package's own license file (or NOTICE) where it has one.");
w();
w("| Package | Version | License | Scope | Copyright |");
w("|---|---|---|---|---|");
for (const r of directRows) {
  const c = classify(r.license);
  const flag = c.level === "attention" ? " **ATTENTION**" : "";
  w(`| ${r.name} | ${r.version} | ${mdEsc(r.license || "unverified")}${flag} | ${r.scope} | ${mdEsc(r.copyright)} |`);
}
w();

// --- transitive npm
w("## npm: transitive dependencies by license");
w();
w("Every other lockfile entry, grouped by license id. \"Runtime\" and \"dev-only\" are separate lists. Each package's own license text is in its folder in `node_modules/` (or in its published tarball).");
w();
for (const r of licRows) {
  const v = byLicense.get(r.id);
  const c = classify(r.id === "UNKNOWN (no license field)" ? "" : r.id);
  w(`### ${r.id}${c.level === "ok" ? "" : c.level === "elect" ? " (dual-licensed)" : " (ATTENTION)"}`);
  w();
  if (v.runtime.size) {
    w(`Runtime (${v.runtime.size}): ${[...v.runtime].sort(cmp).join(", ")}`);
    w();
  }
  if (v.dev.size) {
    w(`Dev-only (${v.dev.size}): ${[...v.dev].sort(cmp).join(", ")}`);
    w();
  }
}
if (mismatches.length) {
  w("### License field mismatches (lockfile vs installed package.json)");
  w();
  for (const m of mismatches.sort(cmp)) w(`- ${m}`);
  w();
}

// --- python
w("## Python pipeline dependencies (build time only)");
w();
w(`Source: \`pipeline/uv.lock\` (${pyRows.length} packages other than the project itself); direct dependencies from \`pipeline/pyproject.toml\`. Licenses come from installed metadata in \`pipeline/.venv\`${sitePackages ? "" : " (NOT FOUND: every license below is unverified; run `uv sync` in pipeline/ and regenerate)"}. "Source" says which metadata field the value came from; a trove classifier alone does not say which BSD or Apache variant applies.`);
w();
w("| Package | Version | Direct | License | Source | Note |");
w("|---|---|---|---|---|---|");
for (const r of pyRows) {
  const notes = [];
  if (r.level !== "ok") notes.push(r.level === "elect" ? r.why : `ATTENTION: ${r.why}`);
  for (const b of r.bundled) notes.push(`${b.file}: ${b.what}`);
  if (r.versionInstalled && r.versionInstalled !== r.version) notes.push(`installed ${r.versionInstalled} differs from lock`);
  w(`| ${r.name} | ${r.version} | ${r.direct ? "yes" : "no"} | ${mdEsc(r.license)} | ${r.source} | ${mdEsc(notes.join("; "))} |`);
}
w();

// --- fonts
w("## Fonts");
w();
w("The three fonts are loaded with `next/font/google` in `frontend/app/layout.tsx` (Inter as `--font-inter`, JetBrains Mono as `--font-jetbrains`, Space Grotesk for display numbers and headlines, subset `latin`, `display: swap`). `next/font` downloads the font files at build time and serves them from the app's own origin, so visitors do not contact Google Fonts. In a local Next build output on 2026-09-26 (`frontend/.next`) the generated CSS declared variable woff2 files split into unicode-range slices for `Inter` (weights 100 to 900) and `JetBrains Mono` (weights 100 to 800), with `local(Arial)` fallbacks. The Vercel production build output was not inspected (unverified).");
w();
w("| Font | License | Copyright notice (from the Google Fonts repository OFL.txt) | Source |");
w("|---|---|---|---|");
w("| Inter | SIL Open Font License 1.1 | Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter) | https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt |");
w("| JetBrains Mono | SIL Open Font License 1.1 | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) | https://github.com/google/fonts/blob/main/ofl/jetbrainsmono/OFL.txt |");
w("| Space Grotesk | SIL Open Font License 1.1 | Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) | https://github.com/google/fonts/blob/main/ofl/spacegrotesk/OFL.txt |");
w();
w("Both copyright lines were read from those files on 2026-09-26. The upstream Inter repository states 2016 in its own copy of the license; the Google Fonts copy, which is the one `next/font/google` downloads from, states 2020. Neither font declares a Reserved Font Name in the copies read.");
w();
w("Gap: `docs/LEGAL.md` asks for each OFL text to ship next to the font files. `next/font/google` emits hashed woff2 files with no license file beside them, so this document is the notice. Whether the running app links to this file is unverified.");
w();
w("### SIL Open Font License 1.1 (applies to Inter, JetBrains Mono and Space Grotesk)");
w();
w("```text");
w(OFL_BODY.replace(/\n+$/, ""));
w("```");
w();

// --- notes on named components
w("## Map, layers, spatial index and icons");
w();
const pick = (n) => directRows.find((r) => r.name === n);
const line = (label, names, extra = "") => {
  const rows = names.map(pick).filter(Boolean);
  if (!rows.length) return;
  w(`- **${label}**: ${rows.map((r) => `${r.name} ${r.version} (${r.license})`).join(", ")}.${extra ? " " + extra : ""}`);
};
line("MapLibre GL JS", ["maplibre-gl"], "Its license file also reproduces the notices of code it contains (Mapbox GL JS up to v1.13, BSD-3-Clause; further MIT and BSD notices); the full file is reproduced below. `frontend/scripts/copy-maplibre-worker.mjs` copies the worker files into `frontend/public/maplibre/` at build time; they carry MapLibre's license header.");
line("react-map-gl", ["react-map-gl"]);
line("deck.gl", ["@deck.gl/core", "@deck.gl/geo-layers", "@deck.gl/layers", "@deck.gl/react"]);
line("H3 (h3-js)", ["h3-js"], "Apache-2.0 with a NOTICE file, reproduced below.");
line("Lucide icons (lucide-react)", ["lucide-react"], "Its license file combines the ISC notice with the MIT notice for portions derived from Feather (Cole Bemis); both are reproduced below.");
w();

// --- appendix: full texts of direct runtime deps
w("## Appendix: license texts of direct runtime dependencies");
w();
w("Identical texts (ignoring copyright lines and whitespace) are printed once, with the packages that use them. Each package's own copyright line is in the direct-dependency table above.");
w();
const groupsByText = new Map();
for (const t of directTexts) {
  const k = crypto.createHash("sha256").update(normText(t.text)).digest("hex");
  if (!groupsByText.has(k)) groupsByText.set(k, []);
  groupsByText.get(k).push(t);
}
const textGroups = [...groupsByText.values()].map((g) => g.sort((a, b) => cmp(a.name, b.name))).sort((a, b) => cmp(a[0].license, b[0].license) || cmp(a[0].name, b[0].name));
for (const g of textGroups) {
  const head = g[0];
  w(`### ${head.license}: ${g.map((t) => `${t.name} ${t.version}`).join(", ")}`);
  w();
  w(`Text as shipped in \`${head.name}\` (\`${head.file}\`):`);
  w();
  w("```text");
  w(head.text.trim());
  w("```");
  w();
  for (const t of g) {
    if (t.notice) {
      w(`NOTICE file of \`${t.name}\`:`);
      w();
      w("```text");
      w(t.notice);
      w("```");
      w();
    }
  }
}

let out = L.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";

// Guard: the repository must not contain assistant-vendor names (scripts/check-repo-hygiene.sh enforces this).
const banned = new RegExp(["cla" + "ude", "anthr" + "opic"].join("|"), "i");
const bad = out.split("\n").findIndex((l) => banned.test(l));
if (bad >= 0) {
  console.error(`Generated text contains a forbidden word on output line ${bad + 1}; not writing. Find the package that introduced it and handle it explicitly.`);
  process.exit(3);
}

if (args.has("--stdout")) {
  process.stdout.write(out);
} else if (args.has("--check")) {
  const cur = exists(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (cur !== out) {
    console.error(`${rel(OUT)} is stale. Run: node scripts/gen-third-party-licenses.mjs`);
    process.exit(1);
  }
  console.log(`${rel(OUT)} is up to date.`);
} else {
  fs.writeFileSync(OUT, out);
  console.log(`Wrote ${rel(OUT)} (${out.split("\n").length} lines): ${npmAll.length} npm entries, ${pyRows.length} Python packages, ${attGroups.length} attention group(s).`);
}

# Attributions

Third-party data, software, fonts, models and services used by WorldSeed, with the exact attribution text to use.
Compiled 2026-09-26 from `docs/LEGAL.md`, `data/snapshot/LICENSE.md`, the package license files in the repository, and
the primary pages linked below (fetched 2026-09-26). This is a compliance record, not legal advice. Anything marked
**unverified** could not be confirmed from a primary source and must not be presented as settled.

Related files: `NOTICE` (short form shipped with the code), `THIRD_PARTY_LICENSES.md` (generated inventory of every
software license, with full texts for direct runtime dependencies), `data/snapshot/LICENSE.md` (the ODbL notice for the data).

WorldSeed is not affiliated with or endorsed by OpenStreetMap Foundation, OpenFreeMap, OpenMapTiles, the U.S. Census
Bureau, the State of Maryland, the Maryland Transportation Authority (MDTA), the NTSB, NVIDIA, Nebius, Tavily, Vercel, or any
agency, hospital, fire company or EMS provider.

## Where attribution appears in the running app

Read from the source on 2026-09-26; re-check after UI changes.

| Place | What it shows |
|---|---|
| Map corner (MapLibre attribution control, `attributionControl={{ compact: false }}` in `frontend/components/MapStage.tsx`) | The attribution string that OpenFreeMap's tile description carries (see the OpenFreeMap entry below). Must stay on. |
| Footer (`frontend/components/Footer.tsx`) | "(c) OpenStreetMap contributors" (linked to the OSM copyright page) (ODbL), U.S. Census Bureau ACS/TIGER/LEHD, NVIDIA Nemotron via Nebius Token Factory (Terms link), Tavily, "AI-generated text may be inaccurate". |
| About dialog (`frontend/components/AboutDialog.tsx`) | The same data credits, "Map tiles: OpenFreeMap, (c) OpenMapTiles", intended-use text, and the "not affiliated" list. |

Not shown in the app yet (as of 2026-09-26): the State of Maryland acknowledgement for the iMAP facility layers, and a link to
`THIRD_PARTY_LICENSES.md`. See the last section.

## Data

### OpenStreetMap (ODbL 1.0)

- Attribution text: `(c) OpenStreetMap contributors`, linked to https://www.openstreetmap.org/copyright.
- License: Open Database License 1.0 (https://opendatacommons.org/licenses/odbl/1-0/); contents under DbCL 1.0
  (https://opendatacommons.org/licenses/dbcl/1-0/).
- What we use: road network, facilities, place names, as of 2024-03-01T00:00:00Z (Overpass attic query), retrieved 2026-09-26.
  The files in `data/snapshot/` derived from it are a Derived Database and are licensed ODbL 1.0, not MIT. Exact list of
  files, bbox, changes made and the note that contributor metadata is absent: `data/snapshot/LICENSE.md`.
- Overpass is used at build time only; the running app never calls it.
- Whether the share-alike scope reaches beyond `data/snapshot/` (for example to the running app's combined output) is a legal
  conclusion still to be confirmed by legal review (as stated in `data/snapshot/LICENSE.md`).

### OpenFreeMap and OpenMapTiles (basemap)

- Attribution text, exactly as the OpenFreeMap tile description (`https://tiles.openfreemap.org/planet`) returned on 2026-09-26:
  `OpenFreeMap (c) OpenMapTiles Data from OpenStreetMap`, with links to https://openfreemap.org, https://www.openmaptiles.org/
  and https://www.openstreetmap.org/copyright. The repository's short form (`docs/LEGAL.md`) is
  `(c) OpenStreetMap contributors, (c) OpenMapTiles, OpenFreeMap`. MapLibre's attribution control renders the string from the tile description.
- Terms: https://openfreemap.org/tos/. The 2026-09-26 read of that page did not surface any availability promise; `docs/LEGAL.md`
  says the service offers none, so keep a fallback basemap ready. Whether the service asks anything further of high-traffic
  users is unverified.
- Style and fonts: the style is WorldSeed's own (`frontend/lib/mapStyle.ts`); map label glyphs are loaded from OpenFreeMap's hosted
  font endpoint (`https://tiles.openfreemap.org/fonts/...`). The license of those glyph fonts is unverified.

### U.S. Census Bureau (ACS, TIGER/Line, LEHD LODES)

Public domain U.S. government works. Cite in this form (from `data/snapshot/LICENSE.md`):

- U.S. Census Bureau, "Total Population," American Community Survey 5-Year Estimates, Table B01003, 2020-2024 5-year,
  https://data.census.gov/table/ACSDT5Y2024.B01003, accessed 2026-09-26.
- U.S. Census Bureau, "Tenure by Vehicles Available," American Community Survey 5-Year Estimates, Table B25044, 2020-2024 5-year,
  https://data.census.gov/table/ACSDT5Y2024.B25044, accessed 2026-09-26.
- U.S. Census Bureau, TIGER/Line Cartographic Boundary Files, 2023 (GENZ2023) 1:500k, block groups (Maryland),
  https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_24_bg_500k.zip, accessed 2026-09-26. Geometry simplified to 10 m.
- U.S. Census Bureau, Longitudinal Employer-Household Dynamics (LEHD), LEHD Origin-Destination Employment Statistics (LODES)
  version 8, Maryland, 2023 (WAC, RAC, crosswalk), https://lehd.ces.census.gov/data/lodes/LODES8/md/, accessed 2026-09-26.

Flags:

- **Census Reporter mirror.** The ACS tables were fetched through the Census Reporter API (https://api.censusreporter.org), a
  third-party service that mirrors the official ACS tables, because the official Census Data API answered keyless queries with a
  missing-key redirect on 2026-09-26. Census Reporter's own terms for API use were not reviewed: **unverified**. The
  underlying figures are Census Bureau data; say "obtained via Census Reporter" wherever the fetch path matters (the in-app
  assumptions drawer already does).
- **Census Data API notice.** "This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau."
  is required only if the official API is used. It was not used for this build. Add it if a rebuild sets `CENSUS_API_KEY`.
- **Derived estimates.** Per-hex values (population, zero-vehicle households, low-wage workers, jobs) are area-share apportionments computed by
  WorldSeed. They are not official Census Bureau figures and must be labeled as derived estimates. LODES is noise-infused
  for confidentiality. Never present these as household-level data.
- Not endorsed by the U.S. Census Bureau.

### Maryland iMAP (fire stations and hospitals)

- Layers: "Maryland Fire" (MD_Fire) and "Maryland Hospitals" (MD_Hospitals), https://mdgeodata.md.gov/imap/rest/services,
  retrieved 2026-09-26; undated live layers.
- Credit lines as printed by the layers' own copyright text (read from the service on 2026-09-26): `MD iMAP, DoIT, MCAC, MSFA`
  (fire stations) and `MD iMAP, DHMH OHCQ` (hospitals).
- License as stated by the source (recorded in `docs/DATA_SOURCES.md`): data provided "as is"; may be freely distributed as long
  as the metadata entry is not modified or deleted; derived data should acknowledge the State of Maryland. There is no
  machine-readable license. Whether that wording is satisfied by the current in-app credits is **unverified** (legal review
  pending; no acknowledgement of the State of Maryland appears in the app yet).
- Suggested acknowledgement text (not yet in the app): `Fire station and hospital locations: MD iMAP (State of Maryland), retrieved 2026-09-26.`
- Not endorsed by the State of Maryland.

### Maryland Transportation Authority (hazardous-materials tunnel rule)

- Hazardous-materials tunnel rule: Maryland Transportation Authority, cited and linked, not affiliated. Rule page:
  https://mdta.maryland.gov/TunnelRestrictionsAndVehiclePermits (accessed 2026-09-26): vehicles carrying the listed hazardous
  materials are prohibited from the Fort McHenry Tunnel (I-95) and the Baltimore Harbor Tunnel (I-895), citing COMAR 11.07.01.
  The page does not mention the Key Bridge. MDTA's Key Bridge news page (https://mdta.maryland.gov/keybridgenews) names the
  western section of I-695 as the alternate route.
- Use: paraphrase and link, at most one quoted sentence. Not endorsed by the MDTA. The license of the page text is unverified
  (State of Maryland web content, cited only). See `docs/LEGAL.md` rule 11 for the required framing ("Simulation, not route guidance").

### Published reporting (news citations)

- "Baltimore residents face daily disruptions after Key Bridge collapse", 28 March 2025 (Baltimore Fishbowl copy: 27 March 2025). Byline
  verified on both syndicated copies read 2026-09-26: Charlotte Kanner and Mira Beinart, Capital News Service. The project has been
  citing this piece as "Maryland Matters"; **unverified:** neither copy names Maryland Matters, and its canonical URL was not
  confirmed (`docs/METHODOLOGY.md` section 6.1). The republishing license is reported as CC BY-NC-ND 4.0 (**unverified**): in the app
  keep any quote to one clause and link out. Until confirmed, credit it as "Capital News Service, via Baltimore Fishbowl".
- Census Reporter: keep the "obtained via Census Reporter" credit. The OSRM demo server is never called from the running app; the ODbL
  credit stays on derived travel times.

### WorldSeed scenario catalog

`candidates.json` and `candidate_effects.json` are WorldSeed's own hypothetical options and modeled effects. No entry was
proposed, studied or endorsed by any agency.

## Software, fonts, icons

The generated inventory is `THIRD_PARTY_LICENSES.md` (regenerate with `node scripts/gen-third-party-licenses.mjs`). Highlights,
with versions as pinned in `frontend/package-lock.json` at generation time:

| Component | Use | License | Notice text |
|---|---|---|---|
| MapLibre GL JS 6.11.2 | Map rendering | BSD-3-Clause | Copyright (c) 2023, MapLibre contributors; the license file also carries Mapbox GL JS (to v1.13, BSD-3-Clause) and other bundled notices, reproduced in `THIRD_PARTY_LICENSES.md` |
| react-map-gl 8.1.3 | React bindings for the map | MIT | Copyright Vis.gl contributors; Copyright (c) 2014, Mapbox |
| deck.gl 9.4.0 (`@deck.gl/core`, `geo-layers`, `layers`, `react`) | Data layers | MIT | Copyright Vis.gl contributors |
| h3-js 4.5.0 | Hexagonal index | Apache-2.0 | Copyright 2017-2021 Uber Technologies, Inc. (its NOTICE file is reproduced in `THIRD_PARTY_LICENSES.md`) |
| lucide-react 1.48.0 | Icons | ISC | Copyright (c) 2026 Lucide Icons and Contributors; portions MIT, Copyright (c) 2013-present Cole Bemis (Feather) |
| Inter | UI font | SIL OFL 1.1 | Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter) |
| JetBrains Mono | Monospace font | SIL OFL 1.1 | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) |
| Space Grotesk | Display font for numbers and headlines | SIL OFL 1.1 | Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) |

Font notes: both are loaded with `next/font/google` (`frontend/app/layout.tsx`), which downloads them at build time and serves them
from the app's own origin. The copyright lines above were read from the Google Fonts repository copies of `OFL.txt` on
2026-09-26 (the upstream Inter repository states 2016 in its own copy). The OFL text is reproduced in `THIRD_PARTY_LICENSES.md`.
Space Grotesk, listed in earlier drafts, is not used anywhere in `frontend/` and has been removed from this list.

Items in `THIRD_PARTY_LICENSES.md` under "Needs a human look" (LGPL `sharp-libvips` optional packages, MPL-2.0 dev tools,
CC-BY-4.0 `caniuse-lite`, Python packages that ship GPL/LGPL text) are open until reviewed.

## Services and models

### NVIDIA Nemotron models on Nebius Token Factory

Model IDs the code requests (`frontend/lib/server/models.ts`; overridable with `WS_MODEL_*`; resolved at runtime against the
account's model list). **All four IDs are unverified against a live Token Factory key**: the code comment says so, and the
exact ID strings for Ultra and Nano were not printed on the public docs pages reached (`spikes/SPIKE_REPORT.md`).

| Role(s) | ID in code | Verbatim in Nebius docs? |
|---|---|---|
| planner, critic (primary) | `nvidia/Nemotron-3-Ultra-550b-a55b` | No. The spike found this casing only on a third-party price aggregator. Unverified. |
| planner, critic, parser, narrator, extractor (fallback) | `nvidia/nemotron-3-super-120b-a12b` | Yes: in the August 2026 deprecation notice (https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice), read 2026-09-26. Access on our key unverified. |
| parser, narrator, extractor (primary) | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | No. The spike guessed `nvidia/Nemotron-3-Nano-30B-A3B`; the code uses a different string. Unverified. |
| parser, extractor (fallback) | `nvidia/Nemotron-3_5-Lightning` | Yes: in the same deprecation notice (as the recommended replacement for several models). Access on our key unverified. |

Model licenses as named on the Hugging Face model cards (BF16 repositories, read 2026-09-26): Nemotron 3 Nano and Nemotron 3 Super,
NVIDIA Nemotron Open Model License (last modified 2025-12-15); Nemotron 3 Ultra and Nemotron 3.5 Lightning, OpenMDW License
Agreement, version 1.1 (OpenMDW-1.1). WorldSeed calls these models through an API and does not distribute model weights or
derivatives. Whether the copies Nebius serves carry the same terms is **unverified** (the FP8/NVFP4 variants were not checked either).

| Model (Hugging Face repository) | License named on the card |
|---|---|
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16` | NVIDIA Nemotron Open Model License, https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-nemotron-open-model-license/ |
| `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16` | NVIDIA Nemotron Open Model License (same link) |
| `nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16` | OpenMDW-1.1, https://openmdw.ai/license/1-1/ |
| `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16` | OpenMDW-1.1 (same link) |

Reading of the NVIDIA license (unverified, not legal advice): its attribution requirement ("Licensed by NVIDIA Corporation under the NVIDIA
Nemotron Model License." in a Notice file) is written for Derivative Works that You distribute. WorldSeed calls hosted models through an
API and distributes neither weights nor derivatives, so the requirement appears not to apply. Confirm before relying on it.

Use of the hosted models is governed by the Nebius Token Factory Terms of Service:
https://docs.tokenfactory.nebius.com/legal/terms-of-service. Provisions that shape the product (read 2026-09-26): use as or in a
"high-risk AI system" as defined in the EU AI Act is prohibited (hence the planning-prototype wording in `docs/LEGAL.md`); requests
must stay within the rate limits; and the terms bar use for "competitive analysis or benchmarking", so latency and reliability notes in
`docs/FEEDBACK_NOTES.md` are observations about running this app, not comparative benchmarks.

Attribution text used in the app and `NOTICE`: `AI features use NVIDIA Nemotron models served via Nebius Token Factory.` The model never
produces a displayed metric.

### Tavily (live road-closure search)

- Terms: https://www.tavily.com/terms. Relevant clause (read 2026-09-26): no use of the Services or Output "to make automated
  decisions without human oversight that have a significant adverse impact on individual rights in high-risk areas". WorldSeed
  shows results only as title, source, link and short snippet, and a person confirms any closure before it enters the model.
- Attribution text: `Live road-closure search results are provided by Tavily; linked articles remain the property of their publishers.`
- Search results and article text are not committed to the repository. Whether the terms ask for a specific attribution string:
  **unverified**.

### Vercel (hosting)

- Live site: https://worldseed-mu.vercel.app on the Hobby plan. Terms: https://vercel.com/legal/terms; fair use:
  https://vercel.com/docs/limits/fair-use-guidelines. Hobby is for non-commercial use (`docs/LEGAL.md` item 8); no ads or paid tiers
  on the deployment. Whether a hackathon cash prize counts as commercial gain is **unverified** (assessed low risk in `docs/LEGAL.md`).

## Open items

- Confirm licenses of the model copies Nebius serves (hosted Ultra, Super, Nano, Lightning) once a key can list them.
- MDTA page-text license, and the news piece's publisher (Maryland Matters vs Capital News Service), canonical URL and republishing license (see the news citations entry): unverified.
- Census Reporter terms, OpenFreeMap glyph font license, Tavily attribution wording: unverified.
- Frontend (owned elsewhere): add the State of Maryland acknowledgement to the About dialog, and link `THIRD_PARTY_LICENSES.md` from it
  (the dialog currently says "under the licenses below" without listing them).
- Legal review of ODbL share-alike scope for the derived snapshot (recorded as pending in `data/snapshot/LICENSE.md`).

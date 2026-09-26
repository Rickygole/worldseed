# License and attribution for data/snapshot/

This directory is NOT covered by the repository's MIT license. It is a database derived from OpenStreetMap
and other public sources, and the terms below apply to it. The code in `pipeline/` that produced it is MIT
licensed like the rest of the repository.

Legal conclusions here are drafts to be confirmed by legal review.

## OpenStreetMap

(c) OpenStreetMap contributors. https://www.openstreetmap.org/copyright

The road network (`graph.bin`, `graph.meta.json`, `links.geojson`), the facility locations taken from
OpenStreetMap (`facilities.json`), the place names used to label destinations (`destinations.json`), the
place, road and facility names and their edge and hex references in `gazetteer.json`, and the OSM node ids and
site names pinned in `candidates.json` are a Derived Database of OpenStreetMap data, made available under the Open Database License (ODbL) 1.0,
https://opendatacommons.org/licenses/odbl/1-0/. The individual contents of the database are licensed under the
Database Contents License (DbCL) 1.0, https://opendatacommons.org/licenses/dbcl/1-0/.

- Source data date: 2024-03-01T00:00:00Z (Overpass API attic query, `[date:"2024-03-01T00:00:00Z"]`).
- Bounding box (west, south, east, north): -76.8, 39.1, -76.4, 39.34.
- Retrieved on 2026-09-26 from https://overpass-api.de/api/interpreter, sequential queries in
  6 bbox tiles plus one facilities query and one place-name query, all cached.
- Contributor metadata (user, uid, changeset, editor timestamps) was not requested and is absent from every
  file in this directory.
- Changes made: the drivable ways were filtered by highway class, split into a directed graph of intersection
  nodes and edges, reduced to the largest strongly connected component, given free-flow travel times, and tagged
  with bridge/tunnel/hazmat flags and named links; hypothetical scenario edges (`candidates.json`, flagged
  `CANDIDATE`, disabled by default) were appended to the graph. `pipeline/` is the complete description of these
  changes.

WorldSeed is not endorsed by the OpenStreetMap Foundation.

## Maryland iMAP (State of Maryland open data)

Fire station and hospital locations and names in `facilities.json` (and the facility names in `gazetteer.json`) were merged from Maryland iMAP layers
(https://mdgeodata.md.gov/imap/rest/services): "Maryland Fire" (MD iMAP, DoIT, MCAC, MSFA) and "Maryland
Hospitals" (MD iMAP, DHMH OHCQ). The data are provided "as is" without warranty; the State of Maryland
asks that data derived from them acknowledge the State of Maryland. Retrieved 2026-09-26. Records that matched an
OpenStreetMap facility keep the OpenStreetMap coordinates and carry `sources: ["osm", "md-imap"]`.

## U.S. Census Bureau

ACS tables were obtained via the Census Reporter API (https://api.censusreporter.org), a third-party service that mirrors the official ACS tables; the official Census Data API returned a missing-key redirect for keyless queries on 2026-09-26, so it was not used.

- U.S. Census Bureau, "Total Population," American Community Survey 5-Year Estimates, Table B01003,
  2020-2024 5-year (release "ACS 2024 5-year"), https://data.census.gov/table/ACSDT5Y2024.B01003,
  accessed 2026-09-26.
- U.S. Census Bureau, "Tenure by Vehicles Available," American Community Survey 5-Year Estimates, Table B25044,
  2020-2024 5-year (release "ACS 2024 5-year"), https://data.census.gov/table/ACSDT5Y2024.B25044,
  accessed 2026-09-26.
- U.S. Census Bureau, TIGER/Line Cartographic Boundary Files, TIGER/Line cartographic boundary 2023 (GENZ2023) 1:500k, block groups (Maryland),
  https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_24_bg_500k.zip, accessed 2026-09-26. Geometry is simplified to 10 m for
  `blockgroups.geojson`.
- U.S. Census Bureau, Longitudinal Employer-Household Dynamics (LEHD), LEHD Origin-Destination Employment
  Statistics (LODES) version 8, Maryland, 2023: workplace area characteristics (WAC), residence area
  characteristics (RAC) and the geography crosswalk, https://lehd.ces.census.gov/data/lodes/LODES8/md/, accessed 2026-09-26.

The Census Bureau Data API notice is not required because the official Census Data API was not used for this build (ACS values came through Census Reporter). If a future rebuild sets CENSUS_API_KEY and uses api.census.gov, add: "This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau."

Per-hex values in `hexes.bin` (population, zero-vehicle households, low-wage workers, jobs) and the per-block-group
low-wage worker counts are apportioned estimates derived by WorldSeed (area-share apportionment; jobs placed at
block internal points). They are not official Census Bureau figures. Block-group totals in `blockgroups.json`
are the published ACS estimates (with sampling error) rounded to integers.

WorldSeed is not endorsed by the U.S. Census Bureau.

## Scenario catalog

`candidates.json` and `candidate_effects.json` are WorldSeed's own hypothetical scenario options and the modeled
effect of each. No entry was proposed, studied or endorsed by any agency, and the effects are model outputs,
not forecasts.

## Files

`manifest.json` lists every file in this directory with its sha256 and size.

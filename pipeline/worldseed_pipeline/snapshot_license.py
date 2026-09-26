"""data/snapshot/LICENSE.md, generated from the real fetch metadata so dates and vintages are never placeholders."""
from __future__ import annotations

import json
import re

from . import config, fetch_census, fetch_osm, manifest


def run() -> None:
    cm = json.loads((fetch_census.INTERIM / "census_meta.json").read_text())
    acs, lodes, tiger = cm["acs"], cm["lodes"], cm["tiger"]
    osm = manifest._osm_meta()
    w, s, e, n = config.BBOX
    year = lodes["year"]
    acs_year = re.search(r"-(\d{4})", acs["vintage"]).group(1)
    official = acs["official"]
    transport = ("the official Census Data API (api.census.gov) with the operator's key" if official else
                 "the Census Reporter API (https://api.censusreporter.org), a third-party service that mirrors the "
                 "official ACS tables; the official Census Data API returned a missing-key redirect for keyless "
                 "queries on 2026-09-26, so it was not used")
    api_notice = ("This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau."
                  if official else
                  "The Census Bureau Data API notice is not required because the official Census Data API was not used "
                  "for this build (ACS values came through Census Reporter). If a future rebuild sets CENSUS_API_KEY "
                  "and uses api.census.gov, add: \"This product uses the Census Bureau Data API but is not endorsed or "
                  "certified by the Census Bureau.\"")
    text = f"""# License and attribution for data/snapshot/

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

- Source data date: {config.OSM_DATE} (Overpass API attic query, `[date:"{config.OSM_DATE}"]`).
- Bounding box (west, south, east, north): {w}, {s}, {e}, {n}.
- Retrieved on {", ".join(osm["tilesFetchedOn"])} from {config.OVERPASS_ENDPOINTS[0]}, sequential queries in
  {fetch_osm.TILES_LON * fetch_osm.TILES_LAT} bbox tiles plus one facilities query and one place-name query, all cached.
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

ACS tables were obtained via {transport}.

- U.S. Census Bureau, "Total Population," American Community Survey 5-Year Estimates, Table B01003,
  {acs["vintage"]} (release "{acs["release"]}"), https://data.census.gov/table/ACSDT5Y{acs_year}.B01003,
  accessed {acs["fetchedAt"]}.
- U.S. Census Bureau, "Tenure by Vehicles Available," American Community Survey 5-Year Estimates, Table B25044,
  {acs["vintage"]} (release "{acs["release"]}"), https://data.census.gov/table/ACSDT5Y{acs_year}.B25044,
  accessed {acs["fetchedAt"]}.
- U.S. Census Bureau, TIGER/Line Cartographic Boundary Files, {tiger["source"]}, block groups (Maryland),
  {tiger["url"]}, accessed {tiger["fetchedAt"]}. Geometry is simplified to {config.BG_SIMPLIFY_M:.0f} m for
  `blockgroups.geojson`.
- U.S. Census Bureau, Longitudinal Employer-Household Dynamics (LEHD), LEHD Origin-Destination Employment
  Statistics (LODES) version 8, Maryland, {year}: workplace area characteristics (WAC), residence area
  characteristics (RAC) and the geography crosswalk, {config.LODES_BASE}/, accessed {lodes["fetchedAt"]}.

{api_notice}

Per-hex values in `hexes.bin` (population, zero-vehicle households, low-wage workers, jobs) and the per-block-group
low-wage worker counts are apportioned estimates derived by WorldSeed (area-share apportionment; jobs placed at
block internal points). They are not official Census Bureau figures. Block-group totals in `blockgroups.json`
are the published ACS estimates (with sampling error) rounded to integers.

WorldSeed is not endorsed by the U.S. Census Bureau.

## Rule sources

The hazmat tunnel prohibition modeled in the `hazmat_truck` class is taken from: Maryland Transportation Authority,
"Transporting Hazardous Materials Across Our Toll Facilities", https://mdta.maryland.gov/TunnelRestrictionsAndVehiclePermits,
accessed 2026-09-26. It is cited as the source of a rule; no text from the page is redistributed here.

## Scenario catalog

`candidates.json` and `candidate_effects.json` are WorldSeed's own hypothetical scenario options and the modeled
effect of each. No entry was proposed, studied or endorsed by any agency, and the effects are model outputs,
not forecasts.

## Files

`manifest.json` lists every file in this directory with its sha256 and size.
"""
    (config.SNAP / "LICENSE.md").write_text(text)
    print("LICENSE.md written")


if __name__ == "__main__":
    run()

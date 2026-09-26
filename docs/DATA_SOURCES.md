# Data sources (DRAFT)

Every number in `data/snapshot/` comes from one of the sources below or from a labeled assumption in
`pipeline/assumptions.yaml`. Legal conclusions are marked "to be confirmed by legal review". Total cost of the
pipeline: $0 (public downloads, no keys, no paid APIs).

Snapshot id `keybridge-2024-03-01-v1`, study bbox (W, S, E, N) `-76.80, 39.10, -76.40, 39.34`, H3 resolution 9.
Fetch date for every source below: 2026-09-26 (the build day).

## 1. OpenStreetMap (roads, facilities, place names)

| | |
|---|---|
| What | Drivable road network, fire stations, ambulance stations, hospitals, named place nodes |
| Where | Overpass API, `https://overpass-api.de/api/interpreter`, attic query `[date:"2024-03-01T00:00:00Z"]` |
| Vintage | 2024-03-01 (the last full snapshot before the 2024-03-26 collapse) |
| Method | Plain HTTP POST, six sequential bbox tiles (3 x 2) for roads, one query for facilities, one for places. Ways that cross tile borders are deduplicated by way id. `out body geom`, so no contributor metadata (user, uid, changeset) is ever returned. Raw JSON cached in `data/raw/` (gitignored). |
| Politeness | Identifying User-Agent (`worldseed-pipeline/0.1 (github.com/Rickygole/worldseed)`), one query at a time, retry every ~20 s on 502/503/504, 30 s x 2^n backoff on 429. Overpass is build-time only; the running app never calls it. |
| License | ODbL 1.0 for the database, DbCL 1.0 for contents. To be confirmed by legal review: share-alike scope for the derived graph in `data/snapshot/`. |
| Attribution | "(c) OpenStreetMap contributors", https://www.openstreetmap.org/copyright |
| Limitations | Volunteer-mapped; free-flow speeds only (see assumptions); `service` roads and private/no-access ways excluded; no turn restrictions. The Overpass server intermittently answered fast 504s on this build (the same query succeeded on a later try); retries are in `netutil.overpass`. |

### Key Bridge and tunnels
- The attic query returns the full bridge. `fix_keybridge.py` re-verifies the six I-695 ways
  24555622, 1026914410, 1026914409, 1026914408, 1026914407, 24555626 (tags `bridge=yes`, ref I 695, midpoint
  within 3 km of 39.2176, -76.5286, three eastbound and three westbound, and no other I-695 `bridge=yes`
  carriageway within 1.5 km) and asserts. Each way is one directed edge in the graph, so `L-KEYBRIDGE` has
  **6 edges** (the architecture example shows 2, which assumed osmnx simplification).
- Fort McHenry (I-95) ways 23014443, 23014446, 49666850, 49776148 and Harbor Tunnel (I-895) ways 23891388,
  158620176, 49666528, 158620174, 23891345, 49666525 are verified `tunnel=yes`; their edges carry `TUNNEL |
  HAZMAT_PROHIBITED` and are registered as links `L-FORTMCHENRY` (4 edges) and `L-HARBORTUNNEL` (6 edges).
  No other `tunnel=yes` motorway/trunk way with an I-95/I-895 ref or "Tunnel"/"Thruway" name exists in the data.
- The manual re-add fallback of the plan (step 8) was **not needed**; it is not implemented.
- Hazmat prohibition on both tunnels is an assumption (A-HAZMAT-TUNNELS), not re-verified against MDTA rules.

## 2. Maryland iMAP (second facilities source)

| | |
|---|---|
| What | County, municipal and state fire stations (`MD_Fire` layers 1, 2, 0) and licensed hospitals (`MD_Hospitals`) |
| Where | `https://mdgeodata.md.gov/imap/rest/services/PublicSafety/MD_Fire/FeatureServer` and `.../Health/MD_Hospitals/FeatureServer/0`, envelope query for the bbox |
| Vintage | Live layers as of 2026-09-26 (undated; no version field) |
| License | State of Maryland data disclaimer: data provided "as is", may be freely distributed as long as the metadata entry is not modified or deleted, and derived data must acknowledge the State of Maryland. Machine-readable license: none. To be confirmed by legal review. |
| Attribution | "MD iMAP, DoIT, MCAC, MSFA" (fire stations); "MD iMAP, DHMH OHCQ" (hospitals) |
| Why this one | HIFLD Open (federal) was not probed further; the state layer is complete for the bbox (78 fire stations, 14 hospitals) and needs no key. Maryland's own EMS layer (`MD_EMS`) holds only regional offices, not ambulance stations, so it was not used. |

Merge rules (`build_facilities.py`), reproducible and counted in the run output:
- Excluded by name: fire academy, communications/911 center, headquarters, maintenance, fire boat / rescue boat,
  fire marshal, training, airport crash-fire units, and OSM "Building 79" (a Coast Guard Yard building;
  unverified as public first-due). Psychiatric, children's, rehabilitation and Kennedy Krieger / Spring Grove /
  Perkins / VA hospitals are excluded from hospitals.
- Same-source duplicates within 60 m merge (OSM node + way of one station).
- An iMAP station matches an OSM station of the same kind within 250 m, or within 2.5 km when the distinguishing
  name tokens agree (iMAP geocodes some stations ~1.5 km off, e.g. Lake Shore Fire Company 20). OSM
  coordinates win. Hospitals match within 500 m.
- Facilities whose nearest street node is farther than 1,500 m are dropped (one OSM node "Fire Station" inside
  Fort Meade).
- Result: 74 fire stations (72 from OSM, 67 of which also in iMAP, plus 3 iMAP-only) + 2 EMS stations
  (OSM "FutureCare"; iMAP "Middle River Volunteer Ambulance Rescue Company") + 10 hospitals.
- iMAP-only additions (manual review of the list is recommended): Sparrows Point Station 57, Middleborough VFD
  Station 23, Violetville VFD Station 34, Middle River Volunteer Ambulance Rescue Company, University of
  Maryland Medical Center.
- `ed` on a hospital is `true` only when OSM says `emergency=yes`; otherwise `null` (unknown, not `false`).
- Limitation: all fire stations count as EMS sources (A-EMS-SOURCES). Unit counts, staffing and availability are
  not in any source. Ambulance-specific coverage remains thin. Stations outside the bbox (Howard County, Fort
  Meade, north Baltimore County) are not included, which makes bbox-edge block groups look under-served.

## 3. U.S. Census Bureau ACS 5-year (population, households, zero-vehicle households)

| | |
|---|---|
| Tables | B01003 (total population), B25044 (tenure by vehicles available). Zero-vehicle households = B25044_003E + B25044_010E. Households = B25044_001E (the plan named B11001_001; B25044_001E is the same occupied-housing-unit universe and keeps one table family). |
| Vintage | ACS 2020-2024 5-year (release `acs2024_5yr`), block-group level. The plan's example says 2018-2022; the latest available was used as instructed. |
| Path used | **Census Reporter API** `https://api.censusreporter.org/1.0/data/show/latest` (`geo_ids=150|05000US<county>`), **a third-party mirror of the official ACS tables**. The official `api.census.gov` answered every keyless data query with a 302 to `missing_key.html` on 2026-09-26. |
| Official path | Implemented in `fetch_census.py` and selected when env `CENSUS_API_KEY` is set (tries ACS 2024, then 2023, 2022). **Not exercised in this build (no key).** |
| Counties | 24510 Baltimore city, 24005 Baltimore County, 24003 Anne Arundel, 24027 Howard (added: the west edge at -76.80 takes in Elkridge and Jessup; without it 208 job-only hexes had no block group) |
| Fetch date | 2026-09-26 |
| License | US Government work (public domain). Third-party mirror terms: to be confirmed by legal review. |
| Attribution | U.S. Census Bureau, American Community Survey 5-Year Estimates. If the official Data API is used: "This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau." |
| Limitations | Block-group estimates carry sampling error (margins in the raw files; `pop_moe`, `zvh_moe` in `data/raw/interim/acs_bg.csv`). Vintage straddles the 2024 collapse. |

## 4. TIGER/Line cartographic boundary files (block-group geometry)

`https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_24_bg_500k.zip` (2023, 1:500k, Maryland block groups).
Shoreline-clipped, so land only. Public domain. Reprojected to UTM 18N (EPSG:32618) for area math; shipped
geometry (`blockgroups.geojson`) is clipped to the bbox and simplified to 10 m.

## 5. LEHD LODES8 (jobs and low-wage workers)

| | |
|---|---|
| Files | `wac/md_wac_S000_JT00_2023.csv.gz`, `rac/md_rac_S000_JT00_2023.csv.gz`, `md_xwalk.csv.gz` under `https://lehd.ces.census.gov/data/lodes/LODES8/md/` |
| Vintage | 2023 (newest year the server offered; 2022 and 2021 are the fallbacks in `config.LODES_YEARS_TRY`). 2020 Census blocks. |
| Fields | WAC `C000` (jobs by workplace block) and `CE01` (jobs with earnings <= 1,250 USD/month); RAC `CE01` (low-wage workers by home block). The architecture doc calls the low-wage field `SE01`; in LODES8 WAC/RAC the earnings bins are `CE01/CE02/CE03`. |
| Placement | Workplace jobs sit at the block internal point (`blklatdd/blklondd` from the crosswalk) and are assigned to the H3 cell containing it. RAC low-wage workers are summed to block group and apportioned to hexes by area share. |
| License | US Government work (public domain). Attribution: U.S. Census Bureau, LEHD LODES. |
| Limitations | LODES is synthetic-noise-infused for confidentiality at small geographies; low-wage is an earnings proxy. Federal military jobs are not in LODES. |

## 6. What was tried and failed / substituted

- Official Census Data API without a key: 302 to `missing_key.html`. Substituted with Census Reporter (above).
- `overpass-api.de` returned intermittent fast 504s; handled by retry (no data was substituted).
- HIFLD Open was not tried (the Maryland state layers were sufficient and reachable).
- Maryland's `MD_EMS` layer contains regional offices only: not usable for ambulance stations.
- The `geodata.md.gov` host served a "Site Maintenance" page on the build day; the same services on
  `mdgeodata.md.gov` worked and are what the pipeline uses.

## 7. Model definitions (also in `pipeline/assumptions.yaml`)

Free-flow graph, no signal/turn/congestion delay. Speeds: `maxspeed` tag else class default. Weighted quantile:
first value (sorted by value, then hex index) whose cumulative weight >= q x total weight, no interpolation.

**EMS lens** (resilience check): multi-source forward Dijkstra from all active fire and EMS stations;
`hexT = 60 s call-processing and turnout delay + travel time + snapS`; pop-weighted p50/p90; % pop within 8 min;
isolated block groups (pop-weighted BG median > 8 min); equity gap = zero-vehicle-household-weighted p90 minus
pop-weighted p90.

**Access lens** (hero): K=8 anchors from weighted k-means of LODES WAC block points (weights = jobs, seed 7),
destination = nearest street node to the cluster's job-weighted medoid block, weight w_k = cluster jobs / total.
`t_k` = reverse Dijkstra driving time hex node -> anchor (unreachable = 7,200 s cap);
`hexT = min(7200, sum_k w_k t_k + snapS)`; `added = hexT_world - hexT_baseline`; pop-weighted p50/p90 of `hexT`;
% pop with added <= 5 min; "cut-off" block groups (pop-weighted BG median added > 10 min); equity gap =
low-wage-worker-weighted mean added minus pop-weighted mean added.

## 8. Known gaps

- Candidates catalog and gazetteer are empty placeholders (later task).
- Shore assignment (`shore.py`) uses county membership plus a hand-drawn harbor divider for Baltimore city;
  cells within 250 m of the divider are "other". Checked against the Key Bridge abutments and tunnel portals,
  not against a water polygon.
- Free-flow times understate tunnel and bridge approach congestion; stress futures are a later layer.
- Anchor names are derived from OSM place nodes and can be loose (for example the anchor named after Dundalk
  sits near Seagirt / Broening Highway).

# WorldSeed snapshot pipeline (Phase 1)

Build-time Python 3.12 pipeline that turns free public data into the committed snapshot in
`data/snapshot/` (contract: `docs/ARCHITECTURE.md` section 2). No API keys, no paid services.

## Rerun

```sh
cd pipeline
export PATH="$HOME/.local/bin:$PATH"          # uv lives here
uv run --python 3.12 python -m worldseed_pipeline.run_all
uv run --python 3.12 pytest -q
```

- First run downloads (Overpass attic queries, Census Reporter, TIGER, LODES, Maryland iMAP) into `data/raw/`
  (gitignored). Overpass is slow and flaky: the first fetch took ~2.5 minutes with a few automatic retries.
  Once `data/raw/` is populated, a full run needs no network and takes about 6 to 20 minutes depending on load (candidate effects and the
  golden reference use up to 8 worker processes).
- Individual stages: `uv run --python 3.12 python -m worldseed_pipeline.<module>` for `fetch_osm`,
  `fetch_census`, `fetch_rules`, `build_graph`, `build_facilities`, `build_hexes`, `build_destinations`, `build_candidates`,
  `build_gazetteer`, `assumptions`, `golden`, `candidate_effects`, `analysis_access`, `snapshot_license`, `manifest`
  (this is the run order; `build_candidates` needs the graph, whose candidate edges come from `candidates.yaml`).
- Optional: `CENSUS_API_KEY=<key>` switches ACS to the official `api.census.gov` (untested in this build).
- Deterministic: with the same `data/raw/`, every artifact except `manifest.json`'s `builtAt` is byte-identical
  between runs (checked by `tests/test_snapshot.py::test_golden_reproducible` and the manifest hashes).

## Modules

| Module | Job |
|---|---|
| `config.py` | bbox, OSM date, counties, H3 res, class/flag tables, Key Bridge and tunnel way ids, corridors |
| `netutil.py` | cached downloads, Overpass client with backoff (sequential, identifying User-Agent) |
| `fetch_osm.py` | attic Overpass fetch: 6 road tiles, facilities, place names |
| `fix_keybridge.py` | asserts the Key Bridge and tunnel ways in the fetched data; link edge selection |
| `build_graph.py`, `graphio.py`, `binio.py` | directed drive graph, SCC, speeds, flags, corridors, CSR -> `graph.bin`/`graph.meta.json`, `links.geojson` |
| `build_facilities.py`, `snap.py` | OSM + Maryland iMAP fire/EMS/hospital merge, nearest street-node snap |
| `fetch_census.py` | ACS (Census Reporter or official API), TIGER block groups, LODES8 WAC/RAC/crosswalk |
| `build_hexes.py`, `shore.py` | H3 res-9 apportionment, snap, shore -> `hexes.bin`, `blockgroups.json/.geojson` |
| `build_destinations.py` | 8 job-weighted Access anchors -> `destinations.json` |
| `golden.py`, `worlds.py`, `xharbor.py`, `golden_util.py` | networkx (regional, EMS) and scipy (xharbor) reference fields and metrics for 6 worlds -> `golden.json` |
| `build_candidates.py`, `candidates.yaml` | hypothetical scenario catalog; temp-link edges are appended by `build_graph`; writes `candidates.json` |
| `build_gazetteer.py`, `gazetteer_match.py` | name/alias index and reference matcher -> `gazetteer.json` |
| `candidate_effects.py` | effect of each candidate alone (all lenses incl. freight), baseline and bridge-removed; kept and pruned -> `candidate_effects.json` |
| `trips.py`, `trips.yaml`, `fetch_rules.py` | freight/hazmat trip pairs (car vs hazmat_truck) -> `golden.json` key `trips`; MDTA rule check |
| `analysis_access.py` | informational effect-size sensitivity -> `access_sensitivity.json` |
| `assumptions.py`, `snapshot_license.py`, `manifest.py` | assumptions.json, LICENSE.md, sha256 manifest |

## Binary layouts

`graph.bin`: little-endian, buffers concatenated in the order of `graph.meta.json` `buffers`, each starting at a
multiple of 8 bytes (`offset` in bytes, `length` in elements, `type` in f32/f64/u32/u16/u8), so
`new Float32Array(buf, offset, length)` works directly. Order: nodeOsmId f64[N], edgeOsmWay f64[E],
nodeLon f32[N], nodeLat f32[N], edgeFrom u32[E], edgeTo u32[E], edgeTimeS f32[E], edgeLenM f32[E],
edgeCorridor u16[E], edgeClass u8[E], edgeFlags u8[E], fwdOff u32[N+1], fwdEdge u32[E], revOff u32[N+1],
revEdge u32[E]. Canonical edges are sorted by (from, to, way); `fwdEdge`/`revEdge` hold canonical edge indices.
Candidate edges (none yet) append after the real edges with class `candidate` and flag `CANDIDATE` (16); the
runtime disables them in the baseline. `hexes.bin` uses the same packing (`hexes.meta.json` also holds the
`h3` string array): lat, lng f32; node u32; snapS, pop, zvh, lowWage, jobs f32; bg u16; shore u8.

## Contract notes and deviations (tell the frontend)

- `L-KEYBRIDGE` has 6 edges (one per I-695 way), not 2. Links `L-FORTMCHENRY` (4 edges) and `L-HARBORTUNNEL`
  (6 edges) are also registered.
- Corridors: `C-I895-TUNNEL`, `C-I95-TUNNEL`, `C-I695`, `C-I95`, `C-I895`, `C-I97`, `C-BROENING`, `C-HANOVER`.
- The EMS constant is `A-CALL-TO-WHEELS` (60 s, call-processing and turnout delay). The contract text used a
  different id for it.
- Low-wage field is LODES `CE01` (contract said `SE01`). ACS vintage is 2020-2024, not 2018-2022. Households come
  from B25044_001E. Howard County (24027) is included.
- Extra, additive fields: `facilities[].sources`, `facilities[].ed`; `blockgroups[].areaShareInStudyArea`;
  `destinations[]` extras (`lowWageJobs`, `lat`, `lng`, `snapM`, `blocks`, `medoidBlock`, `nameSource`, `nameDistM`).
  `golden.json` and `access_sensitivity.json` are extra beyond the contract's file list (the latter is informational).
- Graph size: 36,610 nodes, 81,437 edges; `graph.bin` 3.81 MB raw (about 1.66 MB gzip; the four CSR buffers alone
  are 0.94 MB). The raw size is above the "CSR ~2 MB" target because the contract includes per-edge OSM way ids
  (f64) and per-node OSM ids; drop those from the served copy if the payload matters.
- `golden.json` worlds: `baseline`, `keybridge_removed`, `harbor_tunnel_closed`,
  `keybridge_and_harbor_tunnel_closed`, plus `fort_mchenry_closed`, `keybridge_and_fort_mchenry_closed`. Each has
  per-hex `hexTimeS` (seconds, 2 decimals; `null` = unreachable) for EMS and Access, plus metrics. The TS
  simulator must read `graph.bin`/`hexes.bin` as f32 (as written) and match within 0.5 s per hex. Lens
  definitions: `worldseed_pipeline/golden.py` docstring, `assumptions.yaml`, `docs/DATA_SOURCES.md` section 7.

## Round 2 additions (all additive)

- `golden.json`: the existing keys are byte-identical to round 1; a new top-level `xharbor` key holds the
  cross-harbor lens for the same 6 worlds (definition: `xharbor.py` docstring, `docs/DATA_SOURCES.md`).
  Per world: `jobsWithin1800` (per hex, null for shore-2 hexes), `meanTimeS` (per hex, seconds), `boundary`
  (hexes where the count at T -/+ 0.5 s differs; any value in `[lo, hi]` is accepted there), `metrics`, `sensitivity`
  (T = 20, 30, 40 min). Tolerances: 0.5 s for `meanTimeS`, exact jobs counts except `boundary` hexes.
- `graph.bin` / `graph.meta.json`: 14 candidate edges appended after the 81,437 real edges (edgeCount 81,451;
  class `candidate` = 8, flag `CANDIDATE` = 16). Existing edge indices, node indices and link edge lists are
  unchanged. `graph.meta.json` gains `candidateLinks` [{id, edges, nodes}]. The runtime must disable CANDIDATE
  edges in the baseline (the reference code does).
- `links.geojson`: 7 extra LineString features with `kind: "candidate"`.
- New files: `candidates.json` (was `[]`), `gazetteer.json` (was `[]`), `candidate_effects.json`.
- `assumptions.json`: new entries `A-XHARBOR-*`, `A-CANDIDATES-HYPOTHETICAL`, `A-SHUTTLE-*`, `A-CONNECTOR-SPEED`,
  `A-CORRIDOR-FACTOR-*`, `A-STAGING-DELAY`; entries may carry `min`/`max`.
- Candidate effect semantics for the simulator: `enable_edges` sets the listed edges enabled; `corridor_speed`
  divides the time of every edge of that corridor by `factor`; `add_source` adds a source at `facilityLike.node`
  with delay `delayS` (in addition to the call-processing delay, so 0 means "behaves like a station").

## Round 3 additions (all additive to file formats)

- `golden.json` key `trips` (new, after `xharbor`; earlier keys byte-identical). Schema:
  `{definition, classes: {car: {removesFlag: null}, hazmat_truck: {removesFlag: "HAZMAT_PROHIBITED"}}, worlds: [4 ids],
  tolerance: {timeS: 0.5}, anchors: [{id, name, shore, node, osmNode, lat, lng}],
  trips: [{id: "TP>HP", origin, destination, kind: "cross_harbor" | "same_shore_control", originNode, destinationNode,
  results: {car | hazmat_truck: {<world id>: {timeS, minutes, unreachable, addedS, ratio}}}}]}`.
  `timeS` is free-flow node-to-node shortest drive time (null and `unreachable: true` if no route); `addedS` and
  `ratio` are against the same class's baseline. A simulator must match `timeS` within 0.5 s.
- Vehicle class mask for point-to-point routing: `car` uses every enabled edge; `hazmat_truck` skips edges with flag
  `HAZMAT_PROHIBITED` (4) unless a hazmat window lists them. Candidate shuttle edges now carry flags
  `CANDIDATE | HAZMAT_PROHIBITED` (20); road connectors carry `CANDIDATE` (16).
- Catalog: 16 kept entries (was 24). Edge indices of candidate links changed (6 candidate edges after the 81,437 real
  edges, edgeCount 81,443). New candidate type `hazmat_window` with effect
  `{op: "allow_class_on", edges, vehicleClass: "hazmat", timePenaltyS, penaltyEdges}`: the hazmat class may use `edges`;
  each edge in `penaltyEdges` (the bore edges) adds `timePenaltyS`.
- `candidate_effects.json`: `candidates` (kept) and `pruned` (with `pruneReason`, measured effects), `pruneRules`,
  `tripIds`, `reference[ctx].tripMinutes`; every entry's contexts gain `metrics.freight` (per class: crossHarborMeanSavedS,
  maxSavedS, maxSavedTrip, tripsSaved60s, savedS aligned with `tripIds`) and benefits `freightCarMeanSavedS`,
  `freightHazmatMeanSavedS`, `freightMaxSavedS`; `helps` may include `freight`.
- Residents: `hexes.bin` `pop` is residents per hex (populated = `pop > 0`; job-only = `pop == 0 && jobs > 0`).
- `assumptions.json`: `A-HAZMAT-TUNNELS` is now `sourced` (MDTA URL, accessed 2026-09-26); new `A-TRIPS-*`,
  `A-SHUTTLE-NO-HAZMAT`, `A-HAZMAT-ESCORT-PENALTY`.

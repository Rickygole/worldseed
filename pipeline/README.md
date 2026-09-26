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
  Once `data/raw/` is populated, a full run needs no network and takes about 90 seconds.
- Individual stages: `uv run --python 3.12 python -m worldseed_pipeline.<module>` for `fetch_osm`,
  `fetch_census`, `build_graph`, `build_facilities`, `build_hexes`, `build_destinations`, `placeholders`,
  `assumptions`, `golden`, `analysis_access`, `snapshot_license`, `manifest` (this is the run order).
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
| `golden.py` | networkx reference fields and metrics for 6 worlds -> `golden.json` |
| `analysis_access.py` | informational effect-size sensitivity -> `access_sensitivity.json` |
| `assumptions.py`, `placeholders.py`, `snapshot_license.py`, `manifest.py` | assumptions.json, empty candidates/gazetteer, LICENSE.md, sha256 manifest |

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

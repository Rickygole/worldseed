# WorldSeed feasibility spike (prototype code, not production)

Everything here uses free public data only. No API keys.

## Rerun

    cd /Users/rickygole/worldseed
    uv venv --python 3.12 .venv
    uv pip install --python .venv/bin/python requests numpy scipy pandas networkx igraph h3 shapely geopandas pyarrow osmnx
    cd spikes
    ../.venv/bin/python fetch_osm.py     # Overpass (date-pinned 2024-03-01), cached in ../data/raw/ (gitignored)
    ./fetch_census.sh                    # ACS block-group tables + TIGER cartographic boundaries, cached in ../data/raw/
    ../.venv/bin/python pop.py           # -> out/bg_pop.csv
    ../.venv/bin/python check_landmarks.py   # lists Key Bridge / tunnel ways
    ../.venv/bin/python build_graph.py   # -> out/graph_2024.npz, out/key_bridge_edges.json
    ../.venv/bin/python sim.py           # benchmarks + bridge-removal effect, exports CSR for JS
    node bench.mjs                       # JS/V8 port of the Dijkstra benchmark

Captured output of a full run: `out/run_output.txt`. Findings: `SPIKE_REPORT.md`.
`out/` is regenerable; it is not gitignored.

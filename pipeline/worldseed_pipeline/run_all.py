"""Run the whole snapshot pipeline in order:  uv run --python 3.12 python -m worldseed_pipeline.run_all

Downloads are cached in data/raw/ (gitignored); once cached, re-runs use no network for the OSM/Census/LODES data.
"""
from __future__ import annotations

import sys
import time

from . import (analysis_access, assumptions, build_destinations, build_facilities, build_graph, build_hexes, config, fetch_census,
               fetch_osm, golden, manifest, placeholders, snapshot_license)


def step(name: str, fn) -> None:
    t = time.time()
    print(f"\n=== {name} ===", flush=True)
    fn()
    print(f"--- {name}: {time.time() - t:.1f}s", flush=True)


def main() -> None:
    config.SNAP.mkdir(parents=True, exist_ok=True)
    config.RAW.mkdir(parents=True, exist_ok=True)
    step("fetch_osm (Overpass attic, cached)", fetch_osm.main)
    step("fetch_census (ACS + TIGER + LODES, cached)", fetch_census.run)
    step("build_graph (+ Key Bridge / tunnel verification)", build_graph.run)
    step("build_facilities (OSM + Maryland iMAP)", build_facilities.run)
    step("build_hexes (H3 res 9, block groups)", build_hexes.run)
    step("build_destinations (Access anchors)", build_destinations.run)
    step("placeholders (candidates, gazetteer)", placeholders.run)
    step("assumptions.json", assumptions.run)
    step("golden (networkx reference)", golden.run)
    step("access sensitivity (informational)", analysis_access.run)
    step("LICENSE.md", snapshot_license.run)
    step("manifest", manifest.run)
    print("\nsnapshot written to", config.SNAP)


if __name__ == "__main__":
    sys.exit(main())

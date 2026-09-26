"""Run the whole snapshot pipeline in order:  uv run --python 3.12 python -m worldseed_pipeline.run_all

Downloads are cached in data/raw/ (gitignored); once cached, re-runs use no network for the OSM/Census/LODES data.
"""
from __future__ import annotations

import sys
import time

from . import (analysis_access, assumptions, build_candidates, build_destinations, build_facilities, build_gazetteer,
               build_graph, build_hexes, candidate_effects, config, fetch_census, fetch_osm, fetch_rules, golden, manifest,
               snapshot_license)


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
    step("fetch_rules (MDTA hazmat tunnel rule, cached and checked)", fetch_rules.run)
    step("build_graph (+ Key Bridge / tunnel verification)", build_graph.run)
    step("build_facilities (OSM + Maryland iMAP)", build_facilities.run)
    step("build_hexes (H3 res 9, block groups)", build_hexes.run)
    step("build_destinations (Access anchors)", build_destinations.run)
    step("build_candidates (candidates.json; edges were appended by build_graph)", build_candidates.run)
    step("build_gazetteer", build_gazetteer.run)
    step("assumptions.json", assumptions.run)
    step("golden (regional + xharbor reference)", golden.run)
    step("candidate effects (reference code, 2 contexts)", candidate_effects.run)
    step("access sensitivity (informational)", analysis_access.run)
    step("LICENSE.md", snapshot_license.run)
    step("manifest", manifest.run)
    print("\nsnapshot written to", config.SNAP)


if __name__ == "__main__":
    sys.exit(main())

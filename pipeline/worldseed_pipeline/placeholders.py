"""Empty-but-valid candidates.json and gazetteer.json (schemas reserved by contract section 2.3).

The hand-curated catalog (build_candidates.py) and the gazetteer (build_gazetteer.py) are a later task. Until then
both files are valid empty arrays so the snapshot contract is complete and the frontend can load every file.
"""
from __future__ import annotations

import json

from . import config

CANDIDATE_SCHEMA = {
    "id": "string", "type": "signal_priority | temp_link | prepos_site | hazmat_window | incident_mgmt",
    "title": "string", "lens": ["access", "ems"], "costTier": "$ | $$ | $$$", "costSource": "string | null",
    "leadTime": "days | weeks | months", "hypothetical": "boolean",
    "effect": "one of enable_edges | corridor_speed | add_source | allow_class_on | congestion_sigma",
    "assumptions": ["A-..."], "sources": [], "notes": "string",
}


def run() -> None:
    config.SNAP.mkdir(parents=True, exist_ok=True)
    for name in ("candidates.json", "gazetteer.json"):
        (config.SNAP / name).write_text("[]\n")
    print("placeholders: candidates.json, gazetteer.json (empty arrays)")


if __name__ == "__main__":
    run()

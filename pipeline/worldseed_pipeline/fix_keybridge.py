"""Verify the 2024-03-01 Key Bridge and tunnel ways in the fetched data; define link edge sets.

The spike proved the attic query returns the full bridge (six directed I-695 ways) and that a
node-pair diff against today's OSM is noisy, so the removal set is the explicit way-ID list in
config.KEYBRIDGE_WAY_IDS. This module re-verifies that list against the fetched tags/geometry and
asserts. If the attic data ever lacks the bridge, verification fails loudly (see docs/DATA_SOURCES.md
for the documented manual re-add fallback; it was not needed for this snapshot).
"""
from __future__ import annotations

import re

import numpy as np

from . import config
from .geo import hav_scalar


def _mid(w: dict) -> tuple[float, float]:
    g = w["geometry"]
    m = g[len(g) // 2]
    return m["lat"], m["lon"]


def is_i695(tags: dict) -> bool:
    return bool(re.search(r"(^|;|\s)I[ -]?695($|;|\s)", tags.get("ref") or ""))


def verify_keybridge(ways_by_id: dict[int, dict]) -> dict:
    """Assert the six expected ways exist with the expected tags, direction, and geometry, and that no other
    I-695 bridge=yes carriageway within the radius exists. Returns diagnostic info."""
    cen = config.KEYBRIDGE_CENTER
    info = {}
    for wid in config.KEYBRIDGE_WAY_IDS:
        assert wid in ways_by_id, f"Key Bridge way {wid} missing from the {config.OSM_DATE} data"
        w = ways_by_id[wid]
        t = w["tags"]
        assert t.get("bridge") == "yes", f"way {wid}: bridge tag is {t.get('bridge')!r}"
        assert t.get("highway") in ("motorway", "trunk"), f"way {wid}: highway {t.get('highway')!r}"
        assert is_i695(t), f"way {wid}: ref {t.get('ref')!r} is not I 695"
        lat, lon = _mid(w)
        d = hav_scalar(lat, lon, *cen)
        assert d <= config.KEYBRIDGE_RADIUS_M, f"way {wid}: midpoint {d:.0f} m from the bridge centre"
        g = w["geometry"]
        info[wid] = {"from": (g[0]["lat"], g[0]["lon"]), "to": (g[-1]["lat"], g[-1]["lon"]),
                     "oneway": t.get("oneway"), "bridge": t.get("bridge"), "maxspeed": t.get("maxspeed")}
    # Two carriageways x three ways: three go SW->NE (lon increases), three NE->SW.
    east = [w for w, i in info.items() if i["to"][1] > i["from"][1]]
    west = [w for w, i in info.items() if i["to"][1] < i["from"][1]]
    assert len(east) == 3 and len(west) == 3, f"carriageway split east={east} west={west}"
    # Nothing else that looks like a Key Bridge deck (I-695 bridge=yes carriageway) near the centre.
    others = []
    for wid, w in ways_by_id.items():
        t = w["tags"]
        if wid in config.KEYBRIDGE_WAY_IDS or t.get("bridge") != "yes" or not is_i695(t):
            continue
        if t.get("highway") not in ("motorway", "trunk"):
            continue
        lat, lon = _mid(w)
        if hav_scalar(lat, lon, *cen) <= 1500.0:
            others.append(wid)
    assert not others, f"unexpected extra I-695 bridge=yes ways within 1.5 km of the Key Bridge: {others}"
    return {"ways": info, "eastbound": sorted(east), "westbound": sorted(west)}


def verify_tunnels(ways_by_id: dict[int, dict]) -> dict:
    """Assert the tunnel bores exist with tunnel=yes, and report other tunnel=yes motorway/trunk ways near them."""
    out = {}
    for label, ids, ref in (("fort_mchenry", config.FORT_MCHENRY_WAY_IDS, "95"),
                            ("harbor", config.HARBOR_TUNNEL_WAY_IDS, "895")):
        for wid in ids:
            assert wid in ways_by_id, f"{label} tunnel way {wid} missing"
            t = ways_by_id[wid]["tags"]
            assert t.get("tunnel") == "yes", f"{label} way {wid}: tunnel={t.get('tunnel')!r}"
            assert t.get("highway") in ("motorway", "trunk"), (wid, t.get("highway"))
        out[label] = {"ways": list(ids),
                      "names": sorted({ways_by_id[w]["tags"].get("name", "") for w in ids}),
                      "refs": sorted({ways_by_id[w]["tags"].get("ref", "") for w in ids})}
    # Any other I-95/I-895 tunnel=yes ways we did not list (would be missing from the closure set)
    listed = set(config.FORT_MCHENRY_WAY_IDS) | set(config.HARBOR_TUNNEL_WAY_IDS)
    extra = []
    for wid, w in ways_by_id.items():
        t = w["tags"]
        if wid in listed or t.get("tunnel") != "yes" or t.get("highway") not in ("motorway", "trunk"):
            continue
        ref = t.get("ref") or ""
        if re.search(r"I[ -]?(95|895)\b", ref) or re.search(r"Tunnel|Thruway", t.get("name") or "", re.I):
            extra.append((wid, t.get("name"), ref))
    out["unlisted_tunnel_ways"] = extra
    return out


def link_edges(edge_way: np.ndarray, way_ids) -> list[int]:
    """Canonical edge indices whose OSM way is in way_ids."""
    s = np.isin(edge_way, np.array(sorted(way_ids), dtype=np.float64))
    return [int(i) for i in np.nonzero(s)[0]]

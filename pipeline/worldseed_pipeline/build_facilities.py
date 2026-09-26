"""facilities.json: OSM (attic 2024-03-01) fire stations, ambulance stations, hospitals, plus ONE extra public
source, Maryland iMAP (State of Maryland open data): County/Municipal/State fire stations and licensed hospitals.

Merge rules (documented in docs/DATA_SOURCES.md):
  * excluded by name: fire academy/boat/HQ/comms/maintenance/training (config + IMAP_EXCLUDE below)
  * same-source duplicates (e.g. OSM node + way for one station) within FACILITY_DEDUPE_M merge
  * an iMAP station within IMAP_MATCH_M of an OSM station of the same kind is the same station (OSM kept), or
    within IMAP_NAME_MATCH_M when the distinguishing name tokens agree (iMAP geocodes some stations ~1.5 km off)
  * facilities whose nearest street node is farther than MAX_SNAP_M are dropped (off the modeled network)
  * hospitals: iMAP 'Acute, General and Special Hospitals' + OSM hospitals with emergency=yes; psychiatric,
    children's and rehab hospitals are excluded. `ed` is true only when OSM says emergency=yes, else null.
"""
from __future__ import annotations

import json
import re

import numpy as np

from . import config, fetch_osm, netutil
from .geo import hav_scalar
from .graphio import Graph
from .snap import SnapIndex

IMAP = "https://mdgeodata.md.gov/imap/rest/services"
IMAP_LAYERS = {
    "fire_state": f"{IMAP}/PublicSafety/MD_Fire/FeatureServer/0",
    "fire_county": f"{IMAP}/PublicSafety/MD_Fire/FeatureServer/1",
    "fire_municipal": f"{IMAP}/PublicSafety/MD_Fire/FeatureServer/2",
    "hospitals": f"{IMAP}/Health/MD_Hospitals/FeatureServer/0",
}
IMAP_MATCH_M = 250.0          # same station if within this distance ...
IMAP_NAME_MATCH_M = 2500.0    # ... or within this distance AND the distinguishing name tokens agree
MAX_SNAP_M = 1500.0           # a facility farther than this from any street node is off the modeled network
# Not first-due community response units: training/comms/admin, boats, airport crash units, and OSM "Building 79"
# (a Coast Guard Yard building; a federal installation, not verified as public first-due).
IMAP_EXCLUDE = re.compile(r"academy|communications|comms|headquarters|maintenance|911 center|fire boat|fireboat|"
                          r"rescue boat|fire marshal|training|crash fire|^building 79$", re.I)
GENERIC_TOKENS = {"fire", "station", "company", "co", "department", "dept", "volunteer", "vol", "baltimore", "county",
                  "city", "association", "assn", "firemens", "firemen", "rescue", "ambulance", "the", "of", "and",
                  "engine", "truck", "md", "inc", "hose", "fd", "vfd", "vfc", "fc", "point", "river", "neck"}


def name_tokens(name: str) -> set[str]:
    toks = re.findall(r"[a-z]+", name.lower())
    return {t for t in toks if t not in GENERIC_TOKENS and len(t) > 2}


def same_station(a: dict, b: dict) -> bool:
    d = hav_scalar(a["lat"], a["lng"], b["lat"], b["lng"])
    if d <= IMAP_MATCH_M:
        return True
    ta, tb = name_tokens(a["name"]), name_tokens(b["name"])
    common = ta & tb
    return d <= IMAP_NAME_MATCH_M and bool(common) and len(common) / len(ta | tb) >= 0.5
HOSPITAL_EXCLUDE = re.compile(r"psychiatric|rehabilit|children|kennedy krieger|spring grove|perkins|va medical", re.I)


def fetch_imap() -> dict[str, list[dict]]:
    w, s, e, n = config.BBOX
    out = {}
    for key, url in IMAP_LAYERS.items():
        params = {"where": "1=1", "geometry": f"{w},{s},{e},{n}", "geometryType": "esriGeometryEnvelope",
                  "inSR": 4326, "outSR": 4326, "outFields": "*", "f": "json"}
        p = netutil.http_get(url + "/query", f"imap_{key}_bbox_v1.json", params=params, timeout=120)
        js = json.loads(p.read_text())
        assert "error" not in js, (key, js.get("error"))
        out[key] = js["features"]
    return out


def _osm_items() -> list[dict]:
    items = []
    for el in fetch_osm.load_facilities_raw():
        t = el.get("tags", {})
        lat = el.get("lat") if el["type"] == "node" else el.get("center", {}).get("lat")
        lon = el.get("lon") if el["type"] == "node" else el.get("center", {}).get("lon")
        if lat is None:
            continue
        am, em = t.get("amenity"), t.get("emergency")
        if am == "fire_station":
            kind = "fire_station"
        elif am == "hospital":
            kind = "hospital"
        elif em == "ambulance_station" or am == "ambulance_station":
            kind = "ems_station"
        else:
            continue
        name = (t.get("name") or t.get("official_name") or t.get("operator") or "").strip()
        items.append({"kind": kind, "name": name, "lat": float(lat), "lng": float(lon),
                      "osm": f"{el['type']}/{el['id']}", "source": "osm",
                      "emergency": t.get("emergency") if kind == "hospital" else None})
    return items


def _excluded(name: str) -> bool:
    n = name.lower()
    return any(x in n for x in config.FACILITY_EXCLUDE_NAME_SUBSTR) or bool(IMAP_EXCLUDE.search(name))


def _merge_same_source(items: list[dict]) -> list[dict]:
    """Merge same-kind items within FACILITY_DEDUPE_M; prefer node over way/relation and named over unnamed."""
    items = sorted(items, key=lambda x: (x["kind"], x["lat"], x["lng"], x["osm"] or ""))
    out: list[dict] = []
    for it in items:
        dup = None
        for o in out:
            if o["kind"] == it["kind"] and hav_scalar(o["lat"], o["lng"], it["lat"], it["lng"]) <= config.FACILITY_DEDUPE_M:
                dup = o
                break
        if dup is None:
            out.append(dict(it))
        else:
            if not dup["name"] and it["name"]:
                dup["name"] = it["name"]
            if dup["emergency"] is None:
                dup["emergency"] = it["emergency"]
    return out


def build(g: Graph) -> tuple[list[dict], dict]:
    osm_all = _osm_items()
    stats = {"osmRaw": len(osm_all)}
    osm = [x for x in osm_all if not _excluded(x["name"])]
    stats["osmExcludedByName"] = len(osm_all) - len(osm)
    osm = [x for x in _merge_same_source(osm)]
    # OSM hospitals: keep only emergency=yes
    osm = [x for x in osm if x["kind"] != "hospital" or x["emergency"] == "yes"]
    stats["osmAfterDedupe"] = {k: sum(1 for x in osm if x["kind"] == k) for k in ("fire_station", "ems_station", "hospital")}

    imap = fetch_imap()
    im_fire, im_hosp = [], []
    for key in ("fire_state", "fire_county", "fire_municipal"):
        for f in imap[key]:
            a, geo = f["attributes"], f["geometry"]
            name = (a.get("StationName") or "").strip()
            kind = "ems_station" if re.search(r"ambulance", name, re.I) else "fire_station"
            im_fire.append({"kind": kind, "name": name, "lat": geo["y"], "lng": geo["x"], "osm": None,
                            "source": "md-imap", "emergency": None, "county": a.get("County"), "imapLayer": key})
    for f in imap["hospitals"]:
        a, geo = f["attributes"], f["geometry"]
        name = (a.get("Facility_Name") or "").strip()
        name = re.sub(r"\s+", " ", name)
        if a.get("Type") != "Acute, General and Special Hospitals" or HOSPITAL_EXCLUDE.search(name):
            continue
        im_hosp.append({"kind": "hospital", "name": name.title(), "lat": geo["y"], "lng": geo["x"], "osm": None,
                        "source": "md-imap", "emergency": None, "county": a.get("County")})
    stats["imapRaw"] = {"fire": len(im_fire), "hospitalsAcute": len(im_hosp)}
    im_fire_x = [x for x in im_fire if not _excluded(x["name"])]
    stats["imapFireExcludedByName"] = len(im_fire) - len(im_fire_x)
    im_fire_x = _merge_same_source(im_fire_x)

    merged = [dict(x, sources=["osm"]) for x in osm]
    added = {"fire_station": 0, "ems_station": 0, "hospital": 0}
    matched = {"fire_station": 0, "ems_station": 0, "hospital": 0}
    for it in im_fire_x + _merge_same_source(im_hosp):
        best, bd = None, 1e18
        for o in merged:
            if o["kind"] != it["kind"]:
                continue
            d = hav_scalar(o["lat"], o["lng"], it["lat"], it["lng"])
            # hospitals are big campuses: allow a wider match radius (documented)
            ok = d <= 500.0 if it["kind"] == "hospital" else same_station(o, it)
            if ok and d < bd:
                best, bd = o, d
        if best is not None:
            best["sources"].append("md-imap")
            best["imapName"] = it["name"]
            matched[it["kind"]] += 1
        else:
            merged.append(dict(it, sources=["md-imap"]))
            added[it["kind"]] += 1
    stats["imapMatchedToOsm"] = matched
    stats["imapAdded"] = added

    snap = SnapIndex(g)
    nodes, dist = snap.query([x["lat"] for x in merged], [x["lng"] for x in merged])
    far = [x["name"] for x, dm in zip(merged, dist) if dm > MAX_SNAP_M]
    stats["droppedFarFromNetwork"] = far
    keep = dist <= MAX_SNAP_M
    merged = [x for x, k in zip(merged, keep) if k]
    nodes, dist = nodes[keep], dist[keep]
    order = sorted(range(len(merged)), key=lambda i: (merged[i]["kind"], round(merged[i]["lat"], 5), round(merged[i]["lng"], 5)))
    merged = [merged[i] for i in order]
    nodes, dist = nodes[order], dist[order]
    prefix = {"fire_station": "FIRE", "ems_station": "EMS", "hospital": "HOSP"}
    counters: dict[str, int] = {}
    out = []
    for x, nd, dm in zip(merged, nodes, dist):
        counters[x["kind"]] = counters.get(x["kind"], 0) + 1
        rec = {"id": f"F-{prefix[x['kind']]}-{counters[x['kind']]:03d}", "kind": x["kind"],
               "name": x["name"] or "(unnamed)", "lat": round(x["lat"], 6), "lng": round(x["lng"], 6),
               "node": int(nd), "snapM": round(float(dm), 1), "osm": x["osm"], "active": True,
               "sources": x["sources"]}
        if x["kind"] == "hospital":
            rec["ed"] = True if x["emergency"] == "yes" else None
        out.append(rec)
    stats["final"] = {k: counters.get(k, 0) for k in ("fire_station", "ems_station", "hospital")}
    stats["maxSnapM"] = float(max(x["snapM"] for x in out))
    stats["unmatchedNames"] = {"osmOnly": sorted(x["name"] for x in out if x["sources"] == ["osm"] and x["kind"] != "hospital"),
                               "imapOnly": sorted(x["name"] for x in out if x["sources"] == ["md-imap"])}
    return out, stats


def run() -> dict:
    from .graphio import load_graph
    g = load_graph()
    fac, stats = build(g)
    (config.SNAP / "facilities.json").write_text(json.dumps(fac, indent=1) + "\n")
    print("facilities:", stats)
    return stats


if __name__ == "__main__":
    run()

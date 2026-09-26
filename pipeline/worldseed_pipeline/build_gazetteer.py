"""gazetteer.json: deterministic name -> graph reference index for free-text matching (contract section 2.3).

Entries: neighborhoods (OSM place nodes -> nearest hexes), major roads (motorway/trunk/primary/secondary ways
-> canonical edges), facilities, links, corridors. Aliases are matched after `gazetteer_match.normalize`.
A normalized alias may point to only one entry: collisions keep the entry with the higher-priority kind
(link > corridor > facility > road > neighborhood); same-kind collisions keep the entry with the larger footprint
(roads: more edges, neighborhoods: more hexes) when sizes differ, else drop the alias from all entries involved. Dropped aliases are listed in data/raw/interim/gazetteer_diag.json.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict

import numpy as np
from sklearn.neighbors import BallTree

from . import binio, build_graph, config, fetch_osm
from .geo import R_EARTH_M
from .gazetteer_match import KIND_PRIORITY, normalize
from .graphio import load_graph

PLACE_TYPES = ("city", "town", "suburb", "neighbourhood", "quarter", "village")
NEIGHBORHOOD_MAX_M = 3000.0
ROAD_CLASSES = ("motorway", "trunk", "primary", "secondary")
ABBR = [("street", "st"), ("avenue", "ave"), ("highway", "hwy"), ("road", "rd"), ("boulevard", "blvd"),
        ("drive", "dr"), ("parkway", "pkwy"), ("expressway", "expy"), ("pike", "pike"), ("lane", "ln")]

LINK_ALIASES = {
    "L-KEYBRIDGE": ["Key Bridge", "Francis Scott Key Bridge", "Francis Scott Key", "Baltimore Key Bridge",
                    "FSK Bridge", "Beltway bridge", "I-695 bridge", "I-695 Key Bridge", "Key Bridge I-695"],
    "L-FORTMCHENRY": ["Fort McHenry Tunnel", "McHenry Tunnel", "I-95 tunnel", "I-95 Fort McHenry Tunnel",
                      "Fort McHenry Tunnel I-95"],
    "L-HARBORTUNNEL": ["Harbor Tunnel", "Baltimore Harbor Tunnel", "Harbor Tunnel Thruway", "I-895 tunnel",
                       "I-895 Harbor Tunnel", "Harbor Tunnel Thruway I-895", "Thruway tunnel"],
}
CORRIDOR_ALIASES = {
    "C-I895-TUNNEL": ["Harbor Tunnel bores", "Harbor Tunnel corridor"],
    "C-I95-TUNNEL": ["Fort McHenry Tunnel bores", "Fort McHenry Tunnel corridor"],
    "C-I695": ["Beltway corridor", "Baltimore Beltway corridor", "I-695 corridor"],
    "C-I95": ["I-95 corridor", "Interstate 95 corridor"],
    "C-I895": ["I-895 corridor", "Harbor Tunnel approaches", "I-895 approaches"],
    "C-I97": ["I-97 corridor", "Interstate 97 corridor"],
    "C-BROENING": ["Broening Highway corridor", "Broening Hwy corridor"],
    "C-HANOVER": ["Hanover Street corridor", "Hanover St corridor"],
}


def slug(s: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", s.upper()).strip("-")


def variants(name: str) -> list[str]:
    """The name, plus street-suffix abbreviation variants (Street<->St etc.)."""
    out = {name}
    n = normalize(name)
    for long, short in ABBR:
        if re.search(rf"\b{long}\b", n):
            out.add(re.sub(rf"\b{long}\b", short, n))
        if re.search(rf"\b{short}\b", n):
            out.add(re.sub(rf"\b{short}\b", long, n))
    return sorted(out)


def ref_variants(ref: str) -> list[str]:
    """'I 695' -> I 695, I-695, I695, Interstate 695; 'MD 295' -> MD 295, MD-295, Maryland Route 295, Route 295; 'US 40'."""
    out = {ref}
    m = re.match(r"^(I|US|MD)[ -]?(\d+)([A-Z]?)$", ref.strip())
    if m:
        pre, num, suf = m.groups()
        num = num + suf
        out |= {f"{pre} {num}", f"{pre}-{num}", f"{pre}{num}"}
        if pre == "I":
            out.add(f"Interstate {num}")
        elif pre == "MD":
            out |= {f"Maryland Route {num}", f"MD Route {num}"}
        elif pre == "US":
            out |= {f"US Route {num}", f"U.S. {num}"}
    return sorted(out)


def build() -> tuple[list[dict], dict]:
    g = load_graph()
    ways = build_graph.load_ways()
    hx_meta = json.loads((config.SNAP / "hexes.meta.json").read_text())
    hx = binio.unpack((config.SNAP / "hexes.bin").read_bytes(), hx_meta["buffers"])
    hlat, hlng = hx["lat"].astype(float), hx["lng"].astype(float)
    facilities = json.loads((config.SNAP / "facilities.json").read_text())
    entries: list[dict] = []

    # ---- neighborhoods -----------------------------------------------------------------------------
    places = [p for p in fetch_osm.load_places() if p["place"] in PLACE_TYPES]
    places.sort(key=lambda p: (normalize(p["name"]), p["osm"]))
    tree = BallTree(np.radians(np.array([[p["lat"], p["lng"]] for p in places])), metric="haversine")
    d, i = tree.query(np.radians(np.column_stack([hlat, hlng])), k=1)
    by_place: dict[int, list[int]] = defaultdict(list)
    for h, (dd, ii) in enumerate(zip(d[:, 0] * R_EARTH_M, i[:, 0])):
        if dd <= NEIGHBORHOOD_MAX_M:
            by_place[int(ii)].append(h)
    merged: dict[str, dict] = {}
    for pi, hs in sorted(by_place.items()):
        p = places[pi]
        key = normalize(p["name"])
        m = merged.setdefault(key, {"name": p["name"], "hexes": [], "lat": p["lat"], "lng": p["lng"], "osm": []})
        m["hexes"] += hs
        m["osm"].append(p["osm"])
    for key, m in sorted(merged.items()):
        entries.append({"id": f"G-{slug(m['name'])}", "name": m["name"],
                        "aliases": sorted({m["name"], f"{m['name']} MD", f"{m['name']} Maryland"}),
                        "kind": "neighborhood", "ref": {"hexes": sorted(set(m["hexes"]))},
                        "lat": round(m["lat"], 6), "lng": round(m["lng"], 6), "osm": m["osm"]})

    # ---- roads -------------------------------------------------------------------------------------------
    groups: dict[str, dict] = {}
    for wid, w in ways.items():
        t = w["tags"]
        if t.get("highway") not in ROAD_CLASSES:
            continue
        refs = [r.strip() for r in re.split(r";", t.get("ref") or "") if r.strip()]
        name = (t.get("name") or "").strip()
        key = name or (refs[0] if refs else "")
        if not key:
            continue
        gp = groups.setdefault(key, {"names": set(), "refs": set(), "ways": set(), "cls": t["highway"]})
        if name:
            gp["names"].add(name)
        gp["refs"].update(refs)
        gp["ways"].add(wid)
    edge_way = g.edgeOsmWay
    for key in sorted(groups):
        gp = groups[key]
        edges = np.nonzero(np.isin(edge_way, np.array(sorted(gp["ways"]), dtype=np.float64)) &
                           ((g.edgeFlags & config.FLAGS["CANDIDATE"]) == 0))[0]
        if len(edges) < 2:
            continue
        nodes = np.unique(np.concatenate([g.edgeFrom[edges], g.edgeTo[edges]]))
        display = sorted(gp["names"])[0] if gp["names"] else key
        rr = sorted(gp["refs"])
        title = f"{display} ({rr[0]})" if rr and gp["names"] else display
        al = set()
        for r in gp["refs"]:
            al.update(ref_variants(r))
        for nm in gp["names"]:
            al.update(variants(nm))
        entries.append({"id": f"G-RD-{slug(key)}", "name": title, "aliases": sorted(al), "kind": "road",
                        "ref": {"edges": [int(e) for e in edges]},
                        "lat": round(float(g.nodeLat[nodes].mean()), 6), "lng": round(float(g.nodeLon[nodes].mean()), 6)})

    # ---- facilities -----------------------------------------------------------------------------------------
    for f in facilities:
        al = {f["name"]} | set(variants(f["name"]))
        if f.get("imapName"):
            al.add(f["imapName"])
        entries.append({"id": f"G-FAC-{f['id'][2:]}", "name": f["name"], "aliases": sorted(al), "kind": "facility",
                        "ref": {"facility": f["id"]}, "lat": f["lat"], "lng": f["lng"]})

    # ---- links and corridors ------------------------------------------------------------------------------
    for l in g.meta["links"]:
        e = np.array(l["edges"])
        entries.append({"id": f"G-{l['id'][2:]}", "name": l["name"], "aliases": LINK_ALIASES[l["id"]], "kind": "link",
                        "ref": {"link": l["id"]},
                        "lat": round(float(g.nodeLat[g.edgeFrom[e]].mean()), 6), "lng": round(float(g.nodeLon[g.edgeFrom[e]].mean()), 6)})
    for k, c in enumerate(g.meta["corridors"]):
        e = np.nonzero(g.edgeCorridor == k)[0]
        entries.append({"id": f"G-COR-{c['id'][2:]}", "name": f"{c['name']} corridor", "aliases": CORRIDOR_ALIASES[c["id"]],
                        "kind": "corridor", "ref": {"corridor": c["id"]},
                        "lat": round(float(g.nodeLat[g.edgeFrom[e]].mean()), 6), "lng": round(float(g.nodeLon[g.edgeFrom[e]].mean()), 6)})

    # ---- unique ids, alias collision resolution ------------------------------------------------------------
    seen: dict[str, int] = {}
    for e in entries:
        seen[e["id"]] = seen.get(e["id"], 0) + 1
        if seen[e["id"]] > 1:
            e["id"] = f"{e['id']}-{seen[e['id']]}"
    owners: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        e["aliases"] = sorted({normalize(a) for a in e["aliases"] + [e["name"]]} - {""})
        for a in e["aliases"]:
            owners[a].append(e)
    dropped = []
    for a, es in owners.items():
        if len(es) < 2:
            continue
        best = min(KIND_PRIORITY[e["kind"]] for e in es)
        top = [e for e in es if KIND_PRIORITY[e["kind"]] == best]
        keep = top[0] if len(top) == 1 else None
        if keep is None and top[0]["kind"] in ("road", "neighborhood"):
            # same-kind collision on a road / neighborhood: the entry with the larger footprint keeps the alias
            size = lambda e: len(next(iter(e["ref"].values())))  # noqa: E731
            top.sort(key=lambda e: (-size(e), e["id"]))
            if size(top[0]) > size(top[1]):
                keep = top[0]
        for e in es:
            if e is not keep:
                e["aliases"].remove(a)
        dropped.append({"alias": a, "kept": keep["id"] if keep else None, "dropped": [e["id"] for e in es if e is not keep]})
    # entries left without any alias are useless for matching
    entries = [e for e in entries if e["aliases"]]
    entries.sort(key=lambda e: (KIND_PRIORITY[e["kind"]], e["id"]))
    diag = {"droppedAliasCollisions": dropped, "counts": {k: sum(1 for e in entries if e["kind"] == k) for k in KIND_PRIORITY}}
    return entries, diag


def run() -> list[dict]:
    entries, diag = build()
    for e in entries:
        e.pop("osm", None)
    (config.SNAP / "gazetteer.json").write_text(json.dumps(entries, separators=(",", ":")) + "\n")
    (config.RAW / "interim").mkdir(parents=True, exist_ok=True)
    (config.RAW / "interim" / "gazetteer_diag.json").write_text(json.dumps(diag, indent=1))
    print("gazetteer.json:", diag["counts"], f"alias collisions handled: {len(diag['droppedAliasCollisions'])}")
    return entries


if __name__ == "__main__":
    run()

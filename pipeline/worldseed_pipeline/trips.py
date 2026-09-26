"""Freight / hazmat point-to-point trips (golden.json key `trips`).

WHY. Both Baltimore harbor tunnels prohibit vehicles carrying listed hazardous materials (MDTA, cited in
assumptions A-HAZMAT-TUNNELS); the Key Bridge did not. Removing the bridge therefore costs a hazmat truck its only
short harbor crossing, while a car can still use the tunnels. The trip set below was defined before results were
seen (pipeline/trips.yaml).

DEFINITION.
  anchors      7 real road nodes: north/east bank TP (Tradepoint Atlantic), DMT (Dundalk Marine Terminal /
               Seagirt-Broening), EDG (Edgemere); south/west bank HP (Hawkins Point), CB (Curtis Bay), FF
               (Fairfield), GBI (Glen Burnie industrial).
  pairs        every north anchor with every south anchor (12 cross-harbor pairs) plus 4 same-shore controls
               (TP-DMT, EDG-DMT, HP-CB, FF-CB); every pair in BOTH directions (32 trips).
  classes      car: all enabled edges.  hazmat_truck: edges flagged HAZMAT_PROHIBITED are removed (both tunnels'
               bores, and shuttle links) unless a world lists them in hazmat_allowed (allow_class_on).
  worlds       baseline, keybridge_removed, harbor_tunnel_closed, keybridge_and_harbor_tunnel_closed.
  time         free-flow node-to-node shortest drive time, seconds (no snap time, no dwell, no loading).
  unreachable  no route in that world/class: timeS null and unreachable true. If baseline is null, added/ratio are null.
  added, ratio added = world - baseline (seconds); ratio = world / baseline.
Tolerance for the simulator: timeS within 0.5 s per trip and class.
Not modeled: any hazmat routing rule other than the two tunnel prohibitions (for example restrictions on city
streets, time-of-day rules, permits), vehicle size limits, tolls, congestion.
"""
from __future__ import annotations

import json

import numpy as np
import yaml
from scipy.sparse.csgraph import dijkstra

from . import build_candidates, config, worlds as worlds_mod
from .worlds import VEHICLES, World

TRIPS_YAML = config.PIPELINE_DIR / "trips.yaml"
TRIP_WORLDS = ["baseline", "keybridge_removed", "harbor_tunnel_closed", "keybridge_and_harbor_tunnel_closed"]
TOLERANCE_S = 0.5


def load_spec() -> dict:
    return yaml.safe_load(TRIPS_YAML.read_text())


def resolve(g, ways) -> tuple[list[dict], list[dict]]:
    """Returns (anchors, trips). trips: dicts with id, origin, destination anchor ids, kind, and node ids."""
    spec = load_spec()
    osm_to_idx = {int(o): i for i, o in enumerate(g.nodeOsmId)}
    names = build_candidates._node_names(ways)
    anchors = []
    for a in spec["anchors"]:
        node = build_candidates.resolve_node(a, f"trips anchor {a['id']}", osm_to_idx, names)
        anchors.append({"id": a["id"], "name": a["name"], "shore": a["shore"], "node": node, "osmNode": a["osmNode"],
                        "lat": round(float(g.nodeLat[node]), 6), "lng": round(float(g.nodeLon[node]), 6)})
    by = {a["id"]: a for a in anchors}
    pairs = [(n, s, "cross_harbor") for n in spec["cross_harbor"]["north"] for s in spec["cross_harbor"]["south"]]
    pairs += [(a, b, "same_shore_control") for a, b in spec["controls"]]
    trips = []
    for a, b, kind in pairs:
        if kind == "cross_harbor":
            assert by[a]["shore"] != by[b]["shore"], (a, b)
        else:
            assert by[a]["shore"] == by[b]["shore"], (a, b)
        for o, d in ((a, b), (b, a)):
            trips.append({"id": f"{o}>{d}", "origin": o, "destination": d, "kind": kind,
                          "originNode": by[o]["node"], "destinationNode": by[d]["node"]})
    return anchors, trips


def trip_times(g, w: World, trips: list[dict], vehicle: str) -> np.ndarray:
    """Seconds per trip (inf when unreachable) for one world and vehicle class."""
    A = worlds_mod.matrix(g, w, vehicle)
    origins = sorted({t["originNode"] for t in trips})
    d = dijkstra(A, directed=True, indices=origins)
    row = {o: i for i, o in enumerate(origins)}
    return np.array([d[row[t["originNode"]], t["destinationNode"]] for t in trips])


def compute(g, links: dict, ways, world_defs: list[dict]) -> dict:
    anchors, trips = resolve(g, ways)
    wmap = {wd["id"]: World(id=wd["id"], disabled=frozenset(e for lid in wd["closedLinks"] for e in links[lid]))
            for wd in world_defs if wd["id"] in TRIP_WORLDS}
    times = {c: {wid: trip_times(g, w, trips, c) for wid, w in wmap.items()} for c in VEHICLES}
    out_trips = []
    for k, t in enumerate(trips):
        rec = dict(t)
        rec["results"] = {}
        for c in VEHICLES:
            base = times[c]["baseline"][k]
            per = {}
            for wid in TRIP_WORLDS:
                x = times[c][wid][k]
                ok = bool(np.isfinite(x))
                per[wid] = {"timeS": round(float(x), 2) if ok else None,
                            "minutes": round(float(x) / 60, 2) if ok else None,
                            "unreachable": not ok,
                            "addedS": round(float(x - base), 2) if ok and np.isfinite(base) else None,
                            "ratio": round(float(x / base), 3) if ok and np.isfinite(base) and base > 0 else None}
            rec["results"][c] = per
        out_trips.append(rec)
    return {
        "definition": "worldseed_pipeline/trips.py docstring; pipeline/trips.yaml; assumptions A-TRIPS-*, A-HAZMAT-TUNNELS",
        "classes": {"car": {"removesFlag": None}, "hazmat_truck": {"removesFlag": "HAZMAT_PROHIBITED"}},
        "worlds": TRIP_WORLDS,
        "tolerance": {"timeS": TOLERANCE_S},
        "anchors": anchors,
        "trips": out_trips,
    }

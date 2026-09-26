"""candidates.yaml -> appended candidate graph edges (in build_graph) and data/snapshot/candidates.json.

Two phases:
  * temp_link_edges(): called by build_graph while the node table is being built. Resolves each temporary
    link's two OSM node ids to node indices, checks that the ways touching the node carry one of the expected
    names, and returns directed candidate edges (a->b then b->a per link, in catalog order).
  * run(): after graph.bin exists, resolves everything else (corridors, staging sites), cross-checks the link edge
    indices recorded in graph.meta.json, validates the catalog, and writes candidates.json.

Every unresolved reference raises: the build fails rather than shipping a broken catalog.
Cost tiers are relative labels only; no dollar figures anywhere. All entries are hypothetical scenario options.
"""
from __future__ import annotations

import json
import re

import numpy as np
import yaml

from . import config
from .geo import hav_scalar
from .graphio import load_graph

CAT_YAML = config.PIPELINE_DIR / "candidates.yaml"
TYPES = ("temp_link", "signal_priority", "prepos_site")
KINDS = {"temp_link": "temporary_link", "signal_priority": "corridor_priority", "prepos_site": "staging_site"}
TIERS = ("$", "$$", "$$$")
LEADS = ("days", "weeks", "months")
LENSES = ("access", "xharbor", "ems")


class CatalogError(RuntimeError):
    pass


def load_catalog() -> list[dict]:
    doc = yaml.safe_load(CAT_YAML.read_text())
    return doc["candidates"]


def assumption_map() -> dict[str, dict]:
    doc = yaml.safe_load(config.ASSUMPTIONS_YAML.read_text())
    return {a["id"]: a for a in doc["assumptions"]}


def _node_names(ways: dict[int, dict]) -> dict[int, set[str]]:
    out: dict[int, set[str]] = {}
    for w in ways.values():
        nm = w["tags"].get("name")
        if not nm:
            continue
        for n in w["nodes"]:
            out.setdefault(n, set()).add(nm)
    return out


def resolve_node(ref: dict, where: str, osm_to_idx: dict[int, int], names: dict[int, set[str]]) -> int:
    osm = int(ref["osmNode"])
    if osm not in osm_to_idx:
        raise CatalogError(f"{where}: OSM node {osm} is not in the graph (unresolved)")
    have = names.get(osm, set())
    expect = ref.get("expectNames") or []
    if expect and not (set(expect) & have):
        raise CatalogError(f"{where}: OSM node {osm} touches ways named {sorted(have)}, expected one of {expect}")
    return osm_to_idx[osm]


def temp_link_edges(nodes_osm: np.ndarray, lat: np.ndarray, lon: np.ndarray, ways: dict[int, dict]):
    """Returns (edge_specs, infos). edge_specs: dicts {from,to,lenM,timeS} for build_graph; infos[cand id] holds
    node indices, edge offsets (relative to the first candidate edge) and geometry."""
    am = assumption_map()
    osm_to_idx = {int(o): i for i, o in enumerate(nodes_osm)}
    names = _node_names(ways)
    specs, infos = [], {}
    for c in load_catalog():
        if c["type"] != "temp_link":
            continue
        link = c["link"]
        a = resolve_node(link["a"], f"{c['id']}.a", osm_to_idx, names)
        b = resolve_node(link["b"], f"{c['id']}.b", osm_to_idx, names)
        if a == b:
            raise CatalogError(f"{c['id']}: both ends are the same node")
        length = hav_scalar(float(lat[a]), float(lon[a]), float(lat[b]), float(lon[b]))
        if link["mode"] == "shuttle":
            t = float(am["A-SHUTTLE-WAIT"]["value"]) + length / float(am["A-SHUTTLE-SPEED"]["value"])
        elif link["mode"] == "road":
            t = length / (float(am["A-CONNECTOR-SPEED"]["value"]) * config.MPH_TO_MPS)
        else:
            raise CatalogError(f"{c['id']}: unknown link mode {link['mode']!r}")
        off = len(specs)
        specs.append({"from": a, "to": b, "lenM": length, "timeS": t})
        specs.append({"from": b, "to": a, "lenM": length, "timeS": t})
        infos[c["id"]] = {"nodes": [a, b], "offsets": [off, off + 1], "lenM": length, "timeS": t,
                          "geometry": [[float(lon[a]), float(lat[a])], [float(lon[b]), float(lat[b])]]}
    return specs, infos


# ------------------------------------------------------------------------------------------------
def validate_entry(c: dict, ids: set[str]) -> None:
    where = c.get("id", "?")
    for k in ("id", "type", "kind", "title", "mechanism", "lens", "costTier", "leadTime", "assumptions"):
        if k not in c:
            raise CatalogError(f"{where}: missing {k}")
    if c["id"] in ids:
        raise CatalogError(f"duplicate id {c['id']}")
    if c["type"] not in TYPES or c["kind"] != KINDS[c["type"]]:
        raise CatalogError(f"{where}: bad type/kind {c['type']}/{c['kind']}")
    if c["costTier"] not in TIERS or c["leadTime"] not in LEADS:
        raise CatalogError(f"{where}: bad costTier/leadTime")
    if not c["lens"] or any(x not in LENSES for x in c["lens"]):
        raise CatalogError(f"{where}: bad lens list")
    text = c["title"] + " " + c["mechanism"]
    if re.search(r"\d", text):
        raise CatalogError(f"{where}: digits in title/mechanism (the language model reads these)")
    if re.search(r"\$\s*\d|dollar|USD", text, re.I):
        raise CatalogError(f"{where}: dollar figure in text")
    if re.search(r"dispatch|triage|real-?time", text, re.I):
        raise CatalogError(f"{where}: forbidden wording")
    if re.search(r"propos|endors|recommend", c["title"], re.I) and not c["title"].startswith("Hypothetical scenario option"):
        raise CatalogError(f"{where}: title implies agency endorsement")
    if not c["title"].startswith("Hypothetical scenario option"):
        raise CatalogError(f"{where}: title must start with 'Hypothetical scenario option'")


def run() -> list[dict]:
    g = load_graph()
    meta = g.meta
    am = assumption_map()
    facilities = json.loads((config.SNAP / "facilities.json").read_text())
    from . import build_graph
    ways = build_graph.load_ways()
    names = _node_names(ways)
    osm_to_idx = {int(o): i for i, o in enumerate(g.nodeOsmId)}
    corridors = {c["id"]: i for i, c in enumerate(meta["corridors"])}
    clinks = {l["id"]: l for l in meta.get("candidateLinks", [])}
    out, ids = [], set()
    for c in load_catalog():
        validate_entry(c, ids)
        ids.add(c["id"])
        for a in c["assumptions"]:
            if a not in am:
                raise CatalogError(f"{c['id']}: unknown assumption {a}")
        rec = {"id": c["id"], "type": c["type"], "kind": c["kind"], "title": c["title"],
               "mechanism": " ".join(c["mechanism"].split()), "lens": c["lens"], "costTier": c["costTier"],
               "costSource": None, "leadTime": c["leadTime"], "hypothetical": True}
        if c["type"] == "temp_link":
            cl = clinks.get(c["id"])
            if cl is None:
                raise CatalogError(f"{c['id']}: candidate link missing from graph.meta.json (rebuild the graph)")
            e = cl["edges"]
            for i in e:
                if not (g.edgeFlags[i] & config.FLAGS["CANDIDATE"]):
                    raise CatalogError(f"{c['id']}: edge {i} is not flagged CANDIDATE")
            a, b = int(g.edgeFrom[e[0]]), int(g.edgeTo[e[0]])
            resolve_node(c["link"]["a"], f"{c['id']}.a", osm_to_idx, names)
            resolve_node(c["link"]["b"], f"{c['id']}.b", osm_to_idx, names)
            rec["effect"] = {"op": "enable_edges", "edges": e}
            rec["refs"] = {"nodes": [a, b], "osmNodes": [int(g.nodeOsmId[a]), int(g.nodeOsmId[b])],
                           "sites": [c["link"]["a"].get("site"), c["link"]["b"].get("site")],
                           "mode": c["link"]["mode"], "lenM": round(float(g.edgeLenM[e[0]]), 1),
                           "timeS": round(float(g.edgeTimeS[e[0]]), 1)}
        elif c["type"] == "signal_priority":
            cid = c["corridor"]
            if cid not in corridors:
                raise CatalogError(f"{c['id']}: corridor {cid} is not registered")
            aid = c["factor"]["assumption"]
            asm = am[aid]
            f = float(asm["value"])
            lo, hi = float(asm["min"]), float(asm["max"])
            if not (lo <= f <= hi):
                raise CatalogError(f"{c['id']}: default factor outside declared bounds")
            n_edges = int((g.edgeCorridor == corridors[cid]).sum())
            if n_edges == 0:
                raise CatalogError(f"{c['id']}: corridor {cid} has no edges")
            rec["effect"] = {"op": "corridor_speed", "corridor": cid, "factor": f}
            rec["params"] = {"factor": {"default": f, "min": lo, "max": hi, "assumption": aid}}
            rec["refs"] = {"corridor": cid, "corridorIndex": corridors[cid], "edgeCount": n_edges}
        else:
            site = c["site"]
            if "facilityName" in site:
                hits = [x for x in facilities if x["name"] == site["facilityName"]]
                if len(hits) != 1:
                    raise CatalogError(f"{c['id']}: facility name {site['facilityName']!r} matched {len(hits)} facilities")
                f = hits[0]
                node, lat, lng, ref = int(f["node"]), f["lat"], f["lng"], {"facility": f["id"], "facilityName": f["name"]}
            else:
                node = resolve_node(site, f"{c['id']}.site", osm_to_idx, names)
                lat, lng = float(g.nodeLat[node]), float(g.nodeLon[node])
                ref = {"osmNode": int(site["osmNode"])}
            rec["effect"] = {"op": "add_source", "facilityLike": {"lat": round(lat, 6), "lng": round(lng, 6), "node": node},
                             "delayS": int(am["A-STAGING-DELAY"]["value"])}
            rec["refs"] = dict(ref, node=node)
        rec["assumptions"] = c["assumptions"]
        rec["sources"] = []
        rec["notes"] = "Hypothetical scenario option; not proposed, studied or endorsed by any agency."
        out.append(rec)
    n = len(out)
    if not (18 <= n <= 30):
        raise CatalogError(f"catalog has {n} entries, expected 18-30")
    (config.SNAP / "candidates.json").write_text(json.dumps(out, indent=1) + "\n")
    print(f"candidates.json: {n} entries "
          f"({sum(c['type'] == 'temp_link' for c in out)} temp_link, {sum(c['type'] == 'signal_priority' for c in out)} "
          f"signal_priority, {sum(c['type'] == 'prepos_site' for c in out)} prepos_site)")
    return out


if __name__ == "__main__":
    run()

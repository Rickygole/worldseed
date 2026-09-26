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
TYPES = ("temp_link", "signal_priority", "prepos_site", "hazmat_window")
KINDS = {"temp_link": "temporary_link", "signal_priority": "corridor_priority", "prepos_site": "staging_site",
         "hazmat_window": "hazmat_window"}
STATUSES = ("kept", "pruned")
MIN_KEPT = 10          # round 3 pruned inert options, so the lower bound is no longer 18
MAX_KEPT = 30
BORE_MIN_LEN_M = 1000.0   # tunnel bore edges are about 2 km; portal stubs are under 150 m
TIERS = ("$", "$$", "$$$")
LEADS = ("days", "weeks", "months")
LENSES = ("access", "xharbor", "ems", "freight")


class CatalogError(RuntimeError):
    pass


def load_catalog() -> list[dict]:
    """All entries (kept and pruned), yaml order. `status` defaults to kept."""
    doc = yaml.safe_load(CAT_YAML.read_text())
    for c in doc["candidates"]:
        c.setdefault("status", "kept")
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


def temp_link_edges(nodes_osm: np.ndarray, lat: np.ndarray, lon: np.ndarray, ways: dict[int, dict],
                    include_pruned: bool = False):
    """Returns (edge_specs, infos). edge_specs: dicts {from,to,lenM,timeS,flags} for build_graph; infos[cand id] holds
    node indices, edge offsets (relative to the first candidate edge) and geometry.

    Order: kept links first (yaml order), then, only when include_pruned, pruned links. So the edge indices of the
    kept links are identical whether or not the pruned ones are appended (they are used for the effect record of
    pruned options). Shuttle edges also carry HAZMAT_PROHIBITED (a hazmat vehicle cannot ride a shuttle)."""
    am = assumption_map()
    osm_to_idx = {int(o): i for i, o in enumerate(nodes_osm)}
    names = _node_names(ways)
    specs, infos = [], {}
    entries = [c for c in load_catalog() if c["type"] == "temp_link"]
    entries = [c for c in entries if c["status"] == "kept"] + \
              ([c for c in entries if c["status"] == "pruned"] if include_pruned else [])
    for c in entries:
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
        flags = config.FLAGS["CANDIDATE"] | (config.FLAGS["HAZMAT_PROHIBITED"] if link["mode"] == "shuttle" else 0)
        specs.append({"from": a, "to": b, "lenM": length, "timeS": t, "flags": flags})
        specs.append({"from": b, "to": a, "lenM": length, "timeS": t, "flags": flags})
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
    if c.get("status", "kept") not in STATUSES or (c.get("status") == "pruned" and not c.get("pruneReason")):
        raise CatalogError(f"{where}: bad status (pruned entries need a pruneReason)")
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


def resolve_entries(g, entries: list[dict], ways: dict, facilities: list[dict]) -> list[dict]:
    """Resolve catalog entries against graph `g` (kept-only graph.bin, or the in-memory graph that also holds the
    pruned links). Raises CatalogError on any unresolved reference."""
    meta = g.meta
    am = assumption_map()
    names = _node_names(ways)
    osm_to_idx = {int(o): i for i, o in enumerate(g.nodeOsmId)}
    corridors = {c["id"]: i for i, c in enumerate(meta["corridors"])}
    links = {l["id"]: l for l in meta["links"]}
    clinks = {l["id"]: l for l in meta.get("candidateLinks", [])}
    out = []
    for c in entries:
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
        elif c["type"] == "hazmat_window":
            lid = c["hazmatLink"]
            if lid not in links:
                raise CatalogError(f"{c['id']}: link {lid} is not registered")
            edges = links[lid]["edges"]
            for i in edges:
                if not (g.edgeFlags[i] & config.FLAGS["HAZMAT_PROHIBITED"]):
                    raise CatalogError(f"{c['id']}: edge {i} of {lid} is not HAZMAT_PROHIBITED")
            aid = c["penalty"]["assumption"]
            asm = am[aid]
            pen, lo, hi = float(asm["value"]), float(asm["min"]), float(asm["max"])
            if not (lo <= pen <= hi):
                raise CatalogError(f"{c['id']}: default penalty outside declared bounds")
            # The penalty is a delay per tunnel traversal. A traversal crosses exactly one bore edge (long edge) plus
            # possibly short portal stubs, so only edges at least BORE_MIN_LEN_M long carry the penalty; the stubs are
            # allowed with no penalty.
            bore = [e for e in edges if float(g.edgeLenM[e]) >= BORE_MIN_LEN_M]
            if not bore:
                raise CatalogError(f"{c['id']}: no bore edge found on {lid}")
            rec["effect"] = {"op": "allow_class_on", "edges": list(edges), "vehicleClass": "hazmat", "timePenaltyS": pen,
                             "penaltyEdges": bore}
            rec["params"] = {"timePenaltyS": {"default": pen, "min": lo, "max": hi, "assumption": aid}}
            rec["refs"] = {"link": lid, "edgeCount": len(edges), "boreMinLenM": BORE_MIN_LEN_M}
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
    return out


def run() -> list[dict]:
    from . import build_graph
    g = load_graph()
    facilities = json.loads((config.SNAP / "facilities.json").read_text())
    ways = build_graph.load_ways()
    entries, ids = load_catalog(), set()
    for c in entries:
        validate_entry(c, ids)
        ids.add(c["id"])
    kept = [c for c in entries if c["status"] == "kept"]
    out = resolve_entries(g, kept, ways, facilities)
    # pruned entries must still resolve (their effects are measured on the in-memory full graph)
    osm_to_idx = {int(o): i for i, o in enumerate(g.nodeOsmId)}
    names = _node_names(ways)
    for c in entries:
        if c["status"] != "pruned":
            continue
        for ref in ([c["link"]["a"], c["link"]["b"]] if c["type"] == "temp_link" else
                    [c["site"]] if c["type"] == "prepos_site" and "osmNode" in c["site"] else []):
            resolve_node(ref, f"{c['id']} (pruned)", osm_to_idx, names)
    n = len(out)
    if not (MIN_KEPT <= n <= MAX_KEPT):
        raise CatalogError(f"catalog has {n} kept entries, expected {MIN_KEPT}-{MAX_KEPT}")
    (config.SNAP / "candidates.json").write_text(json.dumps(out, indent=1) + "\n")
    print(f"candidates.json: {n} kept entries "
          f"({sum(c['type'] == 'temp_link' for c in out)} temp_link, {sum(c['type'] == 'signal_priority' for c in out)} "
          f"signal_priority, {sum(c['type'] == 'prepos_site' for c in out)} prepos_site, "
          f"{sum(c['type'] == 'hazmat_window' for c in out)} hazmat_window); {len(entries) - n} pruned (see candidate_effects.json)")
    return out


if __name__ == "__main__":
    run()

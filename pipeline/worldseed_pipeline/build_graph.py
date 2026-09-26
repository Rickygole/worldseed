"""Drive graph from the cached attic Overpass ways -> data/snapshot/graph.bin + graph.meta.json (+ links.geojson).

Model (all constants labeled in assumptions.yaml):
  * nodes = OSM nodes used by 2+ ways or at way ends; edges collapse the chain between them (per way)
  * directed edges per oneway/junction/highway defaults; largest strongly connected component only
  * free-flow time = length / speed; speed from maxspeed else config.DEFAULT_MPH class default
  * no intersection delay, no turn restrictions, no congestion
  * canonical order: nodes by OSM id, edges by (from, to, way, seq) => deterministic
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components

from . import config, fetch_osm, fix_keybridge, graphio
from .geo import hav_scalar

CLASS_ID = {c: i for i, c in enumerate(config.CLASSES)}
F = config.FLAGS


def parse_speed_mps(s: str | None) -> float | None:
    """OSM maxspeed -> m/s. 'NN mph' or 'NN' (km/h per OSM convention). None if not a plain number."""
    if not s:
        return None
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*(mph|km/h|kmh)?\s*$", s)
    if not m:
        return None
    v = float(m.group(1))
    if v <= 0:
        return None
    return v * config.MPH_TO_MPS if m.group(2) == "mph" else v / 3.6


def directions(tags: dict) -> tuple[bool, bool]:
    hw, ow = tags["highway"], tags.get("oneway")
    if ow in ("yes", "true", "1"):
        return True, False
    if ow in ("-1", "reverse"):
        return False, True
    if ow == "no":
        return True, True
    if hw == "motorway" or tags.get("junction") in ("roundabout", "circular") or hw == "motorway_link":
        return True, False
    return True, True


def load_ways() -> dict[int, dict]:
    return {w["id"]: w for w in fetch_osm.load_roads()}


def build_raw_edges(ways: dict[int, dict]):
    """Returns per-edge python lists. Node references are OSM node ids."""
    use: Counter = Counter()
    for w in ways.values():
        n = w["nodes"]
        for k, nid in enumerate(n):
            use[nid] += 2 if k in (0, len(n) - 1) else 1
    coords: dict[int, tuple[float, float]] = {}
    E = []  # (u_osm, v_osm, len_m, speed_mps, way_id, seq, a, b) ; a,b = geometry slice indices in the way
    for wid in sorted(ways):
        w = ways[wid]
        t = w["tags"]
        hw = t["highway"]
        if len(w["nodes"]) != len(w.get("geometry", [])):
            continue  # defensive: geometry missing/misaligned
        sp = parse_speed_mps(t.get("maxspeed")) or config.DEFAULT_MPH[hw] * config.MPH_TO_MPS
        fwd, bwd = directions(t)
        n, g = w["nodes"], w["geometry"]
        start, L, seq = 0, 0.0, 0
        for i in range(len(n) - 1):
            L += hav_scalar(g[i]["lat"], g[i]["lon"], g[i + 1]["lat"], g[i + 1]["lon"])
            if use[n[i + 1]] > 1:
                u, v = n[start], n[i + 1]
                coords[u] = (g[start]["lat"], g[start]["lon"])
                coords[v] = (g[i + 1]["lat"], g[i + 1]["lon"])
                if u != v and L > 0:
                    if fwd:
                        E.append((u, v, L, sp, wid, seq, start, i + 1, False))
                    if bwd:
                        E.append((v, u, L, sp, wid, seq, start, i + 1, True))
                    seq += 1
                start, L = i + 1, 0.0
    return E, coords


def corridor_of(tags: dict, wid: int, compiled) -> int:
    for k, (spec, ref_re, name_re) in enumerate(compiled):
        if spec.get("way_ids") and wid in spec["way_ids"]:
            return k
        if ref_re and ref_re.search(tags.get("ref") or ""):
            return k
        if name_re and name_re.search(tags.get("name") or ""):
            return k
    return config.NO_CORRIDOR


def build(candidate_edges: list[dict] | None = None) -> tuple[graphio.Graph, dict, dict]:
    ways = load_ways()
    kb_info = fix_keybridge.verify_keybridge(ways)
    tun_info = fix_keybridge.verify_tunnels(ways)
    raw, coords = build_raw_edges(ways)

    # --- largest strongly connected component -----------------------------------------------
    osm_ids = np.array(sorted(coords), dtype=np.int64)
    idx = {int(o): i for i, o in enumerate(osm_ids)}
    n_raw = len(osm_ids)
    eu = np.fromiter((idx[e[0]] for e in raw), dtype=np.int64, count=len(raw))
    ev = np.fromiter((idx[e[1]] for e in raw), dtype=np.int64, count=len(raw))
    A = csr_matrix((np.ones(len(raw)), (eu, ev)), shape=(n_raw, n_raw))
    ncomp, lab = connected_components(A, directed=True, connection="strong")
    sizes = np.bincount(lab)
    big = int(np.argmax(sizes))
    keep = lab == big
    remap = -np.ones(n_raw, dtype=np.int64)
    remap[keep] = np.arange(int(keep.sum()))
    em = keep[eu] & keep[ev]
    stats = {"rawNodes": int(n_raw), "rawEdges": len(raw), "sccCount": int(ncomp),
             "sccNodes": int(keep.sum()), "sccEdges": int(em.sum()),
             "droppedEdgesNotInScc": int((~em).sum())}

    sel = np.nonzero(em)[0]
    kept = [raw[i] for i in sel]
    nodes_osm = osm_ids[keep]
    n = len(nodes_osm)
    lat = np.array([coords[int(o)][0] for o in nodes_osm])
    lon = np.array([coords[int(o)][1] for o in nodes_osm])

    # --- per-edge attributes -----------------------------------------------------------------
    corridor_specs = []
    for c in config.CORRIDORS:
        spec = dict(c)
        if spec.get("way_ids"):
            spec["way_ids"] = set(spec["way_ids"])
        corridor_specs.append((spec, re.compile(c["ref_re"]) if c.get("ref_re") else None,
                               re.compile(c["name_re"]) if c.get("name_re") else None))
    haz = set(config.FORT_MCHENRY_WAY_IDS) | set(config.HARBOR_TUNNEL_WAY_IDS)
    kb = set(config.KEYBRIDGE_WAY_IDS)
    m = len(kept)
    e_from = np.empty(m, dtype=np.uint32)
    e_to = np.empty(m, dtype=np.uint32)
    e_len = np.empty(m, dtype=np.float32)
    e_time = np.empty(m, dtype=np.float32)
    e_cls = np.empty(m, dtype=np.uint8)
    e_flags = np.zeros(m, dtype=np.uint8)
    e_cor = np.full(m, config.NO_CORRIDOR, dtype=np.uint16)
    e_way = np.empty(m, dtype=np.float64)
    order = sorted(range(m), key=lambda i: (remap[idx[kept[i][0]]], remap[idx[kept[i][1]]], kept[i][4], kept[i][5], kept[i][8]))
    geom_ref = []
    for k, i in enumerate(order):
        u, v, L, sp, wid, seq, a, b, rev = kept[i]
        t = ways[wid]["tags"]
        e_from[k], e_to[k] = remap[idx[u]], remap[idx[v]]
        e_len[k], e_time[k] = L, L / sp
        e_cls[k] = CLASS_ID[config.HIGHWAY_TO_CLASS[t["highway"]]]
        fl = 0
        if t.get("tunnel") == "yes":
            fl |= F["TUNNEL"]
        if t.get("bridge") not in (None, "no"):
            fl |= F["BRIDGE"]
        if t.get("toll") == "yes":
            fl |= F["TOLL"]
        if wid in haz:
            fl |= F["HAZMAT_PROHIBITED"] | F["TUNNEL"]
        if wid in kb:
            fl |= F["KEYBRIDGE"] | F["BRIDGE"]
        e_flags[k] = fl
        e_cor[k] = corridor_of(t, wid, corridor_specs)
        e_way[k] = wid
        geom_ref.append((wid, a, b, rev))

    # --- candidate edge slots (later task appends here; disabled at runtime by CANDIDATE flag) ----
    cand = candidate_edges or []
    if cand:
        ce = len(cand)
        e_from = np.concatenate([e_from, np.array([c["from"] for c in cand], dtype=np.uint32)])
        e_to = np.concatenate([e_to, np.array([c["to"] for c in cand], dtype=np.uint32)])
        e_len = np.concatenate([e_len, np.array([c["lenM"] for c in cand], dtype=np.float32)])
        e_time = np.concatenate([e_time, np.array([c["timeS"] for c in cand], dtype=np.float32)])
        e_cls = np.concatenate([e_cls, np.full(ce, CLASS_ID["candidate"], dtype=np.uint8)])
        e_flags = np.concatenate([e_flags, np.full(ce, F["CANDIDATE"], dtype=np.uint8)])
        e_cor = np.concatenate([e_cor, np.array([c.get("corridor", config.NO_CORRIDOR) for c in cand], dtype=np.uint16)])
        e_way = np.concatenate([e_way, np.zeros(ce)])
        geom_ref += [None] * ce

    fwd_off, fwd_edge, rev_off, rev_edge = graphio.build_csr(e_from.astype(np.int64), e_to.astype(np.int64), n)
    g = graphio.Graph(
        nodeOsmId=nodes_osm.astype(np.float64), nodeLon=lon.astype(np.float32), nodeLat=lat.astype(np.float32),
        edgeFrom=e_from, edgeTo=e_to, edgeTimeS=e_time, edgeLenM=e_len, edgeClass=e_cls, edgeFlags=e_flags,
        edgeCorridor=e_cor, edgeOsmWay=e_way, fwdOff=fwd_off, fwdEdge=fwd_edge, revOff=rev_off, revEdge=rev_edge)

    # --- links --------------------------------------------------------------------------------
    kb_edges = fix_keybridge.link_edges(e_way, config.KEYBRIDGE_WAY_IDS)
    assert len(kb_edges) == 6, f"expected 6 directed Key Bridge edges in the SCC, found {len(kb_edges)}"
    for i in kb_edges:
        assert e_flags[i] & F["KEYBRIDGE"]
    # each expected way maps to exactly one directed edge
    assert sorted(int(e_way[i]) for i in kb_edges) == sorted(config.KEYBRIDGE_WAY_IDS)
    fm_edges = fix_keybridge.link_edges(e_way, config.FORT_MCHENRY_WAY_IDS)
    ht_edges = fix_keybridge.link_edges(e_way, config.HARBOR_TUNNEL_WAY_IDS)
    assert fm_edges and ht_edges, "tunnel edges not present in the SCC"
    for i in fm_edges + ht_edges:
        assert e_flags[i] & F["TUNNEL"] and e_flags[i] & F["HAZMAT_PROHIBITED"]
    links = [
        {"id": "L-KEYBRIDGE", "name": "Francis Scott Key Bridge (I-695)", "edges": kb_edges},
        {"id": "L-FORTMCHENRY", "name": "Fort McHenry Tunnel (I-95)", "edges": fm_edges},
        {"id": "L-HARBORTUNNEL", "name": "Baltimore Harbor Tunnel (I-895)", "edges": ht_edges},
    ]
    corridors = [{"id": c["id"], "name": c["name"]} for c in config.CORRIDORS]
    cor_counts = Counter(int(x) for x in e_cor if x != config.NO_CORRIDOR)

    meta = {
        "snapshotId": config.SNAPSHOT_ID,
        "classes": config.CLASSES,
        "flags": config.FLAGS,
        "noCorridor": config.NO_CORRIDOR,
        "corridors": corridors,
        "links": links,
        "candidateEdgeCount": len(cand),
        "units": {"edgeTimeS": "seconds free-flow", "edgeLenM": "metres"},
    }
    diag = {"stats": stats, "keybridge": kb_info, "tunnels": tun_info,
            "corridorEdgeCounts": {config.CORRIDORS[k]["id"]: c for k, c in sorted(cor_counts.items())},
            "classCounts": {config.CLASSES[k]: int(c) for k, c in enumerate(np.bincount(e_cls, minlength=len(config.CLASSES)))}}
    g.meta = meta
    return g, diag, {"ways": ways, "geom_ref": geom_ref}


def links_geojson(g: graphio.Graph, ways: dict, geom_ref: list) -> dict:
    """LineStrings for named links and corridors (highlight rendering). Coordinates rounded to 5 dp."""
    def edge_line(i: int):
        wid, a, b, rev = geom_ref[i]
        pts = [[round(p["lon"], 5), round(p["lat"], 5)] for p in ways[wid]["geometry"][a:b + 1]]
        return pts[::-1] if rev else pts

    feats = []
    for link in g.meta["links"]:
        feats.append({"type": "Feature",
                      "properties": {"id": link["id"], "name": link["name"], "kind": "link"},
                      "geometry": {"type": "MultiLineString", "coordinates": [edge_line(i) for i in link["edges"]]}})
    for k, c in enumerate(g.meta["corridors"]):
        idxs = np.nonzero(g.edgeCorridor == k)[0]
        # one geometry per undirected chain: keep the forward-oriented copy of each way segment
        seen, lines = set(), []
        for i in idxs:
            wid, a, b, rev = geom_ref[i]
            if (wid, a, b) in seen:
                continue
            seen.add((wid, a, b))
            lines.append(edge_line(int(i)))
        if lines:
            feats.append({"type": "Feature", "properties": {"id": c["id"], "name": c["name"], "kind": "corridor"},
                          "geometry": {"type": "MultiLineString", "coordinates": lines}})
    return {"type": "FeatureCollection", "features": feats}


def run() -> dict:
    g, diag, aux = build()
    graphio.write_graph(g, g.meta, config.SNAP)
    gj = links_geojson(g, aux["ways"], aux["geom_ref"])
    (config.SNAP / "links.geojson").write_text(json.dumps(gj, separators=(",", ":")) + "\n")
    (config.RAW / "interim").mkdir(parents=True, exist_ok=True)
    (config.RAW / "interim" / "graph_diag.json").write_text(json.dumps(diag, indent=1, default=str))
    s = diag["stats"]
    print(f"graph: raw {s['rawNodes']:,} nodes / {s['rawEdges']:,} edges -> SCC {g.n:,} nodes / {g.e:,} edges "
          f"({s['sccCount']} components)")
    print("Key Bridge edges:", g.meta["links"][0]["edges"])
    print("tunnel edges: Fort McHenry", len(g.meta["links"][1]["edges"]), "Harbor", len(g.meta["links"][2]["edges"]))
    print("corridor edge counts:", diag["corridorEdgeCounts"])
    print("unlisted tunnel ways (info):", diag["tunnels"]["unlisted_tunnel_ways"])
    return diag


if __name__ == "__main__":
    run()

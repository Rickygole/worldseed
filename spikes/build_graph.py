"""Build compact drive graph from cached pre-collapse OSM JSON.
Outputs (in spikes/out/): graph_2024.npz (compact), key_bridge_edges.json, stations.json, tunnels.json
Speed model: maxspeed tag where parseable, else DEFAULT_MPH by highway class (documented below)."""
import json, math, os, re, gzip
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components

RAW = "/Users/rickygole/worldseed/data/raw"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

# Key Bridge = the six I-695 ways tagged bridge=yes in the 2024-03-01 snapshot between the Hawkins Point
# and Fort Armistead/Sollers Point abutments (verified via probe query; see SPIKE_REPORT.md).
KB_WAY_IDS = {24555622, 24555626, 1026914407, 1026914408, 1026914409, 1026914410}

DEFAULT_MPH = {"motorway": 55, "motorway_link": 35, "trunk": 45, "trunk_link": 30,
               "primary": 35, "primary_link": 25, "secondary": 30, "secondary_link": 25,
               "tertiary": 25, "tertiary_link": 20, "unclassified": 25, "residential": 25,
               "living_street": 10}
MPH = 0.44704

def parse_speed(s):
    if not s: return None
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*(mph|km/h|kmh)?\s*$", s)
    if not m: return None
    v = float(m.group(1)); unit = m.group(2) or "kmh"
    return v * MPH if unit == "mph" else v / 3.6

def hav(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 12742000 * math.asin(math.sqrt(a))

def load_ways(name):
    return [e for e in json.load(open(f"{RAW}/{name}"))["elements"] if e["type"] == "way"]

def build():
    ways = load_ways("roads_2024-03-01.json")
    # --- Key Bridge segment set: 2024 I-695 segments near the bridge that no longer exist today
    cur = load_ways("i695_current.json")
    cur_pairs = set()
    for w in cur:
        n = w["nodes"]
        for a, b in zip(n[:-1], n[1:]): cur_pairs.add(frozenset((a, b)))
    kb_lo, kb_hi = (39.205, -76.55), (39.235, -76.50)
    removed_pairs, kb_ways = set(), {}
    for w in ways:
        t = w["tags"]
        if "695" not in (t.get("ref") or "") or t["highway"] not in ("motorway", "trunk"): continue
        g = w["geometry"]
        n = w["nodes"]
        for i, (a, b) in enumerate(zip(n[:-1], n[1:])):
            la, lo = g[i]["lat"], g[i]["lon"]
            if not (kb_lo[0] <= la <= kb_hi[0] and kb_lo[1] <= lo <= kb_hi[1]): continue
            if frozenset((a, b)) not in cur_pairs:
                removed_pairs.add(frozenset((a, b)))
                kb_ways.setdefault(w["id"], []).append((a, b))
    # --- nodes
    nid, coords = {}, []
    def node(osm, lat, lon):
        if osm not in nid:
            nid[osm] = len(coords); coords.append((lat, lon))
        return nid[osm]
    # count node use to find intersections
    use = {}
    for w in ways:
        for k, n in enumerate(w["nodes"]):
            use[n] = use.get(n, 0) + (2 if k in (0, len(w["nodes"]) - 1) else 1)
    edges = []  # (u, v, length_m, speed_mps, hwyclass_idx, is_kb, way_id)
    hw_list = list(DEFAULT_MPH)
    for w in ways:
        t = w["tags"]; hw = t["highway"]
        sp = parse_speed(t.get("maxspeed")) or DEFAULT_MPH[hw] * MPH
        ow = t.get("oneway")
        if ow in ("yes", "true", "1") or hw in ("motorway",) and ow != "no" or t.get("junction") in ("roundabout",): fwd, bwd = True, False
        elif ow == "-1": fwd, bwd = False, True
        else: fwd, bwd = True, True
        if hw == "motorway_link" and ow is None: fwd, bwd = True, False
        n, g = w["nodes"], w["geometry"]
        start = 0; L = 0.0; kb = False
        for i in range(len(n) - 1):
            L += hav(g[i]["lat"], g[i]["lon"], g[i + 1]["lat"], g[i + 1]["lon"])
            if w["id"] in KB_WAY_IDS: kb = True
            if use[n[i + 1]] > 1:  # breakpoint
                u = node(n[start], g[start]["lat"], g[start]["lon"]); v = node(n[i + 1], g[i + 1]["lat"], g[i + 1]["lon"])
                if u != v:
                    if fwd: edges.append((u, v, L, sp, hw_list.index(hw), kb, w["id"]))
                    if bwd: edges.append((v, u, L, sp, hw_list.index(hw), kb, w["id"]))
                start = i + 1; L = 0.0; kb = False
    coords = np.array(coords)
    E = np.array([(e[0], e[1]) for e in edges], dtype=np.int32)
    length = np.array([e[2] for e in edges], dtype=np.float32)
    speed = np.array([e[3] for e in edges], dtype=np.float32)
    hwc = np.array([e[4] for e in edges], dtype=np.int8)
    kbm = np.array([e[5] for e in edges], dtype=bool)
    wid = np.array([e[6] for e in edges], dtype=np.int64)
    # --- largest strongly connected component
    N = len(coords)
    A = csr_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(N, N))
    nc, lab = connected_components(A, directed=True, connection="strong")
    big = np.argmax(np.bincount(lab))
    keep = lab == big
    stats = {"raw_nodes": N, "raw_edges": len(E), "scc_count": int(nc), "scc_nodes": int(keep.sum())}
    remap = -np.ones(N, dtype=np.int32); remap[keep] = np.arange(keep.sum())
    em = keep[E[:, 0]] & keep[E[:, 1]]
    stats["kb_edges_dropped_by_scc"] = int((kbm & ~em).sum())
    E = remap[E[em]]; length, speed, hwc, kbm, wid = length[em], speed[em], hwc[em], kbm[em], wid[em]
    coords = coords[keep]
    stats.update(nodes=len(coords), edges=len(E), kb_edges=int(kbm.sum()))
    return coords, E, length, speed, hwc, kbm, wid, kb_ways, stats

if __name__ == "__main__":
    coords, E, length, speed, hwc, kbm, wid, kb_ways, stats = build()
    tt = length / speed
    np.savez_compressed(f"{OUT}/graph_2024.npz", coords=coords.astype(np.float32), E=E, length=length, speed=speed.astype(np.float16),
                        hwc=hwc, kb=kbm)
    print(stats)
    print("npz size KB", os.path.getsize(f"{OUT}/graph_2024.npz") / 1024)
    # compact typed-array-friendly binary, gzipped: Int32 u,v + Float32 travel_s + Float32 lat/lon (quantised to Int32 1e-6? keep f32)
    raw = b"".join([E.astype(np.int32).tobytes(), tt.astype(np.float32).tobytes(), coords.astype(np.float32).tobytes(), kbm.astype(np.uint8).tobytes()])
    print("browser binary raw KB", len(raw) / 1024, "gz KB", len(gzip.compress(raw, 9)) / 1024)
    # variant: uint16 quantised travel (0.1s units clipped) and delta-friendly ordering
    order = np.lexsort((E[:, 1], E[:, 0]))
    Es = E[order]
    raw2 = b"".join([Es[:, 0].astype(np.int32).tobytes(), Es[:, 1].astype(np.int32).tobytes(), np.minimum(tt[order] * 10, 65535).astype(np.uint16).tobytes(),
                     (np.round((coords[:, 0] - 39.19) * 1e5)).astype(np.uint16).tobytes(), (np.round((coords[:, 1] + 76.62) * 1e5)).astype(np.uint16).tobytes()])
    print("browser binary v2 (sorted, quantised coords, u16 travel) raw KB", len(raw2) / 1024, "gz KB", len(gzip.compress(raw2, 9)) / 1024)
    # key bridge report
    kb_edges = np.where(kbm)[0]
    rep = []
    for i in kb_edges:
        rep.append({"edge": int(i), "u": int(E[i, 0]), "v": int(E[i, 1]), "u_latlon": coords[E[i, 0]].round(5).tolist(), "v_latlon": coords[E[i, 1]].round(5).tolist(),
                    "length_m": round(float(length[i]), 1), "speed_mph": round(float(speed[i] / MPH), 1), "way_id": int(wid[i])})
    json.dump({"removed_way_segments": {str(k): len(v) for k, v in kb_ways.items()}, "edges": rep}, open(f"{OUT}/key_bridge_edges.json", "w"), indent=1)
    print("Cross-check only: 2024 I-695 segments absent from present-day OSM (includes unrelated interchange re-mapping):", {k: len(v) for k, v in kb_ways.items()})
    for r in rep: print(r)
    print("total KB length m", sum(r["length_m"] for r in rep))

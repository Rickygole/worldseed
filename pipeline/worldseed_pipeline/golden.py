"""golden.json: independent networkx reference fields and metrics for the worlds the TS simulator must match.

Independence: this module reads only the committed artifacts (graph.bin round-tripped through graphio,
hexes.bin, destinations.json, facilities.json) and uses networkx' Dijkstra. It shares no routing code with the
CSR/typed-array runtime. Inputs are widened from f32 to float64 exactly as a JS engine would read them.

Lens definitions (also in assumptions.yaml and docs/DATA_SOURCES.md):

Weighted quantile q of values v with weights w (hexes): sort by (v asc, hex index asc); return the first v whose
cumulative weight >= q * total weight (no interpolation). Zero total weight -> null.

EMS lens (resilience check)
  sources   = active facilities of kind fire_station or ems_station, at their snapped node, start time 0
  dist[n]   = forward multi-source Dijkstra over enabled edges (seconds)
  hexT[h]   = CALL_TO_WHEELS_S + dist[node_h] + snapS_h          (unreachable -> null, counted as > threshold)
  p50S/p90S = population-weighted quantiles of hexT
  pctWithin = 100 * pop with hexT <= 480 s / total pop;  zvhWithin = 100 * zvh with hexT <= 480 s / total zvh
  isolatedBg = block groups whose population-weighted median hexT > 480 s (BG = hexes.bg)
  equityGapS = zvh-weighted p90 - population-weighted p90

Access lens (hero)
  destinations k=1..K from destinations.json, w_k = jobs_k / sum jobs
  t_k[n]    = reverse Dijkstra from destination node: driving time n -> destination over enabled edges,
              unreachable -> ACCESS_CAP_S; each t_k is capped at ACCESS_CAP_S
  hexT[h]   = min(ACCESS_CAP_S, sum_k w_k * t_k[node_h] + snapS_h)
  added[h]  = hexT_world[h] - hexT_baseline[h]
  p50S/p90S = population-weighted quantiles of hexT
  pctWithin = 100 * pop with added <= 300 s / total pop
  isolatedBg ("cut-off" BGs) = BGs whose population-weighted median added > 600 s
  equityGapS = sum(lowWage*added)/sum(lowWage) - sum(pop*added)/sum(pop)
"""
from __future__ import annotations

import hashlib
import json
import time

import networkx as nx
import numpy as np

from . import binio, config
from .graphio import Graph, load_graph

ACCESS_ADDED_OK_S = 300.0
ACCESS_CUTOFF_S = 600.0

WORLDS = [
    {"id": "baseline", "label": "Baseline (2024-03-01)", "closedLinks": []},
    {"id": "keybridge_removed", "label": "Key Bridge removed", "closedLinks": ["L-KEYBRIDGE"]},
    {"id": "harbor_tunnel_closed", "label": "Harbor Tunnel (I-895) closed", "closedLinks": ["L-HARBORTUNNEL"]},
    {"id": "keybridge_and_harbor_tunnel_closed", "label": "Key Bridge removed and Harbor Tunnel closed",
     "closedLinks": ["L-KEYBRIDGE", "L-HARBORTUNNEL"]},
    {"id": "fort_mchenry_closed", "label": "Fort McHenry Tunnel (I-95) closed", "closedLinks": ["L-FORTMCHENRY"]},
    {"id": "keybridge_and_fort_mchenry_closed", "label": "Key Bridge removed and Fort McHenry Tunnel closed",
     "closedLinks": ["L-KEYBRIDGE", "L-FORTMCHENRY"]},
]


# ---------------------------------------------------------------------------------------------
def load_hexes() -> dict[str, np.ndarray]:
    meta = json.loads((config.SNAP / "hexes.meta.json").read_text())
    arr = binio.unpack((config.SNAP / "hexes.bin").read_bytes(), meta["buffers"])
    arr = {k: v.astype(np.float64) if v.dtype.kind == "f" else v.astype(np.int64) for k, v in arr.items()}
    arr["h3"] = meta["h3"]
    return arr


def wquantile(v: np.ndarray, w: np.ndarray, q: float):
    """Weighted quantile as specified in the module docstring. v may contain inf (=unreachable)."""
    tot = float(w.sum())
    if tot <= 0:
        return None
    order = np.lexsort((np.arange(len(v)), v))
    cw = np.cumsum(w[order])
    k = int(np.searchsorted(cw, q * tot, side="left"))
    k = min(k, len(v) - 1)
    val = v[order][k]
    return None if not np.isfinite(val) else float(val)


def digraph(g: Graph, disabled: set[int]) -> nx.DiGraph:
    """DiGraph over enabled, non-candidate edges; parallel edges keep the minimum time."""
    G = nx.DiGraph()
    G.add_nodes_from(range(g.n))
    cand = config.FLAGS["CANDIDATE"]
    for i in range(g.e):
        if i in disabled or g.edgeFlags[i] & cand:
            continue
        u, v, t = int(g.edgeFrom[i]), int(g.edgeTo[i]), float(g.edgeTimeS[i])
        if G.has_edge(u, v):
            if t < G[u][v]["weight"]:
                G[u][v]["weight"] = t
        else:
            G.add_edge(u, v, weight=t)
    return G


def _bg_median_flags(bg: np.ndarray, pop: np.ndarray, val: np.ndarray, thr: float) -> list[int]:
    out = []
    for b in np.unique(bg):
        m = bg == b
        if pop[m].sum() <= 0:
            continue
        med = wquantile(val[m], pop[m], 0.5)
        if med is None or med > thr:
            out.append(int(b))
    return out


def ems_field(G: nx.DiGraph, hx: dict, sources: list[int]) -> np.ndarray:
    dist = nx.multi_source_dijkstra_path_length(G, sources, weight="weight")
    d = np.array([dist.get(int(n), np.inf) for n in hx["node"]])
    return config.CALL_TO_WHEELS_S + d + hx["snapS"]


def access_field(GR: nx.DiGraph, hx: dict, dests: list[dict]) -> np.ndarray:
    jobs = np.array([d["jobs"] for d in dests], dtype=float)
    w = jobs / jobs.sum()
    acc = np.zeros(len(hx["node"]))
    for wk, d in zip(w, dests):
        dist = nx.single_source_dijkstra_path_length(GR, d["node"], weight="weight")
        t = np.array([min(dist.get(int(n), np.inf), config.ACCESS_CAP_S) for n in hx["node"]])
        acc += wk * t
    return np.minimum(config.ACCESS_CAP_S, acc + hx["snapS"])


def ems_metrics(hexT: np.ndarray, hx: dict) -> dict:
    thr = config.EMS_THRESHOLD_S
    pop, zvh = hx["pop"], hx["zvh"]
    within = hexT <= thr
    p90_pop = wquantile(hexT, pop, 0.9)
    p90_zvh = wquantile(hexT, zvh, 0.9)
    return {
        "p50S": wquantile(hexT, pop, 0.5), "p90S": p90_pop,
        "pctWithin": float(100 * pop[within].sum() / pop.sum()),
        "zvhWithin": float(100 * zvh[within].sum() / zvh.sum()),
        "isolatedBg": _bg_median_flags(hx["bg"], pop, hexT, thr),
        "equityGapS": None if p90_pop is None or p90_zvh is None else p90_zvh - p90_pop,
        "unreachableHexes": int((~np.isfinite(hexT)).sum()),
    }


def access_metrics(hexT: np.ndarray, added: np.ndarray, hx: dict) -> dict:
    pop, lw = hx["pop"], hx["lowWage"]
    pop_added = float((pop * added).sum() / pop.sum())
    lw_added = float((lw * added).sum() / lw.sum())
    return {
        "p50S": wquantile(hexT, pop, 0.5), "p90S": wquantile(hexT, pop, 0.9),
        "pctWithin": float(100 * pop[added <= ACCESS_ADDED_OK_S].sum() / pop.sum()),
        "isolatedBg": _bg_median_flags(hx["bg"], pop, added, ACCESS_CUTOFF_S),
        "equityGapS": lw_added - pop_added,
        "lowWageAddedS": lw_added, "popAddedS": pop_added,
    }


def added_stats(added: np.ndarray, hx: dict) -> dict:
    """Distribution of added minutes; used for the honest-effect report (not part of the lens metrics)."""
    pop, lw = hx["pop"], hx["lowWage"]
    out = {"addedP50S": wquantile(added, pop, 0.5), "addedP90S": wquantile(added, pop, 0.9),
           "addedP99S": wquantile(added, pop, 0.99), "addedMaxS": float(added.max())}
    for thr in (30, 60, 120, 300, 600):
        m = added > thr
        out[f"popAddedGt{thr}s"] = float(pop[m].sum())
        out[f"lowWageAddedGt{thr}s"] = float(lw[m].sum())
    return out


def compute(verbose: bool = True) -> dict:
    t0 = time.time()
    g = load_graph()
    hx = load_hexes()
    dests = json.loads((config.SNAP / "destinations.json").read_text())
    fac = json.loads((config.SNAP / "facilities.json").read_text())
    sources = sorted({f["node"] for f in fac if f["active"] and f["kind"] in ("fire_station", "ems_station")})
    links = {l["id"]: l["edges"] for l in g.meta["links"]}

    worlds, base_access = [], None
    for wd in WORLDS:
        disabled = {e for lid in wd["closedLinks"] for e in links[lid]}
        G = digraph(g, disabled)
        GR = G.reverse(copy=False)
        ems_t = ems_field(G, hx, sources)
        acc_t = access_field(GR, hx, dests)
        if base_access is None:
            base_access = acc_t
        added = acc_t - base_access
        rec = {"id": wd["id"], "label": wd["label"], "closedLinks": wd["closedLinks"], "disabledEdges": sorted(disabled),
               "ems": {"metrics": ems_metrics(ems_t, hx),
                       "hexTimeS": [None if not np.isfinite(x) else round(float(x), 2) for x in ems_t]},
               "access": {"metrics": access_metrics(acc_t, added, hx), "added": added_stats(added, hx),
                          "hexTimeS": [round(float(x), 2) for x in acc_t]}}
        worlds.append(rec)
        if verbose:
            print(f"  golden world {wd['id']}: access p50 {rec['access']['metrics']['p50S'] / 60:.2f} min, "
              f"pop-added {rec['access']['metrics']['popAddedS'] / 60:.2f} min; EMS p90 {rec['ems']['metrics']['p90S'] / 60:.2f} min "
                  f"({time.time() - t0:.0f}s)")

    # Worst-hit block groups (bridge removed): pop-weighted mean added time per BG
    kb = next(w for w in worlds if w["id"] == "keybridge_removed")
    added_kb = np.array(kb["access"]["hexTimeS"]) - np.array(worlds[0]["access"]["hexTimeS"])
    bgs = json.loads((config.SNAP / "blockgroups.json").read_text())
    rows = []
    for b in bgs:
        hs = b["hexes"]
        if not hs:
            continue
        p = hx["pop"][hs]
        if p.sum() <= 0:
            continue
        rows.append({"geoid": b["geoid"], "i": b["i"], "county": b["county"], "pop": b["pop"],
                     "meanAddedS": float((added_kb[hs] * p).sum() / p.sum()),
                     "medianAddedS": wquantile(added_kb[hs], p, 0.5)})
    rows.sort(key=lambda r: (-r["meanAddedS"], r["geoid"]))

    out = {
        "snapshotId": config.SNAPSHOT_ID,
        "tolerance": {"perHexS": 0.5, "note": "TS simulator must match hexTimeS within 0.5 s per hex"},
        "constants": {"callToWheelsS": config.CALL_TO_WHEELS_S, "emsThresholdS": config.EMS_THRESHOLD_S,
                      "accessCapS": config.ACCESS_CAP_S, "accessAddedOkS": ACCESS_ADDED_OK_S,
                      "accessCutoffS": ACCESS_CUTOFF_S},
        "emsSourceNodes": sources,
        "destinations": [{"id": d["id"], "node": d["node"], "jobs": d["jobs"]} for d in dests],
        "hexCount": len(hx["node"]),
        "worlds": worlds,
        "keybridgeWorstBlockGroups": rows[:15],
    }
    return out


def dumps(doc: dict) -> str:
    return json.dumps(doc, separators=(",", ":")) + "\n"


def run() -> dict:
    t0 = time.time()
    out = compute()
    text = dumps(out)
    (config.SNAP / "golden.json").write_text(text)
    print(f"golden.json: {len(text) / 1e6:.2f} MB, sha256 {hashlib.sha256(text.encode()).hexdigest()[:16]} ({time.time() - t0:.0f}s)")
    return out


if __name__ == "__main__":
    run()

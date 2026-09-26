"""access_sensitivity.json: how big is the Key Bridge effect under several Access definitions?

The contract Access lens (job-weighted MEAN drive time to K=8 anchors) averages a bridge-sized detour over
destinations that mostly do not use the bridge. This module quantifies that dilution so the effect size is
reported honestly. Nothing here feeds the simulator contract; the numbers are informational.

Variants (baseline vs world; times in seconds):
  contract        : the golden Access lens (mean over 8 anchors)
  per_destination : added time to each single anchor
  cross_shore     : mean over the anchors on the OTHER shore only (hexes with shore 2 skipped)
  worst_anchor    : max over anchors of the added time
  jobs_30min      : LODES jobs reachable within 30 min of drive time from the hex node (block-point jobs at hex nodes)
"""
from __future__ import annotations

import json
import time

import networkx as nx
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from . import config
from .golden import WORLDS, digraph, load_hexes, wquantile
from .graphio import load_graph

T_S = 1800.0
CHUNK = 250


def _matrix(g, disabled: set[int]) -> csr_matrix:
    keep = np.array([i not in disabled and not (g.edgeFlags[i] & config.FLAGS["CANDIDATE"]) for i in range(g.e)])
    df = pd.DataFrame({"u": g.edgeFrom[keep], "v": g.edgeTo[keep], "t": g.edgeTimeS[keep].astype(np.float64)})
    df = df.groupby(["u", "v"], as_index=False).t.min()
    return csr_matrix((df.t.values, (df.u.values, df.v.values)), shape=(g.n, g.n))


def jobs_within(A: csr_matrix, hx: dict, n: int) -> np.ndarray:
    """Jobs reachable within T_S seconds of drive time from each hex's node (snap time excluded)."""
    jobs_node = np.zeros(n)
    np.add.at(jobs_node, hx["node"], hx["jobs"])
    uniq = np.unique(hx["node"])
    res = {}
    for a in range(0, len(uniq), CHUNK):
        src = uniq[a:a + CHUNK]
        d = dijkstra(A, directed=True, indices=src, limit=T_S)
        reach = np.isfinite(d)
        tot = reach.astype(np.float64) @ jobs_node
        for s, v in zip(src, tot):
            res[int(s)] = v
    return np.array([res[int(x)] for x in hx["node"]])


def summarize(added: np.ndarray, pop: np.ndarray, lw: np.ndarray, thresholds_s) -> dict:
    out = {"popMeanAddedS": float((pop * added).sum() / pop.sum()),
           "lowWageMeanAddedS": float((lw * added).sum() / lw.sum()),
           "addedP99S": wquantile(added, pop, 0.99), "addedMaxS": float(added.max())}
    for t in thresholds_s:
        out[f"popAddedGt{int(t)}s"] = int(round(pop[added > t].sum()))
        out[f"lowWageAddedGt{int(t)}s"] = int(round(lw[added > t].sum()))
    return out


def run() -> dict:
    t0 = time.time()
    g = load_graph()
    hx = load_hexes()
    dests = json.loads((config.SNAP / "destinations.json").read_text())
    links = {l["id"]: l["edges"] for l in g.meta["links"]}
    pop, lw = hx["pop"], hx["lowWage"]
    jobs = np.array([d["jobs"] for d in dests], float)
    w = jobs / jobs.sum()
    d_shore = np.array([d["shore"] for d in dests])
    h_shore = hx["shore"]

    worlds = [x for x in WORLDS if x["id"] in ("baseline", "keybridge_removed", "harbor_tunnel_closed",
                                                "keybridge_and_harbor_tunnel_closed")]
    per_dest_t, jw = {}, {}
    for wd in worlds:
        dis = {e for lid in wd["closedLinks"] for e in links[lid]}
        GR = digraph(g, dis).reverse(copy=False)
        T = np.zeros((len(dests), len(hx["node"])))
        for k, d in enumerate(dests):
            dist = nx.single_source_dijkstra_path_length(GR, d["node"], weight="weight")
            T[k] = [min(dist.get(int(n), np.inf), config.ACCESS_CAP_S) for n in hx["node"]]
        per_dest_t[wd["id"]] = T
        jw[wd["id"]] = jobs_within(_matrix(g, dis), hx, g.n)
        print(f"  sensitivity world {wd['id']} ({time.time() - t0:.0f}s)")

    base = per_dest_t["baseline"]
    out = {"snapshotId": config.SNAPSHOT_ID, "note": "informational; not part of the simulator contract",
           "anchors": [{"id": d["id"], "jobs": d["jobs"], "shore": d["shore"]} for d in dests], "worlds": {}}
    thr = (30, 60, 120, 300, 600)
    for wd in worlds[1:]:
        T = per_dest_t[wd["id"]]
        added_k = T - base
        contract = (w[:, None] * added_k).sum(axis=0)
        # cross-shore: anchors on the other shore only (renormalised); shore-2 hexes and hexes with no other-shore anchor skipped
        cross = np.zeros(len(pop))
        valid = np.zeros(len(pop), bool)
        for s in (0, 1):
            m = h_shore == s
            sel = d_shore == (1 - s)
            if m.any() and sel.any():
                ww = jobs[sel] / jobs[sel].sum()
                cross[m] = (ww[:, None] * added_k[sel][:, m]).sum(axis=0)
                valid[m] = True
        worst = added_k.max(axis=0)
        j0, j1 = jw["baseline"], jw[wd["id"]]
        loss = np.where(j0 > 0, (j0 - j1) / np.maximum(j0, 1), 0.0)
        rec = {
            "contract_mean_over_anchors": summarize(contract, pop, lw, thr),
            "per_destination": [{"id": d["id"], "shore": d["shore"], **{k: v for k, v in summarize(added_k[i], pop, lw, (60, 300)).items()
                                if k in ("popMeanAddedS", "addedMaxS", "popAddedGt60s", "popAddedGt300s")}} for i, d in enumerate(dests)],
            "cross_shore_anchors_only": {**summarize(cross, np.where(valid, pop, 0), np.where(valid, lw, 0), thr),
                                         "popCovered": int(round(pop[valid].sum()))},
            "worst_anchor": summarize(worst, pop, lw, thr),
            "jobs_within_30min": {
                "popWeightedMeanBaselineJobs": float((pop * j0).sum() / pop.sum()),
                "popWeightedMeanLossPct": float(100 * (pop * loss).sum() / pop.sum()),
                "lowWageWeightedMeanLossPct": float(100 * (lw * loss).sum() / lw.sum()),
                "popLosingGt5pct": int(round(pop[loss > 0.05].sum())), "popLosingGt10pct": int(round(pop[loss > 0.10].sum())),
                "popLosingGt25pct": int(round(pop[loss > 0.25].sum())),
                "lowWageLosingGt10pct": int(round(lw[loss > 0.10].sum())),
                "maxLossPct": float(100 * loss.max()),
                "meanJobsLostPerPerson": float((pop * (j0 - j1)).sum() / pop.sum()),
            },
        }
        out["worlds"][wd["id"]] = rec
    # worst block groups by jobs-within-30-min loss (bridge removed)
    bgs = json.loads((config.SNAP / "blockgroups.json").read_text())
    j0, j1 = jw["baseline"], jw["keybridge_removed"]
    rows = []
    for b in bgs:
        hs = b["hexes"]
        if not hs or pop[hs].sum() <= 0 or b["pop"] < 200:
            continue
        p = pop[hs]
        rows.append({"geoid": b["geoid"], "county": b["county"], "pop": b["pop"],
                     "meanJobsLost": float(((j0[hs] - j1[hs]) * p).sum() / p.sum()),
                     "meanLossPct": float(100 * (((j0[hs] - j1[hs]) / np.maximum(j0[hs], 1)) * p).sum() / p.sum())})
    rows.sort(key=lambda r: (-r["meanLossPct"], r["geoid"]))
    out["keybridge_worst_block_groups_jobs30"] = rows[:10]
    text = json.dumps(out, indent=1) + "\n"
    (config.SNAP / "access_sensitivity.json").write_text(text)
    print(f"access_sensitivity.json written ({time.time() - t0:.0f}s)")
    return out


if __name__ == "__main__":
    run()

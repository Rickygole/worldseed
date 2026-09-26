"""Deliverable (2, destination sample) for the REGIONAL lens: how much does the Key Bridge's regional Access effect depend on the
choice of the K=8 anchors?  Re-derives anchors the way build_destinations.py does (weighted k-means on LODES WAC block points,
weighted medoid -> nearest street node), for other K, other seeds, and 30 block-bootstrap resamples.  Output: out/regional_dest.json
The K=8 / seed 7 reproduction is asserted equal to data/snapshot/destinations.json (same nodes).
"""
import json, time, pathlib
import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.sparse.csgraph import dijkstra
from sklearn.cluster import KMeans
from worldseed_pipeline.snap import SnapIndex
from sensitivity.engine import *

OUT = pathlib.Path(__file__).parent / "out"


def anchors_for(wb, X, weights, K, seed, n_init, snapidx):
    km = KMeans(n_clusters=K, n_init=n_init, random_state=seed).fit(X, sample_weight=weights)
    res = []
    for c in range(K):
        idx = np.nonzero(km.labels_ == c)[0]
        if len(idx) == 0: continue
        wj = weights[idx]; P = X[idx]; best, bi = None, -1
        for a in range(len(idx)):
            sc = float((np.hypot(P[:, 0] - P[a, 0], P[:, 1] - P[a, 1]) * wj).sum())
            if best is None or sc < best: best, bi = sc, a
        nd, _ = snapidx.query(wb.lat.values[idx[bi]], wb.lon.values[idx[bi]])
        res.append((int(nd[0]), float(wj.sum())))
    return res


def reg_added(ctx, ATb, ATk, anchors):
    hx = ctx.hx; nodes = np.array([a[0] for a in anchors]); w = np.array([a[1] for a in anchors]); w = w / w.sum()
    db = dijkstra(ATb, directed=True, indices=nodes)[:, hx["node"]]; dk = dijkstra(ATk, directed=True, indices=nodes)[:, hx["node"]]
    tb = np.minimum(CAP, (np.minimum(db, CAP) * w[:, None]).sum(0) + hx["snapS"]); tk = np.minimum(CAP, (np.minimum(dk, CAP) * w[:, None]).sum(0) + hx["snapS"])
    added = tk - tb; pop = hx["pop"]
    return float((pop * added).sum() / pop.sum()), float(np.percentile(added[pop > 0], 99)), float(added.max())


def main():
    t0 = time.time()
    ctx = Ctx(); g = ctx.g; T0 = base_times(ctx)
    ATb = matrix(ctx, T0, frozenset()).T.tocsr(); ATk = matrix(ctx, T0, frozenset(ctx.kb)).T.tocsr()
    w_, s_, e_, n_ = config.BBOX
    wac = pd.read_csv(config.RAW / "interim" / "lodes_wac_blocks.csv", dtype={"block": str})
    wb = wac[(wac.lat >= s_) & (wac.lat <= n_) & (wac.lon >= w_) & (wac.lon <= e_) & (wac.jobs > 0)].sort_values("block").reset_index(drop=True)
    x, y = Transformer.from_crs(4326, 32618, always_xy=True).transform(wb.lon.values, wb.lat.values)
    X = np.column_stack([x, y]); jobs = wb.jobs.values.astype(float)
    snapidx = SnapIndex(g)
    out = {"blocks": int(len(wb)), "variants": []}
    ref = anchors_for(wb, X, jobs, 8, 7, 20, snapidx)
    snapshot = json.loads((config.SNAP / "destinations.json").read_text())
    same = sorted(a[0] for a in ref) == sorted(d["node"] for d in snapshot)
    out["reproducesSnapshotAnchors"] = bool(same)
    print("K=8 seed 7 reproduces destinations.json nodes:", same, flush=True)
    assert same
    r = reg_added(ctx, ATb, ATk, ref); out["reference"] = {"popMeanAddedS": r[0], "p99AddedS": r[1], "maxAddedS": r[2]}
    print("reference", r, flush=True)
    for K in (2, 4, 6, 8, 12, 16, 24, 32):
        a = anchors_for(wb, X, jobs, K, 7, 20, snapidx); r = reg_added(ctx, ATb, ATk, a)
        out["variants"].append({"name": f"K={K}, seed 7", "K": K, "popMeanAddedS": r[0], "p99AddedS": r[1], "maxAddedS": r[2]}); print(out["variants"][-1], round(time.time() - t0), flush=True)
    for seed in (1, 2, 3, 4, 5):
        a = anchors_for(wb, X, jobs, 8, seed, 20, snapidx); r = reg_added(ctx, ATb, ATk, a)
        out["variants"].append({"name": f"K=8, seed {seed}", "K": 8, "popMeanAddedS": r[0], "p99AddedS": r[1], "maxAddedS": r[2]}); print(out["variants"][-1], flush=True)
    rng = np.random.default_rng(3); boots = []
    for b in range(30):
        m = rng.multinomial(len(wb), np.full(len(wb), 1.0 / len(wb))); wt = jobs * m; keep = wt > 0
        sub = wb[keep].reset_index(drop=True)
        a = anchors_for(sub, X[keep], wt[keep], 8, 7, 5, snapidx); r = reg_added(ctx, ATb, ATk, a)
        boots.append({"popMeanAddedS": r[0], "p99AddedS": r[1], "maxAddedS": r[2]})
        if b % 5 == 0: print("  boot", b, r[0], round(time.time() - t0), flush=True)
    v = np.array([b["popMeanAddedS"] for b in boots])
    out["bootstrapK8"] = {"B": 30, "popMeanAddedS": {"min": float(v.min()), "p2.5": float(np.percentile(v, 2.5)), "median": float(np.median(v)), "p97.5": float(np.percentile(v, 97.5)), "max": float(v.max()), "mean": float(v.mean())}, "rows": boots}
    (OUT / "regional_dest.json").write_text(json.dumps(out, indent=1))
    print("done", round(time.time() - t0))


if __name__ == "__main__":
    main()

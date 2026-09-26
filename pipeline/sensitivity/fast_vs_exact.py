"""Deliverable (4): independent Python port of the browser's fast cross-harbor variant (anchors), compared with the exact lens.
Port of frontend/lib/sim/lenses/xharbor.ts (buildAnchors + runFast + baseline sigma_c spread + linear ramp, RAMP_SCALE = 1).
Output: out/fast_vs_exact.json
"""
import json, time, pathlib
import numpy as np
from scipy.sparse.csgraph import dijkstra
from worldseed_pipeline import config, xharbor
from sensitivity.engine import *

OUT = pathlib.Path(__file__).parent / "out"; OUT.mkdir(exist_ok=True)
KM_PER_DEG_LAT = 110.57


def build_anchors(hx, k):
    shore, jobs = hx["shore"], hx["jobs"]
    dh = np.nonzero((jobs > 0) & (shore < 2))[0]                 # destination hexes (hex order)
    kmlng = 111.32 * np.cos(39.2 * np.pi / 180)
    A = {"node": [], "jobs": [], "snap": [], "members": []}
    for s in (0, 1):
        idx = dh[shore[dh] == s]
        x = hx["lng"][idx] * kmlng; y = hx["lat"][idx] * KM_PER_DEG_LAT; w = jobs[idx].astype(np.float64)
        n = len(idx); kk = min(k, n)
        cx = np.zeros(kk); cy = np.zeros(kk); near = np.full(n, np.inf)
        pick = int(np.argmax(w))
        for c in range(kk):
            cx[c], cy[c] = x[pick], y[pick]
            near = np.minimum(near, (x - cx[c]) ** 2 + (y - cy[c]) ** 2)
            pick = int(np.argmax(near * w))
        assign = np.zeros(n, dtype=np.int64)
        for _ in range(12):
            d2 = (x[:, None] - cx[None, :]) ** 2 + (y[:, None] - cy[None, :]) ** 2
            assign = np.argmin(d2, axis=1)
            sw = np.bincount(assign, weights=w, minlength=kk); sx = np.bincount(assign, weights=w * x, minlength=kk); sy = np.bincount(assign, weights=w * y, minlength=kk)
            nz = sw > 0
            cx[nz] = sx[nz] / sw[nz]; cy[nz] = sy[nz] / sw[nz]
        nodes, jb, sn, mem = [], [], [], []
        for c in range(kk):
            m = np.nonzero(assign == c)[0]
            if len(m) == 0: continue
            d2 = (x[m] - cx[c]) ** 2 + (y[m] - cy[c]) ** 2
            bi = m[int(np.argmin(d2))]
            nodes.append(int(hx["node"][idx[bi]])); jb.append(float(w[m].sum())); sn.append(float((w[m] * hx["snapS"][idx[m]]).sum() / w[m].sum()))
            mem.append(idx[m])
        A["node"].append(np.array(nodes)); A["jobs"].append(np.array(jb)); A["snap"].append(np.array(sn)); A["members"].append(mem)
    return A


def anchor_dists(ctx, A, mat):
    """reverse distances (anchor -> all hex nodes) for both destination shores; cap handled by min() below."""
    AT = mat.T.tocsr()
    return [dijkstra(AT, directed=True, indices=A["node"][s]) for s in (0, 1)]   # full-node columns


def fast_arrays(ctx, A, dist_full, spread, ramp=1.0, T=T_MAIN):
    hx = ctx.hx; H = len(hx["node"])
    mean = np.zeros(H); jobs = np.zeros(H)
    for dshore in (0, 1):
        O = np.nonzero(hx["shore"] == 1 - dshore)[0]
        for c in range(len(A["node"][dshore])):
            d = dist_full[dshore][c]
            W = A["jobs"][dshore][c]; sc = A["snap"][dshore][c]
            t = hx["snapS"][O] + d[hx["node"][O]] + sc
            mean[O] += W * np.minimum(t, CAP)
            half = ramp * spread[dshore][c]
            if half > 0:
                f = np.clip((T - t + half) / (2 * half), 0, 1)
                jobs[O] += W * f
            else:
                jobs[O] += W * (t <= T)
    jbs = [A["jobs"][s].sum() for s in (0, 1)]
    mean_out = np.full(H, np.nan); jobs_out = np.full(H, np.nan)
    for s in (0, 1):
        O = np.nonzero(hx["shore"] == s)[0]
        mean_out[O] = mean[O] / jbs[1 - s]; jobs_out[O] = jobs[O]
    return {"J1800": jobs_out, "mean": mean_out}


def baseline_spread(ctx, A, dist_base):
    hx = ctx.hx; sp = []
    for s in (0, 1):
        row = []
        for c in range(len(A["node"][s])):
            mem = A["members"][s][c]; d = dist_base[s][c][hx["node"][mem]]
            d = np.where(np.isfinite(d), d, 0.0); w = hx["jobs"][mem].astype(float)
            row.append(float((w * d).sum() / w.sum()))
        sp.append(row)
    return sp


def main():
    t0 = time.time()
    ctx = Ctx(); hx = ctx.hx; T0 = base_times(ctx)
    base = solve_state(ctx)
    W = {"keybridge_removed": ctx.kb, "harbor_tunnel_closed": ctx.links["L-HARBORTUNNEL"],
         "keybridge_and_harbor_tunnel_closed": ctx.kb + ctx.links["L-HARBORTUNNEL"]}
    e0 = xh_arrays(ctx, base, {})
    Mb = matrix(ctx, T0, frozenset())
    pop = hx["pop"]; ok = ~np.isnan(e0["mean"]); popok = np.where(ok, pop, 0.0)
    keys = ("popLossGt10pct", "popLossGt25pct", "lowWageLossGt10pct", "lowWageLossGt25pct", "popMeanLossPct", "lowWageMeanLossPct", "popMeanAddedS", "addedP50S", "addedP90S", "addedP99S")
    out = {"worlds": {}}
    anchors = {K: build_anchors(hx, K) for K in (16, 32, 64, 128)}
    dbase = {K: anchor_dists(ctx, anchors[K], Mb) for K in anchors}
    spread = {K: baseline_spread(ctx, anchors[K], dbase[K]) for K in anchors}
    fbase = {K: fast_arrays(ctx, anchors[K], dbase[K], spread[K]) for K in anchors}
    for wname, edges in W.items():
        st = solve_state(ctx, disabled=edges)
        e1 = xh_arrays(ctx, st, {})
        exact = xharbor.summarize(e1, e0, ctx.hx, "J1800")
        exact_bg = bg_table(ctx, e0, e1)
        Mk = matrix(ctx, T0, frozenset(edges))
        rec_w = {"exact": {k: exact[k] for k in HEADLINE}, "variants": []}
        for K in (16, 32, 64, 128):
            A = anchors[K]
            dk = anchor_dists(ctx, A, Mk)
            f0, f1 = fbase[K], fast_arrays(ctx, A, dk, spread[K])
            fm = xharbor.summarize(f1, f0, ctx.hx, "J1800")
            fbg = bg_table(ctx, f0, f1)
            def stats(a, b, w):
                d = np.abs(a - b)[ok]; ww = w[ok]
                return {"meanAbs": float(d.mean()), "popWeightedMeanAbs": float((d * ww).sum() / ww.sum()), "max": float(d.max()), "p99": float(np.percentile(d, 99))}
            add_e, add_f = np.where(ok, e1["mean"] - e0["mean"], 0), np.where(ok, f1["mean"] - f0["mean"], 0)
            loss_e = xharbor._loss(np.where(ok, e0["J1800"], 0), np.where(ok, e1["J1800"], 0)); loss_f = xharbor._loss(np.where(ok, f0["J1800"], 0), np.where(ok, f1["J1800"], 0))
            rec = {"K": K, "anchorsTotal": int(sum(len(a) for a in A["node"])),
                   "baselineMeanTimeErrS": stats(f0["mean"], e0["mean"], pop), "worldMeanTimeErrS": stats(f1["mean"], e1["mean"], pop),
                   "addedTimeErrS": stats(add_f, add_e, pop), "baselineJobsErr": stats(f0["J1800"], e0["J1800"], pop),
                   "lossErrPP": {"meanAbs": float(100 * np.abs(loss_f - loss_e)[ok].mean()), "popWeightedMeanAbs": float(100 * (np.abs(loss_f - loss_e) * popok).sum() / popok.sum()), "max": float(100 * np.abs(loss_f - loss_e)[ok].max()),
                                 "p99": float(100 * np.percentile(np.abs(loss_f - loss_e)[ok], 99))},
                   "headline": {k: {"fast": fm[k], "exact": exact[k], "relErrPct": 100 * (fm[k] / exact[k] - 1) if exact[k] else None} for k in keys},
                   "top10Overlap": top_overlap(exact_bg, fbg), "worstBgSame": max(fbg, key=fbg.get) == max(exact_bg, key=exact_bg.get)}
            sp_r, n_r = spearman(exact_bg, fbg); rec["spearmanBg"] = sp_r; rec["spearmanN"] = n_r
            rec_w["variants"].append(rec)
            print(f"{wname} K={K} anchors {rec['anchorsTotal']} |world mean err| {rec['worldMeanTimeErrS']['meanAbs']:.1f}s max {rec['worldMeanTimeErrS']['max']:.0f}s | "
                  f"added err avg {rec['addedTimeErrS']['meanAbs']:.2f}s max {rec['addedTimeErrS']['max']:.0f}s | loss err avg {rec['lossErrPP']['meanAbs']:.2f}pp max {rec['lossErrPP']['max']:.0f}pp | "
                  + " ".join(f"{k}:{rec['headline'][k]['relErrPct']:+.1f}%" for k in ("popLossGt10pct", "popLossGt25pct", "lowWageLossGt10pct", "popMeanAddedS", "addedP90S", "popMeanLossPct"))
                  + f" | top10 {rec['top10Overlap']} ({time.time()-t0:.0f}s)", flush=True)
        out["worlds"][wname] = rec_w
    (OUT / "fast_vs_exact.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

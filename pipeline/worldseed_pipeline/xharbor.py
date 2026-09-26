"""Cross-harbor access lens `xharbor` (reference implementation, scipy csgraph).

WHY THIS LENS EXISTS. The region-wide job-access average barely moves when the Key Bridge is removed (about
+3 s), because most trips in the region never use it. The bridge's actual function is crossing the Patapsco.
So the question that matches that function is: for people on one shore, what happens to the jobs on the OTHER
shore? The lens is defined a priori from the bridge's function (crossing the river) and the fixed `shore`
field, using standard cumulative-opportunity accessibility. No threshold, destination set or weight was chosen by
looking at results; T = 30 min is the primary value and 20 and 40 min are reported as sensitivity.

Definitions (all times seconds, free-flow drive time on the snapshot graph):
  origins       hexes with shore in {0, 1}. Shore-2 ("ambiguous") hexes are not origins (metrics null).
  destinations  hexes with jobs > 0 and shore in {0, 1} ("opposite" = shore differs from the origin's shore).
                Shore-2 hexes are excluded from destination sets.  Jobs = LODES WAC C000 placed at the hex.
  t(h, j)       snapS_h + d(node_h, node_j) + snapS_j, with d = shortest enabled drive time (Dijkstra) and
                snapS = snap distance / 20 km/h.  Unreachable pairs never count and are capped in the mean.
  jobsWithin[T](h) = sum over opposite-shore destinations j with t(h, j) <= T of jobs_j     (primary T = 1800 s;
                sensitivity T = 1200 s and 2400 s)
  meanTimeS(h)  = sum_j jobs_j * min(t(h, j), ACCESS_CAP_S) / sum_j jobs_j over ALL opposite-shore destinations
                (job-weighted mean travel time to opposite-shore jobs; cap 7200 s as in the regional lens)
  loss(h)       = (J_baseline - J_world) / J_baseline   (J = jobsWithin[1800]); hexes with J_baseline = 0 have
                loss 0 and are counted separately (`originsWithoutBaselineJobs`).
  added(h)      = meanTimeS_world - meanTimeS_baseline
Metrics (population weights `pop`, low-wage weights `lowWage`; weighted quantiles as in golden.py):
  popMeanJobs, jobs p10/p50/p90, popLossGt{5,10,25,50}pct and lowWageLossGt..., meanLossPct (pop and low-wage),
  equityGapLossPct = low-wage mean loss - pop mean loss (percentage points), companion: popMeanAddedS,
  addedP50/P90/P99/Max, popAddedGt{60,300}s, lowWage variants, equityGapAddedS.
Tolerances for the TypeScript simulator: meanTimeS within 0.5 s per hex; jobsWithin[1800] must equal the golden
count exactly, except for hexes listed in `boundary`, where any value in [lo, hi] (counts at T-0.5 s and
T+0.5 s) is accepted.
"""
from __future__ import annotations

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from . import config
from .golden_util import wquantile

T_MAIN = 1800.0
T_SENS = (1200.0, 2400.0)
BOUND_S = 0.5
CHUNK = 128
LOSS_THRESH = (5, 10, 25, 50)


def prepare(hx: dict) -> dict:
    shore = hx["shore"]
    dest = np.nonzero((hx["jobs"] > 0) & (shore < 2))[0]
    orig = np.nonzero(shore < 2)[0]
    onodes, orow = np.unique(hx["node"][orig], return_inverse=True)
    return {"dest": dest, "dnode": hx["node"][dest], "dsnap": hx["snapS"][dest], "djobs": hx["jobs"][dest],
            "dshore": shore[dest], "orig": orig, "onodes": onodes, "orow": orow}


def _range(args):
    """Origin-node rows [a, b) of prep['onodes'] -> per-hex results for the hexes whose node is in that range."""
    A, hx, prep, a, b = args
    parts = []
    for lo in range(a, b, CHUNK):
        hi = min(b, lo + CHUNK)
        src = prep["onodes"][lo:hi]
        dist = dijkstra(A, directed=True, indices=src)
        Dn = dist[:, prep["dnode"]]
        sel = np.nonzero((prep["orow"] >= lo) & (prep["orow"] < hi))[0]
        h = prep["orig"][sel]
        D = Dn[prep["orow"][sel] - lo] + hx["snapS"][h][:, None] + prep["dsnap"][None, :]
        opp = prep["dshore"][None, :] != hx["shore"][h][:, None]
        dj = prep["djobs"]
        res = {"h": h}
        for T in (T_MAIN,) + T_SENS:
            res[f"J{int(T)}"] = ((D <= T) & opp).astype(np.float64) @ dj
        res["Jlo"] = ((D <= T_MAIN - BOUND_S) & opp).astype(np.float64) @ dj
        res["Jhi"] = ((D <= T_MAIN + BOUND_S) & opp).astype(np.float64) @ dj
        capped = np.minimum(D, config.ACCESS_CAP_S)
        res["mean"] = (capped * opp * dj[None, :]).sum(axis=1) / (opp * dj[None, :]).sum(axis=1)
        parts.append(res)
    return parts


KEYS = ("J1800", "J1200", "J2400", "Jlo", "Jhi", "mean")


def split_tasks(A, hx, prep, parts: int):
    n = len(prep["onodes"])
    step = -(-n // parts)
    return [(A, hx, prep, a, min(n, a + step)) for a in range(0, n, step)]


def assemble(results_by_task: list, H: int) -> dict:
    out = {k: np.full(H, np.nan) for k in KEYS}
    for parts in results_by_task:
        for r in parts:
            for k in KEYS:
                out[k][r["h"]] = r[k]
    return out


def compute_arrays(A: csr_matrix, hx: dict, prep: dict, executor=None, parts: int = 16) -> dict:
    tasks = split_tasks(A, hx, prep, parts if executor else 1)
    res = list(executor.map(_range, tasks)) if executor else [_range(t) for t in tasks]
    return assemble(res, len(hx["node"]))


# ------------------------------------------------------------------------------------------------
def _loss(J0, J):
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(J0 > 0, (J0 - J) / J0, 0.0)


def summarize(arr: dict, base: dict, hx: dict, T_key: str = "J1800") -> dict:
    """Metrics of a world relative to the baseline arrays. Works on origins only (shore 0/1)."""
    ok = ~np.isnan(arr["mean"])
    pop = np.where(ok, hx["pop"], 0.0)
    lw = np.where(ok, hx["lowWage"], 0.0)
    J = np.where(ok, arr[T_key], 0.0)
    J0 = np.where(ok, base[T_key], 0.0)
    loss = _loss(J0, J)
    added = np.where(ok, arr["mean"] - base["mean"], 0.0)
    m = {"popCovered": float(pop.sum()), "lowWageCovered": float(lw.sum()),
         "originsWithoutBaselineJobs": int(((J0 == 0) & ok).sum()),
         "popMeanJobs": float((pop * J).sum() / pop.sum()),
         "jobsP10": wquantile(J[ok], pop[ok], 0.10), "jobsP50": wquantile(J[ok], pop[ok], 0.5),
         "jobsP90": wquantile(J[ok], pop[ok], 0.9),
         "popMeanLossPct": float(100 * (pop * loss).sum() / pop.sum()),
         "lowWageMeanLossPct": float(100 * (lw * loss).sum() / lw.sum())}
    m["equityGapLossPct"] = m["lowWageMeanLossPct"] - m["popMeanLossPct"]
    for t in LOSS_THRESH:
        m[f"popLossGt{t}pct"] = float(pop[loss > t / 100].sum())
        m[f"lowWageLossGt{t}pct"] = float(lw[loss > t / 100].sum())
    m["popMeanMeanTimeS"] = float((pop * np.where(ok, arr["mean"], 0)).sum() / pop.sum())
    m["popMeanAddedS"] = float((pop * added).sum() / pop.sum())
    m["lowWageMeanAddedS"] = float((lw * added).sum() / lw.sum())
    m["equityGapAddedS"] = m["lowWageMeanAddedS"] - m["popMeanAddedS"]
    m["addedP50S"] = wquantile(added[ok], pop[ok], 0.5)
    m["addedP90S"] = wquantile(added[ok], pop[ok], 0.9)
    m["addedP99S"] = wquantile(added[ok], pop[ok], 0.99)
    m["addedMaxS"] = float(added.max())
    for t in (60, 300):
        m[f"popAddedGt{t}s"] = float(pop[added > t].sum())
        m[f"lowWageAddedGt{t}s"] = float(lw[added > t].sum())
    split = {}
    for s in (0, 1):
        sm = ok & (hx["shore"] == s)
        p, l = np.where(sm, hx["pop"], 0.0), np.where(sm, hx["lowWage"], 0.0)
        if p.sum() <= 0:
            continue
        split[str(s)] = {"pop": float(p.sum()), "popMeanLossPct": float(100 * (p * loss).sum() / p.sum()),
                         "popLossGt10pct": float(p[loss > 0.10].sum()), "popLossGt25pct": float(p[loss > 0.25].sum()),
                         "lowWageLossGt10pct": float(l[loss > 0.10].sum()),
                         "popMeanAddedS": float((p * added).sum() / p.sum()),
                         "popAddedGt60s": float(p[added > 60].sum()),
                         "meanBaselineJobs": float((p * J0).sum() / p.sum())}
    m["byOriginShore"] = split
    return m


def sensitivity(arr: dict, base: dict, hx: dict) -> dict:
    out = {}
    for T in T_SENS + (T_MAIN,):
        k = f"J{int(T)}"
        s = summarize(arr, base, hx, k)
        out[f"T{int(T // 60)}min"] = {q: s[q] for q in ("popMeanJobs", "popMeanLossPct", "lowWageMeanLossPct", "popLossGt5pct",
                                                        "popLossGt10pct", "popLossGt25pct", "lowWageLossGt10pct",
                                                        "lowWageLossGt25pct", "equityGapLossPct",
                                                        "originsWithoutBaselineJobs")}
    return out


def per_hex_payload(arr: dict) -> dict:
    """JSON-friendly per-hex arrays (null for shore-2 origins)."""
    ok = ~np.isnan(arr["mean"])
    jobs = [None if not o else int(round(x)) for o, x in zip(ok, arr["J1800"])]
    mean = [None if not o else round(float(x), 2) for o, x in zip(ok, arr["mean"])]
    bnd = [[int(i), int(round(arr["Jlo"][i])), int(round(arr["Jhi"][i]))]
           for i in np.nonzero(ok & ((arr["Jlo"] != arr["J1800"]) | (arr["Jhi"] != arr["J1800"])))[0]]
    return {"jobsWithin1800": jobs, "meanTimeS": mean, "boundary": bnd}

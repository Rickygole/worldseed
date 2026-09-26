"""Sensitivity-study engine (PROTOTYPE-GRADE analysis code, not part of the shipped pipeline).

Design: the expensive part of every lens is the network travel-time matrix, which depends only on edge times and
closures. So one "network state" = (edge times, closed edges) is solved ONCE:
    M[u, v]   drive time v -> node u (float64 s) for every destination-side node u (all nodes of hexes with jobs > 0
              plus the K=8 regional-lens anchors) and every hex node v      (reverse Dijkstra, scipy csgraph)
    ems[v]    multi-source forward drive time from the EMS stations to node v
Everything else (shore rule, snap speed, job weights, threshold T, call delay) is cheap post-processing on top of a
state. Lens definitions are NOT re-implemented where the reference code can be reused: metrics come from
worldseed_pipeline.xharbor.summarize / golden.ems_metrics / golden.access_metrics / golden.worst_block_groups.
Times are free-flow (assumption A-NO-DELAYS), same as the reference engine.
"""
from __future__ import annotations

import json
import os
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from worldseed_pipeline import config, golden, xharbor
from worldseed_pipeline.golden_util import wquantile
from worldseed_pipeline.graphio import load_graph
from worldseed_pipeline.worlds import _dedupe_min

CAND = config.FLAGS["CANDIDATE"]
CAP = config.ACCESS_CAP_S
T_MAIN = xharbor.T_MAIN


# --------------------------------------------------------------------------------------------- context
class Ctx:
    def __init__(self):
        self.g = load_graph()
        self.hx = golden.load_hexes()
        self.dests = json.loads((config.SNAP / "destinations.json").read_text())
        self.fac = json.loads((config.SNAP / "facilities.json").read_text())
        self.bgs = json.loads((config.SNAP / "blockgroups.json").read_text())
        self.links = {l["id"]: list(l["edges"]) for l in self.g.meta["links"]}
        self.sources = sorted({f["node"] for f in self.fac if f["active"] and f["kind"] in ("fire_station", "ems_station")})
        hx = self.hx
        self.hexnodes = np.unique(hx["node"])                       # columns of M
        self.col = np.full(self.g.n, -1, dtype=np.int64)
        self.col[self.hexnodes] = np.arange(len(self.hexnodes))
        self.anchor_nodes = np.array([d["node"] for d in self.dests], dtype=np.int64)
        jobnodes = hx["node"][hx["jobs"] > 0]
        self.rownodes = np.unique(np.concatenate([jobnodes, self.anchor_nodes]))   # rows of M
        self.row = np.full(self.g.n, -1, dtype=np.int64)
        self.row[self.rownodes] = np.arange(len(self.rownodes))
        self.kb = self.links["L-KEYBRIDGE"]
        self.workers = max(1, min(9, (os.cpu_count() or 2) - 1))
        self._pool = None

    def pool(self) -> ProcessPoolExecutor:
        if self._pool is None:
            self._pool = ProcessPoolExecutor(max_workers=self.workers)
        return self._pool


def _solve(args):
    AT, idx, cols = args
    return dijkstra(AT, directed=True, indices=idx)[:, cols]


@dataclass
class State:
    M: np.ndarray            # (len(rownodes), len(hexnodes))
    ems: np.ndarray          # (len(hexnodes),) multi-source station drive time
    label: str = ""
    disabled: frozenset = frozenset()


def matrix(ctx: Ctx, t: np.ndarray, disabled) -> csr_matrix:
    g = ctx.g
    on = (g.edgeFlags & CAND) == 0
    if len(disabled):
        on = on & ~np.isin(np.arange(g.e), np.array(sorted(disabled), dtype=np.int64))
    u, v, tt = _dedupe_min(g.edgeFrom[on].astype(np.int64), g.edgeTo[on].astype(np.int64), t[on])
    return csr_matrix((tt, (u, v)), shape=(g.n, g.n))


def solve_state(ctx: Ctx, t: np.ndarray | None = None, disabled=(), label: str = "", ems_only_extra=None) -> State:
    """t: per-edge free-flow time (defaults to the snapshot's edgeTimeS as float64)."""
    if t is None:
        t = ctx.g.edgeTimeS.astype(np.float64)
    A = matrix(ctx, t, frozenset(disabled))
    AT = A.T.tocsr()
    n = len(ctx.rownodes)
    step = -(-n // (ctx.workers * 2))
    tasks = [(AT, ctx.rownodes[a:a + step], ctx.hexnodes) for a in range(0, n, step)]
    M = np.vstack(list(ctx.pool().map(_solve, tasks)))
    ems = dijkstra(A, directed=True, indices=np.array(ctx.sources), min_only=True)[ctx.hexnodes]
    return State(M=M, ems=ems, label=label, disabled=frozenset(disabled))


# --------------------------------------------------------------------------------------------- xharbor
def xh_arrays(ctx: Ctx, S: State, hxv: dict, T: float = T_MAIN) -> dict:
    """Same output shape as xharbor.compute_arrays (J1800 holds jobs within T; mean; NaN for non-origins).
    hxv overrides any of shore / snapS / jobs (defaults: snapshot)."""
    hx = ctx.hx
    shore = hxv.get("shore", hx["shore"])
    snap = hxv.get("snapS", hx["snapS"])
    jobs = hxv.get("jobs", hx["jobs"])
    H = len(shore)
    J = np.full(H, np.nan)
    mean = np.full(H, np.nan)
    for s in (0, 1):
        O = np.nonzero(shore == s)[0]
        Dh = np.nonzero((jobs > 0) & (shore == 1 - s))[0]
        if len(O) == 0 or len(Dh) == 0:
            continue
        Mb = S.M[np.ix_(ctx.row[hx["node"][Dh]], ctx.col[hx["node"][O]])].T          # origins x dests
        D = Mb + snap[O][:, None] + snap[Dh][None, :]
        dj = jobs[Dh].astype(np.float64)
        J[O] = (D <= T).astype(np.float64) @ dj
        mean[O] = np.minimum(D, CAP) @ dj / dj.sum()
    return {"J1800": J, "mean": mean}


def xh_summary(ctx: Ctx, arr: dict, base: dict, hx_over: dict | None = None) -> dict:
    hxm = dict(ctx.hx)
    if hx_over:
        hxm.update(hx_over)
    return xharbor.summarize(arr, base, hxm, "J1800")


# --------------------------------------------------------------------------------------------- regional / EMS
def access_field(ctx: Ctx, S: State, snap: np.ndarray | None = None) -> np.ndarray:
    hx = ctx.hx
    snap = hx["snapS"] if snap is None else snap
    jobs = np.array([d["jobs"] for d in ctx.dests], dtype=float)
    w = jobs / jobs.sum()
    cols = ctx.col[hx["node"]]
    acc = np.zeros(len(cols))
    for wk, d in zip(w, ctx.dests):
        t = np.minimum(S.M[ctx.row[d["node"]]][cols], CAP)
        acc += wk * t
    return np.minimum(CAP, acc + snap)


def ems_field(ctx: Ctx, S: State, call_s: float = config.CALL_TO_WHEELS_S, snap: np.ndarray | None = None) -> np.ndarray:
    hx = ctx.hx
    snap = hx["snapS"] if snap is None else snap
    return call_s + S.ems[ctx.col[hx["node"]]] + snap


# --------------------------------------------------------------------------------------------- bundled evaluation
def bg_table(ctx: Ctx, base: dict, arr: dict, hxm: dict | None = None) -> dict:
    """Per-block-group mean loss (pop >= 200), as golden.worst_block_groups computes it, but for ALL BGs so that
    rankings can be compared. Returns {geoid: meanLossPct}."""
    hx = hxm or ctx.hx
    ok = ~np.isnan(arr["mean"])
    loss = xharbor._loss(np.where(ok, base["J1800"], 0.0), np.where(ok, arr["J1800"], 0.0))
    out = {}
    for b in ctx.bgs:
        hs = [h for h in b["hexes"] if ok[h]]
        if not hs or b["pop"] < 200:
            continue
        p = hx["pop"][hs]
        if p.sum() <= 0:
            continue
        out[b["geoid"]] = float(100 * (loss[hs] * p).sum() / p.sum())
    return out


HEADLINE = ("popLossGt10pct", "popLossGt25pct", "lowWageLossGt10pct", "lowWageLossGt25pct", "popMeanLossPct",
            "lowWageMeanLossPct", "equityGapLossPct", "popMeanAddedS", "addedP50S", "addedP90S", "addedP99S",
            "popCovered", "lowWageCovered")


def evaluate(ctx: Ctx, base: State, world: State, hxv: dict | None = None, T: float = T_MAIN,
             call_s: float = config.CALL_TO_WHEELS_S, with_bg: bool = True) -> dict:
    """Headline metrics of `world` relative to `base`, all three lenses, under overrides hxv (shore/snapS/jobs)."""
    hxv = hxv or {}
    hxm = dict(ctx.hx)
    hxm.update({k: v for k, v in hxv.items() if k in ("shore", "snapS", "jobs")})
    snap = hxm["snapS"]
    a0 = xh_arrays(ctx, base, hxv, T)
    a1 = xh_arrays(ctx, world, hxv, T)
    # non-origin (shore 2) hexes must carry zero weight, exactly as summarize() does through the NaN mask
    xm = xharbor.summarize(a1, a0, hxm, "J1800")
    out = {"xh": {k: xm[k] for k in HEADLINE}}
    out["xh"]["meanJobs"] = xm["popMeanJobs"]
    out["xh"]["originHexes"] = int((hxm["shore"] < 2).sum())
    out["xh"]["byShore"] = xm["byOriginShore"]
    # regional access
    acc0, acc1 = access_field(ctx, base, snap), access_field(ctx, world, snap)
    added = acc1 - acc0
    pop = hxm["pop"]
    out["reg"] = {"popMeanAddedS": float((pop * added).sum() / pop.sum()),
                  "lowWageMeanAddedS": float((hxm["lowWage"] * added).sum() / hxm["lowWage"].sum()),
                  "baseP50S": wquantile(acc0, pop, .5), "baseP90S": wquantile(acc0, pop, .9)}
    # EMS
    e0, e1 = ems_field(ctx, base, call_s, snap), ems_field(ctx, world, call_s, snap)
    m0, m1 = golden.ems_metrics(e0, hxm), golden.ems_metrics(e1, hxm)
    out["ems"] = {"baseP50S": m0["p50S"], "baseP90S": m0["p90S"], "worldP50S": m1["p50S"], "worldP90S": m1["p90S"],
                  "dP50S": m1["p50S"] - m0["p50S"], "dP90S": m1["p90S"] - m0["p90S"],
                  "basePctWithin": m0["pctWithin"], "worldPctWithin": m1["pctWithin"],
                  "hexesChangedGt1s": int((np.abs(np.nan_to_num(e1 - e0, posinf=1e9)) > 1).sum())}
    if with_bg:
        out["bg"] = bg_table(ctx, a0, a1, hxm)
    return out


def top_overlap(ref_bg: dict, bg: dict, k: int = 10) -> int:
    top = lambda d: {g for g, _ in sorted(d.items(), key=lambda kv: (-kv[1], kv[0]))[:k]}
    return len(top(ref_bg) & top(bg))


def spearman(ref_bg: dict, bg: dict, min_ref: float = 0.0) -> tuple[float | None, int]:
    """Spearman rank correlation of BG mean loss over BGs with ref loss > min_ref."""
    from scipy.stats import spearmanr
    keys = [k for k, v in ref_bg.items() if v > min_ref and k in bg]
    if len(keys) < 3:
        return None, len(keys)
    r = spearmanr([ref_bg[k] for k in keys], [bg[k] for k in keys]).statistic
    return (None if np.isnan(r) else float(r)), len(keys)


def base_times(ctx: Ctx) -> np.ndarray:
    return ctx.g.edgeTimeS.astype(np.float64).copy()


def hex_deltas(ctx: Ctx, base: State, world: State) -> dict:
    """Per-hex change diagnostics between two states (snapshot shore/snap/jobs): counts of hexes changed by more than
    1 s and the maximum change, for the three lenses; plus the number of pop-carrying hexes that lose reachability."""
    a0, a1 = xh_arrays(ctx, base, {}), xh_arrays(ctx, world, {})
    ok = ~np.isnan(a0["mean"])
    dx = np.where(ok, a1["mean"] - a0["mean"], 0.0)
    dr = access_field(ctx, world) - access_field(ctx, base)
    e0, e1 = ems_field(ctx, base), ems_field(ctx, world)
    de = np.where(np.isfinite(e1) & np.isfinite(e0), e1 - e0, np.where(np.isfinite(e1) == np.isfinite(e0), 0.0, 1e9))
    pop = ctx.hx["pop"]
    return {"xhHexesAddedGt1s": int((dx > 1).sum()), "xhMaxAddedS": float(dx.max()), "xhPopAddedGt1s": float(pop[dx > 1].sum()),
            "regHexesAddedGt1s": int((dr > 1).sum()), "regMaxAddedS": float(dr.max()), "regPopAddedGt1s": float(pop[dr > 1].sum()),
            "emsHexesChangedGt1s": int((np.abs(de) > 1).sum()), "emsMaxChangeS": float(np.abs(de).max()),
            "emsPopChangedGt1s": float(pop[np.abs(de) > 1].sum()),
            "newlyUnreachablePairs": int((np.isinf(world.M) & ~np.isinf(base.M)).sum())}


def edge_xy(ctx: Ctx, lat0: float = 39.2176, lon0: float = -76.5286):
    g = ctx.g
    idx = np.arange(g.e)
    lo = (g.nodeLon[g.edgeFrom].astype(float) + g.nodeLon[g.edgeTo]) / 2
    la = (g.nodeLat[g.edgeFrom].astype(float) + g.nodeLat[g.edgeTo]) / 2
    return (lo - lon0) * 111320 * np.cos(np.radians(lat0)), (la - lat0) * 110570


def pct_rank(sample: np.ndarray, x: float) -> float:
    """Percentile of x in sample: 100 * (#below + 0.5 * #equal) / n."""
    s = np.asarray(sample, dtype=float)
    return float(100 * ((s < x).sum() + 0.5 * (s == x).sum()) / len(s))

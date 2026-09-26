"""candidate_effects.json: measured effect of every catalog candidate, from the reference code.

Each candidate is applied on its own to two contexts:
  baseline           = the 2024-03-01 network (candidate on top of the intact bridge)
  keybridge_removed  = L-KEYBRIDGE disabled (candidate on top of the removed bridge)
and both lenses (regional Access, xharbor) plus the EMS lens are evaluated with the same reference code as
golden.json (networkx for regional Access / EMS, scipy for xharbor). All deltas are against the same context
WITHOUT the candidate, with the sign convention "positive = better":
  xharborTimeSavedS   reduction of the pop-weighted mean added cross-harbor travel time
  xharborJobsGain     increase of the pop-weighted mean cross-harbor jobs within 30 min
  accessTimeSavedS    reduction of the pop-weighted mean regional Access time
  emsP90SavedS        reduction of the pop-weighted EMS p90
  emsPctWithinGain    increase (percentage points) of the share of people within 8 min

Materiality (chosen a priori, deliberately small so that only true zeros are called "no effect"): a candidate
`helps` a lens when it improves that lens by at least 1 s (time metrics), 100 jobs (xharbor jobs) or 0.01 points
(EMS % within). Dominance: A dominates B when A's cost tier is not higher than B's, A is at least as good as B on
every benefit in the bridge-removed context, and strictly better on at least one; entries with no measurable effect
are listed separately and are dominated by any cheaper-or-equal entry that helps.
"""
from __future__ import annotations

import json
import os
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from . import config, golden, worlds as worlds_mod, xharbor
from .graphio import load_graph
from .worlds import World

_S: dict = {}


def _state():
    if not _S:
        g = load_graph()
        hx = golden.load_hexes()
        _S.update(g=g, hx=hx, prep=xharbor.prepare(hx),
                  dests=json.loads((config.SNAP / "destinations.json").read_text()),
                  fac=json.loads((config.SNAP / "facilities.json").read_text()))
    return _S


def eval_world(w: World) -> dict:
    """Raw per-hex arrays for one world (runs in a worker process)."""
    s = _state()
    g, hx = s["g"], s["hx"]
    G = golden.digraph(g, set(), w)
    sources = sorted({f["node"] for f in s["fac"] if f["active"] and f["kind"] in ("fire_station", "ems_station")}
                     | set(w.extra_sources))
    return {"ems": golden.ems_field(G, hx, sources), "access": golden.access_field(G.reverse(copy=False), hx, s["dests"]),
            "xh": xharbor.compute_arrays(worlds_mod.matrix(g, w), hx, s["prep"])}


def _r(x, nd=3):
    return None if x is None else round(float(x), nd)


def metrics(res: dict, ref_access: np.ndarray, base_xh: dict, hx: dict) -> dict:
    pop = hx["pop"]
    added = res["access"] - ref_access
    em = golden.ems_metrics(res["ems"], hx)
    xm = xharbor.summarize(res["xh"], base_xh, hx)
    return {
        "access": {"popMeanAddedS": _r((pop * added).sum() / pop.sum()), "p50S": _r(golden.wquantile(res["access"], pop, 0.5)),
                   "p90S": _r(golden.wquantile(res["access"], pop, 0.9)), "popAddedGt60s": _r(pop[added > 60].sum(), 1)},
        "xharbor": {k: _r(xm[k], 3) for k in ("popMeanJobs", "popMeanLossPct", "lowWageMeanLossPct", "popLossGt10pct",
                                              "popLossGt25pct", "lowWageLossGt10pct", "popMeanAddedS", "popAddedGt60s")},
        "ems": {"p50S": _r(em["p50S"]), "p90S": _r(em["p90S"]), "pctWithin": _r(em["pctWithin"], 4),
                "zvhWithin": _r(em["zvhWithin"], 4), "isolatedBgCount": len(em["isolatedBg"])},
    }


def benefits(c: dict, ref: dict) -> dict:
    return {
        "xharborTimeSavedS": _r(ref["xharbor"]["popMeanAddedS"] - c["xharbor"]["popMeanAddedS"]),
        "xharborJobsGain": _r(c["xharbor"]["popMeanJobs"] - ref["xharbor"]["popMeanJobs"], 1),
        "accessTimeSavedS": _r(ref["access"]["popMeanAddedS"] - c["access"]["popMeanAddedS"]),
        "emsP90SavedS": _r(ref["ems"]["p90S"] - c["ems"]["p90S"]),
        "emsPctWithinGain": _r(c["ems"]["pctWithin"] - ref["ems"]["pctWithin"], 4),
    }


def helps(b: dict) -> list[str]:
    out = []
    if b["xharborTimeSavedS"] >= 1 or b["xharborJobsGain"] >= 100:
        out.append("xharbor")
    if b["accessTimeSavedS"] >= 1:
        out.append("access")
    if b["emsP90SavedS"] >= 1 or b["emsPctWithinGain"] >= 0.01:
        out.append("ems")
    return out


VEC = ("xharborTimeSavedS", "xharborJobsGain", "accessTimeSavedS", "emsP90SavedS", "emsPctWithinGain")
TIER = {"$": 1, "$$": 2, "$$$": 3}


def local_effect(c: dict, res: dict, ref_res: dict, hx: dict, g, w: World, ref_w: World) -> dict:
    """Where the effect lands: best single-hex saving, people spared a minute or more, and for temporary links the
    terminal-to-terminal drive/crossing time before and after."""
    from scipy.sparse.csgraph import dijkstra
    ok = ~np.isnan(res["xh"]["mean"])
    saved = np.where(ok, ref_res["xh"]["mean"] - res["xh"]["mean"], 0.0)
    out = {"maxHexXharborTimeSavedS": _r(saved.max(), 1),
           "popXharborSaved60s": _r(hx["pop"][saved >= 60].sum(), 0),
           "hexesXharborSaved60s": int((saved >= 60).sum())}
    if c["type"] == "temp_link":
        a, b = c["refs"]["nodes"]
        t0 = dijkstra(worlds_mod.matrix(g, ref_w), directed=True, indices=a)[b]
        t1 = dijkstra(worlds_mod.matrix(g, w), directed=True, indices=a)[b]
        out["terminalPairTimeS"] = {"without": _r(t0, 1), "with": _r(t1, 1)}
    return out


def world_for(c: dict, kb_edges: frozenset) -> tuple[World, World]:
    """(baseline-context world, keybridge-removed-context world) for a catalog entry."""
    eff = c["effect"]
    kw = {}
    if eff["op"] == "enable_edges":
        kw["enabled"] = frozenset(eff["edges"])
    elif eff["op"] == "corridor_speed":
        kw["corridor_factor"] = ((c["refs"]["corridorIndex"], eff["factor"]),)
    elif eff["op"] == "add_source":
        kw["extra_sources"] = (eff["facilityLike"]["node"],)
    return World(id=c["id"] + "@baseline", **kw), World(id=c["id"] + "@keybridge_removed", disabled=kb_edges, **kw)


def compute(verbose: bool = True) -> dict:
    t0 = time.time()
    s = _state()
    g, hx = s["g"], s["hx"]
    cands = json.loads((config.SNAP / "candidates.json").read_text())
    kb = frozenset(next(l for l in g.meta["links"] if l["id"] == "L-KEYBRIDGE")["edges"])
    ref_worlds = [World(id="baseline"), World(id="keybridge_removed", disabled=kb)]
    todo = list(ref_worlds)
    for c in cands:
        todo += list(world_for(c, kb))
    workers = golden.workers()
    with ProcessPoolExecutor(max_workers=workers) as ex:
        results = list(ex.map(eval_world, todo, chunksize=1))
    if verbose:
        print(f"  evaluated {len(todo)} worlds on {workers} workers ({time.time() - t0:.0f}s)")
    base_res, kb_res = results[0], results[1]
    base_xh = base_res["xh"]
    ref = {"baseline": metrics(base_res, base_res["access"], base_xh, hx),
           "keybridge_removed": metrics(kb_res, base_res["access"], base_xh, hx)}
    entries = []
    for k, c in enumerate(cands):
        rb, rk = results[2 + 2 * k], results[3 + 2 * k]
        mb = metrics(rb, base_res["access"], base_xh, hx)
        mk = metrics(rk, base_res["access"], base_xh, hx)
        bb, bk = benefits(mb, ref["baseline"]), benefits(mk, ref["keybridge_removed"])
        wb, wk = world_for(c, kb)
        bk["xharborShareOfBridgeLossRecovered"] = _r(bk["xharborTimeSavedS"] / ref["keybridge_removed"]["xharbor"]["popMeanAddedS"], 4)
        entries.append({"id": c["id"], "type": c["type"], "kind": c["kind"], "costTier": c["costTier"],
                        "inBaseline": {"metrics": mb, "benefits": bb, "helps": helps(bb),
                                       "local": local_effect(c, rb, base_res, hx, g, wb, ref_worlds[0])},
                        "inKeybridgeRemoved": {"metrics": mk, "benefits": bk, "helps": helps(bk),
                                               "local": local_effect(c, rk, kb_res, hx, g, wk, ref_worlds[1])}})
    # dominance in the bridge-removed context, among entries with any measurable benefit
    eff = [e for e in entries if e["inKeybridgeRemoved"]["helps"]]
    for e in entries:
        e["measurableEffectInKeybridgeRemoved"] = bool(e["inKeybridgeRemoved"]["helps"])
        v = [e["inKeybridgeRemoved"]["benefits"][q] for q in VEC]
        dom = []
        for o in eff:
            if o is e:
                continue
            w = [o["inKeybridgeRemoved"]["benefits"][q] for q in VEC]
            if TIER[o["costTier"]] <= TIER[e["costTier"]] and all(a >= b - 1e-9 for a, b in zip(w, v)) and \
                    (any(a > b + 1e-9 for a, b in zip(w, v)) or (w == v and o["id"] < e["id"])):
                dom.append(o["id"])
        e["dominatedBy"] = sorted(dom)
    out = {"snapshotId": config.SNAPSHOT_ID,
           "note": "Effects of each candidate alone, measured by the reference code (see candidate_effects.py docstring). "
                   "Positive benefit = better. Hypothetical scenario options; not forecasts.",
           "materiality": {"timeS": 1, "jobs": 100, "emsPctWithinPoints": 0.01},
           "reference": ref, "candidates": entries}
    return out


def dumps(doc: dict) -> str:
    return json.dumps(doc, indent=1) + "\n"


def run() -> dict:
    t0 = time.time()
    out = compute()
    (config.SNAP / "candidate_effects.json").write_text(dumps(out))
    print(f"candidate_effects.json: {len(out['candidates'])} candidates ({time.time() - t0:.0f}s)")
    return out


if __name__ == "__main__":
    run()

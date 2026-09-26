"""Deliverable (1): sanity / null controls.  Outputs: out/null_controls.json

  A. remote low-traffic edges (should change almost nothing)
  B. closure ordering: Key Bridge vs the two tunnels vs both tunnels
  C. monotonicity of candidates (from the committed candidate_effects.json)
  D. random corridor-cut baseline (200 random motorway/trunk cuts) and the Key Bridge percentile
Pre-declared pass rule for A (set before looking at results): mean xharbor added time < 0.5 s, people losing >10% of
cross-harbor jobs < 0.05% of covered population, regional mean added < 0.5 s, EMS p50/p90 change < 1 s.
"""
import json, time, pathlib, collections
import numpy as np
from sensitivity.engine import *

OUT = pathlib.Path(__file__).parent / "out"; OUT.mkdir(exist_ok=True)
rng = np.random.default_rng(20260926)
LAT0, LON0 = 39.2176, -76.5286


def summarize_world(ctx, base, world):
    ev = evaluate(ctx, base, world, with_bg=False)
    d = hex_deltas(ctx, base, world)
    return {"popLossGt10": ev["xh"]["popLossGt10pct"], "popLossGt25": ev["xh"]["popLossGt25pct"],
            "lowWageLossGt10": ev["xh"]["lowWageLossGt10pct"], "lowWageLossGt25": ev["xh"]["lowWageLossGt25pct"],
            "xhPopMeanLossPct": ev["xh"]["popMeanLossPct"], "xhMeanAddedS": ev["xh"]["popMeanAddedS"],
            "xhAddedP90S": ev["xh"]["addedP90S"], "regMeanAddedS": ev["reg"]["popMeanAddedS"],
            "emsDP50S": ev["ems"]["dP50S"], "emsDP90S": ev["ems"]["dP90S"], **d}


def main():
    t0 = time.time()
    ctx = Ctx(); g = ctx.g; hx = ctx.hx
    base = solve_state(ctx)
    kb_state = solve_state(ctx, disabled=ctx.kb)
    kb_sum = summarize_world(ctx, base, kb_state)
    x, y = edge_xy(ctx, LAT0, LON0)
    dist_kb = np.hypot(x, y)
    res = {"keybridge": kb_sum, "popCovered": None}
    popcov = float(hx["pop"][hx["shore"] < 2].sum()); res["popCovered"] = popcov

    # ------------------------------------------------------------------ A. remote null edges
    nc = (g.edgeFlags & CAND) == 0
    nbr = collections.defaultdict(set)
    for u, v in zip(g.edgeFrom[nc], g.edgeTo[nc]):
        nbr[int(u)].add(int(v)); nbr[int(v)].add(int(u))
    deg = np.array([len(nbr[i]) for i in range(g.n)])
    RES = 5
    hexnode_set = set(hx["node"].tolist())
    pair_edges = collections.defaultdict(list)
    for e in np.nonzero(nc)[0]:
        a, b = int(g.edgeFrom[e]), int(g.edgeTo[e]); pair_edges[(min(a, b), max(a, b))].append(int(e))
    far = dist_kb >= 12000
    def cands(pred):
        out = []
        for (a, b), es in pair_edges.items():
            if far[es[0]] and pred(a, b, es): out.append((a, b, es))
        return out
    cul_pure = cands(lambda a, b, es: g.edgeClass[es[0]] == 5 and min(deg[a], deg[b]) == 1 and
                     (a if deg[a] == 1 else b) not in hexnode_set)
    cul_hex = cands(lambda a, b, es: g.edgeClass[es[0]] == 5 and min(deg[a], deg[b]) == 1 and
                    (a if deg[a] == 1 else b) in hexnode_set)
    rural = cands(lambda a, b, es: g.edgeClass[es[0]] in (3, 4, 5) and min(deg[a], deg[b]) >= 3)
    print("candidate pools", len(cul_pure), len(cul_hex), len(rural))
    picks = []
    for name, pool_, k in (("remote cul-de-sac (dead-end node not snapped by any hex)", cul_pure, 5),
                           ("remote cul-de-sac (dead-end node IS a hex snap node)", cul_hex, 4),
                           ("remote rural edge (both ends junctions, alternative routes exist)", rural, 6)):
        for i in rng.choice(len(pool_), size=k, replace=False):
            picks.append((name, pool_[i]))
    controls = []
    for name, (a, b, es) in picks:
        st = solve_state(ctx, disabled=es)
        s = summarize_world(ctx, base, st)
        e0 = es[0]
        controls.append({"type": name, "edges": es, "osmWay": [float(g.edgeOsmWay[e]) for e in es[:2]],
                         "class": g.meta["classes"][int(g.edgeClass[e0])],
                         "lat": round(float(g.nodeLat[g.edgeFrom[e0]]), 5), "lon": round(float(g.nodeLon[g.edgeFrom[e0]]), 5),
                         "kmFromKeyBridge": round(float(dist_kb[e0] / 1000), 1), **s})
        print(f"  null {name[:30]:<30} km {dist_kb[e0]/1000:5.1f} xhAdd {s['xhMeanAddedS']:.4f} lossGt10 {s['popLossGt10']:.0f} "
              f"reg {s['regMeanAddedS']:.4f} emsD {s['emsDP50S']:.2f}/{s['emsDP90S']:.2f} hexes xh {s['xhHexesAddedGt1s']} ({time.time()-t0:.0f}s)")
    res["nullControls"] = controls
    # pass rule
    def passes(c): return (c["xhMeanAddedS"] < 0.5 and c["popLossGt10"] < 0.0005 * popcov and c["regMeanAddedS"] < 0.5
                           and abs(c["emsDP50S"]) < 1 and abs(c["emsDP90S"]) < 1)
    for c in controls: c["passesPreDeclaredRule"] = bool(passes(c))
    res["nullPassCount"] = [sum(c["passesPreDeclaredRule"] for c in controls), len(controls)]

    # ------------------------------------------------------------------ B. closure ordering
    links = ctx.links
    worlds = {"Key Bridge (I-695)": links["L-KEYBRIDGE"], "Harbor Tunnel (I-895)": links["L-HARBORTUNNEL"],
              "Fort McHenry Tunnel (I-95)": links["L-FORTMCHENRY"],
              "Both tunnels": links["L-HARBORTUNNEL"] + links["L-FORTMCHENRY"],
              "Bridge + both tunnels": links["L-KEYBRIDGE"] + links["L-HARBORTUNNEL"] + links["L-FORTMCHENRY"]}
    order = {}
    for name, es in worlds.items():
        st = kb_state if name.startswith("Key Bridge") else solve_state(ctx, disabled=es)
        order[name] = summarize_world(ctx, base, st); order[name]["nEdges"] = len(es)
        print("  closure", name, {k: round(order[name][k], 2) for k in ("popLossGt10", "xhMeanAddedS", "regMeanAddedS")})
    res["closureOrdering"] = order

    # ------------------------------------------------------------------ C. monotonicity (committed candidate effects)
    eff = json.loads((config.SNAP / "candidate_effects.json").read_text())
    worst = {"xharborTimeSavedS": 0, "accessTimeSavedS": 0, "emsP90SavedS": 0, "emsPctWithinGain": 0, "xharborJobsGain": 0}
    n = 0
    for c in eff["candidates"]:
        for ctxname in ("inBaseline", "inKeybridgeRemoved"):
            n += 1
            for k in worst: worst[k] = min(worst[k], c[ctxname]["benefits"][k])
    res["monotonicity"] = {"candidateContextsChecked": n, "minBenefitObserved": worst,
                           "source": "data/snapshot/candidate_effects.json (reference engine)"}
    print("  monotonicity min benefits", worst)

    # ------------------------------------------------------------------ D. random corridor cuts
    mt = ((g.edgeClass == 0) | (g.edgeClass == 1)) & nc
    mt_idx = np.nonzero(mt)[0]
    R = 800.0  # KB footprint radius (max distance of the 6 KB edge midpoints from their centroid = 798 m)
    tunnel = (g.edgeFlags & config.FLAGS["TUNNEL"]) > 0
    kbset = set(ctx.kb)
    kb_len = float(g.edgeLenM[ctx.kb].sum() / 2)
    N = 200
    seeds = rng.choice(mt_idx, size=N, replace=False)
    rows = []
    for i, s in enumerate(seeds):
        win = mt_idx[np.hypot(x[mt_idx] - x[s], y[mt_idx] - y[s]) <= R]
        if kbset & set(win.tolist()):
            rows.append({"seed": int(s), "skippedContainsKeyBridge": True}); continue
        st = solve_state(ctx, disabled=win.tolist())
        sm = summarize_world(ctx, base, st)
        sm.update(seed=int(s), nEdges=int(len(win)), lenKmOneWayEq=float(g.edgeLenM[win].sum() / 2000),
                  hasTunnel=bool(tunnel[win].any()), hasBridge=bool(((g.edgeFlags[win] & config.FLAGS["BRIDGE"]) > 0).any()),
                  lat=round(float(g.nodeLat[g.edgeFrom[s]]), 5), lon=round(float(g.nodeLon[g.edgeFrom[s]]), 5))
        rows.append(sm)
        if i % 20 == 0: print(f"  random cut {i}/{N} ({time.time()-t0:.0f}s)")
    used = [r for r in rows if "skippedContainsKeyBridge" not in r]
    res["randomCuts"] = {"N": N, "used": len(used), "skippedContainsKeyBridge": N - len(used), "windowRadiusM": R,
                         "keybridgeEdges": len(ctx.kb), "keybridgeLenKmOneWay": kb_len / 1000, "rows": used}
    metrics = ("popLossGt10", "popLossGt25", "xhPopMeanLossPct", "xhMeanAddedS", "regMeanAddedS", "emsDP90S")
    dist = {}
    for subset_name, filt in (("all", lambda r: True), ("noTunnelInWindow", lambda r: not r["hasTunnel"]),
                              ("lengthWithin0.5to2xKB", lambda r: 0.5 * kb_len / 1000 <= r["lenKmOneWayEq"] <= 2 * kb_len / 1000)):
        sub = [r for r in used if filt(r)]
        d = {"n": len(sub)}
        for m in metrics:
            vals = np.array([r[m] for r in sub])
            d[m] = {"keybridge": kb_sum[m], "percentileOfKeyBridge": pct_rank(vals, kb_sum[m]),
                    "randomMedian": float(np.median(vals)), "randomP90": float(np.percentile(vals, 90)),
                    "randomP99": float(np.percentile(vals, 99)), "randomMax": float(vals.max()),
                    "fractionZeroOrTiny": float((vals < (0.5 if 'Added' in m else 100)).mean()),
                    "nBiggerThanKeyBridge": int((vals > kb_sum[m]).sum())}
        dist[subset_name] = d
    res["randomCutDistribution"] = dist
    (OUT / "null_controls.json").write_text(json.dumps(res, indent=1))
    print("done", round(time.time() - t0), "s; wrote out/null_controls.json")
    print(json.dumps(dist["all"], indent=1)[:3000])


if __name__ == "__main__":
    main()

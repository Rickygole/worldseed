"""Second random-closure baseline (definition sensitivity of the Key Bridge percentile): 200 random SINGLE motorway/trunk
segments (one directed edge and its reverse twin if it exists), instead of the 800 m windows in null_controls.py.
Output: out/random_segments.json
"""
import json, time, pathlib
import numpy as np
from sensitivity.engine import *
from sensitivity.null_controls import summarize_world

OUT = pathlib.Path(__file__).parent / "out"


def main():
    t0 = time.time(); ctx = Ctx(); g = ctx.g
    base = solve_state(ctx); kbs = solve_state(ctx, disabled=ctx.kb); kb = summarize_world(ctx, base, kbs)
    nc = (g.edgeFlags & CAND) == 0
    mt = np.nonzero(((g.edgeClass == 0) | (g.edgeClass == 1)) & nc)[0]
    twin = {}
    for e in np.nonzero(nc)[0]: twin.setdefault((int(g.edgeFrom[e]), int(g.edgeTo[e])), []).append(int(e))
    rng = np.random.default_rng(99); seeds = rng.choice(mt, size=200, replace=False); rows = []
    kbset = set(ctx.kb)
    for i, s in enumerate(seeds):
        es = sorted(set(twin[(int(g.edgeFrom[s]), int(g.edgeTo[s]))] + twin.get((int(g.edgeTo[s]), int(g.edgeFrom[s])), [])))
        if kbset & set(es): continue
        r = summarize_world(ctx, base, solve_state(ctx, disabled=es)); r.update(seed=int(s), nEdges=len(es), lenKm=float(g.edgeLenM[s] / 1000), cls=g.meta["classes"][int(g.edgeClass[s])])
        rows.append(r)
        if i % 25 == 0: print(i, round(time.time() - t0), flush=True)
    dist = {}
    for m in ("popLossGt10", "popLossGt25", "xhPopMeanLossPct", "xhMeanAddedS", "regMeanAddedS"):
        v = np.array([r[m] for r in rows])
        dist[m] = {"keybridge": kb[m], "percentileOfKeyBridge": pct_rank(v, kb[m]), "randomMedian": float(np.median(v)), "randomP90": float(np.percentile(v, 90)),
                   "randomMax": float(v.max()), "nBigger": int((v > kb[m]).sum()), "shareZero": float((v <= (1e-9 if m != "popLossGt10" else 0)).mean())}
    (OUT / "random_segments.json").write_text(json.dumps({"n": len(rows), "keybridge": kb, "dist": dist, "rows": rows}, indent=1))
    print(json.dumps(dist, indent=1))


if __name__ == "__main__":
    main()

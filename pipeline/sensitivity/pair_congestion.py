"""Dundalk -> Ferndale under congestion proxies, to put the reported 20 -> 41 minutes in context. Output: out/pair_congestion.json
Times are hex-to-hex free-flow including snap time (same convention as validate_reality.py); congestion proxies are the ones used in sens_run.py."""
import json, pathlib
import numpy as np
from scipy.sparse.csgraph import dijkstra
from sensitivity.engine import *

OUT = pathlib.Path(__file__).parent / "out"
ctx = Ctx(); hx = ctx.hx; g = ctx.g; T0 = base_times(ctx)
gaz = {e["id"]: e for e in json.loads((config.SNAP / "gazetteer.json").read_text()) if e["kind"] == "neighborhood"}
def hexof(gid):
    e = gaz[gid]; d = np.hypot((hx["lat"] - e["lat"]) * 110570, (hx["lng"] - e["lng"]) * 111320 * np.cos(np.radians(e["lat"]))); d[hx["pop"] <= 0] = np.inf
    return int(np.argmin(d))
o, d = hexof("G-DUNDALK"), hexof("G-FERNDALE")
tun = (g.edgeFlags & config.FLAGS["TUNNEL"]) > 0
def t(A, a, b): return float(dijkstra(A, directed=True, indices=int(hx["node"][a]))[int(hx["node"][b])] + hx["snapS"][a] + hx["snapS"][b]) / 60
rows = []
def add(name, tb, tk): rows.append({"proxy": name, "baselineMin": tb, "bridgeRemovedMin": tk, "addedMin": tk - tb})
add("free-flow (reference)", t(matrix(ctx, T0, frozenset()), o, d), t(matrix(ctx, T0, frozenset(ctx.kb)), o, d))
for f in (1.25, 1.5):
    tt = T0.copy(); tt[tun] *= f
    add(f"tunnels x{f} after closure only (diversion)", t(matrix(ctx, T0, frozenset()), o, d), t(matrix(ctx, tt, frozenset(ctx.kb)), o, d))
for s in (0.8,):
    add(f"all speeds x{s}, both worlds", t(matrix(ctx, T0 / s, frozenset()), o, d), t(matrix(ctx, T0 / s, frozenset(ctx.kb)), o, d))
tt = T0 / 0.8; tt[tun] *= 1.5
add("all speeds x0.8 and tunnels x1.5 after closure", t(matrix(ctx, T0 / 0.8, frozenset()), o, d), t(matrix(ctx, tt, frozenset(ctx.kb)), o, d))
# upper bound of any tunnel slowdown: both tunnels unusable (route must use the western I-695 arc)
allc = frozenset(ctx.kb + ctx.links["L-HARBORTUNNEL"] + ctx.links["L-FORTMCHENRY"])
add("bridge AND both tunnels closed (limit of any tunnel slowdown)", rows[0]["baselineMin"], t(matrix(ctx, T0, allc), o, d))
res = {"rows": rows, "note": "hex-to-hex free-flow minutes incl. snap time; the last row bounds what any tunnel congestion multiplier could add for this pair"}
(OUT / "pair_congestion.json").write_text(json.dumps(res, indent=1)); print(json.dumps(res, indent=1))

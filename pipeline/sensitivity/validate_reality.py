"""Deliverable (3): validation against public benchmarks that were actually fetched.  Output: out/validation.json

 (a) Reported detour (news): Dundalk -> Ferndale commute 20 min -> 41 min after the collapse (Maryland Matters, republished
     by Baltimore Fishbowl and The Daily Record; fetched 2026-09-26).  Compared with the model's FREE-FLOW times.
 (b) Independent routing engine: the public OSRM demo server (router.project-osrm.org, current OpenStreetMap; the bridge is gone
     from current OSM, so its answers correspond to the post-collapse network).  Named pairs + 2 x (50 x 50) random pairs.
     OSRM's car profile is not ground truth (own speed table, signal/turn penalties, 2026 edits): it is a cross-check of the
     network topology and speed assumptions, not of congestion.
Politeness: identifying User-Agent, one request at a time, >= 1.3 s between requests, 8 route requests + 2 table requests = 10 in total.
"""
import json, time, pathlib, urllib.request, urllib.parse
import numpy as np
from scipy.sparse.csgraph import dijkstra
from scipy.stats import spearmanr, pearsonr
from sensitivity.engine import *

OUT = pathlib.Path(__file__).parent / "out"; OUT.mkdir(exist_ok=True)
UA = "worldseed-methodology/0.1 (github.com/Rickygole/worldseed; validation study)"
OSRM = "https://router.project-osrm.org"
ACCESS_DATE = "2026-09-26"


def get(url):
    time.sleep(1.3)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main():
    ctx = Ctx(); hx = ctx.hx; g = ctx.g; T0 = base_times(ctx)
    Ab, Ak = matrix(ctx, T0, frozenset()), matrix(ctx, T0, frozenset(ctx.kb))
    gaz = {e["id"]: e for e in json.loads((config.SNAP / "gazetteer.json").read_text()) if e["kind"] == "neighborhood"}
    pts = {"Dundalk": "G-DUNDALK", "Ferndale": "G-FERNDALE", "Curtis Bay": "G-CURTIS-BAY", "Hawkins Point": "G-HAWKINS-POINT",
           "Sparrows Point": "G-SPARROWS-POINT", "Edgemere": "G-EDGEMERE", "Glen Burnie": "G-GLEN-BURNIE", "Essex": "G-ESSEX", "Brooklyn Park": "G-BROOKLYN-PARK"}
    def hexof(gid):
        e = gaz[gid]; lat, lon = e["lat"], e["lng"]
        d = np.hypot((hx["lat"] - lat) * 110570, (hx["lng"] - lon) * 111320 * np.cos(np.radians(lat)))
        d[hx["pop"] <= 0] = np.inf
        return int(np.argmin(d)), lat, lon
    H = {k: hexof(v) for k, v in pts.items()}
    pairs = [("Dundalk", "Ferndale"), ("Ferndale", "Dundalk"), ("Dundalk", "Curtis Bay"), ("Sparrows Point", "Curtis Bay"), ("Dundalk", "Hawkins Point"),
             ("Edgemere", "Hawkins Point"), ("Essex", "Glen Burnie"), ("Sparrows Point", "Brooklyn Park")]
    kbc = (39.2176, -76.5286)

    def model_t(A, o, d):
        r = dijkstra(A, directed=True, indices=int(hx["node"][o]))[int(hx["node"][d])]
        return float(r + hx["snapS"][o] + hx["snapS"][d])
    named = []
    for a, b in pairs:
        (ho, lo_a, lo_o), (hd, la_b, lo_b) = H[a], H[b]
        tb, tk = model_t(Ab, ho, hd), model_t(Ak, ho, hd)
        q = f"{OSRM}/route/v1/driving/{lo_o},{lo_a};{lo_b},{la_b}?overview=full&geometries=geojson&alternatives=false"
        r = get(q)["routes"][0]
        line = np.array(r["geometry"]["coordinates"])
        dk = np.hypot((line[:, 1] - kbc[0]) * 110570, (line[:, 0] - kbc[1]) * 111320 * np.cos(np.radians(kbc[0]))).min()
        named.append({"from": a, "to": b, "modelBaselineMin": tb / 60, "modelBridgeRemovedMin": tk / 60, "modelAddedMin": (tk - tb) / 60,
                      "osrmCurrentMin": r["duration"] / 60, "osrmKm": r["distance"] / 1000, "osrmRouteMinDistToBridgeSiteM": float(dk)})
        print(f"{a:>15} -> {b:<15} model base {tb/60:5.1f} kb-removed {tk/60:5.1f} (+{(tk-tb)/60:4.1f}) | OSRM(current OSM) {r['duration']/60:5.1f} min, {r['distance']/1000:4.1f} km", flush=True)

    # random pairs via OSRM /table (50 sources x 50 destinations, twice)
    rng = np.random.default_rng(11)
    allp = []
    for rep in range(2):
        S = rng.choice(len(hx["pop"]), size=50, replace=False, p=hx["pop"] / hx["pop"].sum())
        Dd = rng.choice(len(hx["jobs"]), size=50, replace=False, p=hx["jobs"] / hx["jobs"].sum())
        coords = ";".join(f"{hx['lng'][h]:.6f},{hx['lat'][h]:.6f}" for h in list(S) + list(Dd))
        q = f"{OSRM}/table/v1/driving/{coords}?sources={';'.join(map(str, range(50)))}&destinations={';'.join(map(str, range(50, 100)))}&annotations=duration"
        tab = np.array(get(q)["durations"], dtype=float)
        db = dijkstra(Ab, directed=True, indices=hx["node"][S].astype(int)); dkm = dijkstra(Ak, directed=True, indices=hx["node"][S].astype(int))
        for i, o in enumerate(S):
            for j, d in enumerate(Dd):
                if o == d or tab[i, j] is None or not np.isfinite(tab[i, j]): continue
                tb = db[i, hx["node"][d]] + hx["snapS"][o] + hx["snapS"][d]; tk = dkm[i, hx["node"][d]] + hx["snapS"][o] + hx["snapS"][d]
                allp.append((tab[i, j], tb, tk, int(hx["shore"][o]), int(hx["shore"][d])))
    P = np.array(allp)
    osrm, tb, tk, so, sd = P.T
    use = (osrm > 120)   # drop trivially short pairs where snap dominates
    res = {"accessDate": ACCESS_DATE, "named": named, "randomPairs": {"n": int(len(P)), "nUsed(osrm>120s)": int(use.sum())}}
    def cmp(a, b, m):
        a, b = a[m], b[m]; r = a / b
        return {"n": int(m.sum()), "medianRatioModelOverOsrm": float(np.median(r)), "p10Ratio": float(np.percentile(r, 10)), "p90Ratio": float(np.percentile(r, 90)),
                "within20pct": float((np.abs(r - 1) <= 0.2).mean()), "within10pct": float((np.abs(r - 1) <= 0.1).mean()),
                "spearman": float(spearmanr(a, b).statistic), "pearson": float(pearsonr(a, b).statistic), "medianAbsErrS": float(np.median(np.abs(a - b)))}
    res["randomPairs"]["bridgeRemovedVsOsrm_all"] = cmp(tk, osrm, use)
    res["randomPairs"]["baselineVsOsrm_all"] = cmp(tb, osrm, use)
    cross = use & (so != sd) & (so < 2) & (sd < 2)
    same = use & (so == sd) & (so < 2)
    res["randomPairs"]["bridgeRemovedVsOsrm_crossHarbor"] = cmp(tk, osrm, cross)
    res["randomPairs"]["bridgeRemovedVsOsrm_sameShore"] = cmp(tk, osrm, same)
    aff = use & (tk - tb > 60)
    if aff.sum():
        e_k, e_b = np.abs(tk - osrm)[aff], np.abs(tb - osrm)[aff]
        res["randomPairs"]["bridgeAffectedPairs(model +>60s)"] = {"n": int(aff.sum()), "shareCloserToBridgeRemoved": float((e_k < e_b).mean()),
            "medianAbsErrBridgeRemovedS": float(np.median(e_k)), "medianAbsErrBaselineS": float(np.median(e_b)),
            "medianModelAddedS": float(np.median((tk - tb)[aff])), "medianOsrmMinusModelBaselineS": float(np.median((osrm - tb)[aff]))}
    unaff = use & (np.abs(tk - tb) < 1)
    res["randomPairs"]["unaffectedPairs(|model diff|<1s)"] = cmp(tk, osrm, unaff)
    print(json.dumps(res["randomPairs"], indent=1))
    (OUT / "validation.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()

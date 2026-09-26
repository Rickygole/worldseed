"""Simulator speed benchmark + effect of removing the Key Bridge. PROTOTYPE, not production."""
import json, time, statistics as st
import numpy as np, pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
import build_graph

OUT = build_graph.OUT
DISPATCH_MIN = 1.0             # minutes from call to wheels rolling
EMERGENCY_SPEED_FACTOR = 1.0   # baseline; >1 = units travel faster than posted/default speed
rng = np.random.default_rng(42)

coords, E, length, speed, hwc, kb, wid, _, stats = build_graph.build()
N = len(coords)
tt = (length / (speed * EMERGENCY_SPEED_FACTOR)).astype(np.float64)   # seconds
# dedupe parallel edges (csr would sum duplicates): keep min travel time per (u,v)
key = E[:, 0].astype(np.int64) * N + E[:, 1]
order = np.lexsort((tt, key)); first = np.ones(len(order), bool); first[1:] = key[order][1:] != key[order][:-1]
keep = np.sort(order[first]); dups = len(E) - len(keep)
E, tt, kb, hwc = E[keep], tt[keep], kb[keep], hwc[keep]
print(f"graph: {N} nodes, {len(E)} edges after dedupe ({dups} parallel edges dropped); KB edges {int(kb.sum())}")

def make_csr(w):  # fixed sparsity: sorted by (u,v) so data order == edge order
    o = np.lexsort((E[:, 1], E[:, 0]))
    return csr_matrix((w[o], (E[o, 0], E[o, 1])), shape=(N, N)), o
# build once and remember permutation so weights can be swapped in place
G, ORD = make_csr(tt)
GT = G.T.tocsr()
# map edge index -> position in G.data / GT.data
pos_G = np.empty(len(E), int); pos_G[ORD] = np.arange(len(E))
# for the transpose: build with explicit ordering
oT = np.lexsort((E[:, 0], E[:, 1])); pos_GT = np.empty(len(E), int); pos_GT[oT] = np.arange(len(E))
GT = csr_matrix((tt[oT], (E[oT, 1], E[oT, 0])), shape=(N, N))

# --- facilities
fac = json.load(open("/Users/rickygole/worldseed/data/raw/facilities_2024-03-01.json"))["elements"]
seen, stations, hospitals = set(), [], []
for e in fac:
    t = e["tags"]; lat = e.get("lat") or e["center"]["lat"]; lon = e.get("lon") or e["center"]["lon"]
    nm = t.get("name", "")
    k = (round(lat, 4), round(lon, 4), t.get("amenity") or t.get("emergency"))
    if k in seen: continue
    seen.add(k)
    if t.get("amenity") == "hospital":
        if t.get("emergency") == "yes": hospitals.append((nm, lat, lon))
    elif "Academy" in nm or "Fire Boat" in nm: continue
    else: stations.append((nm, lat, lon))
print(f"dispatch stations after dedupe/exclusions: {len(stations)}; ED hospitals (emergency=yes): {len(hospitals)}")
# local metric projection for snapping
lat0 = coords[:, 0].mean(); kx = 111320 * np.cos(np.radians(lat0)); ky = 110540
def xy(a): return np.c_[(a[:, 1]) * kx, a[:, 0] * ky]
tree = cKDTree(xy(coords))
def snap(items):
    a = np.array([[i[1], i[2]] for i in items]); d, idx = tree.query(xy(a)); return idx, d
st_idx, st_d = snap(stations); ho_idx, ho_d = snap(hospitals)
print("snap distance m: stations max", st_d.max().round(0), "median", np.median(st_d).round(0), "| hospitals max", ho_d.max().round(0))

# --- population
bg = pd.read_csv(f"{OUT}/bg_pop.csv")
bg_d, bg_idx = tree.query(xy(bg[["lat", "lon"]].values))
print("BG centroid -> node snap m: median", np.median(bg_d).round(0), "p90", np.percentile(bg_d, 90).round(0), "max", bg_d.max().round(0))
w_pop = np.bincount(bg_idx, weights=bg["pop"].values, minlength=N)
w_nov = np.bincount(bg_idx, weights=bg["novehicle_hh"].values, minlength=N)

def wq(vals, w, qs=(0.5, 0.9)):
    m = w > 0; v, ww = vals[m], w[m]; o = np.argsort(v); v, ww = v[o], ww[o]; c = np.cumsum(ww) / ww.sum()
    return [float(v[np.searchsorted(c, q)]) for q in qs]

def response(data_G, removed=None):
    """minutes: dispatch + travel from nearest station to every node (multi-source Dijkstra, forward graph)."""
    g = G
    d = dijkstra(csr_matrix((data_G, G.indices, G.indptr), shape=(N, N)), directed=True, indices=st_idx, min_only=True)
    return DISPATCH_MIN + d / 60.0

def to_hospital(data_GT):
    d = dijkstra(csr_matrix((data_GT, GT.indices, GT.indptr), shape=(N, N)), directed=True, indices=ho_idx, min_only=True)
    return d / 60.0

def weights(mult=None, remove_kb=False):
    w = tt if mult is None else tt * mult
    if remove_kb: w = np.where(kb, np.inf, w)
    return w
def dataG(w): return w[ORD]
def dataGT(w): return w[oT]

# correctness check: inf-removal == physically dropping edges
w_rm = weights(remove_kb=True)
Gm = csr_matrix((tt[~kb], (E[~kb, 0], E[~kb, 1])), shape=(N, N))
d_drop = DISPATCH_MIN + dijkstra(Gm, directed=True, indices=st_idx, min_only=True) / 60
d_inf = response(dataG(w_rm))
fin = np.isfinite(d_drop)
print("inf-weight vs dropped-edge equivalence: max abs diff", float(np.abs(d_drop[fin] - d_inf[fin]).max()), "| unreachable counts", int((~np.isfinite(d_drop)).sum()), int((~np.isfinite(d_inf)).sum()))

# --- baseline vs removed timing (20x each)
def timeit(fn, n=20):
    ts = []
    for _ in range(n):
        t = time.perf_counter(); r = fn(); ts.append((time.perf_counter() - t) * 1000)
    return st.median(ts), min(ts), max(ts), r
wb = weights(); dG_b = dataG(wb); dG_r = dataG(w_rm)
tb = timeit(lambda: response(dG_b)); tr = timeit(lambda: response(dG_r))
print(f"Dijkstra multi-source ({len(st_idx)} sources) scipy: baseline median {tb[0]:.2f} ms (min {tb[1]:.2f} max {tb[2]:.2f}); bridge-removed median {tr[0]:.2f} ms (min {tr[1]:.2f} max {tr[2]:.2f})")
th = timeit(lambda: to_hospital(dataGT(wb)))
print(f"node->ED-hospital (reverse graph, {len(ho_idx)} sources) baseline median {th[0]:.2f} ms")
base, rem = tb[3], tr[3]
def summarize(name, a):
    fin = np.isfinite(a)
    p = wq(np.where(fin, a, 1e9), w_pop); nv = wq(np.where(fin, a, 1e9), w_nov)
    print(f"  {name}: pop-weighted p50 {p[0]:.2f} p90 {p[1]:.2f} min | no-vehicle-hh-weighted p50 {nv[0]:.2f} p90 {nv[1]:.2f} | node-level p50 {np.median(a[fin]):.2f} p90 {np.percentile(a[fin],90):.2f} max {a[fin].max():.1f} | unreachable nodes {int((~fin).sum())}")
summarize("baseline (Key Bridge in)", base); summarize("Key Bridge removed  ", rem)
delta = rem - base; fin = np.isfinite(delta)
print(f"  nodes whose response changed by >0.01 min: {(delta[fin] > 0.01).sum()} of {fin.sum()} ({100*(delta[fin]>0.01).mean():.1f}%)")
print(f"  population living at nodes with delta>0.01 min: {int(w_pop[fin & (delta>0.01)].sum())} of {int(w_pop.sum())}; delta>1 min: {int(w_pop[fin&(delta>1)].sum())}; delta>3 min: {int(w_pop[fin&(delta>3)].sum())}")
print(f"  max delta {np.nanmax(delta[fin]):.2f} min; pop-weighted mean delta {np.average(delta[fin], weights=w_pop[fin]):.3f} min")
top = np.argsort(-np.where(fin, delta, -1))[:5]
for i in top: print("   top delta node", int(i), coords[i].round(4).tolist(), f"{base[i]:.1f} -> {rem[i]:.1f} min, pop {int(w_pop[i])}")
# geographic areas: south peninsula (Hawkins Pt / Fairfield / Curtis Bay) vs Sparrows Pt / Edgemere vs rest
hb = to_hospital(dataGT(wb)); hr = to_hospital(dataGT(weights(remove_kb=True)))
fh = np.isfinite(hb) & np.isfinite(hr)
print(f"  node->ED hospital: pop-weighted p50/p90 baseline {wq(hb, w_pop)} removed {wq(np.where(np.isfinite(hr),hr,1e9), w_pop)}; nodes worse by >1 min: {(hr[fh]-hb[fh]>1).sum()}, max delta {np.max(hr[fh]-hb[fh]):.1f}")

# --- OD sanity test: does the removal actually bite for cross-river trips? (south-shore station -> Dundalk/Edgemere stations)
names = [x[0] for x in stations]
def od(src_name, dst_name, w):
    i = next(k for k, n in enumerate(names) if src_name in n); j = next(k for k, n in enumerate(names) if dst_name in n)
    d = dijkstra(csr_matrix((dataG(w), G.indices, G.indptr), shape=(N, N)), directed=True, indices=st_idx[i])
    return d[st_idx[j]] / 60
for a, b in [("Baltimore Fire Station 39", "Dundalk"),
             ("Baltimore Fire Station 39", "North Point"),
             ("Building 79", "Dundalk"),
             ("Baltimore Fire Station 38", "North Point")]:
    print(f"  OD travel-only {a} -> {b}: baseline {od(a,b,wb):.1f} min, bridge removed {od(a,b,w_rm):.1f} min")
print("  BGs in bbox by county:", bg.groupby("county").size().to_dict(), "| pop by county:", bg.groupby("county")["pop"].sum().astype(int).to_dict())

# --- Monte Carlo: lognormal per-edge multipliers (median 1, sigma 0.25 iid) -- 200 futures
SIGMA = 0.25; NF = 200
mults = rng.lognormal(0.0, SIGMA, size=(NF, len(E)))
t = time.perf_counter(); res_b = []; res_r = []
for f in range(NF):
    w = tt * mults[f]
    res_b.append(response(dataG(w)))
tb_mc = time.perf_counter() - t
t = time.perf_counter()
for f in range(NF):
    w = np.where(kb, np.inf, tt * mults[f]); res_r.append(response(dataG(w)))
tr_mc = time.perf_counter() - t
print(f"MC {NF} futures scipy: baseline {tb_mc:.2f} s, bridge-removed {tr_mc:.2f} s (~{tb_mc/NF*1000:.1f} ms/future incl. lognormal multiply + csr rebuild)")
P50 = np.array([wq(r, w_pop)[0] for r in res_b]); P90 = np.array([wq(r, w_pop)[1] for r in res_b])
Q50 = np.array([wq(np.where(np.isfinite(r), r, 1e9), w_pop)[0] for r in res_r]); Q90 = np.array([wq(np.where(np.isfinite(r), r, 1e9), w_pop)[1] for r in res_r])
print(f"  MC baseline pop-weighted p50: mean {P50.mean():.2f} [5-95%: {np.percentile(P50,5):.2f}-{np.percentile(P50,95):.2f}] p90: mean {P90.mean():.2f} [{np.percentile(P90,5):.2f}-{np.percentile(P90,95):.2f}]")
print(f"  MC removed  pop-weighted p50: mean {Q50.mean():.2f} [{np.percentile(Q50,5):.2f}-{np.percentile(Q50,95):.2f}] p90: mean {Q90.mean():.2f} [{np.percentile(Q90,5):.2f}-{np.percentile(Q90,95):.2f}]")
print("  paired p90 delta (removed - baseline): mean", float((Q90 - P90).mean()).__round__(3), "min", float((Q90-P90).min()).__round__(3), "max", float((Q90-P90).max()).__round__(3))

# --- export CSR for the JS benchmark (float32 seconds), baseline weights
w32 = tt.astype(np.float32)
G.indptr.astype(np.int32).tofile(f"{OUT}/js_indptr.bin"); G.indices.astype(np.int32).tofile(f"{OUT}/js_indices.bin")
G.data.astype(np.float32).tofile(f"{OUT}/js_weights.bin")
np.array(st_idx, dtype=np.int32).tofile(f"{OUT}/js_sources.bin")
# which CSR slots are Key Bridge edges
np.where(kb[ORD])[0].astype(np.int32).tofile(f"{OUT}/js_kb_slots.bin")
json.dump({"N": N, "nnz": int(G.nnz), "sources": len(st_idx), "ref_baseline_sum_min": float(np.sum(base)), "ref_nodes": N}, open(f"{OUT}/js_meta.json", "w"))

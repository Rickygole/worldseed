"""Deliverable (2): one-at-a-time sensitivity of the headline conclusions.  Output: out/sensitivity.json

Reference = the shipped snapshot (Key Bridge removed vs baseline 2024-03-01). Every variant re-derives BOTH the baseline
and the bridge-removed world under the changed assumption, and "added"/"loss" are measured against that variant's own
baseline (so a slower network is compared to itself, not to the shipped baseline).

Qualitative conclusions tested (thresholds were fixed after seeing the reference values, and BEFORE running variants):
  C1 regional Access barely moves         regional mean added < 30 s          (reference 2.9 s)
  C2 EMS first response unchanged         |d p50| < 1 s and |d p90| < 1 s     (reference exactly 0)
  C3 cross-harbor harm is a minority      0.5% <= people losing >10% of cross-harbor jobs <= 10% of covered pop (ref 1.87%)
  C4 the typical resident is unaffected   xharbor added-time p50 < 5 s        (reference 0.19 s)
  C5 low-wage workers not singled out     |low-wage mean loss - pop mean loss| < 1 pp (reference -0.06 pp)
  C6 the same places are worst hit        top-10 block groups (by mean loss) overlap the reference top-10 in >= 7 of 10
"""
import json, sys, time, pathlib
import numpy as np
import h3
import pandas as pd
from worldseed_pipeline import config, golden, xharbor
from worldseed_pipeline.shore import DIVIDER, AMBIGUOUS_M
from sensitivity.engine import *

OUT = pathlib.Path(__file__).parent / "out"; OUT.mkdir(exist_ok=True)
C = {"C1": "regional Access barely moves (<30 s)", "C2": "EMS unchanged (<1 s)", "C3": "0.5%-10% of people lose >10% cross-harbor jobs",
     "C4": "typical resident unaffected (xharbor added p50 <5 s)", "C5": "low-wage loss within 1 pp of population loss", "C6": "top-10 worst BGs overlap >=7"}


def rec_from(ev, ref_bg, name, group, params, extra=None):
    x, r, e = ev["xh"], ev["reg"], ev["ems"]
    ov = top_overlap(ref_bg, ev["bg"]) if "bg" in ev else None
    sp, nsp = spearman(ref_bg, ev["bg"]) if "bg" in ev else (None, 0)
    pc = x["popCovered"]
    rec = {"name": name, "group": group, "params": params,
           "popLossGt10": x["popLossGt10pct"], "popLossGt25": x["popLossGt25pct"],
           "popLossGt10PctOfCovered": 100 * x["popLossGt10pct"] / pc,
           "lowWageLossGt10": x["lowWageLossGt10pct"], "lowWageLossGt25": x["lowWageLossGt25pct"],
           "popMeanLossPct": x["popMeanLossPct"], "lowWageMeanLossPct": x["lowWageMeanLossPct"], "equityGapLossPct": x["equityGapLossPct"],
           "xhAddedMeanS": x["popMeanAddedS"], "xhAddedP50S": x["addedP50S"], "xhAddedP90S": x["addedP90S"], "xhAddedP99S": x["addedP99S"],
           "popCovered": pc, "originHexes": x["originHexes"],
           "top10Overlap": ov, "spearman": sp, "spearmanN": nsp,
           "regAddedMeanS": r["popMeanAddedS"], "regBaseP50S": r["baseP50S"], "regBaseP90S": r["baseP90S"],
           "emsBaseP50S": e["baseP50S"], "emsBaseP90S": e["baseP90S"], "emsDP50S": e["dP50S"], "emsDP90S": e["dP90S"],
           "emsBasePctWithin8": e["basePctWithin"], "emsWorldPctWithin8": e["worldPctWithin"]}
    rec["C"] = {"C1": r["popMeanAddedS"] < 30, "C2": abs(e["dP50S"]) < 1 and abs(e["dP90S"]) < 1,
                "C3": 0.5 <= rec["popLossGt10PctOfCovered"] <= 10, "C4": x["addedP50S"] < 5,
                "C5": abs(x["equityGapLossPct"]) < 1, "C6": None if ov is None else ov >= 7}
    if extra: rec.update(extra)
    return rec


def main():
    t0 = time.time()
    ctx = Ctx(); g = ctx.g; hx = ctx.hx
    T0 = base_times(ctx)
    base = solve_state(ctx); kb = solve_state(ctx, disabled=ctx.kb)
    ref = evaluate(ctx, base, kb)
    ref_bg = ref["bg"]
    top = sorted(ref_bg.items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    bgi = {b["geoid"]: b for b in ctx.bgs}
    results = {"reference": None, "variants": [], "constants": C}
    results["reference"] = rec_from(ref, ref_bg, "reference", "reference", {})
    results["referenceTop10"] = [{"geoid": k, "meanLossPct": v, "county": bgi[k]["county"], "pop": bgi[k]["pop"], "lat": bgi[k]["centroid"][1], "lon": bgi[k]["centroid"][0]} for k, v in top]
    V = results["variants"]

    def add(name, group, params, ev, extra=None):
        r = rec_from(ev, ref_bg, name, group, params, extra); V.append(r)
        print(f"  [{group}] {name:<46} lossGt10 {r['popLossGt10']:8.0f} Gt25 {r['popLossGt25']:8.0f} xhAdd {r['xhAddedMeanS']:6.1f}s p90 {r['xhAddedP90S']:6.1f}s "
              f"reg {r['regAddedMeanS']:5.2f}s emsD {r['emsDP50S']:.1f}/{r['emsDP90S']:.1f} top10 {r['top10Overlap']} ({time.time()-t0:.0f}s)", flush=True)

    # ---- 1. call-to-wheels delay (EMS only; the states are unchanged)
    for c in (0, 48, 72, 120):
        add(f"call delay {c} s", "call_to_wheels", {"callToWheelsS": c}, evaluate(ctx, base, kb, call_s=c))

    # ---- 2. free-flow speeds
    cls = g.edgeClass
    scopes = {"all edges": np.ones(g.e, bool), "motorway class": cls == 0, "tunnel edges only": (g.edgeFlags & config.FLAGS["TUNNEL"]) > 0,
              "surface (non-motorway, non-ramp)": (cls != 0) & (cls != 7), "ramps (link class)": cls == 7}
    for sname, mask in scopes.items():
        for f in (0.8, 1.2):
            t = T0.copy(); t[mask] = t[mask] / f          # speed x f  ->  time / f
            b = solve_state(ctx, t=t); k = solve_state(ctx, t=t, disabled=ctx.kb)
            add(f"speed x{f:.1f}: {sname}", "speeds", {"scope": sname, "speedFactor": f, "edgesChanged": int(mask.sum())}, evaluate(ctx, b, k))

    # ---- 3. tunnel congestion proxy (time multiplier on tunnel edges)
    tun = (g.edgeFlags & config.FLAGS["TUNNEL"]) > 0
    for f in (1.25, 1.5):
        t = T0.copy(); t[tun] *= f
        b = solve_state(ctx, t=t); k = solve_state(ctx, t=t, disabled=ctx.kb)
        add(f"tunnel time x{f} in BOTH worlds", "tunnel_penalty", {"tunnelTimeFactor": f, "where": "both worlds"}, evaluate(ctx, b, k))
        # diversion proxy: tunnels are only congested once the bridge is gone (baseline stays free-flow)
        kd = solve_state(ctx, t=t, disabled=ctx.kb)
        add(f"tunnel time x{f} only AFTER bridge closure (diversion)", "tunnel_penalty", {"tunnelTimeFactor": f, "where": "bridge-removed world only"}, evaluate(ctx, base, kd))

    # ---- 4. threshold T
    for T in (1200, 1440, 1800, 2160, 2400):
        add(f"T = {T // 60} min", "threshold_T", {"TS": T}, evaluate(ctx, base, kb, T=float(T)))

    # ---- 5. snap speed
    for v in (10, 16, 24, 30):
        add(f"snap speed {v} km/h", "snap", {"snapKmh": v}, evaluate(ctx, base, kb, hxv={"snapS": hx["snapS"] * 20.0 / v}))
    add("no snap time", "snap", {"snapKmh": None}, evaluate(ctx, base, kb, hxv={"snapS": np.zeros_like(hx["snapS"])}))

    # ---- 6. shore rule
    bgc = {b["i"]: b["county"] for b in ctx.bgs}
    fips = {v: k for k, v in config.COUNTIES.items()}
    county = np.array([fips[bgc[int(i)]] for i in hx["bg"]])
    lat, lon = hx["lat"], hx["lng"]

    def shore_rule(shift_m=0.0, band_m=AMBIGUOUS_M, city_ambiguous=False):
        s = np.full(len(county), 2, dtype=np.uint8)
        s[county == "24005"] = 0
        s[(county == "24003") | (county == "24027")] = 1
        m = county == "24510"
        if not city_ambiguous:
            dl = (lat[m] - (np.interp(lon[m], DIVIDER[:, 0], DIVIDER[:, 1]) + shift_m / 111_320.0)) * 111_320.0
            o = np.where(dl >= 0, 0, 1).astype(np.uint8); o[np.abs(dl) < band_m] = 2
            s[m] = o
        return s

    assert (shore_rule() == hx["shore"]).all(), "shore reconstruction must equal the snapshot"
    results["shoreReconstructionMatchesSnapshot"] = True

    def shore_extra(s):
        ch = s != hx["shore"]
        return {"hexesChangedShore": int(ch.sum()), "popInChangedHexes": float(hx["pop"][ch].sum()), "jobsInChangedHexes": float(hx["jobs"][ch].sum()),
                "ambiguousHexes": int((s == 2).sum())}
    variants = [(f"divider shifted {d:+d} m (north = +)", {"shiftM": d}, shore_rule(shift_m=d)) for d in (-1000, -500, -250, 250, 500, 1000)]
    variants += [(f"ambiguity band {b} m", {"bandM": b}, shore_rule(band_m=b)) for b in (0, 500, 1000)]
    variants += [("all Baltimore city hexes ambiguous", {"cityAmbiguous": True}, shore_rule(city_ambiguous=True))]
    for name, p, s in variants:
        add("shore: " + name, "shore", p, evaluate(ctx, base, kb, hxv={"shore": s}), shore_extra(s))
    # random misclassification stress test: flip a share of the origin/destination hexes within 6 km (N-S) of the divider
    rng = np.random.default_rng(7)
    dl_all = np.abs((lat - np.interp(lon, DIVIDER[:, 0], DIVIDER[:, 1])) * 111_320.0)
    near = np.nonzero((dl_all < 6000) & (hx["shore"] < 2))[0]
    results["shoreFlipPoolHexes"] = int(len(near))
    for p in (0.02, 0.05, 0.10):
        for rep in range(3):
            s = hx["shore"].copy(); flip = rng.choice(near, size=int(round(p * len(near))), replace=False); s[flip] = 1 - s[flip]
            add(f"shore: random flip {int(p * 100)}% of hexes within 6 km of divider (rep {rep})", "shore_flip", {"share": p, "rep": rep}, evaluate(ctx, base, kb, hxv={"shore": s}), shore_extra(s))

    # ---- 7. combined corners
    def corner(name, speed, tun_f, T, snapv):
        t = T0.copy() / speed; t[tun] *= tun_f
        b = solve_state(ctx, t=t); k = solve_state(ctx, t=t, disabled=ctx.kb)
        add(name, "corner", {"speed": speed, "tunnelFactor": tun_f, "TS": T, "snapKmh": snapv},
            evaluate(ctx, b, k, T=T, hxv={"snapS": hx["snapS"] * 20.0 / snapv}))
    corner("corner A: speeds -20%, tunnels x1.5, T=24 min, snap 16", 0.8, 1.5, 1440.0, 16)
    corner("corner B: speeds +20%, T=36 min, snap 24", 1.2, 1.0, 2160.0, 24)
    corner("corner C: speeds -20%, T=36 min", 0.8, 1.0, 2160.0, 20)
    corner("corner D: speeds +20%, tunnels x1.0, T=24 min", 1.2, 1.0, 1440.0, 20)

    (OUT / "sensitivity.json").write_text(json.dumps(results, indent=1))

    # ---- 8. bootstrap over job destinations (WAC blocks), B=200
    wac = pd.read_csv(config.RAW / "interim" / "lodes_wac_blocks.csv", dtype={"block": str})
    w_, s_, e_, n_ = config.BBOX
    wb = wac[(wac.lat >= s_) & (wac.lat <= n_) & (wac.lon >= w_) & (wac.lon <= e_) & (wac.jobs > 0)].reset_index(drop=True)
    meta = json.loads((config.SNAP / "hexes.meta.json").read_text()); hidx = {c: i for i, c in enumerate(meta["h3"])}
    cell = np.array([hidx[h3.latlng_to_cell(a, b, config.H3_RES)] for a, b in zip(wb.lat, wb.lon)])
    jb = wb.jobs.values.astype(float)
    assert np.allclose(np.bincount(cell, weights=jb, minlength=len(hx["jobs"])), hx["jobs"]), "block->hex jobs must reproduce the snapshot"
    results["bootstrap"] = {"blocks": int(len(wb)), "jobsReproduceSnapshot": True}
    B = 200
    rows = []
    for b_ in range(B):
        m = rng.multinomial(len(wb), np.full(len(wb), 1.0 / len(wb)))
        jobs = np.bincount(cell, weights=m * jb, minlength=len(hx["jobs"]))
        hxm = dict(hx); hxm["jobs"] = jobs
        a0, a1 = xh_arrays(ctx, base, {"jobs": jobs}), xh_arrays(ctx, kb, {"jobs": jobs})
        xm = xharbor.summarize(a1, a0, hxm, "J1800")
        bgt = bg_table(ctx, a0, a1)
        sp, _ = spearman(ref_bg, bgt)
        rows.append({"popLossGt10": xm["popLossGt10pct"], "popLossGt25": xm["popLossGt25pct"], "lowWageLossGt10": xm["lowWageLossGt10pct"],
                     "popMeanLossPct": xm["popMeanLossPct"], "xhAddedMeanS": xm["popMeanAddedS"], "xhAddedP50S": xm["addedP50S"],
                     "xhAddedP90S": xm["addedP90S"], "equityGapLossPct": xm["equityGapLossPct"], "top10Overlap": top_overlap(ref_bg, bgt),
                     "spearman": sp, "totalJobs": float(jobs.sum())})
        if b_ % 20 == 0: print(f"  bootstrap {b_}/{B} ({time.time()-t0:.0f}s)", flush=True)
    results["bootstrap"]["B"] = B
    results["bootstrap"]["rows"] = rows
    summ = {}
    for k in rows[0]:
        v = np.array([r[k] for r in rows], dtype=float)
        summ[k] = {"mean": float(v.mean()), "p2.5": float(np.percentile(v, 2.5)), "p50": float(np.percentile(v, 50)), "p97.5": float(np.percentile(v, 97.5)),
                   "min": float(v.min()), "max": float(v.max())}
    results["bootstrap"]["summary"] = summ
    results["bootstrap"]["C3holds"] = int(sum(0.5 <= 100 * r["popLossGt10"] / results["reference"]["popCovered"] <= 10 for r in rows))
    results["bootstrap"]["C4holds"] = int(sum(r["xhAddedP50S"] < 5 for r in rows))
    results["bootstrap"]["C5holds"] = int(sum(abs(r["equityGapLossPct"]) < 1 for r in rows))
    results["bootstrap"]["C6holds"] = int(sum(r["top10Overlap"] >= 7 for r in rows))
    (OUT / "sensitivity.json").write_text(json.dumps(results, indent=1))
    print("done", round(time.time() - t0), "s", flush=True)


if __name__ == "__main__":
    main()

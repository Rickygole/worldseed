"""Formats the JSON outputs in out/ into markdown table fragments (out/tables.txt) so that numbers in docs/METHODOLOGY.md are
copied from run output, never typed.  Usage: python -m sensitivity.make_tables"""
import json, pathlib
import numpy as np

OUT = pathlib.Path(__file__).parent / "out"
L = lambda n: json.loads((OUT / n).read_text())
n0 = lambda x: f"{x:,.0f}"
n1 = lambda x: f"{x:,.1f}"
n2 = lambda x: f"{x:,.2f}"
def tab(head, rows):
    return "\n".join(["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"] + ["| " + " | ".join(str(c) for c in r) + " |" for r in rows])


def frag():
    F = {}
    S = L("sensitivity.json"); ref = S["reference"]; V = S["variants"]
    def vrow(v, name=None):
        fails = [k for k, x in v["C"].items() if x is False]
        sp = "n/a" if v["spearman"] is None else n2(v["spearman"])
        return [name or v["name"], n0(v["popLossGt10"]), n0(v["popLossGt25"]), n0(v["lowWageLossGt10"]), n0(v["lowWageLossGt25"]), n1(v["xhAddedMeanS"]),
                f"{n1(v['xhAddedP50S'])} / {n1(v['xhAddedP90S'])}", f"{v['top10Overlap']}/10", sp, n2(v["regAddedMeanS"]),
                f"{n1(v['emsDP50S'])} / {n1(v['emsDP90S'])}", ", ".join(fails) if fails else "none"]
    head = ["Variant", "People losing >10%", "People losing >25%", "Low-wage >10%", "Low-wage >25%", "Mean added (s)", "Added p50 / p90 (s)", "Top-10 BG overlap", "Spearman (BG)", "Regional mean added (s)", "EMS d p50 / d p90 (s)", "Conclusions failed"]
    F["reference"] = tab(head, [vrow(ref, "REFERENCE (shipped snapshot)")])
    for grp, key in (("speeds", "speeds"), ("tunnel", "tunnel_penalty"), ("T", "threshold_T"), ("snap", "snap"), ("shore", "shore"), ("corner", "corner")):
        F["sens_" + grp] = tab(head, [vrow(v) for v in V if v["group"] == key])
    # shore flips summarized by share
    rows = []
    for p in (0.02, 0.05, 0.10):
        vs = [v for v in V if v["group"] == "shore_flip" and v["params"]["share"] == p]
        rows.append([f"{int(p*100)}% of hexes within 6 km of divider, 3 random draws", f"{int(np.mean([v['hexesChangedShore'] for v in vs]))}", n0(np.mean([v["popInChangedHexes"] for v in vs])),
                     f"{n0(min(v['popLossGt10'] for v in vs))} to {n0(max(v['popLossGt10'] for v in vs))}", f"{n0(min(v['popLossGt25'] for v in vs))} to {n0(max(v['popLossGt25'] for v in vs))}",
                     f"{n1(min(v['xhAddedMeanS'] for v in vs))} to {n1(max(v['xhAddedMeanS'] for v in vs))}", f"{min(v['top10Overlap'] for v in vs)}/10 to {max(v['top10Overlap'] for v in vs)}/10"])
    F["shore_flip"] = tab(["Random misclassification", "Hexes changed", "Population in changed hexes", "People >10%", "People >25%", "Mean added (s)", "Top-10 overlap"], rows)
    rows = []
    for v in V:
        if v["group"] == "shore":
            rows.append([v["name"].replace("shore: ", ""), n0(v["hexesChangedShore"]), n0(v["popInChangedHexes"]), n0(v["jobsInChangedHexes"]), n0(v["ambiguousHexes"]), n0(v["popLossGt10"]), n0(v["popLossGt25"]), n1(v["xhAddedMeanS"]), f"{v['top10Overlap']}/10"])
    F["shore_counts"] = tab(["Shore variant", "Hexes changing shore", "Population in them", "Jobs in them", "Ambiguous hexes (after)", "People >10%", "People >25%", "Mean added (s)", "Top-10 overlap"], rows)
    # call delay
    rows = [[f"{v['params']['callToWheelsS']} s" if v['group'] == 'call_to_wheels' else "60 s (reference)", n1(v["emsBaseP50S"]), n1(v["emsBaseP90S"]), n1(v["emsBasePctWithin8"]) + "%", n1(v["emsWorldPctWithin8"]) + "%", n1(v["emsDP50S"]), n1(v["emsDP90S"])]
            for v in [ref | {"params": {}, "group": "ref"}] + [x for x in V if x["group"] == "call_to_wheels"]]
    F["call"] = tab(["Call-to-wheels delay", "EMS baseline p50 (s)", "EMS baseline p90 (s)", "Within 8 min, baseline", "Within 8 min, bridge removed", "d p50 (s)", "d p90 (s)"], rows)
    # conclusion scoreboard
    sc = []
    names = {"C1": "C1 regional mean added < 30 s", "C2": "C2 EMS p50 and p90 change < 1 s", "C3": "C3 0.5% to 10% of people lose >10% cross-harbor jobs", "C4": "C4 xharbor added-time p50 < 5 s", "C5": "C5 low-wage loss within 1 pp of population loss", "C6": "C6 top-10 worst BGs overlap >= 7"}
    for c, nm in names.items():
        vs = [v for v in V if v["C"][c] is not None]
        bad = [v["name"] for v in vs if v["C"][c] is False]
        sc.append([nm, f"{len(vs) - len(bad)} of {len(vs)}", "; ".join(bad) if bad else "-"])
    F["scoreboard"] = tab(["Conclusion", "Variants where it holds", "Variants where it fails"], sc)
    # bootstrap
    b = S["bootstrap"]; sm = b["summary"]
    lab = {"popLossGt10": "People losing >10%", "popLossGt25": "People losing >25%", "lowWageLossGt10": "Low-wage workers losing >10%", "popMeanLossPct": "Mean loss (% of jobs within 30 min)", "xhAddedMeanS": "Mean added time (s)",
           "xhAddedP50S": "Added p50 (s)", "xhAddedP90S": "Added p90 (s)", "equityGapLossPct": "Low-wage minus population mean loss (pp)", "top10Overlap": "Top-10 overlap with reference (of 10)", "spearman": "Spearman vs reference (BG ranks)"}
    fb = lambda k: (n0 if k in ("popLossGt10", "popLossGt25", "lowWageLossGt10") else n2)
    rows = [[lab[k], fb(k)(sm[k]["p2.5"]), fb(k)(sm[k]["p50"]), fb(k)(sm[k]["p97.5"]), fb(k)(sm[k]["min"]), fb(k)(sm[k]["max"])] for k in lab]
    F["bootstrap"] = tab(["Metric (200 block resamples)", "2.5th pct", "Median", "97.5th pct", "Min", "Max"], rows)
    F["bootstrap_note"] = f"reference values: {n0(ref['popLossGt10'])} / {n0(ref['popLossGt25'])} / {n0(ref['lowWageLossGt10'])}; conclusions C3, C4, C5, C6 hold in {b['C3holds']}, {b['C4holds']}, {b['C5holds']}, {b['C6holds']} of {b['B']} resamples; {b['blocks']:,} job blocks; total jobs range {n0(sm['totalJobs']['min'])} to {n0(sm['totalJobs']['max'])}"
    # regional destinations
    R = L("regional_dest.json")
    rows = [[v["name"], n2(v["popMeanAddedS"]), n0(v["p99AddedS"]), n0(v["maxAddedS"])] for v in R["variants"]]
    bs = R["bootstrapK8"]["popMeanAddedS"]
    rows.append(["K=8, 30 block-bootstrap re-clusterings: median (2.5th to 97.5th pct)", f"{n2(bs['median'])} ({n2(bs['p2.5'])} to {n2(bs['p97.5'])}); max {n2(bs['max'])}", "", ""])
    F["regional_dest"] = tab(["Regional-lens anchors", "Mean added (s)", "p99 hex added (s)", "Max hex added (s)"], rows)
    # null controls
    N = L("null_controls.json")
    rows = []
    for i, c in enumerate(N["nullControls"], 1):
        rows.append([i, c["type"].split(" (")[0] + (" (hex snaps to dead end)" if "IS a hex" in c["type"] else " (no hex on it)" if "not snapped" in c["type"] else ""), c["class"], n1(c["kmFromKeyBridge"]), n0(c["popLossGt10"]),
                     f"{c['xhMeanAddedS']:.3f}", f"{c['regMeanAddedS']:.3f}", f"{c['regPopAddedGt1s']:,.0f}", f"{c['emsDP50S']:.2f} / {c['emsDP90S']:.2f}", f"{c['emsPopChangedGt1s']:,.0f}", "yes" if c["passesPreDeclaredRule"] else "NO"])
    F["null"] = tab(["#", "Closure", "Class", "km from Key Bridge", "People >10% loss", "xharbor mean added (s)", "Regional mean added (s)", "People with regional +1 s or more", "EMS d p50 / d p90 (s)", "People with EMS change >1 s", "Passes rule"], rows)
    kb = N["keybridge"]
    F["null_pass"] = f"{N['nullPassCount'][0]} of {N['nullPassCount'][1]}"
    rows = []
    for k, v in N["closureOrdering"].items():
        rows.append([k, v["nEdges"], n0(v["popLossGt10"]), n0(v["popLossGt25"]), n0(v["lowWageLossGt10"]), n1(v["xhMeanAddedS"]), n1(v["xhAddedP90S"]), n1(v["regMeanAddedS"]), f"{v['emsDP50S']:.1f} / {v['emsDP90S']:.1f}"])
    F["ordering"] = tab(["Closed (each vs. baseline)", "Directed edges", "People >10%", "People >25%", "Low-wage >10%", "xharbor mean added (s)", "xharbor added p90 (s)", "Regional mean added (s)", "EMS d p50 / d p90 (s)"], rows)
    D = N["randomCutDistribution"]; RC = N["randomCuts"]
    lab2 = {"popLossGt10": "People losing >10% of cross-harbor jobs", "popLossGt25": "People losing >25%", "xhPopMeanLossPct": "xharbor mean loss (%)", "xhMeanAddedS": "xharbor mean added time (s)", "regMeanAddedS": "Regional mean added time (s)"}
    rows = []
    for m, nm in lab2.items():
        d = D["all"][m]; d2 = D["lengthWithin0.5to2xKB"][m]; d3 = D["noTunnelInWindow"][m]
        fm = n0 if m.startswith("popLoss") else n2
        rows.append([nm, fm(d["keybridge"]), fm(d["randomMedian"]), fm(d["randomP90"]), fm(d["randomMax"]), f"{d['percentileOfKeyBridge']:.0f} ({d['nBiggerThanKeyBridge']} of {D['all']['n']} larger)",
                     f"{d2['percentileOfKeyBridge']:.0f}", f"{d3['percentileOfKeyBridge']:.0f}"])
    F["randomcut"] = tab(["Metric", "Key Bridge", "Random-cut median", "Random-cut p90", "Random-cut max", "Key Bridge percentile, all cuts", "Percentile, length 0.5-2x bridge (n=%d)" % D["lengthWithin0.5to2xKB"]["n"], "Percentile, cuts without a tunnel (n=%d)" % D["noTunnelInWindow"]["n"]], rows)
    rows_ = RC["rows"]
    F["randomcut_note"] = (f"{RC['used']} usable cuts of {RC['N']} (one window contained the bridge and was skipped); edges per cut: median {int(np.median([r['nEdges'] for r in rows_]))} "
                           f"(range {min(r['nEdges'] for r in rows_)} to {max(r['nEdges'] for r in rows_)}) vs. {RC['keybridgeEdges']} for the bridge; one-way-equivalent length: median {np.median([r['lenKmOneWayEq'] for r in rows_]):.2f} km vs. {RC['keybridgeLenKmOneWay']:.2f} km for the bridge; "
                           f"{sum(r['hasTunnel'] for r in rows_)} cuts include a tunnel edge; share of cuts with any change in EMS d p90 above 1 s: {np.mean([abs(r['emsDP90S']) > 1 for r in rows_]) * 100:.1f}%; share of cuts with xharbor mean added time under 0.5 s: {np.mean([r['xhMeanAddedS'] < 0.5 for r in rows_]) * 100:.1f}%")
    try:
        G = L("random_segments.json")
        fm = lambda m: (n0 if m.startswith("popLoss") else n2)
        rows = [[lab2[m], fm(m)(G["dist"][m]["keybridge"]), fm(m)(G["dist"][m]["randomMedian"]), fm(m)(G["dist"][m]["randomP90"]), fm(m)(G["dist"][m]["randomMax"]), f"{G['dist'][m]['percentileOfKeyBridge']:.0f} ({G['dist'][m]['nBigger']} of {G['n']} larger)"] for m in lab2]
        F["randomseg"] = tab(["Metric", "Key Bridge", "Segment median", "Segment p90", "Segment max", "Key Bridge percentile"], rows)
        F["randomseg_note"] = f"{G['n']} usable; one draw was a Key Bridge edge and was skipped"
    except FileNotFoundError:
        pass
    # validation
    Val = L("validation.json")
    rows = [[f"{r['from']} to {r['to']}", n1(r["modelBaselineMin"]), n1(r["modelBridgeRemovedMin"]), n1(r["modelAddedMin"]), n1(r["osrmCurrentMin"]), f"{r['osrmRouteMinDistToBridgeSiteM']:,.0f}"] for r in Val["named"]]
    F["val_named"] = tab(["Trip (place-node hexes)", "Model baseline (min)", "Model bridge removed (min)", "Model added (min)", "OSRM current OSM (min)", "OSRM route's closest approach to bridge site (m)"], rows)
    P = Val["randomPairs"]
    def crow(k, nm):
        c = P[k]; return [nm, n0(c["n"]), n2(c["medianRatioModelOverOsrm"]), f"{c['p10Ratio']:.2f} to {c['p90Ratio']:.2f}", f"{100 * c['within20pct']:.0f}%", n2(c["spearman"]), n2(c["pearson"]), n0(c["medianAbsErrS"])]
    rows = [crow("bridgeRemovedVsOsrm_all", "Bridge-removed model vs OSRM, all pairs"), crow("baselineVsOsrm_all", "Baseline model vs OSRM, all pairs"), crow("bridgeRemovedVsOsrm_crossHarbor", "Bridge-removed, cross-harbor pairs"),
            crow("bridgeRemovedVsOsrm_sameShore", "Bridge-removed, same-shore pairs"), crow("unaffectedPairs(|model diff|<1s)", "Pairs the bridge does not touch (model diff < 1 s)")]
    F["val_pairs"] = tab(["Comparison", "Pairs", "Median model/OSRM", "p10 to p90 ratio", "Within 20%", "Spearman", "Pearson", "Median abs. error (s)"], rows)
    a = P["bridgeAffectedPairs(model +>60s)"]
    F["val_aff"] = f"{a['n']} pairs where the model says the bridge adds more than 60 s; OSRM's time is closer to the bridge-removed model in {100 * a['shareCloserToBridgeRemoved']:.0f}% of them; median abs. error {n0(a['medianAbsErrBridgeRemovedS'])} s (bridge removed) vs {n0(a['medianAbsErrBaselineS'])} s (baseline)"
    # fast vs exact
    X = L("fast_vs_exact.json")
    rows = []
    for w, rw in X["worlds"].items():
        for r in rw["variants"]:
            h = r["headline"]
            rows.append([w.replace("_", " "), f"{r['K']} ({r['anchorsTotal']} total)", n1(r["worldMeanTimeErrS"]["meanAbs"]), n0(r["worldMeanTimeErrS"]["max"]), n2(r["addedTimeErrS"]["meanAbs"]), n0(r["addedTimeErrS"]["max"]),
                         n2(r["lossErrPP"]["meanAbs"]), f"{h['popLossGt10pct']['relErrPct']:+.1f}%", f"{h['popLossGt25pct']['relErrPct']:+.1f}%", f"{h['lowWageLossGt10pct']['relErrPct']:+.1f}%", f"{h['popMeanAddedS']['relErrPct']:+.1f}%", f"{h['addedP90S']['relErrPct']:+.1f}%", f"{r['top10Overlap']}/10"])
    F["fast"] = tab(["World", "Anchors per shore", "Mean-time err, mean (s)", "max (s)", "Added-time err, mean (s)", "max (s)", "Loss err, mean (pp)", "People >10%", "People >25%", "Low-wage >10%", "Mean added", "Added p90", "Top-10 overlap"], rows)
    P2 = L("pair_congestion.json")
    F["pair"] = tab(["Dundalk to Ferndale, model", "Baseline (min)", "Bridge removed (min)", "Added (min)"], [[r["proxy"], n1(r["baselineMin"]), n1(r["bridgeRemovedMin"]), n1(r["addedMin"])] for r in P2["rows"]])
    T = L("ts_port_agreement.json")
    F["ts_agree"] = (f"{T['comparisons']} world x anchor-count comparisons ({T['comparisons'] * T['columnsPerComparison']} numbers); " + ("all agree at the precision TypeScript printed" if T["allAgree"] else "NOT all agree, see out/ts_port_agreement.json"))
    M = L("monotonicity.json")
    F["mono"] = f"{M['candidates']} catalog candidates in two contexts (baseline and bridge removed) = {M['contextsChecked']} evaluations in the file as it is now ({M['prunedCandidates']} further entries are listed as pruned; the catalog file changed on disk while this study ran, not by this study; the real network and every lens headline number were checked to be identical); minimum benefit on each of the five measures = {min(M['minBenefit'].values()):g}; negative benefits found: {len(M['negativeBenefits'])}"
    return F


if __name__ == "__main__":
    F = frag()
    txt = "\n\n".join(f"=== {k} ===\n{v}" for k, v in F.items())
    (OUT / "tables.txt").write_text(txt + "\n")
    print(txt[:200000])

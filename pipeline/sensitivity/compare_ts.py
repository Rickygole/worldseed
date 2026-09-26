"""Compares the Python port of the fast xharbor variant (out/fast_vs_exact.json) with the browser code's own printed accuracy table
(out/ts_fast_table.txt = output of frontend/test/sim/xharborGolden.test.ts, run with its cache outside the repo).
For every world x K present in both, every printed column is compared at the precision TypeScript printed it.  Output: out/ts_port_agreement.json"""
import json, re, pathlib

OUT = pathlib.Path(__file__).parent / "out"
X = json.loads((OUT / "fast_vs_exact.json").read_text())["worlds"]
rows = []
for line in (OUT / "ts_fast_table.txt").read_text().splitlines():
    m = re.match(r"(\S+) K=(\d+)/shore", line)
    if not m: continue
    w, K = m.group(1), int(m.group(2))
    f = lambda pat: re.search(pat, line)
    ts = {"meanErrAvg": float(f(r"\|mean err\| avg ([\d.]+) s").group(1)), "meanErrMax": float(f(r"max ([\d.]+) s; \|added").group(1)),
          "addedErrAvg": float(f(r"\|added err\| avg ([\d.]+) s").group(1)), "lossErrAvgPP": float(f(r"\|loss err\| avg ([\d.]+) pp").group(1)),
          "meanAddedRelPct": float(f(r"meanAdded [\d.]+ \(([-\d.]+)%\)").group(1)), "addedP90RelPct": float(f(r"addedP90 [\d.]+ \(([-\d.]+)%\)").group(1)),
          "meanLossRelPct": float(f(r"meanLoss% [\d.]+ \(([-\d.]+)%\)").group(1)), "pop10RelPct": float(f(r"pop>10% \d+ \(([-\d.]+)%\)").group(1)),
          "pop25RelPct": float(f(r"pop>25% \d+ \(([-\d.]+)%\)").group(1)), "lw10RelPct": float(f(r"lw>10% \d+ \(([-\d.]+)%\)").group(1)),
          "top10": int(f(r"overlap (\d+)/10").group(1))}
    py = next((v for v in X[w]["variants"] if v["K"] == K), None)
    if py is None: continue
    h = py["headline"]
    mine = {"meanErrAvg": py["worldMeanTimeErrS"]["meanAbs"], "meanErrMax": py["worldMeanTimeErrS"]["max"], "addedErrAvg": py["addedTimeErrS"]["meanAbs"], "lossErrAvgPP": py["lossErrPP"]["meanAbs"],
            "meanAddedRelPct": h["popMeanAddedS"]["relErrPct"], "addedP90RelPct": h["addedP90S"]["relErrPct"], "meanLossRelPct": h["popMeanLossPct"]["relErrPct"], "pop10RelPct": h["popLossGt10pct"]["relErrPct"],
            "pop25RelPct": h["popLossGt25pct"]["relErrPct"], "lw10RelPct": h["lowWageLossGt10pct"]["relErrPct"], "top10": py["top10Overlap"]}
    tol = {"meanErrAvg": 0.06, "meanErrMax": 1.0, "addedErrAvg": 0.06, "lossErrAvgPP": 0.006, "meanAddedRelPct": 0.06, "addedP90RelPct": 0.06, "meanLossRelPct": 0.06, "pop10RelPct": 0.06, "pop25RelPct": 0.06, "lw10RelPct": 0.06, "top10": 0}
    # TS prints toFixed(1|0|2): agreement = equal after rounding to the printed precision (allow one unit of the last printed digit)
    ok = {k: abs(ts[k] - mine[k]) <= tol[k] + 1e-9 for k in ts}
    rows.append({"world": w, "K": K, "ts": ts, "python": mine, "agree": ok, "allAgree": all(ok.values())})
res = {"comparisons": len(rows), "columnsPerComparison": len(rows[0]["ts"]), "allAgree": all(r["allAgree"] for r in rows), "rows": rows,
       "note": "tolerance = one unit of the last digit TypeScript printed; TypeScript compares against golden.json, the port against its own exact recomputation of the same lens"}
(OUT / "ts_port_agreement.json").write_text(json.dumps(res, indent=1))
print(res["comparisons"], "world x K comparisons,", res["columnsPerComparison"], "columns each; all agree:", res["allAgree"])
for r in rows:
    bad = [k for k, v in r["agree"].items() if not v]
    print(r["world"], r["K"], "OK" if not bad else f"DIFF {bad}: " + ", ".join(f"{k} ts {r['ts'][k]} py {r['python'][k]:.3f}" for k in bad))

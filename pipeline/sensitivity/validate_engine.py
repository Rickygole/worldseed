"""Check 0: the study engine reproduces the committed golden.json (so every later number is on the reference engine)."""
import json, time
import numpy as np
from worldseed_pipeline import config, golden
from sensitivity.engine import *

if __name__ == "__main__":
    t0 = time.time()
    ctx = Ctx()
    gold = json.loads((config.SNAP / "golden.json").read_text())
    base = solve_state(ctx); print("baseline state", round(time.time() - t0, 1), "s", base.M.shape)
    kb = solve_state(ctx, disabled=ctx.kb); print("kb state", round(time.time() - t0, 1), "s")
    res = {}
    gw = {w["id"]: w for w in gold["worlds"]}
    gx = {w["id"]: w for w in gold["xharbor"]["worlds"]}
    a0, a1 = xh_arrays(ctx, base, {}), xh_arrays(ctx, kb, {})
    for name, arr in (("baseline", a0), ("keybridge_removed", a1)):
        ok = ~np.isnan(arr["mean"])
        gm = np.array([np.nan if v is None else v for v in gx[name]["meanTimeS"]])
        gj = np.array([np.nan if v is None else v for v in gx[name]["jobsWithin1800"]])
        assert (np.isnan(gm) == ~ok).all()
        dm = np.abs(arr["mean"][ok] - gm[ok]).max()
        nj = int((np.abs(arr["J1800"][ok] - gj[ok]) > 0.5).sum())
        bnd = {b[0]: (b[1], b[2]) for b in gx[name]["boundary"]}
        nj_out = int(sum(1 for i in np.nonzero(ok)[0] if abs(arr["J1800"][i] - gj[i]) > 0.5 and not (i in bnd and bnd[i][0] - .5 <= arr["J1800"][i] <= bnd[i][1] + .5)))
        res[name] = {"xharMeanTimeMaxAbsErrS": float(dm), "xharJobsHexesDiffering": nj, "xharJobsDiffOutsideBoundaryRule": nj_out}
        print(name, res[name])
    # regional + EMS
    for name, st in (("baseline", base), ("keybridge_removed", kb)):
        acc = access_field(ctx, st); gh = np.array(gw[name]["access"]["hexTimeS"])
        em = ems_field(ctx, st); ge = np.array([np.inf if v is None else v for v in gw[name]["ems"]["hexTimeS"]])
        fin = np.isfinite(ge)
        res[name].update({"accessMaxAbsErrS": float(np.abs(acc - gh).max()), "emsMaxAbsErrS": float(np.abs(em[fin] - ge[fin]).max()),
                          "emsUnreachableMatch": bool((np.isfinite(em) == fin).all())})
        print(name, res[name])
    ev = evaluate(ctx, base, kb)
    g = gx["keybridge_removed"]["metrics"]
    cmp = {k: (ev["xh"][k], g[k]) for k in HEADLINE if k in g}
    print(json.dumps(cmp, indent=1))
    res["headlineVsGolden"] = {k: {"study": v[0], "golden": v[1]} for k, v in cmp.items()}
    worst = json.dumps  # noqa
    top = sorted(ev["bg"].items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    gtop = [r["geoid"] for r in gold["xharbor"]["worstBlockGroups"]["keybridge_removed"]["byLossPct"]]
    res["top10MatchesGolden"] = [k for k, _ in top] == gtop
    print("top10 == golden byLossPct:", res["top10MatchesGolden"])
    print("regional popAdded", ev["reg"]["popMeanAddedS"], "golden", gw["keybridge_removed"]["access"]["metrics"]["popAddedS"])
    res["regionalPopAddedStudy"] = ev["reg"]["popMeanAddedS"]; res["regionalPopAddedGolden"] = gw["keybridge_removed"]["access"]["metrics"]["popAddedS"]
    import pathlib
    out = pathlib.Path(__file__).parent / "out"; out.mkdir(exist_ok=True)
    (out / "validate_engine.json").write_text(json.dumps(res, indent=1))
    print("total", round(time.time() - t0, 1), "s")

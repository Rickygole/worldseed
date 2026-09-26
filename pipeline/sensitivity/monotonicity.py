"""Monotonicity check on the committed candidate effects: adding a candidate never hurts (all benefits >= 0).
Reads data/snapshot/candidate_effects.json as it is on disk NOW (the catalog was re-pruned by another workstream while this study
ran; the real network and all lens headline numbers were verified unchanged). Output: out/monotonicity.json"""
import json, pathlib
from worldseed_pipeline import config

OUT = pathlib.Path(__file__).parent / "out"
eff = json.loads((config.SNAP / "candidate_effects.json").read_text())
keys = ("xharborTimeSavedS", "xharborJobsGain", "accessTimeSavedS", "emsP90SavedS", "emsPctWithinGain")
mn = {k: None for k in keys}; n = 0; neg = []
for c in eff["candidates"]:
    for ctx in ("inBaseline", "inKeybridgeRemoved"):
        n += 1
        for k in keys:
            v = c[ctx]["benefits"][k]
            mn[k] = v if mn[k] is None else min(mn[k], v)
            if v < -1e-9: neg.append((c["id"], ctx, k, v))
res = {"candidates": len(eff["candidates"]), "contextsChecked": n, "minBenefit": mn, "negativeBenefits": neg,
       "prunedCandidates": len(eff.get("pruned", [])), "file": "data/snapshot/candidate_effects.json"}
(OUT / "monotonicity.json").write_text(json.dumps(res, indent=1))
print(json.dumps(res, indent=1))

"""Round 2 invariants: xharbor lens, candidate catalog, gazetteer, candidate effects."""
from __future__ import annotations

import json
import re

import networkx as nx
import numpy as np
import pytest

from worldseed_pipeline import build_candidates, config, golden, worlds
from worldseed_pipeline.gazetteer_match import alias_index, exact, match, normalize
from worldseed_pipeline.graphio import load_graph
from worldseed_pipeline.worlds import World

SNAP = config.SNAP
F = config.FLAGS


@pytest.fixture(scope="module")
def g():
    return load_graph()


@pytest.fixture(scope="module")
def hx():
    return golden.load_hexes()


@pytest.fixture(scope="module")
def gold():
    return json.loads((SNAP / "golden.json").read_text())


@pytest.fixture(scope="module")
def cands():
    return json.loads((SNAP / "candidates.json").read_text())


@pytest.fixture(scope="module")
def gaz():
    return json.loads((SNAP / "gazetteer.json").read_text())


@pytest.fixture(scope="module")
def eff():
    return json.loads((SNAP / "candidate_effects.json").read_text())


# ------------------------------------------------------------------------------------- xharbor lens
def test_regional_golden_keys_preserved(gold):
    for k in ("snapshotId", "tolerance", "constants", "emsSourceNodes", "destinations", "hexCount", "worlds",
              "keybridgeWorstBlockGroups", "xharbor"):
        assert k in gold
    assert len(gold["worlds"]) == 6


def test_xharbor_structure_and_monotone(gold, hx):
    xh = gold["xharbor"]
    ids = [w["id"] for w in xh["worlds"]]
    assert ids == [w["id"] for w in gold["worlds"]]
    H = gold["hexCount"]
    W = {w["id"]: w for w in xh["worlds"]}
    base = W["baseline"]
    assert all(len(w["jobsWithin1800"]) == H and len(w["meanTimeS"]) == H for w in W.values())
    shore = hx["shore"]
    for w in W.values():                       # ambiguous hexes are neither origins nor scored
        assert all(w["jobsWithin1800"][i] is None and w["meanTimeS"][i] is None for i in np.nonzero(shore == 2)[0])
    assert xh["shore"]["ambiguousHexes"] == int((shore == 2).sum())
    assert base["metrics"]["popMeanLossPct"] == 0 and base["metrics"]["popAddedGt60s"] == 0
    ok = shore < 2
    J = {k: np.array([np.nan if v is None else v for v in w["jobsWithin1800"]]) for k, w in W.items()}
    M = {k: np.array([np.nan if v is None else v for v in w["meanTimeS"]]) for k, w in W.items()}
    for k in J:                                # closing edges never gives more jobs or a shorter mean time
        assert np.all(J[k][ok] <= J["baseline"][ok] + 1)
        assert np.all(M[k][ok] >= M["baseline"][ok] - 0.02)
    assert np.all(J["keybridge_and_harbor_tunnel_closed"][ok] <= J["keybridge_removed"][ok] + 1)
    assert np.all(J["keybridge_and_harbor_tunnel_closed"][ok] <= J["harbor_tunnel_closed"][ok] + 1)
    # boundary ranges bracket the central count
    for w in W.values():
        for i, lo, hi in w["boundary"]:
            assert lo <= w["jobsWithin1800"][i] <= hi
    # sensitivity keys
    for w in W.values():
        assert set(w["sensitivity"]) == {"T20min", "T30min", "T40min"}
        assert w["sensitivity"]["T30min"]["popLossGt10pct"] == pytest.approx(w["metrics"]["popLossGt10pct"])


def test_xharbor_matches_networkx_on_sample(g, hx, gold):
    """Independent engine check: networkx Dijkstra recomputes jobsWithin1800 and meanTimeS for sample hexes."""
    kb = frozenset(next(l for l in g.meta["links"] if l["id"] == "L-KEYBRIDGE")["edges"])
    shore = hx["shore"]
    dest = np.nonzero((hx["jobs"] > 0) & (shore < 2))[0]
    rng = np.random.default_rng(3)
    origins = rng.choice(np.nonzero(shore < 2)[0], size=6, replace=False)
    for wid, w in (("baseline", World()), ("keybridge_removed", World(disabled=kb))):
        G = worlds.digraph(g, w)
        gx = next(x for x in gold["xharbor"]["worlds"] if x["id"] == wid)
        for h in origins:
            dist = nx.single_source_dijkstra_path_length(G, int(hx["node"][h]), weight="weight")
            t = np.array([hx["snapS"][h] + dist.get(int(hx["node"][j]), np.inf) + hx["snapS"][j] for j in dest])
            opp = shore[dest] != shore[h]
            jobs = hx["jobs"][dest]
            count = float(jobs[opp & (t <= 1800.0)].sum())
            mean = float((np.minimum(t, config.ACCESS_CAP_S)[opp] * jobs[opp]).sum() / jobs[opp].sum())
            lo = float(jobs[opp & (t <= 1799.5)].sum())
            hi = float(jobs[opp & (t <= 1800.5)].sum())
            assert gx["jobsWithin1800"][h] == count
            assert lo <= count <= hi
            assert abs(gx["meanTimeS"][h] - mean) < 0.02


def test_xharbor_effect_is_directional(gold):
    """The bridge removal must hurt cross-harbor access more than region-wide access, per person on average."""
    kb = next(w for w in gold["xharbor"]["worlds"] if w["id"] == "keybridge_removed")["metrics"]
    reg = next(w for w in gold["worlds"] if w["id"] == "keybridge_removed")["access"]["metrics"]
    assert kb["popMeanAddedS"] > reg["popAddedS"] > 0


# ------------------------------------------------------------------------------------- candidates
def test_catalog_shape(cands):
    assert 18 <= len(cands) <= 30
    ids = [c["id"] for c in cands]
    assert len(ids) == len(set(ids))
    assert {c["type"] for c in cands} == {"temp_link", "signal_priority", "prepos_site"}
    for c in cands:
        assert c["hypothetical"] is True and c["costSource"] is None and c["sources"] == []
        assert c["costTier"] in ("$", "$$", "$$$") and c["leadTime"] in ("days", "weeks", "months")
        assert c["title"].startswith("Hypothetical scenario option")
        assert not re.search(r"\d", c["title"] + c["mechanism"]), c["id"]
        assert not re.search(r"dispatch|triage|real-?time|propos|endors", c["title"] + c["mechanism"] + c["notes"].replace("not proposed, studied or endorsed", ""), re.I), c["id"]
        assert c["effect"]["op"] in ("enable_edges", "corridor_speed", "add_source")


def test_candidate_refs_resolve_and_disabled_by_default(cands, g):
    corridors = {c["id"]: i for i, c in enumerate(g.meta["corridors"])}
    cand_edges = set(np.nonzero(g.edgeFlags & F["CANDIDATE"])[0].tolist())
    assert cand_edges and min(cand_edges) >= g.e - len(cand_edges)      # appended after every real edge
    used = set()
    for c in cands:
        e = c["effect"]
        if e["op"] == "enable_edges":
            assert e["edges"] and set(e["edges"]) <= cand_edges
            used |= set(e["edges"])
            for i in e["edges"]:
                assert g.edgeClass[i] == config.CLASSES.index("candidate") and g.edgeFlags[i] & F["CANDIDATE"]
                assert g.edgeTimeS[i] > 0 and g.edgeLenM[i] > 0
            a, b = c["refs"]["nodes"]
            assert {int(g.edgeFrom[e["edges"][0]]), int(g.edgeTo[e["edges"][0]])} == {a, b}
            assert int(g.nodeOsmId[a]) == c["refs"]["osmNodes"][0]
        elif e["op"] == "corridor_speed":
            assert e["corridor"] in corridors
            p = c["params"]["factor"]
            assert p["min"] <= e["factor"] <= p["max"] and p["default"] == e["factor"]
            assert c["refs"]["edgeCount"] == int((g.edgeCorridor == corridors[e["corridor"]]).sum()) > 0
        else:
            n = e["facilityLike"]["node"]
            assert 0 <= n < g.n
    assert used == cand_edges                                              # every candidate edge belongs to an entry


def test_baseline_ignores_candidate_edges(g, gold):
    A = worlds.matrix(g, World())
    assert A.nnz <= (g.e - int(((g.edgeFlags & F["CANDIDATE"]) != 0).sum()))
    assert gold["worlds"][0]["access"]["metrics"]["popAddedS"] == 0
    # enabling all candidates strictly adds edges
    allc = frozenset(np.nonzero(g.edgeFlags & F["CANDIDATE"])[0].tolist())
    assert worlds.matrix(g, World(enabled=allc)).nnz > A.nnz


def test_unresolved_osm_id_fails_the_build(monkeypatch, g):
    bad = [{"id": "TL-BAD", "type": "temp_link", "link": {"mode": "road",
            "a": {"osmNode": 1, "expectNames": []}, "b": {"osmNode": 2, "expectNames": []}}}]
    monkeypatch.setattr(build_candidates, "load_catalog", lambda: bad)
    with pytest.raises(build_candidates.CatalogError):
        build_candidates.temp_link_edges(g.nodeOsmId.astype(np.int64), g.nodeLat, g.nodeLon, {})
    good_id = int(g.nodeOsmId[0])
    wrong = [{"id": "TL-BAD2", "type": "temp_link", "link": {"mode": "road",
              "a": {"osmNode": good_id, "expectNames": ["No Such Road Anywhere"]}, "b": {"osmNode": int(g.nodeOsmId[1])}}}]
    monkeypatch.setattr(build_candidates, "load_catalog", lambda: wrong)
    with pytest.raises(build_candidates.CatalogError):
        build_candidates.temp_link_edges(g.nodeOsmId.astype(np.int64), g.nodeLat, g.nodeLon, {})


def test_validate_entry_rejects_bad_text():
    base = {"id": "X", "type": "prepos_site", "kind": "staging_site", "title": "Hypothetical scenario option: x",
            "mechanism": "text", "lens": ["ems"], "costTier": "$", "leadTime": "days", "assumptions": []}
    build_candidates.validate_entry(base, set())
    for patch in ({"mechanism": "costs 5 million"}, {"title": "Proposed fix"}, {"costTier": "$$$$"},
                  {"mechanism": "dispatch units"}):
        with pytest.raises(build_candidates.CatalogError):
            build_candidates.validate_entry({**base, **patch}, set())
    with pytest.raises(build_candidates.CatalogError):
        build_candidates.validate_entry(base, {"X"})


# ------------------------------------------------------------------------------------- gazetteer
def test_gazetteer_structure(gaz, g):
    ids = [e["id"] for e in gaz]
    assert len(ids) == len(set(ids))
    facs = {f["id"] for f in json.loads((SNAP / "facilities.json").read_text())}
    links = {l["id"] for l in g.meta["links"]}
    cors = {c["id"] for c in g.meta["corridors"]}
    nh = json.loads((SNAP / "hexes.meta.json").read_text())["count"]
    kinds = {e["kind"] for e in gaz}
    assert kinds == {"neighborhood", "road", "facility", "link", "corridor"}
    cand = set(np.nonzero(g.edgeFlags & F["CANDIDATE"])[0].tolist())
    for e in gaz:
        assert e["aliases"] and isinstance(e["lat"], float) and isinstance(e["lng"], float)
        (k, v), = e["ref"].items()
        if k == "hexes":
            assert v and max(v) < nh
        elif k == "edges":
            assert v and max(v) < g.e and not (set(v) & cand)
        elif k == "facility":
            assert v in facs
        elif k == "link":
            assert v in links
        elif k == "corridor":
            assert v in cors
        else:
            raise AssertionError(k)
    assert {e["ref"]["link"] for e in gaz if e["kind"] == "link"} == links
    assert {e["ref"]["corridor"] for e in gaz if e["kind"] == "corridor"} == cors


def test_gazetteer_aliases_unique_and_normalized(gaz):
    seen = {}
    for e in gaz:
        for a in e["aliases"]:
            assert a == normalize(a)
            assert a not in seen, (a, e["id"], seen.get(a))
            seen[a] = e["id"]


def test_gazetteer_required_aliases(gaz):
    idx = alias_index(gaz)
    want = {"Key Bridge": "G-KEYBRIDGE", "Francis Scott Key Bridge": "G-KEYBRIDGE", "key bridge": "G-KEYBRIDGE",
            "Harbor Tunnel": "G-HARBORTUNNEL", "I-895 tunnel": "G-HARBORTUNNEL", "Baltimore Harbor Tunnel": "G-HARBORTUNNEL",
            "Harbor Tunnel Thruway": "G-HARBORTUNNEL", "Fort McHenry Tunnel": "G-FORTMCHENRY",
            "I-95 tunnel": "G-FORTMCHENRY"}
    for text, gid in want.items():
        assert exact(idx, text)["id"] == gid, text
    # free text: the longest alias wins
    assert match(idx, "Please close the I-895 tunnel tonight")["id"] == "G-HARBORTUNNEL"
    assert match(idx, "the Francis Scott Key Bridge is gone")["id"] == "G-KEYBRIDGE"
    assert match(idx, "detour via the Fort McHenry Tunnel")["id"] == "G-FORTMCHENRY"
    assert exact(idx, "I-695")["kind"] == "road" and exact(idx, "Beltway corridor")["kind"] == "corridor"
    assert exact(idx, "Dundalk")["kind"] == "neighborhood"
    assert exact(idx, "Broening Highway")["kind"] == "road" and exact(idx, "Broening Hwy") is not None
    assert match(idx, "no place names in this sentence about zzzz") is None


# ------------------------------------------------------------------------------------- candidate effects
def test_candidate_effects_complete_and_consistent(eff, cands, gold):
    assert [e["id"] for e in eff["candidates"]] == [c["id"] for c in cands]
    ref = eff["reference"]
    gb = next(w for w in gold["xharbor"]["worlds"] if w["id"] == "baseline")["metrics"]
    gk = next(w for w in gold["xharbor"]["worlds"] if w["id"] == "keybridge_removed")["metrics"]
    assert ref["baseline"]["xharbor"]["popMeanJobs"] == pytest.approx(gb["popMeanJobs"], abs=1e-2)
    assert ref["keybridge_removed"]["xharbor"]["popMeanAddedS"] == pytest.approx(gk["popMeanAddedS"], abs=2e-3)
    reg = next(w for w in gold["worlds"] if w["id"] == "keybridge_removed")
    assert ref["keybridge_removed"]["access"]["popMeanAddedS"] == pytest.approx(reg["access"]["metrics"]["popAddedS"], abs=2e-3)
    assert ref["baseline"]["ems"]["p90S"] == pytest.approx(gold["worlds"][0]["ems"]["metrics"]["p90S"], abs=2e-3)
    for e in eff["candidates"]:
        for ctx in ("inBaseline", "inKeybridgeRemoved"):
            b = e[ctx]["benefits"]
            assert all(b[k] >= -1e-6 for k in ("xharborTimeSavedS", "xharborJobsGain", "accessTimeSavedS", "emsP90SavedS",
                                              "emsPctWithinGain")), (e["id"], ctx)


def test_catalog_has_helpful_and_useless_options(eff):
    helpful = [e for e in eff["candidates"] if e["inKeybridgeRemoved"]["helps"]]
    useless = [e for e in eff["candidates"] if not e["inKeybridgeRemoved"]["helps"]]
    assert len(helpful) >= 3 and len(useless) >= 3        # the search is not trivial
    assert any("xharbor" in e["inKeybridgeRemoved"]["helps"] for e in helpful)
    assert any("ems" in e["inKeybridgeRemoved"]["helps"] for e in helpful)
    for e in useless:
        b = e["inKeybridgeRemoved"]["benefits"]
        assert b["xharborTimeSavedS"] < 1 and b["accessTimeSavedS"] < 1
    # the same-shore water link cannot help cross-harbor access
    same = next(e for e in eff["candidates"] if e["id"] == "TL-SHUTTLE-CANTON-LOCUSTPOINT")
    assert same["inKeybridgeRemoved"]["benefits"]["xharborTimeSavedS"] < 0.01
    # temporary links do shorten the terminal-to-terminal trip they were built for
    tp = next(e for e in eff["candidates"] if e["id"] == "TL-SHUTTLE-TRADEPOINT-HAWKINS")
    t = tp["inKeybridgeRemoved"]["local"]["terminalPairTimeS"]
    assert t["with"] < t["without"]
    for e in eff["candidates"]:
        for d in e["dominatedBy"]:
            assert d in {x["id"] for x in eff["candidates"]} and d != e["id"]

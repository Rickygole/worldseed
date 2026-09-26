"""Invariant tests over the built snapshot (data/snapshot/). Run the pipeline first:
    cd pipeline && uv run --python 3.12 python -m worldseed_pipeline.run_all
    cd pipeline && uv run --python 3.12 pytest -q
"""
from __future__ import annotations

import hashlib
import json

import numpy as np
import pandas as pd
import pytest
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components, dijkstra

from worldseed_pipeline import binio, config, fetch_census, golden, graphio
from worldseed_pipeline.graphio import BUFFER_ORDER, load_graph

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


# ---------------------------------------------------------------------------- graph
def test_graph_size_within_budget(g):
    assert g.n < 45_000, f"graph too large for a fast browser load: {g.n} nodes"
    assert (SNAP / "graph.bin").stat().st_size < 4_500_000


def test_graph_strongly_connected(g):
    m = (g.edgeFlags & F["CANDIDATE"]) == 0
    A = csr_matrix((np.ones(int(m.sum())), (g.edgeFrom[m], g.edgeTo[m])), shape=(g.n, g.n))
    n, _ = connected_components(A, directed=True, connection="strong")
    assert n == 1


def test_csr_round_trip_and_consistency(g):
    meta = json.loads((SNAP / "graph.meta.json").read_text())
    raw = (SNAP / "graph.bin").read_bytes()
    assert len(raw) == meta["byteLength"]
    arrs = binio.unpack(raw, meta["buffers"])
    for name, typ, _ in BUFFER_ORDER:
        b = meta["buffers"][name]
        assert b["offset"] % 8 == 0 and b["type"] == typ
        assert np.array_equal(arrs[name], getattr(g, name))
    n, e = g.n, g.e
    assert meta["nodeCount"] == n and meta["edgeCount"] == e
    assert g.fwdOff[0] == 0 and g.fwdOff[-1] == e and np.all(np.diff(g.fwdOff.astype(np.int64)) >= 0)
    assert g.revOff[0] == 0 and g.revOff[-1] == e and np.all(np.diff(g.revOff.astype(np.int64)) >= 0)
    assert np.array_equal(np.sort(g.fwdEdge), np.arange(e)) and np.array_equal(np.sort(g.revEdge), np.arange(e))
    src = np.repeat(np.arange(n), np.diff(g.fwdOff.astype(np.int64)))
    assert np.array_equal(g.edgeFrom[g.fwdEdge], src)
    dst = np.repeat(np.arange(n), np.diff(g.revOff.astype(np.int64)))
    assert np.array_equal(g.edgeTo[g.revEdge], dst)
    assert np.all(g.edgeTimeS > 0) and np.all(g.edgeLenM > 0)
    assert g.edgeFrom.max() < n and g.edgeTo.max() < n


def test_bbox_and_classes(g):
    w, s, e, n = config.BBOX
    assert g.nodeLon.min() > w - 0.05 and g.nodeLon.max() < e + 0.05
    assert g.nodeLat.min() > s - 0.05 and g.nodeLat.max() < n + 0.05
    meta = json.loads((SNAP / "graph.meta.json").read_text())
    assert meta["classes"] == config.CLASSES and meta["flags"] == config.FLAGS
    assert g.edgeClass.max() < len(config.CLASSES)


# ---------------------------------------------------------------------------- links
def test_keybridge_link(g):
    links = {l["id"]: l for l in g.meta["links"]}
    kb = links["L-KEYBRIDGE"]["edges"]
    assert len(kb) == 6
    ways = sorted(int(g.edgeOsmWay[i]) for i in kb)
    assert ways == sorted(config.KEYBRIDGE_WAY_IDS)
    for i in kb:
        assert g.edgeFlags[i] & F["KEYBRIDGE"] and g.edgeFlags[i] & F["BRIDGE"]
    # every KEYBRIDGE-flagged edge belongs to the link, and nothing else does
    assert sorted(np.nonzero(g.edgeFlags & F["KEYBRIDGE"])[0].tolist()) == sorted(kb)
    # 3 edges head east (lon increases), 3 head west
    dlon = g.nodeLon[g.edgeTo[kb]] - g.nodeLon[g.edgeFrom[kb]]
    assert int((dlon > 0).sum()) == 3 and int((dlon < 0).sum()) == 3
    # continuity: eastbound edges chain from the SW abutment to the NE abutment
    east = [i for i, d in zip(kb, dlon) if d > 0]
    heads = {int(g.edgeFrom[i]) for i in east}
    tails = {int(g.edgeTo[i]) for i in east}
    assert len(heads - tails) == 1 and len(tails - heads) == 1
    (sw,) = heads - tails
    (ne,) = tails - heads
    assert (g.nodeLat[sw], g.nodeLon[sw]) < (g.nodeLat[ne], g.nodeLon[ne])
    assert abs(g.nodeLat[sw] - 39.2098) < 0.002 and abs(g.nodeLon[sw] + 76.5395) < 0.002
    assert abs(g.nodeLat[ne] - 39.2265) < 0.002 and abs(g.nodeLon[ne] + 76.5159) < 0.002


def test_tunnels_present_and_hazmat_flagged(g):
    links = {l["id"]: l for l in g.meta["links"]}
    for lid, ids in (("L-FORTMCHENRY", config.FORT_MCHENRY_WAY_IDS), ("L-HARBORTUNNEL", config.HARBOR_TUNNEL_WAY_IDS)):
        edges = links[lid]["edges"]
        assert edges, lid
        assert set(int(g.edgeOsmWay[i]) for i in edges) <= set(ids)
        for i in edges:
            assert g.edgeFlags[i] & F["TUNNEL"] and g.edgeFlags[i] & F["HAZMAT_PROHIBITED"]
    assert links["L-FORTMCHENRY"]["edges"] != links["L-HARBORTUNNEL"]["edges"]


def test_closing_links_keeps_rest_of_graph_usable(g, gold):
    # every world must leave (nearly) all population reachable in the EMS field
    for w in gold["worlds"]:
        assert w["ems"]["metrics"]["unreachableHexes"] == 0, w["id"]


# ---------------------------------------------------------------------------- census / hexes
def test_population_conservation(hx):
    bgs = json.loads((SNAP / "blockgroups.json").read_text())
    acs = pd.read_csv(fetch_census.INTERIM / "acs_bg.csv", dtype={"geoid": str})
    expected = sum(b["pop"] * b["areaShareInStudyArea"] for b in bgs)
    got = float(hx["pop"].sum())
    assert abs(got - expected) / expected < 0.005, (got, expected)
    zexp = sum(b["zvh"] * b["areaShareInStudyArea"] for b in bgs)
    assert abs(float(hx["zvh"].sum()) - zexp) / zexp < 0.005
    # hex population never exceeds what the fetched ACS says for the intersecting block groups
    ids = {b["geoid"] for b in bgs}
    total_fetched = float(acs[acs.geoid.isin(ids)]["pop"].sum())
    assert got <= total_fetched * 1.0001
    # per block group: sum of pieces cannot exceed the BG total
    assert sum(b["pop"] for b in bgs) == pytest.approx(total_fetched, rel=1e-3)
    # zero-vehicle households are a subset of households in every block group
    assert all(b["zvh"] <= b["households"] + 1 for b in bgs)
    lw_exp = sum(b["lowWageWorkers"] * b["areaShareInStudyArea"] for b in bgs)
    assert abs(float(hx["lowWage"].sum()) - lw_exp) / lw_exp < 0.005


def test_jobs_conserved(hx):
    wac = pd.read_csv(fetch_census.INTERIM / "lodes_wac_blocks.csv", dtype={"block": str})
    w, s, e, n = config.BBOX
    m = (wac.lat >= s) & (wac.lat <= n) & (wac.lon >= w) & (wac.lon <= e)
    assert float(hx["jobs"].sum()) == pytest.approx(float(wac[m].jobs.sum()), rel=1e-6)


def test_hex_fields_valid(hx, g):
    meta = json.loads((SNAP / "hexes.meta.json").read_text())
    n = meta["count"]
    assert len(meta["h3"]) == n == len(hx["node"]) and len(set(meta["h3"])) == n
    assert hx["node"].max() < g.n and hx["bg"].max() < 65535
    assert np.all((hx["pop"] > 0) | (hx["jobs"] > 0))
    assert set(np.unique(hx["shore"])) <= {0, 1, 2}
    assert np.all(hx["snapS"] >= 0)
    bgs = json.loads((SNAP / "blockgroups.json").read_text())
    for b in bgs:
        for h in b["hexes"]:
            assert hx["bg"][h] == b["i"]
    assert sum(len(b["hexes"]) for b in bgs) == n


def test_shore_sanity(g, hx):
    links = {l["id"]: l for l in g.meta["links"]}
    from worldseed_pipeline.shore import shore_of
    # Key Bridge abutments (hand-picked land points beside the abutments) fall on opposite shores
    assert shore_of([39.2000], [-76.5400], ["24510"])[0] == 1     # Hawkins Point side (city, south)
    assert shore_of([39.2300], [-76.5000], ["24005"])[0] == 0     # Sparrows Point / Dundalk side
    assert shore_of([39.2660], [-76.5850], ["24510"])[0] == 0     # Locust Point
    assert shore_of([39.2300], [-76.6000], ["24510"])[0] == 1     # Brooklyn / Curtis Bay
    counts = np.bincount(hx["shore"].astype(int), minlength=3)
    assert counts[0] > 500 and counts[1] > 100


def test_facilities_contract():
    fac = json.loads((SNAP / "facilities.json").read_text())
    kinds = {f["kind"] for f in fac}
    assert kinds <= {"fire_station", "ems_station", "hospital"}
    ids = [f["id"] for f in fac]
    assert len(ids) == len(set(ids))
    assert sum(1 for f in fac if f["kind"] == "fire_station") >= 40
    assert all(not any(x in f["name"].lower() for x in ("academy", "fire boat")) for f in fac)
    assert all(f["snapM"] < 2000 for f in fac)


def test_destinations_contract():
    d = json.loads((SNAP / "destinations.json").read_text())
    assert 1 <= len(d) <= 8
    assert all({"id", "name", "node", "jobs", "shore"} <= set(x) for x in d)
    assert len({x["id"] for x in d}) == len(d)


# ---------------------------------------------------------------------------- golden
def test_golden_shape_and_monotone(gold, hx):
    ids = [w["id"] for w in gold["worlds"]]
    assert ids[:4] == ["baseline", "keybridge_removed", "harbor_tunnel_closed", "keybridge_and_harbor_tunnel_closed"]
    base = np.array(gold["worlds"][0]["access"]["hexTimeS"])
    assert len(base) == gold["hexCount"] == len(hx["node"])
    assert gold["worlds"][0]["access"]["metrics"]["popAddedS"] == 0
    W = {w["id"]: w for w in gold["worlds"]}
    kb = np.array(W["keybridge_removed"]["access"]["hexTimeS"])
    both = np.array(W["keybridge_and_harbor_tunnel_closed"]["access"]["hexTimeS"])
    ht = np.array(W["harbor_tunnel_closed"]["access"]["hexTimeS"])
    assert np.all(kb >= base - 0.02) and np.all(ht >= base - 0.02)          # closing edges never helps
    assert np.all(both >= kb - 0.02) and np.all(both >= ht - 0.02)
    assert W["keybridge_removed"]["disabledEdges"] == sorted(
        next(l for l in json.loads((SNAP / "graph.meta.json").read_text())["links"] if l["id"] == "L-KEYBRIDGE")["edges"])


def test_golden_matches_scipy_reference(g, hx, gold):
    """Second independent engine (scipy csgraph) on the baseline and bridge-removed worlds."""
    dests = json.loads((SNAP / "destinations.json").read_text())
    fac = json.loads((SNAP / "facilities.json").read_text())
    links = {l["id"]: l["edges"] for l in g.meta["links"]}
    W = {w["id"]: w for w in gold["worlds"]}
    jobs = np.array([d["jobs"] for d in dests], float)
    wk = jobs / jobs.sum()
    for wid, closed in (("baseline", []), ("keybridge_removed", ["L-KEYBRIDGE"])):
        dis = {e for l in closed for e in links[l]}
        keep = np.array([i not in dis and not (g.edgeFlags[i] & F["CANDIDATE"]) for i in range(g.e)])
        df = pd.DataFrame({"u": g.edgeFrom[keep], "v": g.edgeTo[keep], "t": g.edgeTimeS[keep].astype(np.float64)})
        df = df.groupby(["u", "v"], as_index=False).t.min()
        A = csr_matrix((df.t.values, (df.u.values, df.v.values)), shape=(g.n, g.n))
        srcs = sorted({f["node"] for f in fac if f["active"] and f["kind"] in ("fire_station", "ems_station")})
        d = dijkstra(A, directed=True, indices=srcs, min_only=True)
        ems = config.CALL_TO_WHEELS_S + d[hx["node"]] + hx["snapS"]
        ref_e = np.array([np.nan if x is None else x for x in W[wid]["ems"]["hexTimeS"]], float)
        assert np.nanmax(np.abs(ems - ref_e)) < 0.02
        AT = A.T.tocsr()
        acc = np.zeros(len(hx["node"]))
        for w_, dst in zip(wk, dests):
            dd = dijkstra(AT, directed=True, indices=dst["node"])
            acc += w_ * np.minimum(dd[hx["node"]], config.ACCESS_CAP_S)
        acc = np.minimum(config.ACCESS_CAP_S, acc + hx["snapS"])
        assert np.max(np.abs(acc - np.array(W[wid]["access"]["hexTimeS"]))) < 0.02


def test_golden_reproducible(gold):
    """Recompute from the committed artifacts: byte-identical to the committed golden.json."""
    text = golden.dumps(golden.compute(verbose=False))
    committed = (SNAP / "golden.json").read_text()
    assert hashlib.sha256(text.encode()).hexdigest() == hashlib.sha256(committed.encode()).hexdigest()


# ---------------------------------------------------------------------------- manifest / hygiene
def test_manifest_hashes_match():
    man = json.loads((SNAP / "manifest.json").read_text())
    for name, f in man["files"].items():
        p = SNAP / name
        assert p.exists(), name
        assert hashlib.sha256(p.read_bytes()).hexdigest() == f["sha256"], name
        assert p.stat().st_size == f["bytes"]
    on_disk = {p.name for p in SNAP.iterdir() if p.is_file()} - {"manifest.json"}
    # hand-written docs (LICENSE.md) may be hashed or not, but every generated artifact must be listed
    assert {n for n in on_disk if n.endswith((".json", ".bin", ".geojson"))} <= set(man["files"])
    assert man["totalBytes"] < 10_000_000


def test_no_contributor_metadata_in_snapshot():
    for p in SNAP.glob("*.json*"):
        text = p.read_text()
        for bad in ('"uid"', '"changeset"', '"user"'):
            assert bad not in text, (p.name, bad)


def test_speed_parser():
    from worldseed_pipeline.build_graph import parse_speed_mps
    assert parse_speed_mps("55 mph") == pytest.approx(55 * 0.44704)
    assert parse_speed_mps("50") == pytest.approx(50 / 3.6)
    assert parse_speed_mps("signals") is None and parse_speed_mps(None) is None


def test_weighted_quantile_definition():
    v = np.array([3.0, 1.0, 2.0, 10.0])
    w = np.array([1.0, 1.0, 1.0, 1.0])
    assert golden.wquantile(v, w, 0.5) == 2.0     # cum weights 1,2,3,4 over sorted 1,2,3,10; 0.5*4 = 2 -> 2.0
    assert golden.wquantile(v, w, 0.9) == 10.0
    assert golden.wquantile(v, np.zeros(4), 0.5) is None

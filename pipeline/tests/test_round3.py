"""Round 3 invariants: freight/hazmat trips, hazmat class semantics, source of the hazmat rule, residents."""
from __future__ import annotations

import json

import networkx as nx
import numpy as np
import pytest
from scipy.sparse.csgraph import dijkstra

from worldseed_pipeline import build_candidates, build_graph, config, golden, trips as trips_mod, worlds
from worldseed_pipeline.graphio import load_graph
from worldseed_pipeline.worlds import World

SNAP = config.SNAP
F = config.FLAGS
WORLDS4 = trips_mod.TRIP_WORLDS


@pytest.fixture(scope="module")
def g():
    return load_graph()


@pytest.fixture(scope="module")
def tr():
    return json.loads((SNAP / "golden.json").read_text())["trips"]


@pytest.fixture(scope="module")
def links(g):
    return {l["id"]: l["edges"] for l in g.meta["links"]}


def minutes(t, tid, cls, w):
    trip = next(x for x in t["trips"] if x["id"] == tid)
    return trip["results"][cls][w]["timeS"]


def test_trips_schema(tr):
    assert tr["worlds"] == WORLDS4 and set(tr["classes"]) == {"car", "hazmat_truck"}
    assert tr["tolerance"]["timeS"] == 0.5
    assert len(tr["anchors"]) == 7 and len(tr["trips"]) == 32
    ids = [t["id"] for t in tr["trips"]]
    assert len(ids) == len(set(ids))
    kinds = {t["kind"] for t in tr["trips"]}
    assert kinds == {"cross_harbor", "same_shore_control"}
    assert sum(t["kind"] == "cross_harbor" for t in tr["trips"]) == 24
    assert sum(t["kind"] == "same_shore_control" for t in tr["trips"]) == 8
    for t in tr["trips"]:
        assert set(t) >= {"id", "origin", "destination", "kind", "originNode", "destinationNode", "results"}
        for cls in ("car", "hazmat_truck"):
            for w in WORLDS4:
                r = t["results"][cls][w]
                assert set(r) == {"timeS", "minutes", "unreachable", "addedS", "ratio"}
                assert (r["timeS"] is None) == r["unreachable"]
                if r["timeS"] is not None:
                    assert r["minutes"] == pytest.approx(r["timeS"] / 60, abs=0.006)
    # both directions of every pair
    pairs = {(t["origin"], t["destination"]) for t in tr["trips"]}
    assert all((d, o) in pairs for o, d in pairs)


def test_trip_anchors_resolve_and_shores(tr, g):
    hx = golden.load_hexes()
    for a in tr["anchors"]:
        assert int(g.nodeOsmId[a["node"]]) == a["osmNode"]
        i = int(np.argmin((hx["lat"] - a["lat"]) ** 2 + (hx["lng"] - a["lng"]) ** 2))
        if hx["shore"][i] != 2:
            assert hx["shore"][i] == a["shore"], a["id"]


def test_hazmat_class_semantics(tr):
    for t in tr["trips"]:
        for w in WORLDS4:
            c, h = t["results"]["car"][w]["timeS"], t["results"]["hazmat_truck"][w]["timeS"]
            if c is not None and h is not None:
                assert h >= c - 0.02                              # removing edges never helps
        # tunnel closures cannot change a hazmat route: it never used a tunnel
        for a, b in (("baseline", "harbor_tunnel_closed"), ("keybridge_removed", "keybridge_and_harbor_tunnel_closed")):
            assert t["results"]["hazmat_truck"][a]["timeS"] == pytest.approx(t["results"]["hazmat_truck"][b]["timeS"], abs=0.02)
        # closing edges never helps a car either
        car = t["results"]["car"]
        assert car["keybridge_removed"]["timeS"] >= car["baseline"]["timeS"] - 0.02
        assert car["keybridge_and_harbor_tunnel_closed"]["timeS"] >= car["keybridge_removed"]["timeS"] - 0.02


def test_same_shore_controls_do_not_need_the_bridge(tr):
    for t in tr["trips"]:
        if t["kind"] == "same_shore_control":
            for cls in ("car", "hazmat_truck"):
                base = t["results"][cls]["baseline"]["timeS"]
                assert all(t["results"][cls][w]["timeS"] == pytest.approx(base, abs=0.02) for w in WORLDS4)
            assert t["results"]["car"]["baseline"]["timeS"] == pytest.approx(t["results"]["hazmat_truck"]["baseline"]["timeS"], abs=0.02)


def test_bridge_removal_hurts_hazmat_more_than_cars(tr):
    ho, cars = [], []
    for t in tr["trips"]:
        if t["kind"] == "cross_harbor" and t["origin"] in ("TP", "EDG", "HP") and t["destination"] in ("HP", "TP", "EDG", "CB", "GBI"):
            ho.append(t["results"]["hazmat_truck"]["keybridge_removed"]["addedS"])
            cars.append(t["results"]["car"]["keybridge_removed"]["addedS"])
    assert len(ho) >= 8 and np.mean(ho) > np.mean(cars) > 0
    # no trip is unreachable: the western I-695 arc and city streets remain
    assert all(not t["results"][c][w]["unreachable"] for t in tr["trips"] for c in ("car", "hazmat_truck") for w in WORLDS4)


def test_trips_match_networkx_on_sample(tr, g, links):
    kb = frozenset(links["L-KEYBRIDGE"])
    node = {a["id"]: a["node"] for a in tr["anchors"]}
    for tid in ("TP>HP", "DMT>FF", "CB>DMT", "EDG>GBI"):
        o, d = tid.split(">")
        for wid, w in (("baseline", World()), ("keybridge_removed", World(disabled=kb))):
            for cls in ("car", "hazmat_truck"):
                G = worlds.digraph(g, w, cls)
                x = nx.dijkstra_path_length(G, node[o], node[d], weight="weight")
                assert minutes(tr, tid, cls, wid) == pytest.approx(x, abs=0.02), (tid, wid, cls)


def test_hazmat_detour_uses_western_beltway_arc(tr, g, links):
    """Reachability is honest, not an artifact: the hazmat route Tradepoint -> Hawkins Point without the bridge
    crosses the Patapsco on the Beltway west of the harbor."""
    node = {a["id"]: a["node"] for a in tr["anchors"]}
    w = World(disabled=frozenset(links["L-KEYBRIDGE"]))
    A = worlds.matrix(g, w, "hazmat_truck")
    dist, pred = dijkstra(A, directed=True, indices=node["TP"], return_predecessors=True)
    path = [node["HP"]]
    while path[-1] != node["TP"]:
        path.append(int(pred[path[-1]]))
    beltway_west = 0
    beltway = [c["id"] for c in g.meta["corridors"]].index("C-I695")
    for u, v in zip(path[:-1], path[1:]):
        for e in np.nonzero((g.edgeFrom == v) & (g.edgeTo == u))[0]:
            if g.edgeCorridor[e] == beltway and g.nodeLon[u] < -76.62:
                beltway_west += 1
    assert beltway_west > 0
    assert not any(g.edgeFlags[e] & F["HAZMAT_PROHIBITED"] for u, v in zip(path[:-1], path[1:])
                   for e in np.nonzero((g.edgeFrom == v) & (g.edgeTo == u))[0])


def test_hazmat_source_documented():
    a = {x["id"]: x for x in json.loads((SNAP / "assumptions.json").read_text())}
    h = a["A-HAZMAT-TUNNELS"]
    assert h["status"] == "sourced" and "https://mdta.maryland.gov/" in h["source"] and "accessed" in h["source"]
    for k in ("A-TRIPS-DEFINITION", "A-TRIPS-CLASSES", "A-TRIPS-TIME", "A-TRIPS-TOL", "A-SHUTTLE-NO-HAZMAT", "A-HAZMAT-ESCORT-PENALTY"):
        assert k in a


def test_hazmat_allow_class_on_semantics(g, links):
    node_a, node_b = int(g.edgeFrom[links["L-FORTMCHENRY"][0]]), int(g.edgeTo[links["L-FORTMCHENRY"][0]])
    allow = tuple((e, 300.0) for e in links["L-FORTMCHENRY"])
    w0, w1 = World(), World(hazmat_allowed=allow)
    base_h = dijkstra(worlds.matrix(g, w0, "hazmat_truck"), indices=node_a)[node_b]
    win_h = dijkstra(worlds.matrix(g, w1, "hazmat_truck"), indices=node_a)[node_b]
    car0 = dijkstra(worlds.matrix(g, w0), indices=node_a)[node_b]
    car1 = dijkstra(worlds.matrix(g, w1), indices=node_a)[node_b]
    assert car0 == car1                                   # cars are untouched
    assert win_h <= base_h                                # a window never hurts
    e0 = links["L-FORTMCHENRY"][0]
    assert win_h <= float(g.edgeTimeS[e0]) + 300.0 + 1e-3  # and the penalty is applied once per bore edge


def test_residents_derivable_from_hexes_bin():
    """The UI can style populated vs job-only cells from hexes.bin: `pop` is residents, `jobs` is jobs."""
    hx = golden.load_hexes()
    populated = hx["pop"] > 0
    job_only = (hx["pop"] == 0) & (hx["jobs"] > 0)
    assert populated.sum() > 5000 and job_only.sum() > 0
    assert np.all(populated | job_only)

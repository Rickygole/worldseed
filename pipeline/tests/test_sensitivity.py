"""Sanity tests for the sensitivity study engine (pipeline/sensitivity/). Prototype-grade: they check that the study engine
reproduces the committed reference (golden.json) and that the null control behaves. Run: cd pipeline && uv run --python 3.12 pytest -q tests/test_sensitivity.py"""
from __future__ import annotations

import json

import numpy as np
import pytest

from worldseed_pipeline import config
from sensitivity import engine as E


@pytest.fixture(scope="module")
def ctx():
    return E.Ctx()


@pytest.fixture(scope="module")
def states(ctx):
    return E.solve_state(ctx), E.solve_state(ctx, disabled=ctx.kb)


def test_engine_reproduces_golden_keybridge_headline(ctx, states):
    gold = json.loads((config.SNAP / "golden.json").read_text())
    g = next(w for w in gold["xharbor"]["worlds"] if w["id"] == "keybridge_removed")["metrics"]
    ev = E.evaluate(ctx, *states, with_bg=False)
    for k in ("popLossGt10pct", "popLossGt25pct", "lowWageLossGt10pct", "popMeanLossPct", "addedP90S"):
        assert ev["xh"][k] == pytest.approx(g[k], rel=1e-6, abs=1e-6), k
    gr = next(w for w in gold["worlds"] if w["id"] == "keybridge_removed")["access"]["metrics"]["popAddedS"]
    assert ev["reg"]["popMeanAddedS"] == pytest.approx(gr, rel=1e-9)
    assert ev["ems"]["dP50S"] == 0 and ev["ems"]["dP90S"] == 0          # EMS unchanged by the bridge


def test_null_control_remote_dead_end_changes_nothing(ctx, states):
    """A remote residential dead-end that no hex snaps to must change nothing in any lens."""
    g, hx = ctx.g, ctx.hx
    nbr = {}
    for a, b in zip(g.edgeFrom.tolist(), g.edgeTo.tolist()):
        nbr.setdefault(a, set()).add(b); nbr.setdefault(b, set()).add(a)
    deg = np.array([len(nbr.get(i, ())) for i in range(g.n)])
    hexnodes = set(hx["node"].tolist())
    x, y = E.edge_xy(ctx)
    cand = [e for e in range(g.e) if g.edgeClass[e] == 5 and np.hypot(x[e], y[e]) > 12000 and deg[g.edgeTo[e]] == 1 and int(g.edgeTo[e]) not in hexnodes and (g.edgeFlags[e] & config.FLAGS["CANDIDATE"]) == 0]
    assert cand, "expected at least one remote dead-end"
    e = cand[0]
    es = [i for i in range(g.e) if {int(g.edgeFrom[i]), int(g.edgeTo[i])} == {int(g.edgeFrom[e]), int(g.edgeTo[e])} and (g.edgeFlags[i] & config.FLAGS["CANDIDATE"]) == 0]
    st = E.solve_state(ctx, disabled=es)
    d = E.hex_deltas(ctx, states[0], st)
    assert d["xhMaxAddedS"] < 1e-6 and d["regMaxAddedS"] < 1e-6 and d["emsMaxChangeS"] < 1e-6


def test_percentile_rank_definition():
    assert E.pct_rank(np.array([1, 2, 3, 4]), 4) == pytest.approx(87.5)
    assert E.pct_rank(np.array([0, 0, 0, 0]), 0) == pytest.approx(50.0)


def test_top_overlap_and_spearman():
    a = {str(i): float(i) for i in range(30)}
    assert E.top_overlap(a, a) == 10
    r, n = E.spearman(a, a)
    assert r == pytest.approx(1.0) and n == 29                        # the value-0 entry is excluded (ref loss must be > 0)

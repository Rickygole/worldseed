"""World specs (what a set of mutations compiles to) and reference graph builders (scipy CSR, networkx).

A world is: edges disabled, candidate edges enabled, corridor speed factors, extra EMS source nodes. Corridor
factor f > 1 means faster: time / f on every edge of that corridor. Candidate (CANDIDATE-flag) edges are ignored
unless listed in `enabled`. Parallel edges keep the minimum time. This mirrors the compile step of the browser
simulator (edgeEnabled, edgeCostMul, extraSources).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import networkx as nx
import numpy as np
from scipy.sparse import csr_matrix

from . import config
from .graphio import Graph

CAND = config.FLAGS["CANDIDATE"]


@dataclass(frozen=True)
class World:
    id: str = "baseline"
    disabled: frozenset = frozenset()
    enabled: frozenset = frozenset()
    corridor_factor: tuple = ()      # ((corridor index, factor), ...)
    extra_sources: tuple = ()        # (node, ...)

    def key(self) -> str:
        return self.id


def edge_arrays(g: Graph, w: World):
    """(from, to, time float64) of enabled edges, after corridor factors."""
    on = (g.edgeFlags & CAND) == 0
    if w.enabled:
        on = on | np.isin(np.arange(g.e), np.array(sorted(w.enabled), dtype=np.int64))
    if w.disabled:
        on = on & ~np.isin(np.arange(g.e), np.array(sorted(w.disabled), dtype=np.int64))
    t = g.edgeTimeS.astype(np.float64).copy()
    for cidx, f in w.corridor_factor:
        t[g.edgeCorridor == cidx] /= float(f)
    return g.edgeFrom[on].astype(np.int64), g.edgeTo[on].astype(np.int64), t[on]


def _dedupe_min(u, v, t):
    order = np.lexsort((t, v, u))
    u, v, t = u[order], v[order], t[order]
    first = np.ones(len(u), dtype=bool)
    first[1:] = (u[1:] != u[:-1]) | (v[1:] != v[:-1])
    return u[first], v[first], t[first]


def matrix(g: Graph, w: World) -> csr_matrix:
    u, v, t = _dedupe_min(*edge_arrays(g, w))
    return csr_matrix((t, (u, v)), shape=(g.n, g.n))


def digraph(g: Graph, w: World) -> nx.DiGraph:
    u, v, t = _dedupe_min(*edge_arrays(g, w))
    G = nx.DiGraph()
    G.add_nodes_from(range(g.n))
    G.add_weighted_edges_from(zip(u.tolist(), v.tolist(), t.tolist()))
    return G

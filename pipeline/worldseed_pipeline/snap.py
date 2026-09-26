"""Nearest-drivable-node snapping (BallTree, haversine).

Snap targets are nodes with at least one incident edge of a non-motorway, non-link class (an address
cannot enter a freeway at a grade-separated node). Assumption A-SNAP-TARGETS.
"""
from __future__ import annotations

import numpy as np
from sklearn.neighbors import BallTree

from . import config
from .geo import R_EARTH_M
from .graphio import Graph


class SnapIndex:
    def __init__(self, g: Graph):
        cls = {c: i for i, c in enumerate(config.CLASSES)}
        street = np.isin(g.edgeClass, [cls[c] for c in ("trunk", "primary", "secondary", "tertiary", "residential", "service")])
        street &= (g.edgeFlags & config.FLAGS["CANDIDATE"]) == 0
        ok = np.zeros(g.n, dtype=bool)
        ok[g.edgeFrom[street]] = True
        ok[g.edgeTo[street]] = True
        self.nodes = np.nonzero(ok)[0]
        pts = np.radians(np.column_stack([g.nodeLat[self.nodes], g.nodeLon[self.nodes]]).astype(np.float64))
        self.tree = BallTree(pts, metric="haversine")

    def query(self, lat, lon) -> tuple[np.ndarray, np.ndarray]:
        """Returns (node index array, distance metres array)."""
        q = np.radians(np.column_stack([np.atleast_1d(lat), np.atleast_1d(lon)]).astype(np.float64))
        d, i = self.tree.query(q, k=1)
        return self.nodes[i[:, 0]], d[:, 0] * R_EARTH_M

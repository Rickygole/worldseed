"""Weighted-quantile helper shared by golden.py and xharbor.py (kept import-cycle free)."""
from __future__ import annotations

import numpy as np


def wquantile(v: np.ndarray, w: np.ndarray, q: float):
    """First value (sorted by value, then index) whose cumulative weight >= q * total weight; no interpolation.
    Zero total weight or a non-finite result -> None."""
    tot = float(w.sum())
    if tot <= 0:
        return None
    order = np.lexsort((np.arange(len(v)), v))
    cw = np.cumsum(w[order])
    k = int(np.searchsorted(cw, q * tot, side="left"))
    k = min(k, len(v) - 1)
    val = v[order][k]
    return None if not np.isfinite(val) else float(val)

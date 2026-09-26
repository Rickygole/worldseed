"""Small geodesy helpers (spherical earth, metres)."""
from __future__ import annotations

import math

import numpy as np

R_EARTH_M = 6371008.8


def hav_m(lat1, lon1, lat2, lon2):
    """Haversine distance in metres. Works on scalars or numpy arrays."""
    p = np.pi / 180.0
    la1, la2 = np.asarray(lat1) * p, np.asarray(lat2) * p
    dlat, dlon = la2 - la1, (np.asarray(lon2) - np.asarray(lon1)) * p
    a = np.sin(dlat / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin(dlon / 2) ** 2
    return 2 * R_EARTH_M * np.arcsin(np.sqrt(a))


def hav_scalar(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p = math.pi / 180.0
    a = (math.sin((lat2 - lat1) * p / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2)
    return 2 * R_EARTH_M * math.asin(math.sqrt(a))

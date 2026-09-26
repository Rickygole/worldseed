"""`shore` classification: which side of the Patapsco / Baltimore Harbor a hex is on (assumption A-SHORE-RULE).

    0 = north/east shore, 1 = south/west shore, 2 = other/ambiguous.

Rule (documented, deliberately simple and checkable):
  * Baltimore County (24005) hexes  -> 0   (Dundalk, Sparrows Point, Essex, Arbutus, Halethorpe are all on
                                            the north/east bank of the river)
  * Anne Arundel (24003), Howard (24027) -> 1 (south/west bank; the Patapsco is their boundary with
                                            Baltimore County / city)
  * Baltimore city (24510)          -> side of a hand-drawn harbor divider polyline (below): the city has land
                                            on both banks (Locust Point, Canton on the north; Cherry Hill, Brooklyn,
                                            Curtis Bay, Hawkins Point on the south). Cells within 250 m of the
                                            divider are 2 (ambiguous).
Divider points are approximate positions of the main harbor channel/Middle Branch axis, checked in tests
against the known crossings: Key Bridge abutments (SW Hawkins Point south, NE Sollers Point north) and the
Harbor Tunnel portals (Fairfield south, Canton north).
"""
from __future__ import annotations

import numpy as np

# (lon, lat) west -> east; only the Baltimore city part is evaluated
DIVIDER = np.array([
    (-76.80, 39.2545), (-76.6200, 39.2545), (-76.5900, 39.2540), (-76.5710, 39.2544),
    (-76.5500, 39.2330), (-76.5286, 39.2176), (-76.40, 39.1900),
])
AMBIGUOUS_M = 250.0


def divider_lat(lon):
    return np.interp(lon, DIVIDER[:, 0], DIVIDER[:, 1])


def side_of_divider(lat, lon) -> np.ndarray:
    """0 north/east, 1 south/west, 2 within AMBIGUOUS_M of the polyline (approximated by latitude offset)."""
    lat, lon = np.asarray(lat, dtype=float), np.asarray(lon, dtype=float)
    dlat_m = (lat - divider_lat(lon)) * 111_320.0
    out = np.where(dlat_m >= 0, 0, 1).astype(np.uint8)
    out[np.abs(dlat_m) < AMBIGUOUS_M] = 2
    return out


def shore_of(lat, lon, county_fips) -> np.ndarray:
    """county_fips: array of 5-digit county FIPS strings for each hex (primary block group's county)."""
    c = np.asarray(county_fips)
    s = np.full(len(c), 2, dtype=np.uint8)
    s[c == "24005"] = 0
    s[(c == "24003") | (c == "24027")] = 1
    m = c == "24510"
    if m.any():
        s[m] = side_of_divider(np.asarray(lat)[m], np.asarray(lon)[m])
    return s

"""destinations.json: the Access-lens anchors (K <= 8), job-weighted from LODES WAC block points.

Method (assumption A-ACCESS-DESTINATIONS, deterministic):
  1. WAC blocks inside the study bbox with jobs > 0, projected to UTM 18N metres.
  2. Weighted k-means (weights = C000 jobs), K = 8, k-means++ init, n_init=20, random_state=7.
  3. Destination node for a cluster = nearest drivable node (snap rule) to the cluster's job-weighted medoid
     block (the block minimizing sum_j jobs_j * distance(i, j) within the cluster).
  4. jobs = total WAC jobs in the cluster (weight of that destination = jobs / sum of jobs); lowWageJobs = CE01.
  5. name = "<OSM place> employment center": the nearest city/town/suburb/village node within 4 km of the
     medoid, else the nearest place node of any type; ordinal suffix if a name repeats. Labels are derived from
     OSM place names, not curated, and are only labels (no number depends on them).
"""
from __future__ import annotations

import json
import re

import h3
import numpy as np
import pandas as pd
from pyproj import Transformer
from sklearn.cluster import KMeans

from . import config, fetch_census, fetch_osm
from .geo import hav_scalar
from .graphio import load_graph
from .snap import SnapIndex

K = 8
SEED = 7


def slug(s: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", s.upper()).strip("-")


def build() -> list[dict]:
    g = load_graph()
    w, s, e, n = config.BBOX
    wac = pd.read_csv(fetch_census.INTERIM / "lodes_wac_blocks.csv", dtype={"block": str})
    wb = wac[(wac.lat >= s) & (wac.lat <= n) & (wac.lon >= w) & (wac.lon <= e) & (wac.jobs > 0)].sort_values("block").reset_index(drop=True)
    tr = Transformer.from_crs(4326, 32618, always_xy=True)
    x, y = tr.transform(wb.lon.values, wb.lat.values)
    X = np.column_stack([x, y])
    km = KMeans(n_clusters=K, n_init=20, random_state=SEED).fit(X, sample_weight=wb.jobs.values.astype(float))
    lab = km.labels_
    hexmeta = json.loads((config.SNAP / "hexes.meta.json").read_text())
    hex_shore = dict(zip(hexmeta["h3"], np.frombuffer((config.SNAP / "hexes.bin").read_bytes(),
                        dtype="u1", count=hexmeta["buffers"]["shore"]["length"], offset=hexmeta["buffers"]["shore"]["offset"])))
    places = fetch_osm.load_places()
    snap = SnapIndex(g)
    out = []
    for c in range(K):
        idx = np.nonzero(lab == c)[0]
        wj = wb.jobs.values[idx].astype(float)
        P = X[idx]
        # weighted medoid (O(m^2) with m <= a few thousand blocks per cluster; chunked)
        best, bi = None, -1
        for a in range(len(idx)):
            d = np.hypot(P[:, 0] - P[a, 0], P[:, 1] - P[a, 1])
            sc = float((d * wj).sum())
            if best is None or sc < best:
                best, bi = sc, a
        row = wb.iloc[idx[bi]]
        nd, dm = snap.query(row.lat, row.lon)
        # label from the nearest place node
        dists = [hav_scalar(row.lat, row.lon, p["lat"], p["lng"]) for p in places]
        # prefer well-known place types within 4 km, else the nearest place of any type
        major = [i for i, p in enumerate(places) if p["place"] in ("city", "town", "suburb", "village") and dists[i] <= 4000]
        pick = min(major, key=lambda i: dists[i]) if major else int(np.argmin(dists))
        pl = places[pick] if places else None
        out.append({"cluster": c, "name": (pl["name"] + " employment center") if pl else "Employment center",
                    "nameSource": pl["osm"] if pl else None, "nameDistM": round(float(dists[pick]), 0) if pl else None,
                    "node": int(nd[0]), "snapM": round(float(dm[0]), 1), "lat": float(row.lat), "lng": float(row.lon),
                    "jobs": int(wj.sum()), "lowWageJobs": int(wb.lowwage_jobs.values[idx].sum()), "blocks": int(len(idx)),
                    "medoidBlock": row.block,
                    "shore": int(hex_shore.get(h3.latlng_to_cell(row.lat, row.lon, config.H3_RES), 2))})
    # deterministic id/order: by jobs descending, then medoid block
    out.sort(key=lambda d: (-d["jobs"], d["medoidBlock"]))
    seen: dict[str, int] = {}
    res = []
    for d in out:
        base = d["name"]
        seen[base] = seen.get(base, 0) + 1
        if seen[base] > 1:
            d["name"] = f"{base} {seen[base]}"
        d["id"] = f"D-{slug(d['name'])}"
        d.pop("cluster")
        res.append({k: d[k] for k in ("id", "name", "node", "jobs", "shore", "lowWageJobs", "lat", "lng", "snapM",
                                     "blocks", "medoidBlock", "nameSource", "nameDistM")})
    return res


def run() -> list[dict]:
    dest = build()
    (config.SNAP / "destinations.json").write_text(json.dumps(dest, indent=1) + "\n")
    tot = sum(d["jobs"] for d in dest)
    for d in dest:
        print(f"  {d['id']:<44} jobs {d['jobs']:>7,} ({100 * d['jobs'] / tot:4.1f}%) shore {d['shore']} node {d['node']} snap {d['snapM']} m")
    return dest


if __name__ == "__main__":
    run()

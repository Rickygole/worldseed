"""H3 res-9 hexes over land-clipped block groups: area-share apportionment, node snap, shore -> hexes.bin.

  * BG polygons: TIGER/Line cb 500k (already shoreline-clipped => land only), reprojected to UTM 18N (EPSG:32618)
    for areas, clipped to the study bbox for the study-area pieces.
  * cover: every H3 res-9 cell that overlaps a BG (h3 polygon_to_cells_experimental, contain='overlap');
    the exact overlap of (cell, BG) polygons is computed with shapely.
  * pop, zvh, lowWage (RAC CE01 residents) are apportioned by  BG_value * area(cell ∩ BG ∩ bbox) / area(BG).
    (uniform density inside a BG: assumption A-AREA-APPORTION). Population of the part of a BG outside the
    bbox is not modelled.
  * jobs come from LODES WAC blocks placed at the block internal point (finer than BG area share).
  * bg = BG with the largest overlap in the cell (jobs-only cells: BG of the block with the most jobs).
"""
from __future__ import annotations

import json

import geopandas as gpd
import h3
import numpy as np
import pandas as pd
from shapely.geometry import Polygon, box

from . import binio, config, fetch_census
from .graphio import Graph, load_graph
from .shore import shore_of
from .snap import SnapIndex

UTM = 32618
HEX_BUFFERS = [("lat", "f32"), ("lng", "f32"), ("node", "u32"), ("snapS", "f32"), ("pop", "f32"), ("zvh", "f32"),
               ("lowWage", "f32"), ("jobs", "f32"), ("bg", "u16"), ("shore", "u8")]


def _cell_polygon(cell: str) -> Polygon:
    ring = h3.cell_to_boundary(cell)  # ((lat, lng), ...)
    return Polygon([(lng, lat) for lat, lng in ring])


def _cells_overlapping(geom) -> set[str]:
    """H3 cells overlapping a (Multi)Polygon in lon/lat."""
    out: set[str] = set()
    geoms = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    for poly in geoms:
        if poly.is_empty:
            continue
        lp = h3.LatLngPoly([(y, x) for x, y in poly.exterior.coords],
                           *[[(y, x) for x, y in r.coords] for r in poly.interiors])
        out.update(h3.polygon_to_cells_experimental(lp, config.H3_RES, contain="overlap"))
    return out


def load_inputs():
    acs = pd.read_csv(fetch_census.INTERIM / "acs_bg.csv", dtype={"geoid": str, "county": str})
    wac = pd.read_csv(fetch_census.INTERIM / "lodes_wac_blocks.csv", dtype={"block": str})
    rac = pd.read_csv(fetch_census.INTERIM / "lodes_rac_blocks.csv", dtype={"block": str})
    census_meta = json.loads((fetch_census.INTERIM / "census_meta.json").read_text())
    tiger = fetch_census.fetch_tiger_bg()
    return acs, wac, rac, tiger, census_meta


def build(g: Graph) -> dict:
    acs, wac, rac, tiger, census_meta = load_inputs()
    w, s, e, n = config.BBOX
    bbox_ll = box(w, s, e, n)

    # ---- block groups in the study area -------------------------------------------------------
    bg = tiger.merge(acs, left_on="GEOID", right_on="geoid", how="left", validate="1:1")
    missing = bg["pop"].isna()
    assert not missing.any(), f"{int(missing.sum())} TIGER block groups have no ACS row"
    bg["geometry_ll"] = bg.geometry
    bg_utm = bg.set_geometry("geometry_ll").to_crs(UTM)
    bg["area_full"] = bg_utm.geometry.area.values
    bbox_utm = gpd.GeoSeries([bbox_ll], crs=4326).to_crs(UTM).iloc[0]
    bg["geom_utm"] = list(bg_utm.geometry.values)
    bg["clip_utm"] = [gm.intersection(bbox_utm) for gm in bg["geom_utm"]]
    bg["area_in"] = [c.area for c in bg["clip_utm"]]
    bg = bg[bg.area_in > 1.0].sort_values("GEOID").reset_index(drop=True)
    bg["i"] = np.arange(len(bg))
    assert len(bg) < 65535

    # LODES: block -> BG (first 12 digits)
    wac["bg"] = wac.block.str[:12]
    rac["bg"] = rac.block.str[:12]
    rac_bg = rac.groupby("bg")[["residents", "lowwage_workers"]].sum()
    jobs_bg = wac.groupby("bg")[["jobs", "lowwage_jobs"]].sum()
    bg["lowWageWorkers"] = bg.GEOID.map(rac_bg.lowwage_workers).fillna(0.0)
    bg["racResidents"] = bg.GEOID.map(rac_bg.residents).fillna(0.0)
    bg["jobsBg"] = bg.GEOID.map(jobs_bg.jobs).fillna(0.0)

    # ---- cells and exact overlaps -----------------------------------------------------------------
    pieces = []  # (cell, bg index, area m2 in utm)
    for _, row in bg.iterrows():
        clip_ll = gpd.GeoSeries([row.clip_utm], crs=UTM).to_crs(4326).iloc[0]
        cells = sorted(_cells_overlapping(clip_ll))
        if not cells:
            continue
        cg = gpd.GeoSeries([_cell_polygon(c) for c in cells], crs=4326).to_crs(UTM)
        for c, poly in zip(cells, cg.values):
            a = poly.intersection(row.clip_utm).area
            if a > 0.5:
                pieces.append((c, int(row.i), a))
    pc = pd.DataFrame(pieces, columns=["cell", "bg", "area"])
    pc = pc.merge(bg[["i", "area_full", "pop", "households", "zvh", "lowWageWorkers"]], left_on="bg", right_on="i")
    frac = pc.area / pc.area_full
    for col in ("pop", "households", "zvh", "lowWageWorkers"):
        pc[col + "_h"] = pc[col] * frac
    hexes = pc.groupby("cell").agg(pop=("pop_h", "sum"), zvh=("zvh_h", "sum"), lowWage=("lowWageWorkers_h", "sum"),
                                   area=("area", "sum"))
    prim = pc.sort_values(["cell", "area", "bg"], ascending=[True, False, True]).drop_duplicates("cell").set_index("cell").bg

    # ---- jobs from WAC block points -----------------------------------------------------------------
    wb = wac[(wac.lat >= s) & (wac.lat <= n) & (wac.lon >= w) & (wac.lon <= e) & (wac.jobs > 0)].copy()
    wb["cell"] = [h3.latlng_to_cell(la, lo, config.H3_RES) for la, lo in zip(wb.lat, wb.lon)]
    jobs_cell = wb.groupby("cell").jobs.sum()
    hexes["jobs"] = jobs_cell.reindex(hexes.index).fillna(0.0)
    extra = jobs_cell.index.difference(hexes.index)
    if len(extra):
        add = pd.DataFrame({"pop": 0.0, "zvh": 0.0, "lowWage": 0.0, "area": 0.0, "jobs": jobs_cell.loc[extra]})
        hexes = pd.concat([hexes, add])
        bgi = {gid: int(i) for gid, i in zip(bg.GEOID, bg.i)}
        top = wb[wb.cell.isin(extra)].sort_values(["cell", "jobs"], ascending=[True, False]).drop_duplicates("cell")
        for c, blk in zip(top.cell, top.block):
            prim[c] = bgi.get(blk[:12], -1)
    hexes = hexes[(hexes["pop"] > 0) | (hexes["jobs"] > 0)].sort_index()
    hexes["bg"] = prim.reindex(hexes.index).astype(int)
    bad = hexes.bg < 0
    if bad.any():  # jobs-only cell whose block belongs to a BG outside the study set: attach to nearest BG centroid
        raise AssertionError(f"{int(bad.sum())} jobs-only hexes without a block group")

    cells = list(hexes.index)
    ll = np.array([h3.cell_to_latlng(c) for c in cells])
    lat, lng = ll[:, 0], ll[:, 1]
    snap = SnapIndex(g)
    node, dist = snap.query(lat, lng)
    snap_s = dist / (config.SNAP_SPEED_KMH / 3.6)
    bg_county = bg.set_index("i").county.reindex(hexes["bg"].values).values
    shore = shore_of(lat, lng, bg_county)

    arrays = {"lat": lat, "lng": lng, "node": node, "snapS": snap_s, "pop": hexes["pop"].values,
              "zvh": hexes["zvh"].values, "lowWage": hexes["lowWage"].values, "jobs": hexes["jobs"].values,
              "bg": hexes["bg"].values, "shore": shore}
    blob, buffers, total = binio.pack([(k, t, arrays[k]) for k, t in HEX_BUFFERS])
    (config.SNAP / "hexes.bin").write_bytes(blob)
    hex_meta = {"snapshotId": config.SNAPSHOT_ID, "h3Res": config.H3_RES, "count": len(cells),
                "h3": cells, "buffers": buffers, "byteLength": total, "littleEndian": True, "alignment": 8,
                "shore": {"0": "north/east shore of the Patapsco/harbor", "1": "south/west shore", "2": "other/ambiguous (see shore.py)"},
                "units": {"snapS": "seconds (snap distance / 20 km/h)", "pop": "persons", "zvh": "households",
                          "lowWage": "workers (LODES RAC CE01 residents)", "jobs": "LODES WAC C000 jobs"}}
    (config.SNAP / "hexes.meta.json").write_text(json.dumps(hex_meta, indent=1) + "\n")

    # ---- blockgroups.json / .geojson ------------------------------------------------------------------
    hex_by_bg: dict[int, list[int]] = {}
    for hi, b in enumerate(hexes["bg"].values):
        hex_by_bg.setdefault(int(b), []).append(hi)
    cname = config.COUNTIES
    rows = []
    for _, r in bg.iterrows():
        rp = gpd.GeoSeries([r.clip_utm.representative_point()], crs=UTM).to_crs(4326).iloc[0]
        rows.append({"geoid": r.GEOID, "i": int(r.i), "county": cname[config.STATE_FIPS + r.COUNTYFP],
                     "pop": int(round(r["pop"])), "households": int(round(r.households)), "zvh": int(round(r.zvh)),
                     "lowWageWorkers": int(round(r.lowWageWorkers)), "centroid": [round(rp.x, 6), round(rp.y, 6)],
                     "hexes": hex_by_bg.get(int(r.i), []),
                     "areaShareInStudyArea": round(float(r.area_in / r.area_full), 4)})
    (config.SNAP / "blockgroups.json").write_text(json.dumps(rows, separators=(",", ":")) + "\n")
    simp = gpd.GeoSeries(list(bg.clip_utm), crs=UTM).simplify(config.BG_SIMPLIFY_M, preserve_topology=True).to_crs(4326)
    feats = []
    for (_, r), gm in zip(bg.iterrows(), simp.values):
        feats.append({"type": "Feature", "properties": {"i": int(r.i), "geoid": r.GEOID},
                      "geometry": json.loads(json.dumps(gm.__geo_interface__))})
    gj = {"type": "FeatureCollection", "features": feats}
    text = json.dumps(gj, separators=(",", ":"))
    # round coordinates to 6 dp to keep the file small
    import re
    text = re.sub(r"(\d+\.\d{6})\d+", r"\1", text)
    (config.SNAP / "blockgroups.geojson").write_text(text + "\n")

    stats = {
        "blockGroupsInStudyArea": len(bg),
        "hexes": len(cells),
        "hexPop": float(hexes["pop"].sum()), "hexZvh": float(hexes["zvh"].sum()),
        "hexLowWage": float(hexes["lowWage"].sum()), "hexJobs": float(hexes["jobs"].sum()),
        "wacJobsInBbox": float(wb.jobs.sum()),
        "bgPopFullSum": float(bg["pop"].sum()),
        "bgPopExpectedInBbox": float((bg["pop"] * bg.area_in / bg.area_full).sum()),
        "bgHouseholdsExpectedInBbox": float((bg.households * bg.area_in / bg.area_full).sum()),
        "bgZvhExpectedInBbox": float((bg.zvh * bg.area_in / bg.area_full).sum()),
        "bgLowWageExpectedInBbox": float((bg.lowWageWorkers * bg.area_in / bg.area_full).sum()),
        "bgWithoutHexes": int(sum(1 for r in rows if not r["hexes"])),
        "snapMedianM": float(np.median(dist)), "snapMaxM": float(dist.max()),
        "shoreCounts": {int(k): int(v) for k, v in zip(*np.unique(shore, return_counts=True))},
        "jobsOnlyHexes": int(len(extra)),
    }
    # BG-whole totals for BGs whose land-clipped representative point is in the bbox (spike-comparable)
    inside = [r for r in rows if r["areaShareInStudyArea"] >= 0.5]
    stats["bgWholeMajorityInBbox"] = {"n": len(inside), "pop": sum(r["pop"] for r in inside),
                                      "households": sum(r["households"] for r in inside),
                                      "zvh": sum(r["zvh"] for r in inside)}
    return stats


def run() -> dict:
    g = load_graph()
    stats = build(g)
    (config.RAW / "interim" / "hex_stats.json").write_text(json.dumps(stats, indent=1))
    print("hexes:", json.dumps(stats, indent=1))
    return stats


if __name__ == "__main__":
    run()

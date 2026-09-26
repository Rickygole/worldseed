"""ACS block-group tables, TIGER/Line block-group geometry, and LEHD LODES8 (WAC + RAC).

ACS source is pluggable:
  * env CENSUS_API_KEY set  -> official Census Data API (api.census.gov)      [untested here: no key]
  * otherwise               -> Census Reporter API (third-party mirror of official ACS tables)
The official API answered every keyless data query with 302 -> /data/missing_key.html on
2026-09-26 (spike finding), so the keyless path is the one exercised in this build.

Everything downloaded is cached in data/raw/. Normalised tables land in data/raw/interim/.
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import os
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import requests

from . import config, netutil

INTERIM = config.RAW / "interim"

ACS_COLS = ["geoid", "county", "pop", "households", "zvh_owner", "zvh_renter", "zvh",
            "pop_moe", "zvh_moe"]


def _mtime_iso(path: Path) -> str:
    return dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).strftime("%Y-%m-%d")


# ------------------------------------------------------------------------------------------
# ACS
# ------------------------------------------------------------------------------------------
def _acs_census_reporter() -> tuple[pd.DataFrame, dict]:
    """Census Reporter: same B-table cells, no key. ACS 'latest' release (2020-2024 5-year)."""
    rows, release, fetched = [], None, []
    for fips in config.COUNTIES:
        cty = fips[2:]
        name = f"cr_bg_05000US{fips}.json"   # same cache names as the feasibility spike
        url = "https://api.censusreporter.org/1.0/data/show/latest"
        params = {"table_ids": "B01003,B25044", "geo_ids": f"150|05000US{fips}"}
        path = netutil.http_get(url, name, params=params, timeout=180)
        fetched.append(_mtime_iso(path))
        d = json.loads(path.read_text())
        release = d["release"]
        for gid, v in d["data"].items():
            geoid = gid.split("US")[1]
            b1, b2 = v["B01003"]["estimate"], v["B25044"]["estimate"]
            e1, e2 = v["B01003"]["error"], v["B25044"]["error"]
            # Margins of error: square-root-sum-of-squares for the two summed cells (Census guidance)
            zmoe = float(np.sqrt((e2["B25044003"] or 0) ** 2 + (e2["B25044010"] or 0) ** 2))
            rows.append(dict(geoid=geoid, county=config.STATE_FIPS + cty,
                             pop=b1["B01003001"], households=b2["B25044001"],
                             zvh_owner=b2["B25044003"], zvh_renter=b2["B25044010"],
                             pop_moe=e1["B01003001"], zvh_moe=zmoe))
    df = pd.DataFrame(rows)
    meta = {
        "source": "Census Reporter API (api.censusreporter.org), third-party mirror of official ACS",
        "official": False,
        "release": release["name"], "vintage": f"{release['years']} 5-year",
        "tables": ["B01003", "B25044"],
        "fetchedAt": max(fetched),
        "note": "Values are the official B-table cells; the transport is a third-party service.",
    }
    return df, meta


def _acs_official(key: str) -> tuple[pd.DataFrame, dict]:
    """Official Census Data API. Tries the newest ACS 5-year first."""
    get = "B01003_001E,B01003_001M,B25044_001E,B25044_003E,B25044_003M,B25044_010E,B25044_010M"
    last = None
    for year in (2024, 2023, 2022):
        rows, ok = [], True
        for fips in config.COUNTIES:
            cty = fips[2:]
            url = f"https://api.census.gov/data/{year}/acs/acs5"
            params = {"get": get, "for": "block group:*", "in": f"state:{config.STATE_FIPS} county:{cty}",
                      "key": key}
            r = requests.get(url, params=params, headers={"User-Agent": config.HTTP_UA}, timeout=120,
                             allow_redirects=False)
            if r.status_code != 200:
                last, ok = f"{year} {fips}: HTTP {r.status_code}", False
                break
            data = r.json()
            hdr = data[0]
            for rec in data[1:]:
                d = dict(zip(hdr, rec))
                zmoe = float(np.sqrt(float(d["B25044_003M"]) ** 2 + float(d["B25044_010M"]) ** 2))
                rows.append(dict(geoid=d["state"] + d["county"] + d["tract"] + d["block group"],
                                 county=config.STATE_FIPS + cty,
                                 pop=float(d["B01003_001E"]), households=float(d["B25044_001E"]),
                                 zvh_owner=float(d["B25044_003E"]), zvh_renter=float(d["B25044_010E"]),
                                 pop_moe=float(d["B01003_001M"]), zvh_moe=zmoe))
        if ok:
            meta = {"source": "US Census Bureau Data API (api.census.gov)", "official": True,
                    "release": f"acs{year}_5yr", "vintage": f"{year - 4}-{year} 5-year",
                    "tables": ["B01003", "B25044"],
                    "fetchedAt": dt.date.today().isoformat(), "note": "Official API with user key."}
            return pd.DataFrame(rows), meta
    raise RuntimeError(f"official Census API failed: {last}")


def fetch_acs() -> tuple[pd.DataFrame, dict]:
    key = os.environ.get(config.CENSUS_API_KEY_ENV)
    df, meta = _acs_official(key) if key else _acs_census_reporter()
    for c in ("pop", "households", "zvh_owner", "zvh_renter"):
        df[c] = df[c].fillna(0).astype(float)
    df["zvh"] = df.zvh_owner + df.zvh_renter
    df = df[ACS_COLS].sort_values("geoid").reset_index(drop=True)
    return df, meta


# ------------------------------------------------------------------------------------------
# TIGER block groups
# ------------------------------------------------------------------------------------------
def fetch_tiger_bg() -> gpd.GeoDataFrame:
    path = netutil.http_get(config.TIGER_BG_URL, "cb_bg_24.zip", timeout=180)
    g = gpd.read_file(f"zip://{path}")
    g = g[g["COUNTYFP"].isin([c[2:] for c in config.COUNTIES])][["GEOID", "COUNTYFP", "geometry"]]
    g = g.to_crs(4326).sort_values("GEOID").reset_index(drop=True)
    return g


# ------------------------------------------------------------------------------------------
# LODES8
# ------------------------------------------------------------------------------------------
def _lodes_year() -> int:
    for y in config.LODES_YEARS_TRY:
        url = f"{config.LODES_BASE}/wac/md_wac_S000_JT00_{y}.csv.gz"
        try:
            r = requests.head(url, headers={"User-Agent": config.HTTP_UA}, timeout=60)
        except requests.RequestException:
            continue
        if r.status_code == 200:
            return y
    raise RuntimeError("no LODES8 MD year available among " + str(config.LODES_YEARS_TRY))


def fetch_lodes() -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Returns (wac_blocks, rac_blocks, meta). wac_blocks columns: block, jobs, lowwage_jobs, lat, lon.
    rac_blocks: block, residents, lowwage_workers."""
    year = _lodes_year()
    wac_p = netutil.http_get(f"{config.LODES_BASE}/wac/md_wac_S000_JT00_{year}.csv.gz",
                             f"md_wac_S000_JT00_{year}.csv.gz")
    rac_p = netutil.http_get(f"{config.LODES_BASE}/rac/md_rac_S000_JT00_{year}.csv.gz",
                             f"md_rac_S000_JT00_{year}.csv.gz")
    xw_p = netutil.http_get(f"{config.LODES_BASE}/md_xwalk.csv.gz", "md_xwalk.csv.gz")
    wac = pd.read_csv(wac_p, usecols=["w_geocode", "C000", "CE01"], dtype={"w_geocode": str})
    rac = pd.read_csv(rac_p, usecols=["h_geocode", "C000", "CE01"], dtype={"h_geocode": str})
    xw = pd.read_csv(xw_p, usecols=["tabblk2020", "blklatdd", "blklondd"], dtype={"tabblk2020": str})
    wac = wac.rename(columns={"w_geocode": "block", "C000": "jobs", "CE01": "lowwage_jobs"})
    rac = rac.rename(columns={"h_geocode": "block", "C000": "residents", "CE01": "lowwage_workers"})
    xw = xw.rename(columns={"tabblk2020": "block", "blklatdd": "lat", "blklondd": "lon"})
    wac = wac.merge(xw, on="block", how="left")
    rac = rac.merge(xw, on="block", how="left")
    meta = {
        "source": "US Census Bureau LEHD LODES8 (lehd.ces.census.gov), Maryland, JT00 all jobs, S000 all segments",
        "year": year, "tag": f"LODES8 MD {year}",
        "urls": [f"{config.LODES_BASE}/wac/md_wac_S000_JT00_{year}.csv.gz",
                 f"{config.LODES_BASE}/rac/md_rac_S000_JT00_{year}.csv.gz",
                 f"{config.LODES_BASE}/md_xwalk.csv.gz"],
        "fetchedAt": _mtime_iso(wac_p),
        "lowWageDefinition": "CE01 = jobs with earnings <= $1,250 per month (LODES definition)",
        "geography": "2020 Census blocks (LODES8)",
    }
    return wac, rac, meta


# ------------------------------------------------------------------------------------------
def run() -> dict:
    INTERIM.mkdir(parents=True, exist_ok=True)
    acs, acs_meta = fetch_acs()
    acs.to_csv(INTERIM / "acs_bg.csv", index=False)
    wac, rac, lodes_meta = fetch_lodes()
    wac.to_csv(INTERIM / "lodes_wac_blocks.csv", index=False)
    rac.to_csv(INTERIM / "lodes_rac_blocks.csv", index=False)
    tiger = fetch_tiger_bg()
    meta = {"acs": acs_meta, "lodes": lodes_meta,
            "tiger": {"source": config.TIGER_BG_VINTAGE, "url": config.TIGER_BG_URL,
                      "fetchedAt": _mtime_iso(config.RAW / "cb_bg_24.zip"), "bgRows": len(tiger)}}
    (INTERIM / "census_meta.json").write_text(json.dumps(meta, indent=1, sort_keys=True))
    print(f"ACS {acs_meta['vintage']} via {acs_meta['source']}: {len(acs)} BGs, pop {acs['pop'].sum():,.0f}")
    print(f"LODES {lodes_meta['tag']}: WAC blocks {len(wac):,} jobs {wac.jobs.sum():,}; "
          f"RAC blocks {len(rac):,} residents {rac.residents.sum():,}")
    return meta


if __name__ == "__main__":
    run()

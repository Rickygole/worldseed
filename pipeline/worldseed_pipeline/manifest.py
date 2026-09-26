"""manifest.json: sha256 + size of every snapshot artifact, source vintages, fetch dates, pipeline version."""
from __future__ import annotations

import datetime as dt
import json
import zlib

from . import config, fetch_census, netutil

SOURCES_STATIC = [
    {"name": "OpenStreetMap", "license": "ODbL 1.0", "attribution": "(c) OpenStreetMap contributors",
     "url": "https://www.openstreetmap.org/copyright", "use": "road network, facilities, place names (2024-03-01 attic snapshot)"},
    {"name": "Maryland iMAP (State of Maryland open data)", "license": "State of Maryland data disclaimer (to be confirmed by legal review)",
     "attribution": "MD iMAP, DoIT, MCAC, MSFA (fire stations); MD iMAP, DHMH OHCQ (hospitals)",
     "url": "https://mdgeodata.md.gov/imap/rest/services", "use": "fire stations and hospitals (second source)"},
]


def _osm_meta() -> dict:
    tiles = sorted(config.RAW.glob("roads_tile*_of6_2024-03-01.json"))
    base = None
    if tiles:
        base = json.loads(tiles[0].read_text()).get("osm3s", {}).get("timestamp_osm_base")
    dates = sorted({dt.datetime.fromtimestamp(p.stat().st_mtime, dt.timezone.utc).strftime("%Y-%m-%d") for p in tiles})
    return {"osmDate": config.OSM_DATE, "overpassEndpoint": config.OVERPASS_ENDPOINTS[0],
            "tilesFetchedOn": dates, "overpassServerTimestamp": base,
            "method": "Overpass API attic query [date:\"2024-03-01T00:00:00Z\"], 3x2 tiles, plain HTTP, cached"}


def run() -> dict:
    files = {}
    for p in sorted(config.SNAP.iterdir()):
        if p.name in ("manifest.json",) or not p.is_file():
            continue
        raw = p.read_bytes()
        files[p.name] = {"sha256": netutil.sha256_file(p), "bytes": len(raw), "gzipBytes": len(zlib.compress(raw, 9))}
    cm = json.loads((fetch_census.INTERIM / "census_meta.json").read_text())
    acs, lodes = cm["acs"], cm["lodes"]
    sources = list(SOURCES_STATIC) + [
        {"name": "US Census Bureau ACS 5-Year Estimates", "vintage": acs["vintage"], "release": acs["release"],
         "tables": acs["tables"], "fetchedAt": acs["fetchedAt"], "transport": acs["source"], "officialApi": acs["official"],
         "license": "US Government work (public domain); third-party mirror terms to be confirmed by legal review",
         "attribution": "U.S. Census Bureau, American Community Survey 5-Year Estimates"},
        {"name": "US Census Bureau TIGER/Line Cartographic Boundary Files", "vintage": cm["tiger"]["source"],
         "url": cm["tiger"]["url"], "fetchedAt": cm["tiger"]["fetchedAt"], "license": "US Government work (public domain)",
         "attribution": "U.S. Census Bureau, TIGER/Line cartographic boundary files"},
        {"name": "US Census Bureau LEHD LODES8", "vintage": lodes["tag"], "urls": lodes["urls"], "fetchedAt": lodes["fetchedAt"],
         "license": "US Government work (public domain)",
         "attribution": "U.S. Census Bureau, LEHD Origin-Destination Employment Statistics (LODES) 8"},
    ]
    man = {
        "snapshotId": config.SNAPSHOT_ID, "pipelineVersion": config.PIPELINE_VERSION,
        "builtAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "osmDate": config.OSM_DATE, "acsVintage": acs["vintage"], "lodes": lodes["tag"],
        "bbox": list(config.BBOX), "h3Res": config.H3_RES,
        "osm": _osm_meta(), "files": files, "sources": sources,
        "totalBytes": sum(f["bytes"] for f in files.values()),
        "notes": ["Artifact hashes are deterministic for fixed cached inputs; builtAt is the only wall-clock field.",
                  "The acsVintage differs from the architecture example (2018-2022): the latest ACS 5-year available "
                  "through the keyless Census Reporter API was used."],
    }
    (config.SNAP / "manifest.json").write_text(json.dumps(man, indent=1) + "\n")
    print(f"manifest.json: {len(files)} files, {man['totalBytes'] / 1e6:.2f} MB total")
    return man


if __name__ == "__main__":
    run()

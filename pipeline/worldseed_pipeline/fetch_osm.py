"""Attic-date Overpass fetch: drivable roads + emergency facilities, cached in data/raw/.

Plain requests, not osmnx: the spike proved this works and it gives us raw way geometry and tags
(needed for the explicit Key Bridge way-ID check) without osmnx' simplification step.
"""
from __future__ import annotations

import json
import time

from . import config, netutil

FAC_FILE = "facilities_bbox_v1_2024-03-01.json"
TILES_LON, TILES_LAT = 3, 2   # the full-bbox query 504s on the public instance; tiles are cached individually


def _bbox_str() -> str:
    return ",".join(str(x) for x in config.OVERPASS_BBOX_SWNE)


def tiles() -> list[tuple[float, float, float, float]]:
    """Tile bboxes as (S, W, N, E), row-major, exact partition of the study bbox."""
    w, s, e, n = config.BBOX
    out = []
    for j in range(TILES_LAT):
        for i in range(TILES_LON):
            out.append((round(s + (n - s) * j / TILES_LAT, 6), round(w + (e - w) * i / TILES_LON, 6),
                        round(s + (n - s) * (j + 1) / TILES_LAT, 6), round(w + (e - w) * (i + 1) / TILES_LON, 6)))
    return out


def roads_query(tile: tuple[float, float, float, float]) -> str:
    b = ",".join(str(x) for x in tile)
    return (f'[out:json][timeout:300][date:"{config.OSM_DATE}"];\n'
            f'way["highway"~"^({config.HIGHWAY_CLASSES})$"]["access"!~"^(private|no)$"]'
            f'["motor_vehicle"!~"^(no|private)$"]({b});\nout body geom;')


def facilities_query() -> str:
    b = _bbox_str()
    return (f'[out:json][timeout:180][date:"{config.OSM_DATE}"];\n'
            f'(nwr["amenity"="hospital"]({b});\nnwr["amenity"="fire_station"]({b});\n'
            f'nwr["emergency"="ambulance_station"]({b});\nnwr["amenity"="ambulance_station"]({b}););\n'
            f'out center tags;')


PLACES_FILE = "places_bbox_v1_2024-03-01.json"


def places_query() -> str:
    b = _bbox_str()
    return (f'[out:json][timeout:120][date:"{config.OSM_DATE}"];\n'
            f'node["place"~"^(suburb|neighbourhood|quarter|town|village|hamlet|city|locality|island)$"]["name"]({b});\n'
            f'out body;')


def load_places() -> list[dict]:
    """Named place nodes (used only to label Access-lens destinations and, later, the gazetteer)."""
    js = netutil.overpass(places_query(), PLACES_FILE)
    return [{"name": e["tags"]["name"], "place": e["tags"]["place"], "lat": e["lat"], "lng": e["lon"], "osm": f"node/{e['id']}"}
            for e in js["elements"] if e["type"] == "node"]


def load_roads() -> list[dict]:
    """All drivable ways in the bbox at OSM_DATE, deduped by way id across tiles (sequential queries)."""
    seen: dict[int, dict] = {}
    for k, tile in enumerate(tiles()):
        name = f"roads_tile{k}_of{TILES_LON * TILES_LAT}_2024-03-01.json"
        cached = (config.RAW / name).exists()
        js = netutil.overpass(roads_query(tile), name)
        for e in js["elements"]:
            if e["type"] == "way":
                seen[e["id"]] = e
        if not cached:
            time.sleep(5)  # polite spacing between live queries
    return [seen[k] for k in sorted(seen)]


def load_facilities_raw() -> list[dict]:
    js = netutil.overpass(facilities_query(), FAC_FILE)
    return js["elements"]


def main() -> None:
    t = time.time()
    ways = load_roads()
    print(f"roads: {len(ways)} ways ({time.time() - t:.1f}s)")
    time.sleep(3)
    fac = load_facilities_raw()
    print(f"facilities raw: {len(fac)} elements")
    time.sleep(3)
    print(f"places: {len(load_places())} named place nodes")


if __name__ == "__main__":
    main()

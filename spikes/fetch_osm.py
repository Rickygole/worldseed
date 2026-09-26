"""Fetch pre-collapse (2024-03-01) OSM drivable network + facilities for the Key Bridge region.
Cached to data/raw/. Re-running is free once cached."""
import overpass
BBOX = (39.19, -76.62, 39.34, -76.42)   # S, W, N, E
DATE = "2024-03-01T00:00:00Z"
b = ",".join(map(str, BBOX))
HW = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street"

roads = f'''[out:json][timeout:300][date:"{DATE}"];
way["highway"~"^({HW})$"]["access"!~"^(private|no)$"]["motor_vehicle"!~"^(no|private)$"]({b});
out body geom;'''
fac = f'''[out:json][timeout:120][date:"{DATE}"];
(nwr["amenity"="hospital"]({b});
 nwr["amenity"="fire_station"]({b});
 nwr["emergency"="ambulance_station"]({b}););
out center tags;'''
# present-day I-695 ways near the bridge, used only to diff which edges vanished
cur = f'''[out:json][timeout:60];
way["highway"]["name"~"Beltway",i](39.205,-76.55,39.235,-76.50);
out body geom;'''

if __name__ == "__main__":
    import time
    for q, n in [(roads, "roads_2024-03-01.json"), (fac, "facilities_2024-03-01.json"), (cur, "i695_current.json")]:
        t = time.time(); js = overpass.query(q, n)
        print(n, len(js["elements"]), "elements", round(time.time() - t, 1), "s")
        time.sleep(5)

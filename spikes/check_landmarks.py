"""List Key Bridge ways, Fort McHenry Tunnel (I-95) and Harbor Tunnel (I-895) ways from the cached 2024 snapshot."""
import json
ways = [e for e in json.load(open("/Users/rickygole/worldseed/data/raw/roads_2024-03-01.json"))["elements"] if e["type"] == "way"]
def show(title, pred, box=None):
    print("==", title)
    rows = [w for w in ways if pred(w["tags"]) and (box is None or (box[0] <= w["geometry"][0]["lat"] <= box[1] and box[2] <= w["geometry"][0]["lon"] <= box[3]))]
    for w in rows:
        t = w["tags"]; g = w["geometry"]
        print(f'  way {w["id"]:>11} {t.get("name","")!r:32} ref={t.get("ref")} hw={t["highway"]} bridge={t.get("bridge")} tunnel={t.get("tunnel")} oneway={t.get("oneway")} maxspeed={t.get("maxspeed")} '
              f'{g[0]["lat"]:.4f},{g[0]["lon"]:.4f}->{g[-1]["lat"]:.4f},{g[-1]["lon"]:.4f}')
    print("  count:", len(rows))
show("I-695 bridge=yes/viaduct ways", lambda t: "695" in (t.get("ref") or "") and t.get("bridge") in ("yes", "viaduct"), box=(39.205, 39.235, -76.55, -76.50))
show("Tunnels on I-95 / I-895", lambda t: t.get("tunnel") in ("yes", "building_passage") and any(k in (t.get("ref") or "") for k in ("95", "895")))
show("Any way named Tunnel/McHenry", lambda t: "unnel" in (t.get("name") or "") or "McHenry" in (t.get("name") or "") or t.get("tunnel") == "yes" and t["highway"] in ("motorway","trunk"))

"""Join ACS block-group tables (via Census Reporter) to cartographic-boundary geometry; keep BGs whose centroid is in the bbox."""
import json, sys
import numpy as np, pandas as pd, geopandas as gpd
RAW = "/Users/rickygole/worldseed/data/raw"; OUT = "/Users/rickygole/worldseed/spikes/out"
BBOX = (39.19, -76.62, 39.34, -76.42)
rows = []; release = None
for c in ("24510", "24005", "24003"):
    d = json.load(open(f"{RAW}/cr_bg_05000US{c}.json")); release = d["release"]["name"]
    n = 0
    for gid, v in d["data"].items():
        b1, b2 = v["B01003"]["estimate"], v["B25044"]["estimate"]
        rows.append(dict(geoid=gid.split("US")[1], county=c, pop=b1["B01003001"], hh=b2["B25044001"],
                         nov_own=b2["B25044003"], nov_rent=b2["B25044010"])); n += 1
    print("county", c, "block groups:", n)
df = pd.DataFrame(rows); df["novehicle_hh"] = df.nov_own + df.nov_rent
gdf = gpd.read_file(f"zip://{RAW}/cb_bg_24.zip")
print("TIGER cartographic BG rows (MD):", len(gdf), "| CRS", gdf.crs)
g = gdf[["GEOID", "geometry"]].merge(df, left_on="GEOID", right_on="geoid", how="inner")
cen = g.to_crs(26918).geometry.centroid.to_crs(4326)
g["lat"], g["lon"] = cen.y, cen.x
g = g[(g.lat >= BBOX[0]) & (g.lat <= BBOX[2]) & (g.lon >= BBOX[1]) & (g.lon <= BBOX[3])]
print("release:", release, "| joined rows (3 counties):", len(df), "| BGs with centroid in bbox:", len(g))
print("pop in bbox BGs:", int(g["pop"].sum()), "| households:", int(g.hh.sum()), "| no-vehicle hh:", int(g.novehicle_hh.sum()),
      f"({100*g.novehicle_hh.sum()/g.hh.sum():.1f}%)")
print("null pop:", int(g["pop"].isna().sum()), "| pop==0 BGs:", int((g["pop"] == 0).sum()))
g[["geoid", "county", "lat", "lon", "pop", "hh", "novehicle_hh"]].to_csv(f"{OUT}/bg_pop.csv", index=False)

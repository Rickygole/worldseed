#!/bin/sh
# Census Data API (api.census.gov) 302-redirects EVERY data query to /data/missing_key.html without a key
# (metadata endpoints like /variables/*.json still work). Free workaround used here: Census Reporter's public
# API, which serves the same ACS tables (release 'acs2024_5yr', 2020-2024) with no key. Geometry: TIGER/Line
# cartographic boundary block groups.
set -e
RAW=/Users/rickygole/worldseed/data/raw
mkdir -p $RAW
for c in 24510 24005 24003; do   # Baltimore City, Baltimore County, Anne Arundel
  [ -s $RAW/cr_bg_05000US$c.json ] || { curl -s -f -m 120 -o $RAW/cr_bg_05000US$c.json "https://api.censusreporter.org/1.0/data/show/latest?table_ids=B01003,B25044&geo_ids=150|05000US$c"; sleep 2; }
done
[ -s $RAW/cb_bg_24.zip ] || curl -s -f -m 120 -o $RAW/cb_bg_24.zip "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_24_bg_500k.zip"
ls -la $RAW

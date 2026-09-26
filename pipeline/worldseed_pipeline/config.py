"""Single source of truth for pipeline constants.

Every value here is either a fixed identifier (dates, FIPS codes) or a design choice that is
documented in pipeline/assumptions.yaml. Nothing in here is a measured statistic.
"""
from __future__ import annotations

from pathlib import Path

PIPELINE_VERSION = "1.0.0"
SNAPSHOT_ID = "keybridge-2024-03-01-v1"

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "data" / "raw"          # gitignored downloads
SNAP = REPO / "data" / "snapshot"    # committed artifacts
PIPELINE_DIR = REPO / "pipeline"
ASSUMPTIONS_YAML = PIPELINE_DIR / "assumptions.yaml"

# --- Study area -------------------------------------------------------------------------
# (west, south, east, north), WGS84. Started from W-76.80 S39.10 E-76.40 N39.34 (task brief);
# West edge -76.80 keeps the western I-695 arc (the real Key Bridge detour) in the graph and the
# south edge 39.10 pulls in northern Anne Arundel (Glen Burnie, Pasadena, Curtis Bay).
BBOX = (-76.80, 39.10, -76.40, 39.34)
OVERPASS_BBOX_SWNE = (BBOX[1], BBOX[0], BBOX[3], BBOX[2])  # Overpass order: S,W,N,E

# Attic date: last full snapshot before the 2024-03-26 collapse.
OSM_DATE = "2024-03-01T00:00:00Z"

# state FIPS 24 = Maryland.  Counties whose block groups intersect the bbox (plan: 24510, 24005, 24003; plus Howard).
STATE_FIPS = "24"
# 24027 Howard County is needed because the widened west edge (-76.80) takes in Elkridge/Jessup.
COUNTIES = {"24510": "Baltimore city", "24005": "Baltimore County", "24003": "Anne Arundel County",
            "24027": "Howard County"}

H3_RES = 9

# --- Overpass ---------------------------------------------------------------------------
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
HTTP_UA = "worldseed-pipeline/0.1 (github.com/Rickygole/worldseed)"

# Same highway filter as the spike (service excluded, private/no access excluded).
HIGHWAY_CLASSES = ("motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|"
                   "secondary_link|tertiary|tertiary_link|unclassified|residential|living_street")

# --- Key Bridge (L-KEYBRIDGE) -----------------------------------------------------------
# Explicit way-ID removal set, verified against the 2024-03-01 snapshot in the spike. fix_keybridge
# re-verifies these against fetched data (tags, geometry) and asserts.
KEYBRIDGE_WAY_IDS = (24555622, 1026914410, 1026914409, 1026914408, 1026914407, 24555626)
KEYBRIDGE_CENTER = (39.2176, -76.5286)   # lat, lon (plan section 1.7 step 8)
KEYBRIDGE_RADIUS_M = 3000.0

# Tunnels: way IDs found by the spike (I-95 Fort McHenry, I-895 Harbor Tunnel), re-verified by tags.
FORT_MCHENRY_WAY_IDS = (23014443, 23014446, 49666850, 49776148)
HARBOR_TUNNEL_WAY_IDS = (23891388, 158620176, 49666528, 158620174, 23891345, 49666525)

# --- Facilities -------------------------------------------------------------------------
# Excluded by name (case-insensitive substring): not first-due response units.
FACILITY_EXCLUDE_NAME_SUBSTR = ("fire academy", "fire boat", "fireboat", "training academy", "training center")
# Hospitals kept as ED hospitals only if emergency=yes in OSM.
FACILITY_DEDUPE_M = 60.0   # same-kind facilities closer than this are one facility

# --- Speeds (assumption A-SPEED-DEFAULTS) -----------------------------------------------
DEFAULT_MPH = {"motorway": 55, "motorway_link": 35, "trunk": 45, "trunk_link": 30,
               "primary": 35, "primary_link": 25, "secondary": 30, "secondary_link": 25,
               "tertiary": 25, "tertiary_link": 20, "unclassified": 25, "residential": 25,
               "living_street": 10}
MPH_TO_MPS = 0.44704

# Contract section 2.2 classes (index = class id).
CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "service", "link", "candidate"]
HIGHWAY_TO_CLASS = {
    "motorway": "motorway", "trunk": "trunk", "primary": "primary", "secondary": "secondary",
    "tertiary": "tertiary", "unclassified": "tertiary", "residential": "residential",
    "living_street": "residential", "service": "service",
    "motorway_link": "link", "trunk_link": "link", "primary_link": "link",
    "secondary_link": "link", "tertiary_link": "link",
}
# Corridors (an edge belongs to at most one corridor, first match wins). Match keys: way_ids, ref_re
# (regex on the OSM ref tag), name_re (regex on the OSM name tag). Tagging is by OSM ref/name so it is
# reproducible; the candidate catalog (later task) references these ids.
CORRIDORS = [
    {"id": "C-I895-TUNNEL", "name": "Harbor Tunnel (I-895)", "way_ids": HARBOR_TUNNEL_WAY_IDS},
    {"id": "C-I95-TUNNEL", "name": "Fort McHenry Tunnel (I-95)", "way_ids": FORT_MCHENRY_WAY_IDS},
    {"id": "C-I695", "name": "Baltimore Beltway (I-695)", "ref_re": r"(^|;|\s)I[ -]?695($|;|\s)"},
    {"id": "C-I95", "name": "I-95", "ref_re": r"(^|;|\s)I[ -]?95($|;|\s)"},
    {"id": "C-I895", "name": "I-895", "ref_re": r"(^|;|\s)I[ -]?895($|;|\s)"},
    {"id": "C-I97", "name": "I-97", "ref_re": r"(^|;|\s)I[ -]?97($|;|\s)"},
    {"id": "C-BROENING", "name": "Broening Highway", "name_re": r"^Broening (Highway|Hwy)"},
    {"id": "C-HANOVER", "name": "Hanover Street", "name_re": r"^(South |North |S\.? |N\.? )?Hanover (Street|St)\b"},
]
FLAGS = {"TUNNEL": 1, "BRIDGE": 2, "HAZMAT_PROHIBITED": 4, "TOLL": 8, "CANDIDATE": 16, "KEYBRIDGE": 32}
NO_CORRIDOR = 0xFFFF

# --- Census / LODES ---------------------------------------------------------------------
CENSUS_API_KEY_ENV = "CENSUS_API_KEY"
ACS_TABLES = ("B01003", "B25044", "B11001")
TIGER_BG_URL = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_24_bg_500k.zip"
TIGER_BG_VINTAGE = "TIGER/Line cartographic boundary 2023 (GENZ2023) 1:500k"
# TIGER cb 500k is already generalized; we additionally simplify for shipping (metres).
BG_SIMPLIFY_M = 10.0
# LODES8: try newest first; fall back stepwise. Year actually used is recorded in the manifest.
LODES_YEARS_TRY = (2023, 2022, 2021)
LODES_BASE = "https://lehd.ces.census.gov/data/lodes/LODES8/md"
# LODES block-level file joined to block groups via the first 12 digits of the 15 digit block GEOID.

# Land clip: TIGER cb files are already clipped to shoreline (cartographic boundary). ok.

# --- Access lens / EMS lens (documented in assumptions.yaml) ----------------------------
CALL_TO_WHEELS_S = 60.0   # call-processing and turnout delay (assumption A-CALL-TO-WHEELS)
EMS_THRESHOLD_S = 480.0
ACCESS_CAP_S = 7200.0            # 120 min cap
SNAP_SPEED_KMH = 20.0

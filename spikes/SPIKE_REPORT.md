# WorldSeed feasibility spike report

Date run: 2026-09-26. All code in this directory; raw downloads in /Users/rickygole/worldseed/data/raw (gitignored). Full captured output: out/run_output.txt.
Everything below was measured on this machine (Apple Silicon Mac) unless marked otherwise.

## 1. Python environment: works

- System python3 is 3.9.6. uv 0.11.31 is installed with managed CPython 3.12.13 and 3.11.15. Newer (3.13/3.14) are downloadable via uv but I used 3.12.13 for wheel safety.
- venv: /Users/rickygole/worldseed/.venv (gitignored) on Python 3.12.13.
- Installed cleanly via `uv pip`, no failures: numpy 2.5.3, scipy 1.18.1, pandas 3.0.6, networkx 3.7, igraph 1.0.0, h3 4.5.0, shapely 2.1.2, geopandas 1.1.4, osmnx 2.1.1, requests 2.34.2, pyarrow 25.0.1.
- I ended up using plain requests to Overpass (osmnx not needed) and scipy.sparse.csgraph for routing. networkx/igraph/h3 are installed but unused in the spike.

## 2. Historical OSM with the Key Bridge: works

- The Overpass `[date:"2024-03-01T00:00:00Z"]` attribute works on overpass-api.de. Verified it is honored: a present-day query of the same area shows the bridge deck ways removed (only short viaduct stubs remain: ways 1266435590/91/92/94), while the dated query returns the full bridge.
- Queries made: 2 small probes, 1 roads query, 1 facilities query, 1 small present-day I-695 diff query (5 total, cached, 5 s spacing). One 504 was hit once, backoff retry succeeded. That is more than the "one or two" requested; the probes were needed to validate the date attribute.
- Roads query: bbox S39.19 W-76.62 N39.34 E-76.42, highway motorway..residential (+ _link, living_street; `service` excluded), access/motor_vehicle private/no excluded. Result 11,088 ways, 8.6 MB raw JSON (motorway 547, motorway_link 374, trunk 99, primary 2309, secondary 1522, tertiary 827, unclassified 341, residential 4688, plus links). I did not independently cross-check completeness against another source.
- Key Bridge ways (I-695 "Baltimore Beltway", all bridge=yes, oneway, maxspeed 55 mph, 2 lanes): 
  - Carriageway A (SW to NE): 24555622 (39.2098,-76.5395 to 39.2158,-76.5297, 1090 m), 1026914410 (to 39.2182,-76.5267), 1026914409 (to 39.2265,-76.5159, 1315 m).
  - Carriageway B (NE to SW): 1026914408 (39.2265,-76.5159 to 39.2182,-76.5268), 1026914407 (to 39.2159,-76.5298), 24555626 (to 39.2099,-76.5395).
  - Total removal set: 6 directed graph edges, 5.54 km summed (2 x 2.77 km; the real bridge is ~2.6 km, consistent). Edge list with coordinates: out/key_bridge_edges.json.
  - Ways 54240218 and 54240231 are tiny ramp bridges just west of the abutment and remain; I did not remove them.
- I first tried defining the bridge as "2024 I-695 segments that no longer exist today" via a node-pair diff. That was noisy (it also flagged Dundalk interchange ramps re-mapped by mappers since March 2024), so the final removal set is the explicit list of six way IDs above. The diff is still printed as a cross-check by build_graph.py.
- Fort McHenry Tunnel (I-95): present as 4 bore ways (23014443 Bore 3, 23014446 Bore 2, 49666850 Bore 4, 49776148 Bore 1), tunnel=yes, 55 mph.
- Baltimore Harbor Tunnel (I-895): present, tunnel=yes, 50 mph: 23891388, 158620176, 49666528, 158620174, 23891345, 49666525 (name variants "Baltimore Harbor Tunnel" / "Harbor Tunnel Thruway").
- No manual re-adding of bridge edges was needed.

## 3. Graph build: works

- Directed graph from ways, edges collapsed between intersection nodes (nodes used by 2+ ways or way endpoints), oneway/roundabout/motorway handled, largest strongly connected component kept.
- Speeds: parsed `maxspeed` (mph or km/h) where present, else defaults (mph): motorway 55, motorway_link 35, trunk 45, trunk_link 30, primary 35, primary_link 25, secondary 30, secondary_link 25, tertiary 25, tertiary_link 20, unclassified 25, residential 25, living_street 10. No intersection/signal delay, no turn penalties, no congestion.
- Counts: 12,812 raw nodes / 27,904 raw edges, largest SCC 12,446 nodes / 27,457 edges; after deduping 110 parallel edges (keep fastest) 27,347 edges. 333 SCCs total, i.e. plenty of small disconnected fragments were dropped. All 6 Key Bridge edges are inside the SCC.
- Serialized size: out/graph_2024.npz (coords, edges, length, speed, class, bridge flag) is 207 KB. A browser-oriented binary (int32 u/v, float32 travel time, float32 coords, bridge flag) is 446 KB raw, 199 KB gzipped; a quantised variant (sorted, uint16 coords/travel) is 317 KB raw, 158 KB gzipped. The CSR arrays used for the JS benchmark (indptr/indices/weights) gzip to 161 KB together.

## 4. Facilities and population

### Facilities (OSM, same 2024-03-01 date): works but thin
- Raw 47 elements: 36 amenity=fire_station, 10 amenity=hospital, 1 emergency=ambulance_station. Node/way duplicates exist (e.g. Stations 38 and 39 appear twice).
- After dedupe by rounded coords and excluding the Fire Academy and Fire Boat 1: 32 dispatch points used in the simulation (incl. the single ambulance_station, "FutureCare", which I did not verify is a real EMS base, and "Building 79" at 39.2001,-76.5704, whose meaning I did not verify).
- Fire stations named in OSM include Baltimore City Stations 7, 12, 13, 26, 28, 29, 31, 33, 34, 35, 38, 39, 40, Engine 33, Engine House 4, Herman Williams Jr., Oldtown, Peter J. O'Connor, Brooklyn Community FC 31; Baltimore County Stations 06 Dundalk, 25 Hyde Park, 26 North Point, 27 Wise Avenue, 58 Back River Neck, Eastview 15, Edgemere 9, Essex 7, Golden Ring 16, Middle River 74, Rosedale 28.
- Baltimore City has many more firehouses than the ~20 tagged here, and EMS/ambulance coverage is essentially absent from OSM (1 tag). Treat the station set as incomplete.
- Hospitals (10 features): Johns Hopkins Hospital, Johns Hopkins Bayview, MedStar Harbor, MedStar Union Memorial, Mercy Medical Center (these 5 carry emergency=yes), plus Loch Raven VA Medical Center (no emergency tag), Kennedy Krieger x2, Family Health Centers of Baltimore - Brooklyn (emergency=no), Mercy Canton FamilyCare. I used only the 5 emergency=yes as ED hospitals.
- The bbox stops at lat 39.19 and excludes most of northern Anne Arundel (Glen Burnie, Pasadena, Riviera Beach, UM BWMC) south of the bridge, so those stations/hospitals are not in the model.

### Census: the documented API path FAILED; a free keyless workaround WORKS
- Variable metadata (api.census.gov/data/2023/acs/acs5/variables/*.json) is reachable with no key and confirms: B01003_001E = Estimate!!Total (Total Population); B25044_001E = Total households (Tenure by Vehicles Available); B25044_003E = Owner occupied: No vehicle available; B25044_010E = Renter occupied: No vehicle available. So no-vehicle households = B25044_003E + B25044_010E, as you assumed.
- BUT every data query to api.census.gov (state, county, tract, block-group, ACS 2021/2022/2023 5-year, decennial pl, with a browser User-Agent) returned HTTP 302 to /data/missing_key.html with header X-DataWebAPI-KeyError: 1, with no key supplied. So "works without a key at low volume" is not true from here today. Row counts via the official API: 0. A free key is available from Census by email signup; I did not request one.
- Workaround used: Census Reporter API (api.censusreporter.org/1.0/data/show/latest?table_ids=B01003,B25044&geo_ids=150|05000US24510), no key, ACS 2024 5-year (2020-2024 release). Block-group rows: Baltimore City (24510) 618, Baltimore County (24005) 562, Anne Arundel (24003) 340 = 1,520, all of which joined to TIGER geometry. Values are the same B-table cells (B25044003 / B25044010 verified in the column labels).
- Geometry: TIGER/Line cartographic boundary file https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_24_bg_500k.zip (1.3 MB, 4,068 Maryland block groups). Downloaded and read with geopandas.
- Block groups whose centroid falls in the bbox: 352 (Baltimore City 241, Baltimore County 99, Anne Arundel 12), population 384,150, households 166,496, no-vehicle households 33,229 (20.0%). Three block groups have pop 0. Caveat: assigning by centroid, not by area overlap; edge block groups are counted whole or not at all.
- Dependency risk: Census Reporter is a third-party service, not an official Census endpoint. For a hackathon fetch-once-and-cache it is fine; for anything durable, get an official key.

## 5. Simulator speed and the Key Bridge effect

Setup: multi-source Dijkstra (scipy.sparse.csgraph.dijkstra, min_only=True) from 32 dispatch points to all 12,446 nodes on the forward graph. Response = 1.0 min dispatch (DISPATCH_MIN) + travel time at EMERGENCY_SPEED_FACTOR = 1.0 (both documented parameters in sim.py). Block-group population/no-vehicle counts are assigned to the nearest graph node to the BG centroid (median snap 49 m, max 500 m). Removing the bridge sets the 6 edges' weights to infinity (checked identical to physically dropping the edges: max diff 0.0).

Timings (20 repeats, median):
- Baseline multi-source Dijkstra: 0.80 ms (min 0.78, max 0.89).
- Key Bridge removed: 0.79 ms.
- Node-to-ED-hospital (reverse graph, 5 sources): 0.83 ms.

Response-time results (real numbers):

| | pop-weighted p50 | pop-weighted p90 | no-vehicle-hh-weighted p50 / p90 | node-level max |
|---|---|---|---|---|
| Baseline | 2.74 min | 4.57 min | 2.58 / 4.04 | 9.6 min |
| Key Bridge removed | 2.74 min | 4.57 min | 2.58 / 4.04 | 10.0 min |

What changed when the bridge is removed:
- Only 15 of 12,431 reachable nodes changed response time by more than 0.01 min; max delta 0.44 min. The nodes affected have 0 assigned population (bridge deck / interchange nodes east of the bridge in the Sparrows Point / Dundalk industrial area). 0 people of 384,150 are at nodes with delta > 0.01 min. Pop-weighted p50/p90 unchanged at two decimals.
- Node-to-ED-hospital travel time is also unchanged (max delta 0.0 min).
- The 15 "unreachable" nodes after removal are the bridge-only nodes themselves.
- Point-to-point sanity checks show the removal does bite when trips cross the river (travel only, no dispatch): Building 79 to Dundalk Station 6: 11.2 to 17.1 min (+5.9); Station 39 to North Point station: 16.3 to 20.2 (+3.9); Station 39 to Dundalk: 12.7 to 12.7 (routes via the tunnels either way).

Plausibility flags (important):
- The "no effect" result is real for this model but is probably too small to be the headline demo. Likely reasons, none tested: (a) each bank of the Patapsco has its own stations so nearest-station response rarely crosses the bridge; (b) the bbox cuts off at 39.19 and drops the south-shore stations/hospitals (northern Anne Arundel) that would in reality serve Dundalk/Sparrows Point across the bridge; (c) the station list is incomplete (no EMS bases); (d) nobody lives on the bridge and the Hawkins Point/Fairfield/Sparrows Point neighborhoods nearest it have little population, so population weighting mutes the effect. I did not run a wider-bbox query to test (b), to stay polite to Overpass.
- Absolute response times (p50 2.7 min including 1 min dispatch) look optimistic: no signals, turn delays, traffic, or unit availability, and stations are dense. Treat as relative comparisons only.
- A more useful counterfactual metric for the story is probably cross-river mutual aid / freight / commuter travel time and multi-unit assignment, not nearest-station response.

Monte Carlo, 200 futures (iid lognormal per-edge multipliers, median 1, sigma 0.25):
- Python/scipy: 0.20 s for 200 baseline futures (about 1.0 ms/future including multiplier generation and CSR reuse), 0.20 s for 200 bridge-removed futures. Pop-weighted p50 across futures 2.75 min (5-95%: 2.71-2.80), p90 4.62 (4.47-4.76); paired p90 delta from removing the bridge: exactly 0.0 in all 200 futures.
- Note the iid per-edge noise averages out over long routes, so the futures are narrow. Correlated noise (per road class / per zone / incident-based) would be needed for realistic spread; not tested.

Browser/TypeScript feasibility: yes, comfortably.
- Ported to plain JS (binary-heap multi-source Dijkstra over typed-array CSR, bench.mjs) and run on Node v24.18.0 (V8): baseline 0.58 ms, bridge-removed 0.57 ms per multi-source run; the JS result matches Python exactly on a checksum of all node response times (37598.697 vs 37598.697). 200 futures including generating 27k lognormal multipliers each: 323 ms; 200 futures with and without the bridge: 480 ms.
- This was Node, not a browser; a phone will be perhaps a few times slower, which would still be about 1-2 s. Not measured.
- Payload: about 160 KB gzipped for the CSR graph (plus a few KB for coords/stations/BG populations, which I did not size for the browser).

## 6. Nebius Token Factory (docs only; all items "documented, unverified with a key")

I had no WebFetch/WebSearch tool, so I used curl against public pages and a web-search results page. No Nebius API calls were made.

- Base URL: `https://api.tokenfactory.nebius.com/v1/` (docs quickstart, OpenAI-compatible; chat completions at /v1/chat/completions, models list at /v1/models, `?verbose=true` returns pricing and per-request limits). Documented, unverified with a key. Inconsistencies: the Nemotron marketing page shows a regional base URL `https://api.tokenfactory.us-central1.nebius.com/v1/`, and another sample on nebius.com uses `https://api.tokenfactory.nebius.com/` with no /v1. Try the docs one first.
- Model IDs, documented, unverified with a key:
  - Nemotron 3 Super: `nvidia/nemotron-3-super-120b-a12b` (appears verbatim in the Nemotron page code sample and in the docs deprecation notice as a recommended replacement). 256K context, listed public endpoint.
  - Nemotron 3 Ultra: official Nebius pages list "Nemotron-3-Ultra-550b-a55b" (550B hybrid MoE, ~1M/1,024K context, FP4, public endpoint). The exact API ID string is not printed on any official page I could reach; a third-party price aggregator (allaimodel.com) lists `nvidia/Nemotron-3-Ultra-550b-a55b`. Treat exact casing as a guess to confirm with GET /v1/models.
  - Nemotron 3 Nano: official page lists "Nemotron-3-Nano-30B-A3B" (262K context, FP8, public endpoint); exact ID string not printed. By analogy probably `nvidia/Nemotron-3-Nano-30B-A3B` (unconfirmed guess).
  - Newer model in the same family: `nvidia/Nemotron-3_5-Lightning` (30B total / 3B active, ~1M context, public), which the docs name as the replacement for several deprecated models.
  - Vision / multimodal: `nvidia/Nemotron-3-Nano-Omni` was scheduled for removal from Serverless on 2026-08-31 (docs deprecation notice) and the Nemotron page says it is now dedicated-only. Other vision IDs named in docs: `Qwen/Qwen2-VL-72B-Instruct` (docs vision example), `Qwen/Qwen2.5-VL-72B-Instruct` (also deprecated 2026-08-31), `nvidia/Cosmos3-Super-Reasoner` (also deprecated 2026-08-31). Replacement suggested for the vision models: `MiniMaxAI/MiniMax-M3` (I did not check whether it accepts images). So there may be no serverless Nemotron vision model today.
- Per-token prices (official nebius.com Nemotron page, USD per 1M tokens input/output), documented, unverified with a key: Nemotron 3 Ultra 1.00 / 3.00; Nemotron 3 Super 0.30 / 0.90; Nemotron 3 Nano 0.06 / 0.24; Nemotron 3.5 Lightning 0.06 / 0.24. The docs' own pricing page is behind a login redirect, so these come from the marketing page. Third-party aggregators show other numbers for Ultra (e.g. OpenRouter $0.50 / $2.20), which are not Nebius prices.
- Rate limits (docs "Rate Limits & Scaling"), documented, unverified with a key: dynamic limits; default caps are shown in the account's Rate Limits page (not public). The docs example baseline table uses 60 RPM / 400,000 TPM; limit rises 20% per 15-minute window when average usage >= 80% of the limit, falls by one third when <= 50%, hard ceiling 20x base before Enterprise. HTTP 429 on exceed, though over-limit requests may still be served at low priority (header `x-ratelimit-over-limit: yes`). Headers: x-ratelimit-limit-requests / -tokens, x-ratelimit-remaining-requests / -tokens. The verbose models endpoint example shows per-model requests_per_minute / tokens_per_minute (e.g. 1200 RPM / 800k TPM for a small Llama model), so per-model limits differ. Batch API has higher limits.
- Other docs facts: append `-fast` to a model ID for the lower-latency flavor; function calling and JSON/structured output pages exist (I did not read them).

## Recommendation: where to run the Monte Carlo

Run it in the browser (TypeScript, typed-array CSR graph, maybe in a Web Worker). Measured cost is about 0.6 ms per multi-source pass on V8 and about 0.5 s for 200 paired futures, over a graph of about 160 KB gzipped. That is fast enough for interactive sliders, needs no backend, and removes the free-host cold-start/latency risk. Keep Python only as an offline precompute/validation tool (it agrees with JS exactly and the scripts are here). The one thing that could change this is a much larger graph (e.g. wider bbox, or adding `service` roads): cost scales roughly linearly, so even 10x would still be under about 6 ms per pass.

## Surprises that should change the plan

1. The official Census API now requires a key for every data query (302 to missing_key). Either get a free key (email signup) or use the Census Reporter workaround used here. Build the pipeline as fetch-once-and-cache.
2. Removing the Key Bridge barely changes nearest-station response or hospital access in this model: 0 people affected, p50/p90 unchanged. If the demo story depends on "bridge collapse hurts emergency response", this baseline does not show it. Options: widen the bbox south into Anne Arundel and add its stations/hospitals (untested), model cross-river mutual aid or multi-unit dispatch, or use incident-location scenarios on the bridge approaches / port area. The routing does react correctly when trips actually cross (+4 to +6 min in point-to-point tests).
3. OSM emergency-service coverage is thin: ~32 fire points, 1 dubious ambulance station, 5 ED hospitals. Expect to hand-curate or find another free source (e.g. HIFLD / state EMS lists) for a credible station set.
4. Nebius model catalog is moving: Nemotron-3-Nano-Omni left Serverless on 2026-08-31, Nemotron 3.5 Lightning is the new default small model, and exact ID strings for Ultra and Nano were not in the public docs I could reach. Confirm with GET /v1/models once you have a key; do not hard-code the guessed IDs. Prices come from a marketing page, not a billing page.
5. The Overpass `[date:]` trick works, so no manual re-adding of the bridge is required; but present-day edits to the surrounding interchange mean a date-pinned snapshot should be cached and treated as the source of truth.

## Shortcuts and assumptions (where the bodies are)

- Speeds: default speeds by class, no intersections/signals/turn costs/congestion. Emergency speed factor 1.0.
- `service` roads excluded; access=private/no excluded; graph is the largest SCC only (dropped 333-1 fragments).
- Population attached to nearest node of the block-group centroid; block groups selected by centroid inside the bbox; population is ACS 2020-2024 (release acs2024_5yr), block-group geometry 2023 cartographic boundaries (500k generalized).
- Stations: OSM only, deduped by rounded coordinates, Academy and Fire Boat dropped, no unit counts or availability, no EMS.
- The Key Bridge removal set is 6 way IDs chosen by inspection of the 2024 snapshot; the two small ramp bridges west of it are left in.
- MC uses iid lognormal edge noise; no correlated shocks, no incidents, no demand model.
- JS benchmark ran on Node/V8 on the same Mac, not in a browser or on a phone.
- out/ contains regenerated artifacts (about 680 KB) and is not gitignored; nothing was committed or pushed.

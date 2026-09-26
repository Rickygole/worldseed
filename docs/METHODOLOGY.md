# WorldSeed methodology, sensitivity and validation (DRAFT)

Status: written 2026-09-26 for the snapshot `keybridge-2024-03-01-v1`. Every number in this file was produced by a script in
[`pipeline/sensitivity/`](../pipeline/sensitivity/) and is stored, unrounded, in `pipeline/sensitivity/out/*.json`. The tables below
are generated from those files by `pipeline/sensitivity/make_tables.py`. Nothing here is a forecast. WorldSeed is a fast,
open, free-flow screening model of a road network with a closed link, and this document tries to say exactly how far that
can be trusted.

## 0. Read this first

**What the model says (reference run: Key Bridge removed, 30 minute budget, free-flow drive times).**

- First-response (EMS) times do not change. Population-weighted p50 / p90 stay at 201.8 s / 367.5 s (96.2% of people within 8 minutes).
- The region-wide job-access average barely moves: +2.9 s per person (regional Access lens).
- The damage is a cross-harbor effect that lands on a few places. Of the 1,056,263 people in the cross-harbor lens, 19,705 (1.9%)
  lose more than 10% of the jobs they can reach on the opposite shore within 30 minutes, and 11,623 (1.1%) lose more than 25%.
  The typical resident is unaffected (added-time p50 0.2 s); the p90 is 26.6 s and the p99 is 261.5 s. The worst-hit block groups are
  on the eastern Baltimore County peninsula (nearest OSM place names to the block-group centroids: Fort Howard, Lodge Forest, Water View, Edgemere; mean loss 36% to 76%) and in northern Anne Arundel County (nearest place name: Annesley By The Bay; 23% to 29%). Place names are approximate labels, not boundaries.

**What held up under sensitivity, and what did not.** We fixed six qualitative conclusions (C1 to C6, defined in section 5.1) and re-ran
the cross-harbor, regional and EMS lenses under 51 variants (one assumption changed at a time, plus four combined corners). Scoreboard:

| Conclusion | Variants where it holds | Variants where it fails |
|---|---|---|
| C1 regional mean added < 30 s | 51 of 51 | - |
| C2 EMS p50 and p90 change < 1 s | 51 of 51 | - |
| C3 0.5% to 10% of people lose >10% cross-harbor jobs | 47 of 51 | T = 40 min; shore: all Baltimore city hexes ambiguous; corner A: speeds -20%, tunnels x1.5, T=24 min, snap 16; corner B: speeds +20%, T=36 min, snap 24 |
| C4 xharbor added-time p50 < 5 s | 48 of 51 | tunnel time x1.25 only AFTER bridge closure (diversion); tunnel time x1.5 only AFTER bridge closure (diversion); shore: all Baltimore city hexes ambiguous |
| C5 low-wage loss within 1 pp of population loss | 51 of 51 | - |
| C6 top-10 worst BGs overlap >= 7 | 50 of 51 | corner A: speeds -20%, tunnels x1.5, T=24 min, snap 16 |

Conclusions that did **not** hold everywhere, stated plainly:

1. **The size of the headline counts is not robust.** "19,705 people lose more than 10%" moves from 6,667 (all speeds +20%) to 96,277 (all speeds -20%)
   and from 6,422 (T = 36 min) to 96,450 (T = 24 min). It is a cliff-edge statistic (jobs within a fixed budget), and speed and budget are one
   dimension (speed -20% gives nearly the same count as T = 24 min). Only the time-based measures (mean added time 11.4 to 17.0 s, p90 22.1 to 33.2 s) are stable.
   Quote the counts with their range, not as a point estimate.
2. **"The typical cross-harbor resident is unaffected" (C4) fails if the tunnels absorb the diverted traffic.** If tunnel time is multiplied by 1.25 or 1.5 only after
   the bridge closes, the added-time p50 becomes 10.9 s or 17.3 s instead of 0.2 s, and the count losing more than 10% becomes 39,893 or 76,221.
3. **C3 (a minority is harmed) fails at T = 40 min (842 people) and in the corner where speeds are +20% and T = 36 min (9 people),** and when every Baltimore
   city hex is made ambiguous (127,163 people, an extreme stress test).
4. **The worst-hit ranking is stable in most variants but not all** (C6 fails in one corner: top-10 overlap 6/10; at T = 20 min it is 7/10 and the rank correlation over all
   affected block groups falls to 0.12).
5. **The model does not reproduce the one reported detour we could source.** A reported Dundalk to Ferndale commute went from 20 to 41 minutes;
   the free-flow model adds 1.2 minutes for the same pair (section 6). Free-flow times are a lower bound on disruption. See the limitations.
6. **Against random comparable motorway cuts, the Key Bridge is not exceptional on the regional lens** (36th percentile among 199 random corridor cuts, 29th among cuts of 0.5 to 2 times the bridge's length, 81st among
   single segments) and sits between the 62nd and 100th percentile on the cross-harbor measures depending on how the random closure is defined (section 4.3).
7. **Three of the four null controls that close a dead-end street a hex snaps to exceeded our pre-declared tolerance** (section 4.1; 12 of 15 null controls passed): closing such a dead end strands
   that hex, and the 7,200 s "unreachable" cap turns 34 to 104 stranded people into 1 to 4 s of extra cross-harbor mean time. The people-count metrics stay under 105 people.

## 1. The method in plain language

1. **Road network.** OpenStreetMap drivable roads as they were on 2024-03-01 (the last full snapshot before the 2024-03-26 collapse), pulled with
   an Overpass "attic" query, study box W -76.80, S 39.10, E -76.40, N 39.34. 36,610 nodes and 81,437 directed road edges (the snapshot also carries catalog-candidate edges, which are disabled in every world here). Each edge takes length / speed
   seconds, where speed is the OSM `maxspeed` tag or a class default (`A-SPEED-DEFAULTS`). No signals, turns, queues or congestion (`A-NO-DELAYS`).
2. **People and jobs on a hex grid.** 7,985 H3 resolution-9 hexes. Population, zero-vehicle households and low-wage residents are spread from Census block groups by
   area share (`A-AREA-APPORTION`); jobs are LODES 2023 workplace jobs placed at the block point. Each hex is snapped to its nearest street node with a 20 km/h
   walk-in time (`A-SNAP-SPEED`).
3. **A world is a set of closed edges.** "Key Bridge removed" closes the six directed I-695 edges of the bridge (`A-KEYBRIDGE-EDGES`, verified against tags and geometry by the pipeline).
   Everything is then recomputed with exact shortest paths (Dijkstra), for the whole network, once per world.
4. **Three lenses read the same shortest paths.**
   - *EMS (resilience check).* Time from the nearest of 76 response sources (74 fire stations, 2 ambulance stations) plus a 60 s call-to-wheels delay. Metrics: population-weighted p50 / p90, share within 8 minutes.
   - *Regional Access.* Job-weighted mean drive time to 8 employment anchors (k-means of LODES job blocks). Metric: mean added seconds per person.
   - *Cross-harbor (`xharbor`).* Which jobs on the *other* shore of the Patapsco can a hex reach within 30 minutes (`A-XHARBOR-T`)? Loss = (baseline jobs - world jobs) / baseline jobs.
     Metrics: people and low-wage workers losing more than 10% and 25%, and the change in job-weighted mean travel time to all opposite-shore jobs. The lens was defined before its results were seen, from the bridge's function (crossing the river).
5. **Shore.** Baltimore County = north/east shore, Anne Arundel and Howard = south/west shore, Baltimore city split by a hand-drawn harbor divider, 250 m either side of it "ambiguous" and left out (`A-SHORE-RULE`).
6. **Reference engine.** `worldseed_pipeline/golden.py` and `xharbor.py` (networkx for the regional and EMS lenses, scipy for `xharbor`) write `data/snapshot/golden.json`; the browser simulator must match it. This study reuses those metric functions.

The engine used here (`pipeline/sensitivity/engine.py`) re-solves the network with scipy and calls the reference metric code. **It reproduces the committed `golden.json` for the baseline and the bridge-removed world:
per-hex cross-harbor mean time within 0.005 s (golden stores two decimals), job counts identical in every hex, regional Access and EMS fields within 0.005 s, all reported headline metrics equal to the last digit, the same worst-10 block groups**
(`pipeline/sensitivity/out/validate_engine.json`, `pipeline/tests/test_sensitivity.py`).

## 2. Assumption register

"Sourced" means a cited external value; "assumption" means our choice (status copied from [`pipeline/assumptions.yaml`](../pipeline/assumptions.yaml)). The last column says whether this study varied it.

| ID | What | Status | Value | Tested here |
|---|---|---|---|---|
| `A-OSM-DATE` | OSM snapshot date | sourced | 2024-03-01 | not varied |
| `A-KEYBRIDGE-EDGES` | Key Bridge removal set | sourced | 6 directed I-695 edges | not varied (a wrong set would change everything) |
| `A-HAZMAT-TUNNELS` | Hazmat prohibited in both tunnels | sourced (MDTA page, per the yaml) | flag on tunnel edges | not exercised: no hazmat lens here |
| `A-JOBS-BLOCK-POINTS` | Jobs at LODES block points | sourced | LODES8 2023 WAC | bootstrap over blocks (5.4) |
| `A-ZVH`, `A-LOW-WAGE` | Zero-vehicle households, low-wage residents | sourced | ACS B25044, LODES RAC CE01 | not varied; ACS margins not propagated |
| `A-SPEED-DEFAULTS` | Class speed defaults | assumption | motorway 55 mph ... residential 25 | +/-20% by class group (5.2) |
| `A-NO-DELAYS` | Free-flow, no signals or congestion | assumption | free-flow | tunnel-congestion proxy (5.3); OSRM comparison (6) |
| `A-CALL-TO-WHEELS` | EMS call-processing and turnout delay | assumption | 60 s | 0, 48, 72, 120 s (5.1a) |
| `A-EMS-THRESHOLD` | 8 minute EMS threshold | assumption | 480 s | not varied |
| `A-EMS-SOURCES` | Every fire station counts as an EMS source | assumption | 74 fire + 2 ambulance | not varied (no unit data exists) |
| `A-SNAP-SPEED` | Hex-to-node snap speed | assumption | 20 km/h | 10, 16, 24, 30 km/h, and zero (5.6) |
| `A-SNAP-TARGETS` | Snap only to non-motorway street nodes | assumption | | not varied |
| `A-AREA-APPORTION` | Uniform density inside a block group | assumption | | not varied |
| `A-ACCESS-K`, `A-ACCESS-WEIGHTS` | 8 job-weighted anchors | assumption | K = 8, seed 7 | K = 2 to 32, seeds, 30 bootstrap re-clusterings (5.4) |
| `A-ACCESS-CAP` | Unreachable = 7,200 s | assumption | 7,200 s | not varied; visible in the null controls (4.1) |
| `A-ACCESS-ADDED-OK`, `A-ACCESS-CUTOFF` | 5 and 10 minute regional thresholds | assumption | 300 s, 600 s | not varied (not used in the conclusions below) |
| `A-QUANTILE` | Weighted quantile without interpolation | assumption | | not varied |
| `A-SHORE-RULE` | County rule plus hand-drawn divider | assumption | 250 m ambiguity band | divider +/-250, 500, 1000 m; band 0 to 1000 m; random flips (5.5) |
| `A-BBOX` | Study box | assumption | -76.80, 39.10, -76.40, 39.34 | not varied; jobs and people outside are not modeled |
| `A-XHARBOR-T` | Job-access time budget | assumption | 1,800 s | 20, 24, 30, 36, 40 min (5.5) |
| `A-XHARBOR-DEST`, `A-XHARBOR-TIME`, `A-XHARBOR-WHY` | Origin/destination sets, travel time definition | assumption | | shore variants change the sets (5.5) |
| `A-XHARBOR-TOL`, `A-TRIPS-*`, `A-CANDIDATES-*`, `A-SHUTTLE-*`, `A-CONNECTOR-SPEED`, `A-CORRIDOR-FACTOR-*`, `A-STAGING-DELAY`, `A-HAZMAT-ESCORT-PENALTY` | Test tolerances, freight-trip and candidate-catalog constants | assumption | see yaml | outside this study's scope (candidate monotonicity only, 4.2) |

Study-specific choices (not in the yaml, labeled here): the six conclusion thresholds (5.1), the +/-20% ranges, the 800 m random-cut window, B = 200 job-block resamples,
the 6 km band for random shore flips, 8 named trips plus 2 x 50 x 50 random pairs for the routing cross-check.

## 3. Simplifications in this study (where the bodies are)

- One-at-a-time variants plus four combined corners; no full factorial design and no probability model of the inputs. The ranges are "plausible", not fitted.
- Every variant re-derives its own baseline; "added" and "loss" are always relative to the same variant's baseline.
- The six conclusion thresholds were set after seeing the reference values and before running any variant. They are judgement calls; the tables carry the raw numbers so a reader can apply other thresholds.
- Speed variants multiply OSM-derived edge speeds by 0.8 or 1.2. They do not distinguish tagged from defaulted `maxspeed`.
- The job bootstrap resamples the 5,330 LODES workplace blocks with replacement. It represents sampling variation in *where jobs are*, not LODES noise infusion or year-to-year change. **A second LODES vintage (2022) was not in the local cache and was not fetched** so the vintage difference is not measured. The only network calls made by this study were the validation fetches in section 6 (a few web pages and 10 requests to the OSRM demo server); no snapshot input was re-downloaded.
- Spearman correlations are over the 319 block groups with any reference loss, so they are dominated by mildly affected block groups; the top-10 overlap is the more relevant ranking statistic.
- The OSRM comparison used the public demo server, whose OSM extract is current (post-collapse) and not versioned.
- Percentiles against random closures depend on the definition of a random closure (section 4.3 reports two definitions).
- While this study ran, `data/snapshot/` was regenerated by another workstream (candidate catalog files, `graph.bin`, and others). This study read the snapshot as committed. Afterwards we verified that the non-candidate road edges, nodes, corridor links, `hexes.bin`, and every lens headline number in `golden.json` are identical between the committed and the regenerated files; only candidate entries and edges differ, and no world here uses them. The candidate monotonicity check (4.2) was re-run on the current file.

## 4. Sanity and null controls

### 4.1 Closing something remote must change (almost) nothing

Fifteen closures, chosen with a fixed random seed from edges at least 12 km from the Key Bridge site: 5 residential dead ends that no hex snaps to, 4 residential dead ends that a hex snaps to,
and 6 through-edges (secondary, tertiary or residential, both ends junctions with three or more neighbors). Pre-declared pass rule (set before the run): xharbor mean added time < 0.5 s, fewer than 0.05% of covered people (528) losing more than 10%, regional mean added < 0.5 s, EMS p50 and p90 change < 1 s.

| # | Closure | Class | km from Key Bridge | People >10% loss | xharbor mean added (s) | Regional mean added (s) | People with regional +1 s or more | EMS d p50 / d p90 (s) | People with EMS change >1 s | Passes rule |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | remote cul-de-sac (no hex on it) | residential | 14.2 | 0 | 0.000 | 0.000 | 0 | 0.00 / 0.00 | 0 | yes |
| 2 | remote cul-de-sac (no hex on it) | residential | 18.2 | 0 | 0.000 | 0.000 | 0 | 0.00 / 0.00 | 0 | yes |
| 3 | remote cul-de-sac (no hex on it) | residential | 17.8 | 0 | 0.000 | 0.000 | 0 | 0.00 / 0.00 | 0 | yes |
| 4 | remote cul-de-sac (no hex on it) | residential | 20.1 | 0 | 0.000 | 0.000 | 0 | 0.00 / 0.00 | 0 | yes |
| 5 | remote cul-de-sac (no hex on it) | residential | 12.2 | 0 | 0.000 | 0.000 | 0 | 0.00 / 0.00 | 0 | yes |
| 6 | remote cul-de-sac (hex snaps to dead end) | residential | 16.3 | 49 | 1.214 | 0.263 | 49 | 0.00 / 0.00 | 49 | NO |
| 7 | remote cul-de-sac (hex snaps to dead end) | residential | 15.3 | 35 | 0.199 | 0.206 | 35 | 0.00 / 0.00 | 35 | yes |
| 8 | remote cul-de-sac (hex snaps to dead end) | residential | 21.3 | 34 | 1.633 | 0.191 | 34 | 0.00 / 0.00 | 34 | NO |
| 9 | remote cul-de-sac (hex snaps to dead end) | residential | 13.2 | 104 | 3.879 | 0.596 | 104 | 0.00 / 0.00 | 104 | NO |
| 10 | remote rural edge | secondary | 13.5 | 0 | 0.000 | 0.000 | 0 | 0.00 / 0.00 | 1,790 | yes |
| 11 | remote rural edge | residential | 12.1 | 0 | 0.001 | 0.001 | 468 | 0.00 / 0.00 | 0 | yes |
| 12 | remote rural edge | residential | 12.8 | 0 | 0.170 | 0.000 | 0 | 0.11 / 0.08 | 400 | yes |
| 13 | remote rural edge | residential | 16.6 | 0 | 0.000 | 0.000 | 0 | 0.00 / 0.00 | 0 | yes |
| 14 | remote rural edge | residential | 12.4 | 0 | 0.000 | 0.000 | 0 | 0.00 / 0.00 | 0 | yes |
| 15 | remote rural edge | secondary | 12.0 | 0 | 0.000 | 0.007 | 1,670 | 0.00 / 0.00 | 0 | yes |

**Result: 12 of 15 pass.** All 5 dead ends with no hex on them and all 6 rural through-edges produce zero or near-zero change in every lens (largest: 0.17 s xharbor mean, 0.11 s EMS p50). Two rural edges change EMS times by more than 1 s for 1,790 and 400 people; the population p50 and p90 move by at most 0.11 s.
The three that fail are dead ends that a hex snaps to: closing the only edge strands that hex (34 to 104 people per closure), the model assigns the 7,200 s "unreachable" cap, and if the stranded hex holds jobs, every origin on the other shore sees a slightly larger job-weighted mean time (1.2, 1.6 and 3.9 s).
The people-count measures stay at 34 to 104 people (under 0.01% of the covered population). This is a real property of the model, not a bug: **the mean-time measures have a noise floor of roughly 4 s (xharbor) and 0.6 s (regional) from a single stranded hex**, compared with 13.6 s and 2.9 s for the bridge.
The regional figure for the bridge is therefore about five times the worst null we found, not orders of magnitude above it.

### 4.2 Ordering of closures, and monotonicity

| Closed (each vs. baseline) | Directed edges | People >10% | People >25% | Low-wage >10% | xharbor mean added (s) | xharbor added p90 (s) | Regional mean added (s) | EMS d p50 / d p90 (s) |
|---|---|---|---|---|---|---|---|---|
| Key Bridge (I-695) | 6 | 19,705 | 11,623 | 1,371 | 13.6 | 26.6 | 2.9 | 0.0 / 0.0 |
| Harbor Tunnel (I-895) | 6 | 63,272 | 4,934 | 4,849 | 23.9 | 60.3 | 14.5 | 0.0 / 0.0 |
| Fort McHenry Tunnel (I-95) | 4 | 5,207 | 0 | 404 | 2.1 | 7.2 | 3.4 | 0.0 / 0.0 |
| Both tunnels | 10 | 151,676 | 71,083 | 11,178 | 48.8 | 170.0 | 35.1 | 0.0 / 0.0 |
| Bridge + both tunnels | 16 | 311,086 | 153,393 | 21,968 | 105.4 | 298.5 | 56.6 | 0.0 / 0.0 |

- Ordering by people losing more than 10%: both tunnels (151,676) > Harbor Tunnel (63,272) > Key Bridge (19,705) > Fort McHenry (5,207). By mean added time and by regional effect the same ordering holds
  except that the Fort McHenry tunnel's regional effect (3.4 s) is slightly above the bridge's (2.9 s). By depth (people losing more than 25%) the bridge is the deepest single-link closure: 11,623 vs 4,934 (Harbor Tunnel) and 0 (Fort McHenry). Its damage is the most concentrated.
- Closing both tunnels affects 7.7 times as many people at the 10% level as removing the bridge; all three crossings closed affects 311,086.
- **EMS times are unchanged even when all three crossings are closed**: not one of the 7,985 hexes changes by even 1 s (maximum change 0.0 s), so no hex's fastest route from its nearest station uses any of the three links. This is a property of the lens (nearest of 76 sources; no hospital transport and no cross-harbor mutual aid), not evidence that EMS is unaffected in reality.
- **Monotonicity (a candidate never hurts).** 16 catalog candidates in two contexts (baseline and bridge removed) = 32 evaluations in the file as it is now (10 further entries are listed as pruned; the catalog file changed on disk while this study ran, not by this study; the real network and every lens headline number were checked to be identical); minimum benefit on each of the five measures = 0; negative benefits found: 0. No candidate worsens any lens (xharbor time saved, jobs gained, regional time saved, EMS p90 saved, EMS % within gain). An earlier read of the same file, before it changed, covered 24 candidates and 48 evaluations with the same result. `pipeline/tests/test_round2.py` also asserts this.

### 4.3 Where does the Key Bridge sit among random closures?

Two random baselines, because the answer depends on the definition. In both, "comparable road class" means motorway or trunk edges (non-ramp). "Percentile" is the share of random closures with a smaller value, ties counting half (100 = larger than every random closure).

**(a) Random corridor cuts, size-matched.** A random motorway/trunk edge is drawn; every motorway/trunk edge (both carriageways) whose midpoint is within 800 m of it is closed. 800 m is the bridge's own footprint (the largest distance from the centroid of the six bridge-edge midpoints is 798 m). 200 draws, one contained the bridge and was skipped.

| Metric | Key Bridge | Random-cut median | Random-cut p90 | Random-cut max | Key Bridge percentile, all cuts | Percentile, length 0.5-2x bridge (n=166) | Percentile, cuts without a tunnel (n=193) |
|---|---|---|---|---|---|---|---|
| People losing >10% of cross-harbor jobs | 19,705 | 8,024 | 52,818 | 151,676 | 78 (42 of 199 larger) | 76 | 81 |
| People losing >25% | 11,623 | 320 | 7,459 | 71,083 | 92 (15 of 199 larger) | 91 | 95 |
| xharbor mean loss (%) | 1.50 | 0.63 | 1.76 | 5.05 | 87 (25 of 199 larger) | 85 | 89 |
| xharbor mean added time (s) | 13.63 | 8.12 | 32.24 | 72.74 | 67 (64 of 199 larger) | 62 | 69 |
| Regional mean added time (s) | 2.95 | 5.57 | 15.99 | 35.09 | 36 (125 of 199 larger) | 29 | 38 |

Notes: 199 usable cuts of 200 (one window contained the bridge and was skipped); edges per cut: median 19 (range 2 to 81) vs. 6 for the bridge; one-way-equivalent length: median 1.77 km vs. 2.77 km for the bridge; 6 cuts include a tunnel edge; share of cuts with any change in EMS d p90 above 1 s: 0.0%; share of cuts with xharbor mean added time under 0.5 s: 10.6%. The cuts contain more edges than the bridge (interchanges) but are shorter in one-way length, so "size-matched" is approximate.

**(b) Random single segments.** 200 draws of one motorway/trunk edge and its reverse twin (199 usable; one draw was a Key Bridge edge and was skipped); median length 0.14 km, far shorter than the bridge's 2.77 km, so the bridge is expected to rank high.

| Metric | Key Bridge | Segment median | Segment p90 | Segment max | Key Bridge percentile |
|---|---|---|---|---|---|
| People losing >10% of cross-harbor jobs | 19,705 | 0 | 11,702 | 59,390 | 97 (6 of 199 larger) |
| People losing >25% | 11,623 | 0 | 1,884 | 9,481 | 100 (0 of 199 larger) |
| xharbor mean loss (%) | 1.50 | 0.10 | 0.60 | 1.43 | 100 (0 of 199 larger) |
| xharbor mean added time (s) | 13.63 | 1.56 | 8.52 | 16.26 | 98 (4 of 199 larger) |
| Regional mean added time (s) | 2.95 | 1.05 | 4.12 | 10.58 | 81 (37 of 199 larger) |

Reading: against ordinary single segments the bridge is near the top on every measure (cross-harbor 97th to 100th percentile; regional 81st). Against size-matched cuts it is unremarkable on the regional lens (36th percentile, 29th among cuts within 0.5 to 2 times its length: the median random cut adds 5.6 s to the regional mean, the bridge adds 2.9 s) and lower on cross-harbor means (67th percentile on mean added time), but the bridge is at the 92nd percentile for the share of people losing more than 25% of cross-harbor jobs:
its effect is unusually deep for the people it does hit. Random cuts elsewhere in the network hurt cross-harbor access too, because cross-harbor trips use I-95, I-895, I-97 and the western I-695 arc. **We therefore do not claim the bridge is the single most consequential motorway link; we claim it is a concentrated cross-harbor bottleneck.** No random cut changed EMS p90 by more than 1 s (0 of 199 cuts, 0 of 199 segments).

## 5. Sensitivity

### 5.1 How to read the tables

Reference:

| Variant | People losing >10% | People losing >25% | Low-wage >10% | Low-wage >25% | Mean added (s) | Added p50 / p90 (s) | Top-10 BG overlap | Spearman (BG) | Regional mean added (s) | EMS d p50 / d p90 (s) | Conclusions failed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| REFERENCE (shipped snapshot) | 19,705 | 11,623 | 1,371 | 789 | 13.6 | 0.2 / 26.6 | 10/10 | 1.00 | 2.95 | 0.0 / 0.0 | none |

Columns: people and low-wage workers losing more than 10% / 25% of opposite-shore jobs within the budget; mean and p50 / p90 of added job-weighted travel time (seconds, population weighted); overlap of the worst-10 block groups (by mean loss) with the reference worst-10; Spearman rank correlation of block-group mean loss (319 block groups with any reference loss); regional Access mean added seconds; change in EMS p50 / p90.

Conclusions tested in every variant (thresholds fixed before the variants were run):

- **C1** regional Access barely moves: mean added < 30 s (reference 2.9 s)
- **C2** EMS first response unchanged: |change in p50| and |change in p90| < 1 s (reference exactly 0)
- **C3** cross-harbor harm is a minority: 0.5% to 10% of covered people lose more than 10% of cross-harbor jobs (reference 1.87%)
- **C4** the typical resident is unaffected: xharbor added-time p50 < 5 s (reference 0.19 s)
- **C5** low-wage workers are not singled out: |low-wage mean loss - population mean loss| < 1 percentage point (reference -0.06 pp)
- **C6** the same places are worst hit: worst-10 block-group overlap >= 7 of 10

### 5.1a Call-to-wheels delay (`A-CALL-TO-WHEELS`, 60 s, varied 0 to 120 s)

| Call-to-wheels delay | EMS baseline p50 (s) | EMS baseline p90 (s) | Within 8 min, baseline | Within 8 min, bridge removed | d p50 (s) | d p90 (s) |
|---|---|---|---|---|---|---|
| 60 s (reference) | 201.8 | 367.5 | 96.2% | 96.2% | 0.0 | 0.0 |
| 0 s | 141.8 | 307.5 | 97.6% | 97.6% | 0.0 | 0.0 |
| 48 s | 189.8 | 355.5 | 96.5% | 96.5% | 0.0 | 0.0 |
| 72 s | 213.8 | 379.5 | 95.8% | 95.8% | 0.0 | 0.0 |
| 120 s | 261.8 | 427.5 | 93.9% | 93.9% | 0.0 | 0.0 |

The delay shifts absolute EMS times one-for-one (+/-12 s for +/-20%) and moves the share within 8 minutes by under 1 point; the effect of the bridge on EMS stays exactly zero. No conclusion depends on this parameter.

### 5.2 Free-flow speeds by road class (+/-20%)

| Variant | People losing >10% | People losing >25% | Low-wage >10% | Low-wage >25% | Mean added (s) | Added p50 / p90 (s) | Top-10 BG overlap | Spearman (BG) | Regional mean added (s) | EMS d p50 / d p90 (s) | Conclusions failed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| speed x0.8: all edges | 96,277 | 33,230 | 6,873 | 2,377 | 17.0 | 0.2 / 33.2 | 8/10 | 0.44 | 3.68 | 0.0 / 0.0 | none |
| speed x1.2: all edges | 6,667 | 1,097 | 469 | 77 | 11.4 | 0.2 / 22.1 | 9/10 | 0.73 | 2.45 | 0.0 / 0.0 | none |
| speed x0.8: motorway class | 54,882 | 16,778 | 3,947 | 1,171 | 14.7 | 0.4 / 38.3 | 10/10 | 0.78 | 2.95 | 0.0 / 0.0 | none |
| speed x1.2: motorway class | 11,158 | 5,617 | 741 | 401 | 13.6 | 0.1 / 24.2 | 7/10 | 0.85 | 3.16 | 0.0 / 0.0 | none |
| speed x0.8: tunnel edges only | 22,759 | 12,023 | 1,600 | 815 | 15.3 | 0.7 / 29.5 | 10/10 | 0.99 | 3.44 | 0.0 / 0.0 | none |
| speed x1.2: tunnel edges only | 17,510 | 11,408 | 1,223 | 776 | 12.6 | 0.0 / 25.1 | 10/10 | 1.00 | 2.64 | 0.0 / 0.0 | none |
| speed x0.8: surface (non-motorway, non-ramp) | 54,629 | 14,581 | 3,913 | 1,015 | 16.9 | 0.1 / 30.6 | 7/10 | 0.76 | 3.93 | 0.0 / 0.0 | none |
| speed x1.2: surface (non-motorway, non-ramp) | 11,911 | 5,536 | 800 | 395 | 11.8 | 0.3 / 29.2 | 9/10 | 0.82 | 2.36 | 0.0 / 0.0 | none |
| speed x0.8: ramps (link class) | 21,352 | 12,727 | 1,502 | 862 | 13.5 | 0.1 / 27.0 | 10/10 | 0.99 | 2.91 | 0.0 / 0.0 | none |
| speed x1.2: ramps (link class) | 17,964 | 10,998 | 1,244 | 746 | 13.7 | 0.2 / 26.4 | 10/10 | 0.99 | 2.92 | 0.0 / 0.0 | none |

All-edge speeds are the most influential input for the counts (6,667 to 96,277 people above 10% loss) and much less so for time measures (mean added 11.4 to 17.0 s). Changing only the tunnels or the ramps moves the counts by less than 16% (tunnels-only 17,510 to 22,759; ramps-only 17,964 to 21,352); changing only the motorway class or only the surface streets moves them by a factor of 1.8 to 2.8 (11,158 to 54,882).

### 5.3 Tunnel congestion proxy

Tunnel travel time multiplied by 1.25 or 1.5. "Both worlds" applies it to baseline and bridge-removed alike; "only after bridge closure" models diversion congestion (tunnels are free-flow before the bridge closes and congested after), which is the more realistic proxy and the harsher test. A time multiplier of 1.25 is the same as tunnel speeds -20%.

| Variant | People losing >10% | People losing >25% | Low-wage >10% | Low-wage >25% | Mean added (s) | Added p50 / p90 (s) | Top-10 BG overlap | Spearman (BG) | Regional mean added (s) | EMS d p50 / d p90 (s) | Conclusions failed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| tunnel time x1.25 in BOTH worlds | 22,759 | 12,023 | 1,600 | 815 | 15.3 | 0.7 / 29.5 | 10/10 | 0.99 | 3.44 | 0.0 / 0.0 | none |
| tunnel time x1.25 only AFTER bridge closure (diversion) | 39,893 | 13,687 | 2,882 | 940 | 21.0 | 10.9 / 40.7 | 10/10 | 0.88 | 7.34 | 0.0 / 0.0 | C4 |
| tunnel time x1.5 in BOTH worlds | 27,307 | 12,633 | 1,927 | 855 | 17.0 | 1.4 / 32.2 | 9/10 | 0.97 | 4.00 | 0.0 / 0.0 | none |
| tunnel time x1.5 only AFTER bridge closure (diversion) | 76,221 | 19,484 | 5,577 | 1,374 | 28.1 | 17.3 / 59.0 | 8/10 | 0.81 | 11.57 | 0.0 / 0.0 | C4 |

### 5.4 Sample of job destinations

**Cross-harbor lens: 200 bootstrap resamples of the LODES workplace blocks** (each block's jobs are multiplied by its resample count; total jobs vary from 510,229 to 705,339 versus 603,260 in the snapshot).

| Metric (200 block resamples) | 2.5th pct | Median | 97.5th pct | Min | Max |
|---|---|---|---|---|---|
| People losing >10% | 15,376 | 20,354 | 36,371 | 14,187 | 67,199 |
| People losing >25% | 9,695 | 11,480 | 12,992 | 8,658 | 13,681 |
| Low-wage workers losing >10% | 1,055 | 1,421 | 2,562 | 964 | 4,656 |
| Mean loss (% of jobs within 30 min) | 1.03 | 1.50 | 2.33 | 0.97 | 2.75 |
| Mean added time (s) | 9.69 | 13.57 | 20.73 | 9.29 | 23.62 |
| Added p50 (s) | 0.05 | 0.16 | 0.32 | 0.02 | 0.35 |
| Added p90 (s) | 15.72 | 26.50 | 51.80 | 14.41 | 61.76 |
| Low-wage minus population mean loss (pp) | -0.13 | -0.06 | -0.02 | -0.16 | -0.01 |
| Top-10 overlap with reference (of 10) | 8.00 | 10.00 | 10.00 | 7.00 | 10.00 |
| Spearman vs reference (BG ranks) | 0.87 | 0.97 | 0.99 | 0.84 | 1.00 |

(reference values: 19,705 / 11,623 / 1,371; conclusions C3, C4, C5, C6 hold in 200, 200, 200, 200 of 200 resamples; 5,330 job blocks; total jobs range 510,229 to 705,339.) The 95% interval for people above 10% loss is roughly 15,400 to 36,400 around the reference 19,705: a single large job block can swing the count, because the count is a cliff-edge statistic. The >25% count (9,700 to 13,000) and the time measures are tighter.

**Regional lens: anchors.** The K=8 anchors are one clustering of one job sample. Re-deriving them (K=8 seed 7 reproduces `destinations.json` exactly, asserted):

| Regional-lens anchors | Mean added (s) | p99 hex added (s) | Max hex added (s) |
|---|---|---|---|
| K=2, seed 7 | 1.59 | 91 | 133 |
| K=4, seed 7 | 3.88 | 115 | 161 |
| K=6, seed 7 | 3.75 | 121 | 177 |
| K=8, seed 7 | 2.95 | 116 | 174 |
| K=12, seed 7 | 7.99 | 114 | 171 |
| K=16, seed 7 | 9.33 | 111 | 168 |
| K=24, seed 7 | 7.63 | 100 | 158 |
| K=32, seed 7 | 7.28 | 99 | 153 |
| K=8, seed 1 | 3.14 | 122 | 179 |
| K=8, seed 2 | 3.14 | 122 | 179 |
| K=8, seed 3 | 3.13 | 122 | 180 |
| K=8, seed 4 | 3.13 | 121 | 179 |
| K=8, seed 5 | 3.10 | 122 | 183 |
| K=8, 30 block-bootstrap re-clusterings: median (2.5th to 97.5th pct) | 3.78 (2.75 to 13.59); max 16.39 |  |  |

The regional mean added time depends on K (1.6 to 9.3 s across K = 2 to 32; median 3.8 s across bootstraps, up to 16.4 s) but never approaches the 30 s threshold: "the regional average barely moves" holds, but its magnitude is uncertain: 1.6 to 9.3 s across K, 2.7 to 13.6 s (95% range) across bootstraps.

### 5.5 Threshold T and the shore rule

| Variant | People losing >10% | People losing >25% | Low-wage >10% | Low-wage >25% | Mean added (s) | Added p50 / p90 (s) | Top-10 BG overlap | Spearman (BG) | Regional mean added (s) | EMS d p50 / d p90 (s) | Conclusions failed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T = 20 min | 100,460 | 77,648 | 7,136 | 5,432 | 13.6 | 0.2 / 26.6 | 7/10 | 0.12 | 2.95 | 0.0 / 0.0 | none |
| T = 24 min | 96,450 | 32,995 | 6,881 | 2,366 | 13.6 | 0.2 / 26.6 | 8/10 | 0.42 | 2.95 | 0.0 / 0.0 | none |
| T = 30 min | 19,705 | 11,623 | 1,371 | 789 | 13.6 | 0.2 / 26.6 | 10/10 | 1.00 | 2.95 | 0.0 / 0.0 | none |
| T = 36 min | 6,422 | 934 | 452 | 65 | 13.6 | 0.2 / 26.6 | 9/10 | 0.73 | 2.95 | 0.0 / 0.0 | none |
| T = 40 min | 842 | 0 | 59 | 0 | 13.6 | 0.2 / 26.6 | 7/10 | 0.58 | 2.95 | 0.0 / 0.0 | C3 |

Speed and budget are one dimension: speeds +20% with T = 30 min behaves like T = 36 min (6,667 vs 6,422 people above 10%), and speeds -20% behaves like T = 24 min (96,277 vs 96,450). The 30-minute choice sits on the steep part of the curve; the count changes by a factor of 5 between T = 30 and T = 24 or 36. The time-based measures do not depend on T at all.

**Shore rule.** The snapshot's shore field was reproduced exactly from the county rule and divider (asserted equal). Perturbations and the number of hexes that change shore:

| Shore variant | Hexes changing shore | Population in them | Jobs in them | Ambiguous hexes (after) | People >10% | People >25% | Mean added (s) | Top-10 overlap |
|---|---|---|---|---|---|---|---|---|
| divider shifted -1000 m (north = +) | 98 | 10,399 | 6,536 | 37 | 20,666 | 11,368 | 13.8 | 10/10 |
| divider shifted -500 m (north = +) | 61 | 7,324 | 3,923 | 30 | 19,938 | 11,688 | 13.7 | 10/10 |
| divider shifted -250 m (north = +) | 30 | 3,371 | 1,915 | 29 | 19,780 | 11,623 | 13.7 | 10/10 |
| divider shifted +250 m (north = +) | 31 | 3,354 | 1,717 | 32 | 19,633 | 11,770 | 13.6 | 10/10 |
| divider shifted +500 m (north = +) | 66 | 6,744 | 2,600 | 35 | 19,495 | 11,808 | 13.6 | 10/10 |
| divider shifted +1000 m (north = +) | 112 | 9,988 | 6,774 | 46 | 19,151 | 11,830 | 13.6 | 10/10 |
| ambiguity band 0 m | 31 | 4,236 | 1,500 | 0 | 19,606 | 11,623 | 13.5 | 10/10 |
| ambiguity band 500 m | 30 | 2,488 | 2,132 | 61 | 19,806 | 11,770 | 13.7 | 10/10 |
| ambiguity band 1000 m | 108 | 8,919 | 8,051 | 139 | 20,440 | 11,948 | 14.0 | 10/10 |
| all Baltimore city hexes ambiguous | 1,651 | 420,409 | 302,210 | 1,682 | 127,163 | 17,941 | 45.0 | 9/10 |

| Variant | People losing >10% | People losing >25% | Low-wage >10% | Low-wage >25% | Mean added (s) | Added p50 / p90 (s) | Top-10 BG overlap | Spearman (BG) | Regional mean added (s) | EMS d p50 / d p90 (s) | Conclusions failed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| shore: divider shifted -1000 m (north = +) | 20,666 | 11,368 | 1,442 | 770 | 13.8 | 0.1 / 26.3 | 10/10 | 1.00 | 2.95 | 0.0 / 0.0 | none |
| shore: divider shifted -500 m (north = +) | 19,938 | 11,688 | 1,386 | 794 | 13.7 | 0.1 / 26.4 | 10/10 | 1.00 | 2.95 | 0.0 / 0.0 | none |
| shore: divider shifted -250 m (north = +) | 19,780 | 11,623 | 1,376 | 789 | 13.7 | 0.1 / 26.5 | 10/10 | 1.00 | 2.95 | 0.0 / 0.0 | none |
| shore: divider shifted +250 m (north = +) | 19,633 | 11,770 | 1,365 | 799 | 13.6 | 0.2 / 26.6 | 10/10 | 1.00 | 2.95 | 0.0 / 0.0 | none |
| shore: divider shifted +500 m (north = +) | 19,495 | 11,808 | 1,356 | 801 | 13.6 | 0.2 / 26.6 | 10/10 | 1.00 | 2.95 | 0.0 / 0.0 | none |
| shore: divider shifted +1000 m (north = +) | 19,151 | 11,830 | 1,331 | 803 | 13.6 | 0.2 / 26.9 | 10/10 | 1.00 | 2.95 | 0.0 / 0.0 | none |
| shore: ambiguity band 0 m | 19,606 | 11,623 | 1,363 | 789 | 13.5 | 0.1 / 26.5 | 10/10 | 1.00 | 2.95 | 0.0 / 0.0 | none |
| shore: ambiguity band 500 m | 19,806 | 11,770 | 1,379 | 799 | 13.7 | 0.2 / 26.6 | 10/10 | 1.00 | 2.95 | 0.0 / 0.0 | none |
| shore: ambiguity band 1000 m | 20,440 | 11,948 | 1,427 | 811 | 14.0 | 0.2 / 27.5 | 10/10 | 1.00 | 2.95 | 0.0 / 0.0 | none |
| shore: all Baltimore city hexes ambiguous | 127,163 | 17,941 | 8,197 | 1,249 | 45.0 | 36.1 / 113.0 | 9/10 | 0.92 | 2.95 | 0.0 / 0.0 | C3, C4 |

Random misclassification (flipping 0 <-> 1 for a share of the hexes within 6 km of the divider, three draws each):

| Random misclassification | Hexes changed | Population in changed hexes | People >10% | People >25% | Mean added (s) | Top-10 overlap |
|---|---|---|---|---|---|---|
| 2% of hexes within 6 km of divider, 3 random draws | 60 | 8,941 | 18,380 to 18,587 | 11,027 to 11,642 | 13.3 to 13.4 | 10/10 to 10/10 |
| 5% of hexes within 6 km of divider, 3 random draws | 150 | 24,846 | 17,426 to 17,554 | 10,521 to 11,314 | 12.9 to 13.1 | 10/10 to 10/10 |
| 10% of hexes within 6 km of divider, 3 random draws | 300 | 44,794 | 15,382 to 16,501 | 9,985 to 10,439 | 12.2 to 12.4 | 10/10 to 10/10 |

Shifting the divider by up to 1 km changes 98 to 112 hexes (about 10,000 people) and moves the headline counts by less than 5%; ambiguity bands from 0 to 1 km change them by less than 4%. Random flips of 10% of nearby hexes lower the counts by up to about 22% and never change the worst-10 ranking.
The only shore variant that changes conclusions is the extreme one that removes all of Baltimore city from the lens (1,651 hexes, 420,409 people, 302,210 jobs). It is a stress test, not a plausible boundary error, but it shows how much of the effect sits in the city's south-harbor communities (Curtis Bay, Hawkins Point and neighbors), which the county rule cannot place.

### 5.6 Snap-time assumption

| Variant | People losing >10% | People losing >25% | Low-wage >10% | Low-wage >25% | Mean added (s) | Added p50 / p90 (s) | Top-10 BG overlap | Spearman (BG) | Regional mean added (s) | EMS d p50 / d p90 (s) | Conclusions failed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| snap speed 10 km/h | 20,598 | 12,345 | 1,439 | 838 | 13.6 | 0.2 / 26.6 | 9/10 | 0.94 | 2.95 | 0.0 / 0.0 | none |
| snap speed 16 km/h | 19,556 | 12,146 | 1,370 | 825 | 13.6 | 0.2 / 26.6 | 10/10 | 0.99 | 2.95 | 0.0 / 0.0 | none |
| snap speed 24 km/h | 19,641 | 11,590 | 1,366 | 786 | 13.6 | 0.2 / 26.6 | 10/10 | 1.00 | 2.95 | 0.0 / 0.0 | none |
| snap speed 30 km/h | 18,665 | 11,349 | 1,303 | 772 | 13.6 | 0.2 / 26.6 | 10/10 | 0.99 | 2.95 | 0.0 / 0.0 | none |
| no snap time | 15,810 | 10,775 | 1,089 | 733 | 13.6 | 0.2 / 26.6 | 10/10 | 0.93 | 2.95 | 0.0 / 0.0 | none |

Snap time does not touch the added-time measures at all (the same hexes are snapped in both worlds, so it cancels) and moves the counts by at most 20% (zero snap time: 15,810; 10 km/h: 20,598).

### 5.7 Combined corners

| Variant | People losing >10% | People losing >25% | Low-wage >10% | Low-wage >25% | Mean added (s) | Added p50 / p90 (s) | Top-10 BG overlap | Spearman (BG) | Regional mean added (s) | EMS d p50 / d p90 (s) | Conclusions failed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| corner A: speeds -20%, tunnels x1.5, T=24 min, snap 16 | 106,287 | 88,838 | 7,552 | 6,231 | 21.3 | 1.8 / 40.2 | 6/10 | 0.09 | 5.00 | 0.0 / 0.0 | C3, C6 |
| corner B: speeds +20%, T=36 min, snap 24 | 9 | 0 | 1 | 0 | 11.4 | 0.2 / 22.1 | 7/10 | 0.40 | 2.45 | 0.0 / 0.0 | C3 |
| corner C: speeds -20%, T=36 min | 24,230 | 13,283 | 1,706 | 905 | 17.0 | 0.2 / 33.2 | 10/10 | 0.95 | 3.68 | 0.0 / 0.0 | none |
| corner D: speeds +20%, tunnels x1.0, T=24 min | 25,090 | 13,468 | 1,775 | 918 | 11.4 | 0.2 / 22.1 | 10/10 | 0.91 | 2.45 | 0.0 / 0.0 | none |

Corner A (slow, congested tunnels, short budget, slow snap) is the only variant where the ranking fails (6 of 10 in the top-10) and where the bridge no longer looks like a minority effect (10.1% of covered people above 10% loss). Corner B (fast, long budget) is the mirror image: 9 people.

## 6. Validation against reality

Only sources that were actually fetched are cited. All were accessed on 2026-09-26.

### 6.1 Reported detour

- Maryland Matters, "Baltimore residents face daily disruptions after Key Bridge collapse" (2025-03-28, per the URL; the original returned HTTP 403 to our fetch, so the text was read in two syndicated copies):
  https://baltimorefishbowl.com/stories/baltimore-residents-face-daily-disruptions-after-key-bridge-collapse/ and
  https://thedailyrecord.com/2025/03/28/baltimore-residents-face-daily-disruptions-after-key-bridge-collapse/.
  Quoted: "A study by the Baltimore Metropolitan Council said the Francis Scott Key Bridge averaged 39,000 crossings per weekday" and "a 20-minute commute from Dundalk to Ferndale in northern Anne Arundel County has doubled to 41 minutes."
- Maryland DOT State Highway Administration press release, "State Highway Administration Encourages Drivers to Use Real-Time Traffic Map to Plan Commute Following Key Bridge Collapse": https://roads.maryland.gov/mdotsha/pages/pressreleasedetails.aspx?PageId=818&newsId=4996. Quoted: the bridge "accommodated an average of more than 30,000 vehicle trips every day prior to the collapse".
- Wikipedia (tertiary), "Francis Scott Key Bridge collapse", https://en.wikipedia.org/wiki/Francis_Scott_Key_Bridge_collapse, fetched through the MediaWiki API: "Most traffic is detoured along I-95 and I-895, which cross Baltimore Harbor in tunnels". Consistent with the model's detour route.

We did **not** find a source for a Dundalk to Curtis Bay detour of "20+ minutes" and do not cite one. The only sourced detour figure we found is Dundalk to Ferndale (20 to 41 minutes, typical commute, real traffic).

| Dundalk to Ferndale | minutes |
|---|---|
| Reported before the collapse (typical commute) | 20 |
| Reported after the collapse | 41 (+21) |
| Model baseline, free-flow (place-node hexes) | 16.1 |
| Model bridge removed, free-flow | 17.2 (+1.2) |
| OSRM demo server, current OSM (bridge absent), Dundalk to Ferndale | 22.4 |

**What this shows.** The model's absolute baseline (16.1) is 0.80 of the reported typical commute (20), consistent with the systematic 0.78 ratio to OSRM below. But the reported *increase* (+21 minutes) is about 17 times the model's free-flow increase (+1.2 minutes). Free-flow shortest paths find an almost equally fast route through the Harbor Tunnel. One plausible reading, which this study did not test, is that the 30,000 to 39,000 daily crossings that had to move elsewhere queue on the diversion routes. **The model measures the loss of network connectivity, not the loss of travel-time reliability, and for this pair it underestimates the second by a large factor.** Congestion proxies applied to the model do not close the gap (model, same pair):

| Dundalk to Ferndale, model | Baseline (min) | Bridge removed (min) | Added (min) |
|---|---|---|---|
| free-flow (reference) | 16.1 | 17.2 | 1.2 |
| tunnels x1.25 after closure only (diversion) | 16.1 | 17.6 | 1.6 |
| tunnels x1.5 after closure only (diversion) | 16.1 | 18.1 | 2.0 |
| all speeds x0.8, both worlds | 20.0 | 21.4 | 1.5 |
| all speeds x0.8 and tunnels x1.5 after closure | 20.0 | 22.5 | 2.5 |
| bridge AND both tunnels closed (limit of any tunnel slowdown) | 16.1 | 25.4 | 9.4 |

Even with both tunnels and the bridge unusable (the limit of any tunnel slowdown), the free-flow model adds 9.4 minutes for this pair, less than half of the reported 21. Reproducing the report would need delays on the western I-695 arc and on surface streets that this model does not have.

### 6.2 Independent router (OSRM demo server) as a cross-check of topology and speeds

Public OSRM demo server (https://router.project-osrm.org; routing by OSRM, http://project-osrm.org; data (c) OpenStreetMap contributors, ODbL). Its data is current OSM, in which the bridge is already gone, so its answers should match the *bridge-removed* world. 10 requests in total (8 routes, 2 tables of 50 x 50), one at a time with an identifying User-Agent and at least 1.3 s between requests.
OSRM's car profile has its own speeds and signal/turn penalties and 2026 edits, so it is a cross-check, not ground truth.

| Trip (place-node hexes) | Model baseline (min) | Model bridge removed (min) | Model added (min) | OSRM current OSM (min) | OSRM route's closest approach to bridge site (m) |
|---|---|---|---|---|---|
| Dundalk to Ferndale | 16.1 | 17.2 | 1.2 | 22.4 | 4,424 |
| Ferndale to Dundalk | 16.3 | 16.3 | 0.1 | 20.7 | 4,417 |
| Dundalk to Curtis Bay | 13.3 | 13.3 | 0.0 | 17.7 | 4,424 |
| Sparrows Point to Curtis Bay | 17.3 | 22.8 | 5.5 | 29.2 | 4,540 |
| Dundalk to Hawkins Point | 9.0 | 19.1 | 10.1 | 25.1 | 2,717 |
| Edgemere to Hawkins Point | 12.1 | 26.5 | 14.3 | 33.3 | 2,717 |
| Essex to Glen Burnie | 22.0 | 22.0 | 0.0 | 28.0 | 5,164 |
| Sparrows Point to Brooklyn Park | 18.2 | 22.6 | 4.3 | 29.4 | 4,540 |

Random pairs: 2 x 50 hexes sampled by population against 2 x 50 hexes sampled by jobs (4,997 usable pairs), model times hex to hex including snap time.

| Comparison | Pairs | Median model/OSRM | p10 to p90 ratio | Within 20% | Spearman | Pearson | Median abs. error (s) |
|---|---|---|---|---|---|---|---|
| Bridge-removed model vs OSRM, all pairs | 4,991 | 0.78 | 0.70 to 0.84 | 30% | 0.98 | 0.98 | 298 |
| Baseline model vs OSRM, all pairs | 4,991 | 0.77 | 0.69 to 0.84 | 28% | 0.98 | 0.98 | 299 |
| Bridge-removed, cross-harbor pairs | 2,412 | 0.78 | 0.73 to 0.84 | 35% | 0.97 | 0.98 | 346 |
| Bridge-removed, same-shore pairs | 2,529 | 0.76 | 0.69 to 0.85 | 25% | 0.98 | 0.98 | 242 |
| Pairs the bridge does not touch (model diff < 1 s) | 4,768 | 0.77 | 0.70 to 0.84 | 29% | 0.98 | 0.98 | 291 |

- Rank agreement is very high (Spearman 0.98). The model is systematically faster than OSRM by a median factor of 0.78 (p10 to p90: 0.70 to 0.84): free-flow with no signals or turns. Absolute free-flow times should be read as about a fifth too short relative to a router that includes signals.
- The bridge removal is implemented correctly in topology terms: 197 pairs where the model says the bridge adds more than 60 s; OSRM's time is closer to the bridge-removed model in 100% of them; median abs. error 432 s (bridge removed) vs 722 s (baseline).
- OSRM's routes for the named pairs pass 2.7 to 5.2 km from the bridge site, i.e. do not use it.
- The 0.78 factor does not depend on whether the pair crosses the harbor (0.78 cross-harbor vs 0.76 same shore), so the model's speed error is broad, not a harbor artifact.

## 7. The fast cross-harbor variant vs the exact one

The browser's default cross-harbor lens (`frontend/lib/sim/lenses/xharbor.ts`) approximates the destination side with job-weighted k-means "anchors" per shore (default 64 per shore, 32 for futures), a ramp for jobs-within-budget and exact origins.
We ported it to Python from the TypeScript source (`pipeline/sensitivity/fast_vs_exact.py`) and compared it with the exact all-pairs lens. **As an independent check, the port's error figures were then compared with the TypeScript test's own printed table (`pipeline/sensitivity/out/ts_fast_table.txt`, from running `frontend/test/sim/xharborGolden.test.ts` unchanged, with the build cache directed outside the repo): 6 world x anchor-count comparisons (66 numbers); all agree at the precision TypeScript printed** (`pipeline/sensitivity/compare_ts.py`; for example bridge removed, 64 anchors per shore: people >10% +1.8%, people >25% -1.7%, mean added -0.3%, added p90 +2.9%, top-10 overlap 10/10).

| World | Anchors per shore | Mean-time err, mean (s) | max (s) | Added-time err, mean (s) | max (s) | Loss err, mean (pp) | People >10% | People >25% | Low-wage >10% | Mean added | Added p90 | Top-10 overlap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| keybridge removed | 16 (32 total) | 13.2 | 23 | 1.48 | 12 | 1.06 | -10.9% | -17.1% | -10.0% | -5.4% | -2.3% | 7/10 |
| keybridge removed | 32 (64 total) | 4.2 | 10 | 0.87 | 5 | 0.64 | +8.6% | -11.4% | +9.8% | -4.3% | -2.8% | 8/10 |
| keybridge removed | 64 (128 total) | 1.4 | 5 | 0.42 | 3 | 0.44 | +1.8% | -1.7% | +0.4% | -0.3% | +2.9% | 10/10 |
| keybridge removed | 128 (256 total) | 1.8 | 4 | 0.14 | 1 | 0.18 | -0.5% | -3.4% | -0.8% | +0.2% | -0.5% | 10/10 |
| harbor tunnel closed | 16 (32 total) | 7.8 | 23 | 5.38 | 14 | 0.93 | +2.7% | -5.7% | +2.1% | +10.5% | -4.8% | 8/10 |
| harbor tunnel closed | 32 (64 total) | 5.7 | 13 | 2.35 | 6 | 0.66 | +8.7% | -41.9% | +8.3% | +7.0% | +4.6% | 8/10 |
| harbor tunnel closed | 64 (128 total) | 1.6 | 5 | 0.48 | 3 | 0.41 | +2.2% | +20.0% | +2.0% | -0.3% | -2.1% | 10/10 |
| harbor tunnel closed | 128 (256 total) | 1.4 | 3 | 0.47 | 1 | 0.25 | +5.9% | +51.2% | +6.5% | +1.7% | +1.2% | 10/10 |
| keybridge and harbor tunnel closed | 16 (32 total) | 7.8 | 23 | 5.41 | 13 | 1.28 | +9.6% | +1.0% | +9.3% | +4.0% | -2.3% | 10/10 |
| keybridge and harbor tunnel closed | 32 (64 total) | 6.1 | 12 | 2.01 | 5 | 0.97 | +4.0% | -9.5% | +3.7% | +2.3% | -0.6% | 10/10 |
| keybridge and harbor tunnel closed | 64 (128 total) | 1.9 | 5 | 1.18 | 4 | 0.64 | -0.5% | -15.6% | -0.5% | -0.4% | -2.2% | 9/10 |
| keybridge and harbor tunnel closed | 128 (256 total) | 1.3 | 3 | 0.63 | 1 | 0.35 | +0.3% | -18.0% | +0.1% | +1.0% | +0.6% | 10/10 |

- **The "about 2%" claim holds for the bridge-removed headline at the default 64 anchors per shore** (people >10% +1.8%, >25% -1.7%, low-wage >10% +0.4%, mean added -0.3%). Per-hex, the error is small: mean absolute error of the mean cross-harbor time 1.4 s (max 5 s), of added time 0.42 s (max 3 s), and of the loss fraction 0.44 percentage points on average (but up to 71 points in a single hex with few baseline jobs).
- **It does not hold in general.** At 32 anchors per shore (the futures default) the bridge-removed counts are +8.6% and -11.4%. For the two-crossing worlds the count above 25% is off by -15.6% (bridge plus Harbor Tunnel, 64 anchors) and by +20.0% (Harbor Tunnel alone, 64 anchors), because those counts are small and sit on the cliff edge. Adding anchors does not fix it monotonically (Harbor Tunnel alone at 128 anchors: +51.2%).
- Means and quantiles are safe: mean added time is within 0.3 to 0.4% at 64 anchors in all three worlds; p90 within 2.9%. The worst-10 block groups match 10/10 at 64 anchors for the bridge and Harbor Tunnel worlds and 9/10 for both together.
- Use the fast variant for exploration and for time measures; use exact numbers (this study, `golden.json`) for any count you quote.

## 8. Limitations

1. **Free-flow only; no signals, turns, or congestion** (`A-NO-DELAYS`). Model times are about 22% shorter than an independent router's, and the single sourced real-world detour is about 17 times larger than the model's, and no tunnel slowdown closes the gap. The model captures lost connectivity, not queues on the diversion routes. This is the most important limitation.
2. **Cumulative-opportunity access assumes any resident can take any job** within the budget. Real commutes are constrained by who works where; LODES origin-destination flows were not used.
3. **Counts are cliff-edge statistics** (jobs within a fixed time). See section 5: they vary by more than 10x over plausible parameters. The time-based measures are stable.
4. **Shore rule.** County membership plus a hand-drawn divider, not a water polygon. Tested to +/-1 km and 10% random flips; the whole-city variant shows what happens if the city's south-harbor side cannot be placed.
5. **EMS lens.** 74 of 76 response sources are fire stations (only 2 ambulance stations were found); unit counts, staffing and availability are unknown; response is first-due from the nearest station only, with no hospital transport, no cross-harbor mutual aid and no incident load. "EMS unchanged" means unchanged under that lens. The facility layers (Maryland iMAP) are live 2026 layers while the road network is 2024-03-01. Stations outside the box are excluded, so edge block groups look under-served. The 60 s delay and the 8 minute threshold are assumptions.
6. **Third-party ACS mirror.** Population, zero-vehicle households come from ACS 2020-2024 5-year estimates through the Census Reporter API, a third-party mirror; the official Census API answered every keyless query with a redirect to `missing_key.html` on 2026-09-26 and the official path was not exercised. Block-group margins of error are not propagated. The vintage straddles the collapse.
7. **LODES.** One vintage (2023), noise-infused, workplace-block points; low-wage = earnings up to 1,250 USD/month by home block. Federal military jobs are not in LODES. The vintage difference was not measured.
8. **Hex apportionment.** Population is spread uniformly inside block groups by area; the part of a block group outside the study box is not modeled.
9. **One network, one closure family.** No route choice, no mode, no time of day, no induced or suppressed demand, no scheduling. Candidate "solutions" are hypothetical scenario options with assumed effects.
10. **Study limits.** One-at-a-time sensitivity plus four corners; thresholds for "conclusions hold" are judgement calls; random-closure percentiles depend on the closure definition; the job bootstrap varies where jobs are, not their vintage.

## 9. What would change our conclusions

- **Real speeds.** If measured tunnel and diversion-route speeds (peak) are far below free-flow, the "typical resident is unaffected" conclusion (C4) is wrong and the >10% count grows two to four times (5.3). The Dundalk to Ferndale report suggests real-world effects at least this large for the trips it describes.
- **A different time budget or speed level.** A 24-minute effective budget makes about 96,000 people lose more than 10%; a 36-minute one, about 6,400. The finding "a cross-harbor effect lands on a few places" survives; the count does not.
- **A different affected population.** The counts are residents (and, separately, low-wage residents by home block). Under this model low-wage workers are hit at the same rate as everyone (equity gap -0.06 pp; between -0.16 and -0.01 pp in all 200 bootstraps). Commuters by workplace, zero-vehicle households and transit riders were not tested and could differ.
- **Placing Baltimore city's harbor-side communities on the wrong shore.** If Curtis Bay, Hawkins Point and Canton-side hexes were systematically misassigned, both the counts and the added-time measures would change materially (5.5).
- **EMS with hospital transport, ambulance unit data, or incident volume.** Unchanged first response would no longer be a safe statement if hospital or mutual-aid trips across the harbor were part of the lens; the pre-build spike in `docs/ARCHITECTURE.md` section 0 reported no change in nearest-hospital time, but this study did not re-test it.
- **Evidence that the Key Bridge edge set is wrong** (for example missing approach ramps), or that the OSM graph omits routes that residents use.
- **Random-closure benchmark.** If a size-matched benchmark were defined differently, the bridge's percentile among random closures would move by tens of points (section 4.3). No claim of the bridge being uniquely important should be made from this study.

## 10. Reproduce

From the repository root (no network is needed except for `validate_reality`; results in `pipeline/sensitivity/out/`):

```
cd pipeline
uv run --python 3.12 python -m sensitivity.validate_engine     # study engine vs golden.json
uv run --python 3.12 python -m sensitivity.null_controls       # 4.1 to 4.3(a), about 11 minutes
uv run --python 3.12 python -m sensitivity.random_segments     # 4.3(b), about 15 minutes
uv run --python 3.12 python -m sensitivity.sens_run            # section 5, about 4 minutes
uv run --python 3.12 python -m sensitivity.regional_dest       # 5.4 regional anchors, under 1 minute
uv run --python 3.12 python -m sensitivity.fast_vs_exact       # section 7
uv run --python 3.12 python -m sensitivity.validate_reality    # section 6.2, 10 requests to the OSRM demo server
uv run --python 3.12 python -m sensitivity.pair_congestion     # section 6.1 congestion proxies for Dundalk to Ferndale
uv run --python 3.12 python -m sensitivity.monotonicity        # 4.2 candidate monotonicity on the current catalog
uv run --python 3.12 python -m sensitivity.compare_ts          # section 7, needs out/ts_fast_table.txt
uv run --python 3.12 python -m sensitivity.make_tables         # writes out/tables.txt from the JSON outputs
uv run --python 3.12 pytest -q tests/test_sensitivity.py
```

`out/ts_fast_table.txt` is the printed table of `frontend/test/sim/xharborGolden.test.ts` (`-t FAST`), run from `frontend/` with `node_modules/.bin/vitest run --config <a config outside the repo that sets root to frontend/ and cacheDir elsewhere>` so that nothing under `frontend/` is written; it is checked in as evidence, not regenerated by these scripts.

`data/snapshot/` is not modified by any of these scripts. Random seeds are fixed in the scripts (20260926 for the closure draws, 99 for segments, 7 and 3 for the bootstraps, 11 for the routing pairs).

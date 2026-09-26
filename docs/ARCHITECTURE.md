# WorldSeed Architecture and Build Plan

Status: design, 2026-09-26. Deadline 2026-10-30 (day 35 counting today as day 1).
Scope: Best Apps and Agents track. $0 operating cost. Public demo without login through 2026-12-15.

---

## 0. The spike result that shapes everything

Before committing to the hero visual, a throwaway spike ran on real data (osmnx 2.x, Overpass attic
query `[date:"2024-03-01T00:00:00Z"]`, bbox W-76.66 S39.15 E-76.40 N39.32, drive network, osmnx
imputed free-flow speeds, 44 fire/EMS stations from OSM):

- The historical Overpass query **works**. It returned 12,324 nodes / 30,735 edges in 21 s,
  and the Key Bridge is present as two directed I-695 edges tagged `bridge=yes`
  (about 3.96 km and 4.62 km after simplification).
- **First-due EMS response barely changes when the bridge is removed.** Exactly one node changed
  by more than 0.5 min, and that node was the dead-ended bridge span itself. Baseline node p50/p90
  is 2.75 / 4.78 min, including the 1.0 min dispatch constant. Nearest-hospital travel time also
  did not change. Both shores have their own stations and hospitals.
- **Cross-harbor mobility changes a lot** (free-flow minutes, before -> after):

| Trip | Car | Hazmat (tunnels prohibited) |
|---|---|---|
| Sparrows Pt / Tradepoint -> Hawkins Pt | 15.0 -> 30.1 | 15.0 -> 37.9 |
| Dundalk -> Hawkins Pt | 10.6 -> 21.2 | 10.6 -> 30.4 |
| Edgemere -> Hawkins Pt | 14.2 -> 27.4 | 14.2 -> 35.2 |
| Sparrows Pt -> Curtis Bay | 17.0 -> 22.8 | 17.0 -> 31.3 |
| Dundalk -> Curtis Bay | 12.6 -> 13.9 | 12.6 -> 23.8 |

Consequence: a "delay terrain" built on first-due EMS response would be flat. Showing mountains
there would mean fabricating them. The honest mountains are in **cross-harbor access**
(workers, freight, hazmat, cross-shore EMS mutual aid and transfers). The design therefore makes
the metric a pluggable **Lens** (section 2.4), with **Access** as the hero lens and **EMS** as a
"resilience check" lens that tells the true, non-obvious story: first response held up, and
cross-harbor access is what broke. This needs user sign-off (section 7, D1).

The spike also showed that the bbox must widen to about W-76.80 so the western I-695 arc (the
real detour) is in the graph. Otherwise detours get forced through city streets.

---

## 1. Key architectural decisions

### 1.1 The central abstraction (the decision everything rests on)
**Every world change compiles to one thing: an edge-cost vector plus a source set over a fixed,
immutable CSR graph.**

- The snapshot graph never changes shape at runtime. Everything that could ever exist is baked in
  at build time: the Key Bridge, the tunnels, and every catalog temporary link, which is shipped
  with a `CANDIDATE` flag and disabled in the baseline.
- `WorldState` is an ordered list of `Mutation`s with provenance. `compile(world)` produces
  `{edgeEnabled: Uint8Array, edgeCostMul: Float32Array, sources: Uint32Array, classMask}`.
- The simulator is then one pure function: `(compiledWorld, lens, futureSample) -> fields + metrics`.
- Why this matters: it gives determinism, trivial diff and undo, and zero allocation per
  Monte Carlo sample. The agent validator becomes simple: an agent can only reference IDs whose
  compiled effect is known in advance. "Bridge removed" is not special. It is
  `close_link("L-KEYBRIDGE")`.

### 1.2 Where the simulator and Monte Carlo run: **in the browser (TypeScript, Web Workers)**. Pick.

| Option | Pros | Cons |
|---|---|---|
| **Browser TS + Web Workers** | $0 forever. No cold starts. Scales with judges' devices. Nothing to keep alive until Dec 15. Graph is small (est. 30-40k nodes after bbox widen, CSR about 1.5 MB, about 0.6 MB gz) | Must write Dijkstra in TS (about 150 lines). Slower on weak laptops |
| Python FastAPI on a free host (Render/Fly/HF Spaces) | Reuse networkx/igraph | Free tiers sleep (30-60 s cold start in front of a judge), CPU is shared, keep-alive through Dec 15 is fragile, and some need a card |
| Vercel Function (Node) running the same TS | Same code | 1 vCPU, CPU time counts against Hobby allotment, 4.5 MB payload cap, and a concurrent judge burst could exhaust the free tier |
| Precompute + cache everything | Instant | Cannot cover NL missions or arbitrary combinations. Fine for the tour only |

Pick browser. Sizing: one heap Dijkstra over about 35k nodes on typed arrays takes about 5 ms in V8.
Access lens = K=8 reverse Dijkstras per run, about 40 ms. One agent round = 100 futures x
(baseline + up to 6 bundles) = 700 runs, about 28 s single-thread, about 7-9 s on 4 workers.
Finalists get 200 futures. The EMS lens is 1 Dijkstra per run, 8x cheaper. A Node CLI entry point
reuses the same TS for golden tests. Every result carries `runner: "local-browser"` and the UI
prints "Computed locally in your browser (4 workers, 612 ms)". Tour replays say "Recorded AI run;
numbers recomputed locally". Nothing ever claims cloud compute.

### 1.3 Data pipeline: **build-time Python 3.12 via `uv`, committed artifacts**
System Python 3.9.6 is too old for osmnx 2.x. `uv` and python3.11/3.12 are already installed at
`~/.local/bin`. The pipeline is a `pyproject.toml` under `pipeline/`, run with
`uv run --python 3.12`. Outputs go to `data/snapshot/` and are committed. They are deterministic,
sha256'd in `manifest.json`, and total under about 10 MB, so no LFS. `frontend/scripts/sync-snapshot.mjs`
copies them to `frontend/public/snapshot/` on `prebuild`.

### 1.4 Backend: **thin Next.js Route Handlers on Vercel Hobby (Node runtime, Fluid)**
Only three jobs: hold the keys, compose prompts server-side, and enforce budgets.
- **Hard rule: no generic LLM proxy.** The client never sends prompt text. Each endpoint accepts a
  zod-validated structured payload (mission, candidate IDs, sim results table). The server builds
  prompts from templates in `frontend/src/server/prompts/`. Without this, the demo becomes a free public
  Nemotron endpoint billed to the user.
- Rate limiting and global budgets: **Upstash Redis free tier** (500K commands/mo, no card) via
  `@upstash/ratelimit`. If it is not configured, fall back to an in-memory limiter plus a
  conservative per-instance cap (weaker; logged). Limits: per IP 5 missions/hour and 15/day.
  A global daily token ceiling per model (from D2). A global Tavily cap of 30 calls/day plus a
  6 h response cache keyed by query.
- Hobby limits that apply: 300 s max duration (set `maxDuration = 60` per route), 4.5 MB body
  cap (payloads are KB), 2 GB / 1 vCPU. Hobby is non-commercial, which is fine for a hackathon.

### 1.5 Streaming: **SSE from Route Handlers, client-orchestrated agent loop**
The simulator lives in the browser, so the loop has to be orchestrated from the browser:
`client state machine -> POST /api/agent/plan (SSE) -> server calls Token Factory (stream) -> validated
tool call streamed back -> client executes tool in workers -> client posts results -> next step`.
The server is stateless and re-validates every tool call against the catalog (defense in depth).
SSE events: `status`, `log` (plain sentence), `tool_call`, `usage`, `error`, `done`. Raw reasoning
tokens are never shown. The decision log uses a structured `log_sentence` field instead.

### 1.6 LLM integration: model registry with capability flags and fallbacks
`frontend/src/server/models.ts`: roles map to an ordered candidate list. The IDs below were checked
against the public Token Factory catalog on 2026-09-26. Access on the user's key is unverified.

| Role | Primary | Fallbacks |
|---|---|---|
| planner, critic | `nvidia/Nemotron-3-Ultra-550b-a55b` | `nvidia/nemotron-3-super-120b-a12b` |
| parser, extractor (Tavily) | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | `nvidia/Nemotron-3_5-Lightning`, Super |
| narrator | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Super |

- The registry is overridable via env (`WS_MODEL_PLANNER=...`) so an ID change is a config change.
- `GET /api/health` calls `GET {base}/models` (cached 10 min) and reports which role resolved to
  which model. The UI shows the resolved model name on every AI step ("Planned by Nemotron 3 Ultra").
- Capability flags per model: `supportsTools`, `supportsJsonSchema`, `reasoningToggle`. The
  default path is **JSON-schema structured output** (`response_format`), falling back to JSON-in-text
  plus a repair retry. It never depends on native tool calling. That path can be enabled if the
  probe shows it works.
- Degraded mode: if no planner model resolves, or the budget is spent, the mission panel shows
  **"AI planner unavailable. Explore manually."** Candidate toggles still work, plus a
  **"Deterministic search"** button (greedy over the catalog, labeled as non-AI).
- Cost note: Token Factory is pay-per-token (Ultra lists at $1/M in, $3/M out). A mission is
  about 25k input and 4k output tokens, roughly $0.04 on Ultra. "$0" only holds within free or
  hackathon credits, hence the global daily ceiling (D2).

### 1.7 Repo structure
```
worldseed/
  pipeline/                 Python 3.12 (uv). Build-time only.
    pyproject.toml
    worldseed_pipeline/
      config.py             bbox, OSM date, ACS vintage, counties, h3 res
      fetch_osm.py          attic Overpass -> raw graph + facilities
      fix_keybridge.py      verify/tag L-KEYBRIDGE; manual re-add fallback
      build_graph.py        speeds, classes, corridors, flags, CSR -> graph.bin
      fetch_census.py       ACS 5-yr BG + TIGER cb geometries (+ LODES)
      build_hexes.py        H3 res-9 areal apportionment, snap to nodes
      build_candidates.py   candidates.yaml -> candidates.json (resolve OSM ids -> edge idx)
      build_gazetteer.py
      golden.py             networkx reference results -> golden.json
      manifest.py
    candidates.yaml         hand-curated intervention catalog (source of truth)
    assumptions.yaml        every labeled constant, with source or "assumption"
  data/snapshot/            committed artifacts (section 2)
  data/raw/                 gitignored downloads
  frontend/                    Next.js (App Router) + TS. Vercel root dir = frontend/
    src/app/                page, /api/{health,agent/*,closures}/route.ts
    src/sim/                pure TS: csr.ts, dijkstra.ts, compile.ts, lenses/, futures.ts, prng.ts, metrics.ts, explain.ts
    src/workers/            sim.worker.ts (Comlink), pool.ts
    src/agent/              machine.ts (client loop), tools.ts (zod), validator.ts
    src/server/             models.ts, tokenfactory.ts, tavily.ts, ratelimit.ts, prompts/
    src/state/              zustand stores: world, results, mission, ui
    src/components/         map/, ribbon/, mission/, log/, futures/, finalists/, inspector/, drawer/, cmdk/
    src/tour/               keybridge.json (recorded AI transcript), tour.ts
    test/                   vitest; golden.test.ts
  docs/ ARCHITECTURE.md, DATA_SOURCES.md, FEEDBACK_NOTES.md, ASSUMPTIONS.md (generated)
```

---

## 2. Data contract

All coordinates are WGS84. All times are stored in seconds and displayed in minutes. All binaries
are little-endian.

### 2.1 `data/snapshot/manifest.json`
```json
{ "snapshotId": "keybridge-2024-03-01-v1", "pipelineVersion": "1.0.0", "builtAt": "ISO",
  "osmDate": "2024-03-01T00:00:00Z", "acsVintage": "2018-2022 5-year", "lodes": "LODES8 MD 2021",
  "bbox": [-76.80, 39.10, -76.38, 39.38], "h3Res": 9,
  "files": { "graph.bin": {"sha256": "", "bytes": 0}, "...": {} },
  "sources": [{"name": "OpenStreetMap", "license": "ODbL", "attribution": "(c) OpenStreetMap contributors"}] }
```

### 2.2 Graph: `graph.meta.json` + `graph.bin`
`graph.meta.json`:
```json
{ "nodeCount": 0, "edgeCount": 0,
  "classes": ["motorway","trunk","primary","secondary","tertiary","residential","service","link","candidate"],
  "flags": {"TUNNEL":1,"BRIDGE":2,"HAZMAT_PROHIBITED":4,"TOLL":8,"CANDIDATE":16,"KEYBRIDGE":32},
  "corridors": [{"id":"C-I895-TUNNEL","name":"Harbor Tunnel (I-895)"}],
  "links": [{"id":"L-KEYBRIDGE","name":"Francis Scott Key Bridge (I-695)","edges":[0,1]}],
  "buffers": { "nodeLon": {"offset":0,"length":0,"type":"f32"}, "...": {} } }
```
`graph.bin` buffers (N nodes, E edges):
- `nodeLon f32[N]`, `nodeLat f32[N]`, `nodeOsmId f64[N]` (kept for traceability)
- canonical edges: `edgeFrom u32[E]`, `edgeTo u32[E]`, `edgeTimeS f32[E]` (free-flow),
  `edgeLenM f32[E]`, `edgeClass u8[E]`, `edgeFlags u8[E]`, `edgeCorridor u16[E]` (0xFFFF = none),
  `edgeOsmWay f64[E]`
- forward CSR: `fwdOff u32[N+1]`, `fwdEdge u32[E]` (canonical edge index, target via edgeTo)
- reverse CSR: `revOff u32[N+1]`, `revEdge u32[E]`

`links.geojson`: LineStrings for named links, corridors, and candidate links only (for rendering
highlights). General roads come from the basemap.

### 2.3 Facilities, block groups, hexes, destinations, candidates, gazetteer
`facilities.json`:
`[{ "id":"F-BCFD-06", "kind":"fire_station|ems_station|hospital", "name":"", "lat":0, "lng":0,
"node":0, "snapM":0, "osm":"node/367796387", "active":true }]`. Fire boats and academies are
excluded (list in pipeline config).

`blockgroups.json`:
`[{ "geoid":"245102503001", "i":0, "county":"Baltimore city", "pop":0, "households":0,
"zvh":0, "lowWageWorkers":0, "centroid":[lng,lat], "hexes":[0,1] }]` plus
`blockgroups.geojson` (TIGER cb 500k, simplified to 10 m, properties `{i, geoid}`).
ACS: B01003_001 (pop), B11001_001 (households), zvh = B25044_003 + B25044_010.
LODES RAC SE01 is aggregated to BG.

`hexes.bin` + `hexes.meta.json` (study area: land hexes with pop > 0 or jobs > 0):
`h3 (string[] in meta)`, `lat f32`, `lng f32`, `node u32` (nearest drivable node), `snapS f32`
(snap distance / 20 km/h, assumption), `pop f32`, `zvh f32`, `lowWage f32`, `jobs f32`,
`bg u16`, `shore u8` (0 north/east, 1 south/west, 2 other). Pop is allocated by area share of
the land-clipped BG polygon.

`destinations.json` (Access lens anchors, K <= 8, job-weighted from LODES WAC clusters):
`[{ "id":"D-TRADEPOINT", "name":"Tradepoint Atlantic", "node":0, "jobs":0, "shore":0 }]`

`candidates.json`:
```json
[{ "id": "SP-BROENING", "type": "signal_priority | temp_link | prepos_site | hazmat_window | incident_mgmt",
   "title": "Signal retiming, Broening Hwy detour corridor",
   "lens": ["access","ems"], "costTier": "$|$$|$$$", "costSource": null, "leadTime": "days|weeks|months",
   "hypothetical": true,
   "effect": { "op": "corridor_speed", "corridor": "C-BROENING", "factor": 1.12 },
   "assumptions": ["A-SIGNAL-GAIN"], "sources": [], "notes": "" }]
```
Allowed `effect.op` values:
- `enable_edges{edges[]}`: temp link, ferry or shuttle with a baked wait-time edge.
- `corridor_speed{corridor,factor}`
- `add_source{facilityLike{lat,lng,node}}`: pre-positioning, EMS lens.
- `allow_class_on{edges[],vehicleClass:"hazmat",timePenaltyS}`: escort window.
- `congestion_sigma{corridor,scale}`: incident management.

Target size is 18-30 hand-curated entries. They are labeled hypothetical unless sourced.

`gazetteer.json`:
`[{ "id":"G-DUNDALK", "name":"Dundalk", "aliases":["dundalk md"], "kind":"neighborhood|road|facility|link|corridor", "ref":{"hexes":[..]|"edges":[..]|"facility":"F-..."|"link":"L-..."|"corridor":"C-..."}, "lat":0, "lng":0 }]`

`assumptions.json` (generated from `assumptions.yaml`):
`[{ "id":"A-DISPATCH", "label":"Dispatch + turnout", "value":60, "unit":"s", "status":"assumption|sourced", "source":null }]`

`golden.json`: networkx reference results for baseline, bridge removed, and 2 candidate bundles.
The TS simulator must match within 0.5 s per hex.

### 2.4 World state and mutations (`frontend/src/sim/types.ts`)
```ts
type Origin = "user" | "agent" | "tavily" | "tour";
type Mutation =
  | { kind: "close_link"; linkId: string }                  // L-KEYBRIDGE, tunnels, gazetteer roads
  | { kind: "close_edges"; edges: number[]; label: string } // Tavily-resolved closures
  | { kind: "apply_candidate"; candidateId: string }
  | { kind: "set_facility_active"; facilityId: string; active: boolean };
interface MutationRecord { id: string; m: Mutation; origin: Origin; label: string;
  provenance?: { url: string; quote: string; retrievedAt: string }; confirmedAt: string }
interface WorldState { snapshotId: string; mutations: MutationRecord[] }
interface CompiledWorld { edgeEnabled: Uint8Array; edgeCostMul: Float32Array;
  extraSources: {node: number; delayS: number}[]; sourceMask: Uint8Array; hazmatAllowed: Uint8Array;
  corridorSigmaScale: Float32Array }
```
Nothing enters `WorldState` without `confirmedAt` set by a user action. The tour sets
origin `"tour"` and says so.

### 2.5 Lenses and metrics (`frontend/src/sim/lenses/`)
```ts
interface Lens { id: "access" | "ems"; label: string; unitLabel: string;
  field(cw: CompiledWorld, sample: FutureSample, out: Float32Array): void; // per-hex seconds
  metrics(field: Float32Array, baseline?: Float32Array): Metrics }
```
- **EMS**: forward multi-source Dijkstra from active stations plus `extraSources`.
  `hexT = A-DISPATCH + dist[node] + snapS`. Metrics: pop-weighted p50/p90, % pop within 8 min,
  zvh within 8 min, isolated BGs (pop-weighted BG median > 8 min), equity gap =
  zvh-weighted p90 minus pop-weighted p90.
- **Access** (hero): reverse Dijkstra from each destination on the reverse CSR.
  `hexT = sum_k w_k * t_k + snapS`, with w = jobs share, capped at 120 min. Metrics: pop-weighted
  p50/p90 of access time, % pop with added time <= 5 min, "cut-off" BGs (added time > 10 min,
  analogous to isolated, hatched), equity gap = low-wage-worker-weighted added time minus
  pop-weighted added time. The hazmat sub-view disables tunnel edges where
  `HAZMAT_PROHIBITED && !hazmatAllowed` (COULD).

`Metrics = { p50S, p90S, pctWithin, isolatedBg: number[], equityGapS, zvhWithin?, lowWageAddedS? }`.
Every metric object carries `{ lens, runner: "local-browser", workers, ms, snapshotId, seed? }`.

### 2.6 Simulator API (worker, via Comlink; `frontend/src/workers/sim.worker.ts`)
```ts
load(snapshotBaseUrl: string): Promise<SnapshotInfo>
runDeterministic(world: WorldState, lens: LensId): Promise<RunResult>      // free-flow, no noise
runFutures(world: WorldState, lens: LensId, opts: { n: number; seed: number; tod: "am"|"mid"|"pm"|"night";
           closureProb: number }, onProgress: (done: number) => void): Promise<FuturesResult>
explain(world: WorldState, lens: LensId, hexIndex: number): Promise<CausalChain>
// RunResult   = { field: Float32Array (transferable), metrics: Metrics, meta }
// FuturesResult = { samples: Metrics[], p50: Dist, p90: Dist, pGoal?: number, worstIsolated: {bg:number, freq:number}[],
//                   hexP90: Float32Array, meta: { n, seed, runner, ms } }
// CausalChain = { hex, before: {timeS, viaLinks: string[]}, after: {timeS, viaLinks: string[]}, deltaS, sentence (templated, not LLM) }
```
`pool.ts` fans futures out across `min(4, hardwareConcurrency-1)` workers by seed ranges.

**Futures model** (`futures.ts`). All parameters live in `assumptions.yaml` and are labeled
"stress scenarios, not a traffic forecast".
- Seeded PRNG (sfc32). **Common random numbers**: future i uses the same seed for every candidate,
  so comparisons are paired and fair. The seed is shown in the UI and runs are reproducible.
- Per future: time-of-day profile factor per class, then corridor multiplier
  `m_c ~ LogNormal(mu_class,tod, sigma_class * corridorSigmaScale_c)`, with non-corridor edges
  using the class-level draw. A diversion load factor applies to tunnel corridors when
  L-KEYBRIDGE is closed (`A-DIVERSION`, cite MDTA AADT or label as an assumption).
- With `closureProb`, close one link drawn from `closureEligible` (tunnels, Hanover St bridge,
  Broening Hwy bridge).
- EMS lens: incident locations are sampled from hexes proportional to pop, and the metric uses
  those incidents. Access lens: population-weighted over all hexes.
- `pGoal` = share of futures meeting the mission goal (for example "p90 added access <= 8 min").

### 2.7 Agent tools (zod in `frontend/src/agent/tools.ts`; mirrored server-side)
The planner returns exactly one action per turn:
```ts
propose  { action:"propose",  log_sentence: string(<=160), bundles: { id: string, candidateIds: string[1..3] }[1..6], hypothesis: string(<=280) }
refine   { action:"refine",   log_sentence, keep: bundleId[], drop: bundleId[], add: {id, candidateIds}[0..4] }
finalize { action:"finalize", log_sentence, finalists: { bundleId, tradeoff: string(<=240) }[3] }
```
`evaluate` is not an LLM action. After every propose or refine, the client runs
`runFutures(n=100)` for each bundle plus baseline and returns an **`evaluation` tool message**:
a compact table `{bundleId, p50S, p90S, pctWithin, isolatedCount, equityGapS, pGoal, costTier}`.
The critic (Ultra, separate system prompt) returns
`{ action:"critique", log_sentence, concerns: {bundleId, kind:"worst_case|equity|cost|feasibility", note}[], veto?: bundleId[] }`.
Parser (Nano) returns `{ lens, goal:{metric, op:"<=", targetRef:"baseline+X" }, constraints:{ maxCostTier, types[], areas: gazetteerId[] } }`,
and the user confirms it as chips. The numeric target comes from a chip picker, not from model text.

**Validator rules** (`frontend/src/agent/validator.ts`, re-run server-side):
1. The output parses against the schema. Unknown keys are rejected.
2. Every `candidateId` is in `candidates.json`, matches the mission lens, has `costTier` at or
   below `maxCostTier`, and has `type` in the allowed types. Every gazetteer ID exists.
3. Bundles have 1-3 unique candidates, no duplicate bundles, and at most 12 evaluated bundles per
   mission.
4. Round <= 3. Per-mission token budget (default 60k in + 12k out) is not exceeded. The server
   also enforces `max_tokens` per call.
5. **No numbers in model prose.** `log_sentence`, `hypothesis`, `tradeoff`, and `note` must match
   `/^[^0-9]*$/` after removing `{{slot}}` placeholders. Narration may only cite numbers as slots
   (`{{p90.delta}}`, `{{finalist.B2.pGoal}}`) that the UI fills from simulator results.
6. `finalize` names exactly 3 distinct evaluated bundles, and nothing unevaluated.
7. On violation: one repair turn with the error list. On a second violation, fall back to
   deterministic greedy search, labeled "Planner output rejected; deterministic search used".
   Every rejection is shown in the decision log. Visible guardrails are a feature.

Tavily extraction (Nano) returns `[{ road, from?, to?, startDate?, endDate?, sourceUrl, quote }]`.
Server-side checks: `quote` must be a substring of the Tavily result content (grounding), and
`road` is matched **deterministically** (normalized fuzzy match) to gazetteer road IDs within the
bbox. Unmatched items are shown as "found but not in model area" and cannot be applied.

---

## 3. Phased build plan (day 1 = Sat 2026-09-26)

Cut lines: **MUST** = submission fails without it. **SHOULD** = expected by judges.
**COULD** = only if ahead.

### Phase 0: Setup and truth checks (days 1-2) MUST
1. Get the Nebius key into `.env`. Run `curl $NEBIUS_BASE_URL/models`. Record which Nemotron IDs
   resolve and whether `response_format: json_schema` and streaming work for Ultra, Super, and Nano.
   Write findings to `docs/FEEDBACK_NOTES.md` (dated entries: model, what happened, severity,
   suggestion). Append to it every time friction appears. This feeds the mandatory feedback.
2. Get the Tavily key. Run one search for "Baltimore road closure" and note the result shape.
3. Get user decisions D1-D3 (section 7).
4. `frontend/`: `npx create-next-app@latest frontend --ts --tailwind --app --src-dir`. Add deps: `zustand`,
   `framer-motion`, `@deck.gl/core @deck.gl/layers @deck.gl/geo-layers @deck.gl/extensions @deck.gl/mapbox`,
   `maplibre-gl react-map-gl`, `h3-js`, `comlink`, `zod`, `openai`, `cmdk`, `@visx/*`, `d3-scale`,
   `@upstash/ratelimit @upstash/redis`, `vitest`. Put design tokens in `tailwind.config.ts` and
   load Inter and JetBrains Mono via `next/font`.
5. Deploy the empty app to Vercel Hobby (root dir `frontend/`) on day 2, so deploy problems show up early.

### Phase 1: Snapshot pipeline (days 2-6) MUST
6. `pipeline/pyproject.toml`: osmnx>=2, geopandas, shapely, h3>=4, pandas, numpy, networkx,
   scikit-learn, requests, pyyaml. Put `bbox`, `OSM_DATE`, counties
   `24510, 24005, 24003`, and `H3_RES=9` in `config.py`.
7. `fetch_osm.py`: set `ox.settings.overpass_settings = '[out:json][timeout:{timeout}][date:"2024-03-01T00:00:00Z"]{maxsize}'`,
   then `graph_from_bbox(network_type="drive")` and `features_from_bbox` for fire, EMS, and
   hospital. Cache raw GraphML to `data/raw/`.
8. `fix_keybridge.py`: find edges with `bridge=yes`, ref `I 695`, midpoint within 1.5 km of
   (39.2176, -76.5286). Assert exactly 2 directed edges are found. Tag them `KEYBRIDGE` and register
   `L-KEYBRIDGE`. **Fallback**, documented in `docs/DATA_SOURCES.md`: if the attic query fails,
   fetch the current graph and re-add the two directed edges between the surviving I-695 approach
   nodes, with length from the known span geometry and motorway speed.
9. `build_graph.py`: `add_edge_speeds`/`add_edge_travel_times`, class mapping, flags (`tunnel`,
   and `HAZMAT_PROHIBITED` on the I-95 and I-895 tunnel edges), corridor tagging by name/ref, and
   candidate edges appended from `candidates.yaml` (disabled). Write CSR buffers to `graph.bin`.
10. `fetch_census.py`: ACS API (2018-2022 5-yr, tables in 2.3; no key needed below 500 calls/day),
    TIGER cb 2022 BG shapefile, and LODES8 MD RAC/WAC 2021 (SHOULD: needed for Access destinations
    and low-wage equity).
11. `build_hexes.py`: `h3.geo_to_cells` over land-clipped BGs, then area-share apportionment, snap
    to the nearest node (sklearn BallTree, haversine), `shore` assignment, and `hexes.bin`.
12. `candidates.yaml` with 18-30 entries. `build_candidates.py` resolves OSM way IDs to edge
    indices and fails the build on unresolved IDs. `build_gazetteer.py` covers neighborhoods
    (BG/place names), major roads, facilities, links, and corridors.
13. `golden.py`: networkx reference fields for 4 worlds, written to `golden.json`.
    `manifest.py` writes the sha256 manifest. Add `make snapshot` (or `pipeline/run_all.sh`).

### Phase 2: Vertical slice, the bridge is removed and the terrain rises (days 5-10) MUST
14. `src/sim/csr.ts` (parse `graph.bin` from meta), `prng.ts`, `dijkstra.ts` (binary heap on
    typed arrays; forward and reverse; `maxS` cutoff; fills a `pred` edge array for explain),
    `compile.ts`, `lenses/ems.ts`, `lenses/access.ts`, `metrics.ts`.
15. `test/golden.test.ts`: TS fields match `golden.json`. Add a perf test asserting one EMS
    Dijkstra under 20 ms in Node.
16. `workers/sim.worker.ts` + `pool.ts` (Comlink). `state/world.ts` holds mutations, undo, and
    reset. `state/results.ts` holds baseline and current RunResult.
17. `components/map/WorldMap.tsx`: react-map-gl/maplibre with an OpenFreeMap dark style (verify the
    style URL; fallback is positron with a dimming layer) and `MapboxOverlay` holding
    `H3HexagonLayer` (extruded, elevation = lens minutes x scale, color ramp ok -> warn -> critical,
    elevation and color `transitions` 1200 ms). Isolated BGs get a `PolygonLayer` with
    `FillStyleExtension` hatch. Highlighted links come from `links.geojson`, drawn as a thin
    dashed line where L-KEYBRIDGE was, never animated. Persistent OSM attribution control.
18. `components/ribbon/MetricsRibbon.tsx`: p50, p90, % within, isolated, equity gap, each with a
    baseline -> current delta chip and a runner label.
19. Intro overlay with the one-line dedication, then a "Remove Key Bridge" action (a confirm
    modal, which is the same code path as any mutation) and Reset (R).
    **Day-10 demo: open -> baseline plain -> remove -> terrain rises over Sparrows Pt / Hawkins Pt / Dundalk (Access) -> ribbon deltas.**

### Phase 3: Futures (days 10-13) MUST
20. `futures.ts` (the model in 2.6) and `runFutures` with progress. `assumptions.yaml` params
    appear in `AssumptionsDrawer.tsx` (SHOULD).
21. `components/futures/FanChart.tsx` (visx: p10-p90 band plus median per scenario) and
    `ProgressGrid.tsx` (N cells, filled as futures complete; the count is real).

### Phase 4: Agent loop (days 12-18) MUST
22. `server/models.ts` (registry + probe), `server/tokenfactory.ts` (the `openai` SDK with
    `baseURL`, streaming, usage accounting), `server/ratelimit.ts` (Upstash + in-memory fallback),
    and `app/api/health/route.ts`.
23. `server/prompts/{parse,plan,critique,narrate}.ts`: system prompts embed the catalog subset
    (IDs, titles, types, cost tiers, and no numeric effects, so the model reasons about
    mechanisms, not invented numbers), the rules, and the JSON schema.
24. `app/api/agent/{parse,plan,critique,narrate}/route.ts`: zod input, prompt composition,
    SSE stream, server-side validator, `maxDuration = 60`.
25. `agent/machine.ts`: an explicit state machine
    `idle -> parsing -> confirmGoal -> planning(r) -> evaluating(r) -> critiquing -> finalizing -> finalists -> applied`,
    with a budget meter and a cancel action.
    `agent/validator.ts` follows the rules in 2.7.
    `agent/greedy.ts` is the deterministic fallback searcher.
26. `components/mission/MissionPanel.tsx` (goal text, confirmed chips, budget tier),
    `log/DecisionLog.tsx` (plain-sentence stepper with expandable raw tool JSON, model name,
    tokens used, and validator verdicts), and `finalists/FinalistCards.tsx` (3 cards, no
    "Recommended" badge, Preview / Compare / Apply, cost tier, pGoal, worst-case BG, and narration
    with filled slots). Apply commits the bundle as a mutation and the terrain sinks.

### Phase 5: Tavily, command bar, inspector (days 18-22)
27. MUST: `server/tavily.ts` + `app/api/closures/route.ts`: cache, then search
    (`topic:"news"`, `search_depth:"basic"`, `days:14`, `max_results:8`; 1 credit), then Nano
    extraction, then the grounding check, then deterministic gazetteer matching. The UI toast reads
    "N closures found. Review", followed by a modal with source link and quote, and Apply creates
    a mutation with provenance. If nothing matches the model area, say so honestly. Never fake a hit.
28. SHOULD: `cmdk/CommandBar.tsx` (Cmd-K). The query goes to `/api/agent/parse` with an intent
    schema, which proposes a mutation, and the user must confirm it. Local regex shortcuts
    ("close <gazetteer>", "reset") work without the LLM.
29. SHOULD: `inspector/NeighborhoodInspector.tsx`: click a hex to get BG demographics plus
    `explain()` causal chain ("Fastest route used Key Bridge (I-695); now via Harbor Tunnel,
    +{{delta}}").
30. SHOULD: `EventLog.tsx`: every mutation, run, AI call, and rejection, with timestamps.

### Phase 6: Polish and demo safety (days 22-29)
31. MUST: Guided tour `?tour=keybridge`: a recorded transcript in `src/tour/keybridge.json`
    (real planner outputs captured from a live run, with model names and dates). Numbers are
    **recomputed live** by the simulator. The banner reads "Recorded AI run from <date>; numbers
    computed live in your browser".
32. MUST: States: empty/loading/partial/error/cached for every panel, and the degraded-mode banner.
    SHOULD: presentation mode (P: hide chrome, bigger type), keyboard map, focus rings, and
    color-blind check (hatch plus labels, never color alone).
33. SHOULD: EMS lens toggle and the "resilience check" beat. COULD: hazmat sub-view.
    COULD: "Deterministic check": exhaustive search over small bundles, showing how the AI's
    finalists rank against exhaustive search. This is an honest planner-quality check.
34. MUST: Perf pass: lazy-load the snapshot, gzip/brotli (Vercel default), and first render under
    3 s on a mid laptop.

### Phase 7: Submission (days 29-35, buffer included) MUST
35. README (what, how to run, data sources and licenses, labeled assumptions, the "LLM never
    outputs a metric" architecture diagram), `docs/DATA_SOURCES.md`, a 2-3 min video, and the
    written Nebius/NVIDIA feedback compiled from `FEEDBACK_NOTES.md`.
36. Code freeze on day 32 (Oct 27). Days 33-35 are buffer only.

**Cut order if behind:** 33 -> 30 -> 29 -> 28 -> the EMS lens (Access alone carries the story)
-> the critic call (fold its checks into the planner prompt) -> reduce futures to N=50 with that
label shown.

---

## 4. Reuse and free-tier limits

**Reuse**
- osmnx 2.x: attic Overpass via `settings.overpass_settings`, speed imputation, and
  `features_from_bbox` (proven in the spike).
- networkx, only as the golden reference. igraph/scipy are not needed because runtime is TS.
- h3 (py v4) and h3-js; deck.gl `H3HexagonLayer`, `PolygonLayer` + `FillStyleExtension`
  (hatch), `PathLayer`, and `MapboxOverlay`; react-map-gl/maplibre.
- Comlink for workers, cmdk for the command bar, zod shared client and server, the `openai` SDK
  pointed at Token Factory, @upstash/ratelimit, and visx.

**Limits that can bite**
- Vercel Hobby: functions have a 300 s max duration (use 60), a 4.5 MB body cap, 1 vCPU, are
  non-commercial, and have monthly free allotments. The static snapshot is served from the CDN, not
  from functions.
- Token Factory: this is **paid per token**. Rate limits are undocumented publicly, so measure them
  in Phase 0 and log to FEEDBACK_NOTES. The global daily token ceiling plus the recorded tour keep
  the demo alive when the budget is gone.
- Tavily free: 1000 credits/mo (basic search = 1). Judges' traffic could burn it, so use a 6 h
  cache, a 30 calls/day global cap, and after that serve "Cached result from <time>", labeled.
- Overpass: attic queries are slow and rate-limited, so cache the raw result once. The snapshot
  is frozen after that.
- Upstash free: 500K commands/mo is plenty.

---

## 5. Top risks and de-risking

| # | Risk | De-risk / honest fallback |
|---|---|---|
| R1 | Hero metric is flat (**confirmed for EMS by spike**) | The Access lens is the hero (spike shows +10-15 min car, up to +23 min hazmat). EMS is presented truthfully as resilient. Needs D1 |
| R2 | Ultra not enabled on the account, or rate-limited | Registry falls back to Super. The UI shows the actual model used. The degraded manual mode plus deterministic search still demos the full loop. The recorded tour is captured the first day Ultra works |
| R3 | Token credits run out before Dec 15 | Global daily ceiling, per-IP limits, and a tour that needs no tokens. The live AI button reads "Daily AI budget reached; try the recorded run" |
| R4 | Model ignores the schema or emits numbers | JSON-schema output, validator, one repair turn, then greedy fallback. Rejections are shown as a feature |
| R5 | Historical OSM is painful | Already verified working. Manual re-add fallback is documented in step 8 |
| R6 | Browser Monte Carlo too slow on judge laptops | Reverse-Dijkstra cutoff, N adaptive to measured speed (labeled), 4 workers, and deterministic run shown first while futures stream in |
| R7 | Wrong shore/water artifacts (hexes in the harbor) | Land-clipped cb BGs and a `shore` field. Visual QA against the basemap in Phase 2 |
| R8 | Tavily finds no Baltimore closures on demo day | Honest "No closures found near the model area in the last 14 days", plus a cached earlier result shown with its retrieval date |
| R9 | Tone | No collapse or ship imagery or animation. The bridge appears only as a removed dashed link. Dedication in the intro. Copy review in Phase 6 |
| R10 | Unsourced numbers creep in (AADT, cost, gains) | Every constant lives in `assumptions.yaml` with `status`. The drawer lists them. Anything without a source reads "assumption" |
| R11 | Open proxy abuse of the API routes | No client-supplied prompts, zod-only inputs, rate limits, and a budget ceiling |

Deliberately not done: server-side simulation, user accounts or persistence, live traffic feeds,
transit routing, native tool-calling dependence, and any vision model.

---

## 6. Judging-criteria map
- **Tech**: a multi-step agent (parse -> propose -> evaluate x N futures -> critique -> refine ->
  finalize) with a validator, on Token Factory with Nemotron roles, plus a deterministic,
  golden-tested simulator.
- **Design**: a complete coherent product with honest states and runner labels.
- **Impact**: MDTA/BMC/county planners, with a specific finding: first response stayed resilient,
  and cross-harbor access, freight, and hazmat routing broke, concentrated on low-wage workers.
- **Idea**: the LLM searches a space it cannot score. It never produces a number.

---

## 7. Decisions needed from the user (these change the design)

- **D1 - Hero metric.** The spike shows first-due EMS response is essentially unchanged by the
  bridge loss. Options:
  (a) **Recommended**: Access lens as hero (cross-harbor travel time to job-weighted destinations,
  equity = low-wage workers from LODES), with EMS kept as a secondary "resilience check" lens
  (equity = zero-vehicle households).
  (b) EMS-only: honest but visually flat. The mountains would appear only under stress futures
  (tunnel closure plus congestion), and even then weakly.
  (c) Add a hazmat/freight sub-lens (tunnels prohibit hazmat, and the spike shows about 2-3x
  detours). This is strong for "real problem understanding" but narrower in audience.
  The default if there is no answer is (a), with (c) as COULD.
- **D2 - Token Factory spend.** Token Factory bills per token. What credit amount is available
  (hackathon promo or free credits), and is the user willing to let anonymous judges spend it
  until Dec 15? This sets the global daily token ceiling. The default if there is no answer is
  $1/day on Ultra (about 25 live missions/day), then recorded-tour only.
- **D3 - Upstash free account** (third-party signup, no card) for shared rate limiting and the
  Tavily cache. If declined, use in-memory per-instance limits: weaker, and the budget ceiling
  becomes approximate.

### Resolutions (2026-09-26)
- **D1: (a) chosen by the user.** Access is the hero lens; EMS is the "resilience check" lens;
  the hazmat/freight sub-lens stays COULD.
- **D2: default applies for now.** Global cap of about $1/day on Ultra, then recorded tour only.
  Revisit once the real credit balance is known (Nebius promo emails pending).
- **D3: deferred.** Start with the in-memory limiter; add Upstash only if the user signs up.
- **App directory:** the app lives in `frontend/` (this document originally said `web/`).

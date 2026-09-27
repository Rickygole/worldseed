# WorldSeed guided story: copy deck (DRAFT, plain-language pass)

Copy for the map-first guided story and its Expert mode toggle. Status: written 2026-09-26 against the snapshot
`keybridge-2024-03-01-v1`, then rewritten for plain language at the owner's request ("simple and understood by
everybody"). Nothing here is a result. Every number on screen is inserted through a named slot that the simulator (or
a cited data table, or the documented sensitivity study) fills. No number is typed by hand into a template. The only
typed figures are the cited historical facts in the intro (six workers, March 26, 2024).

Tone: sober, precise, short. No exclamation marks. This is a planning simulation built on a real loss. Follow
[docs/LEGAL.md](LEGAL.md) rule 1 (never describe our own features with the words it forbids) and rule 9 (no
lives-saved framing, no claim about the cause of the collapse or fault beyond cited NTSB findings; this deck makes
none). Rule 11 and the second legal review (freight framing) add: never write "hazmat routing", "route guidance",
"navigation", "traffic management", "safety-critical", "compliance tool" or "vehicle-routing" to describe this tool.
The only required exceptions are two disclaimers shown verbatim: "Planning simulation, not dispatch." (banner, intro,
About) and "Simulation, not route guidance." (scene 4 Popover 4b, its screen-reader text and the dangerous-cargo
tile tooltip). Section 13 item 6 quotes the retired headline only to explain why it changed. Anywhere the copy says the Key Bridge carried
trucks with hazardous materials, it says "in the model" and labels it an assumption.

## 1. Conventions

- **Slots.** `{{name}}` renders the full text (with "about" and the unit where the slot table says so).
  `{{name.value}}` renders the bare numeral for the big-number display, which shows prefix and unit separately.
  If a slot cannot be resolved, hide the sentence and show "Not available for this scenario". Never render a blank,
  a zero or a stale number.
- **Limits (tightened).** Scene sentence: 18 words at most, one sentence, reading grade 8 or lower. Headline: 5 words.
  Step label: 2 to 3 words. Caption: 8 words. Popover: 40 words. Count rendered words at the reference values (the
  Key Bridge link removed, nothing else changed); a numeral is one word; "27-77%" is one word.
- **One big number per scene**, always with a small "Simulated" tag inside the tile. That tag carries the "in the
  model" meaning so the sentences can stay short. Back and Next only move between scenes; they are not actions. Each
  scene has one action button.
- **Everyday words on the default path.** Use these, and define the technical term once in a popover or in the
  glossary (section 11):

  | Technical | Say instead | Defined in |
  | --- | --- | --- |
  | cross-harbor, xharbor | across the river; a trip to jobs across the river | Glossary "Across the river" |
  | hazmat | dangerous cargo (first use in a popover: "hazardous materials, like some fuels and chemicals") | Popover 4a |
  | first response, EMS p90 | fire stations; the time to the nearest station | Popover 3a |
  | regional average | the average across the whole region | Popover 1a |
  | assumption-sensitive | "depending on assumptions" (chip) | Popover 2a |
  | free-flow | with no traffic jams | Popover 1a |
  | block group | spot (area) | Popover 2c |
  | option, futures | idea, what-if runs | Glossary |

- **Say "reach", never "lose jobs".** People "reach fewer jobs". No one in this copy loses a job.
- **No blame, no names, no animation of the collapse.** The removal in scene 1 is a plain fade of the link line.
- **Simulated, not measured.** Any time or count is simulated. Popovers carry the caveats, not extra sentences.

## 2. Scene order and why

| # | Step label | Headline (5 words max) | Why here |
| --- | --- | --- | --- |
| 0 | (none) | Intro card | Dedication first, one premise sentence, skip always visible. |
| 1 | The bridge | The crossing is removed | Calm baseline, one click, and a small number on purpose so the next scene lands. |
| 2 | The local story | Averages hide the local story | The claim the tool exists for, always with its range. |
| 3 | What held | What did not break | Relief after the loss, and the honest counter-example. |
| 4 | Dangerous cargo | Tunnel rules change the trip | The largest effect in minutes, with a documented rule (MDTA). The headline avoids "must", which could read as an instruction. |
| 5 | What could help | What could help? | After the problem is understood; ends on the honest residual. |
| 6 | Explore | Now explore | Hand-off to Expert mode. |

Two changes from the original brief, both for accuracy: scene 1 says "removed" (the model removes a link, it does not
depict an event), and scene 4 is about dangerous cargo, not "freight" (only cars and hazmat trucks are modeled).
Scenes 2 to 5 need the bridge link removed; if the user restores it, show the gate in section 7.

## 3. Slot table

Source names the lens and metric. "study" slots come from the separate sensitivity study
([METHODOLOGY.md](METHODOLOGY.md), `frontend/lib/ui/methodology.ts`), not from a simulator run in the session, and
are valid only when the world on screen is exactly the Key Bridge-removed reference world. Recommendation: emit them
into a generated snapshot file so they are never typed in code either.

| Slot | Meaning | Unit | Source (lens / metric) | Formatting rule |
| --- | --- | --- | --- | --- |
| `snapshot.date` | Date of the road network | date | Snapshot manifest (OpenStreetMap attic date) | "1 March 2024". |
| `regional.addedS` | Change in the average drive to the region's 8 main job centers, per resident, absolute value | seconds | Regional access lens; `current.v.regional - baseline.v.regional` | Below 0.5 s: "under 1 second". Else round to a whole second, prefix "about", unit "seconds" ("second" for 1). |
| `regional.dir` | Direction of that change | enum: longer, shorter, none | Same metric; longer if delta >= 0.5, shorter if <= -0.5, else none | Selects a template. Never shown. |
| `xharbor.peopleGt10` | People who reach more than 10% fewer of the opposite-shore jobs within the time budget ("affected") | people | Cross-harbor lens; `current.v.xhPeople` | 2 significant figures, prefix "about", thousands separators (`fmtAbout`). Below 100: whole number, no prefix. |
| `xharbor.worstBgCount` | Number of hardest-hit spots (block groups with mean loss over 25%) | spots | Cross-harbor lens; `worstBlockGroups.byLossPct` with `meanLossPct > 25` | Whole number. Zero selects the "no spots" template. |
| `xharbor.worstLossRangePct` | Lowest to highest mean loss among those spots | percent | Same list; min and max `meanLossPct` | Whole percent, "27-77%"; one value as "40%". Used in Popover 2d and Expert. |
| `xharbor.worstAreaLabel` | Short place label for those spots | text | Nearest OpenStreetMap place to each spot's center (`placesFor`); a reviewed label table maps the reference set to "Sparrows Point and Edgemere" | Up to 3 names joined "a, b and c". No "the" and no "peninsula". Falls back to "the hardest-hit spots". Approximate, not a boundary. |
| `def.budgetMin` | Time budget of the jobs measure ("reach") | minutes | Assumption `A-XHARBOR-T` | Whole number. |
| `def.lossPct` | Loss threshold that defines "affected" | percent | Lens definition | Whole number, no sign. |
| `def.emsPct` | Share of people the station-time number covers | percent | Station-time lens quantile (p90) | Whole number. |
| `def.callDelayMin` | Delay to get moving after a call | minutes | Assumption `A-CALL-TO-WHEELS` | Whole number if integer, else 1 decimal. |
| `study.peopleGt10.lo` / `.hi` | Lowest and highest count across the tested variants | people | Sensitivity study, METHODOLOGY 0 and 5 (`PEOPLE_GT10_RANGE`) | 2 significant figures, **no prefix** (templates write "about"). |
| `study.meanAdded.lo` / `.hi` | Range of average added trip time across speed variants | seconds | Sensitivity study (`MEAN_ADDED_RANGE_S`) | Whole seconds, no prefix. Expert only; not used in the story. |
| `study.speedVariantPct` | Size of the speed change tested | percent | Sensitivity study variant definition | Whole number. |
| `study.detour.beforeMin` / `.afterMin` | Reported Dundalk to Ferndale commute before and after | minutes | METHODOLOGY 6.1 (`REPORTED_DETOUR`) | Whole number, no prefix. |
| `study.detour.modelAddedMin` | Model's added time for that pair | minutes | METHODOLOGY 6.1 | 1 decimal, no prefix. |
| `study.detour.bothTunnelsMin` | Model's added time with both tunnels also closed | minutes | METHODOLOGY 6.1 | Whole number, no prefix. |
| `study.fastErrPct` | Quick method's error at its default setting | percent | METHODOLOGY 7 (about 19,700 exact vs 20,100 in the app) | Whole percent. |
| `study.fastErrFuturesPct` | Quick method's error at the coarser setting the search uses | percent range | METHODOLOGY 7 | "9 to 11%". |
| `ems.p90Min` | Simulated time to the nearest station covering `def.emsPct`% of people, current world | minutes | Station-time lens; `current.v.ems / 60` | 1 decimal. |
| `ems.baselineP90Min` | Same, baseline world | minutes | `baseline.v.ems / 60` | 1 decimal. |
| `ems.state` | Whether it changed | enum: unchanged, moved | Unchanged if change < 1 s and change in the share within 8 minutes < 0.05 points | Selects a template. |
| `ems.shoresWithStations` | Shores with at least one fire station | count | Snapshot facilities joined to the shore field | Whole number. The "both sides" sentence needs 2. New accessor. |
| `data.fireStations` / `data.ambulanceStations` | Stations in the station-time lens | stations | Snapshot facilities | Whole number. |
| `freight.hazmatMeanAddedMin` | Mean added time, truck with dangerous cargo, across the river | minutes | Trips set; `summary.hazmat_truck.crossHarborMeanAddedMinutes` | Big number: whole minute, prefix "about". Expert: 1 decimal. |
| `freight.carMeanAddedMin` | Same for a car | minutes | `summary.car.crossHarborMeanAddedMinutes` | Whole minute, prefix "about". |
| `freight.crossHarborTrips` | Trips across the river in the set | trips | `summary.*.crossHarborTrips` | Whole number. |
| `freight.anchorCount` | Road places the trips connect | places | DATA_SOURCES 10 (`trips.yaml`) | Whole number. New accessor. |
| `cite.mdtaAccessed` | Access date of the MDTA rule page and the MDTA Key Bridge news page | date | DATA_SOURCES 10; legal review 2 | "26 September 2026". |
| `privacy.retentionDays` | Longest time the server keeps the hashed fair-use counter | days | Limiter TTL configuration (daily cap keys are 2 days); must match it | Whole number. |
| `catalog.count` | What-if ideas in the catalog | ideas | `candidates.json` | Whole number. |
| `catalog.helpfulCount` | Ideas that meaningfully help in the catalog tests | ideas | Catalog effect measurements (README "about four") | Prefix "about" + whole number. [VERIFY before ship] |
| `options.best.recoveredPct` | Share of the added loss that the best idea tried wins back, in the world with it applied | percent | Cross-harbor lens; `(loss_removed - loss_with_option) / (loss_removed - loss_intact)` on the measure in `options.best.recoveryMeasure` | 2 significant figures, prefix "about", clamped 0 to 100. |
| `options.best.recoveryMeasure` | Which measure `recoveredPct` uses | text | Fixed label from the search goal | Shown in the number's tooltip. Always named. |
| `options.best.residualPeople` | People still "affected" with that idea applied | people | Cross-harbor lens, world with the idea; `xhPeople` | Same as `xharbor.peopleGt10`. |
| `option.titles` | Titles of the idea(s) being applied | text | Catalog titles (application-written, never model text) | Comma list. |
| `search.done` / `search.total` | What-if runs completed and planned | runs ("futures") | Search progress counter | Whole numbers. |
| `search.mode` | Planner in use | enum: ai, deterministic | `/api/health` and search state | Selects label. |
| `ai.model` | Model that actually ran | text | `/api/health` | Verbatim. |
| `goal.targetMin` / `goal.costTier` | Preset goal size and cost tier | minutes, tier | Planner defaults | "1 minute", "$$". |
| `closure.roadName` / `.sourceDomain` / `.quote` / `.retrievedAt` | A news-derived closure candidate | text, date | `/api/closures`; quote is verbatim and screened | Quote in quotation marks. Viewer's locale for time. |
| `cache.retrievedAt` | Time a cached result was produced | time | Cache metadata | Viewer's locale. |
| `story.scene` / `story.total` | Current scene and scene count | scenes | Story state | Whole numbers. |

## 4. Scene 0: Intro card (30 words of body text; buttons not counted)

| Field | Copy |
| --- | --- |
| id | `intro` |
| Line 1, small | In memory of the six construction workers who died when the Key Bridge fell, March 26, 2024. (17 words) |
| Line 2, large | See who is affected if the bridge is removed. (9 words) |
| Line 3, small | Planning simulation, not dispatch. (4 words) |
| Primary button | Start the walk-through |
| Secondary button | Skip to the map (also Escape, and a "Skip intro" link top right) |
| What a stranger should understand in five seconds | A bridge was lost and people are remembered. This tool shows, in a model, who a lost bridge would affect. |
| Big number | None. Exempt. |
| Screen reader | Dialog "Introduction". On open, read line 1, then line 2. |

The full dedication wording ("...when the Francis Scott Key Bridge collapsed on March 26, 2024") stays in About and in
[DEDICATION.md](DEDICATION.md). No auto-advance. No collapse footage, imagery or animation.

## 5. Scenes 1 to 6

Every scene: the story bar shows "Scene {{story.scene}} of {{story.total}}", the step label, Back, Next and the
Expert mode toggle (section 8).

### Scene 1: The bridge

| Field | Copy |
| --- | --- |
| id | `crossing` |
| Step label | The bridge |
| Headline | The crossing is removed |
| Sentence, before the action | Remove the Key Bridge from the map to see what changes. (11 words) |
| Sentence, after the action | The average drive to jobs gets {{regional.addedS}} longer, since most trips skip the bridge. (16 words) |
| Big number | `{{regional.addedS.value}}`, prefix "about", unit "seconds", small tag "Simulated". Before the action it shows 0 seconds (the computed baseline). |
| Caption | Extra drive time, across the whole region (7 words) |
| What a stranger should understand in five seconds | Across the whole region, losing the bridge adds only a few seconds to the average drive. |
| Action button | Remove the Key Bridge |
| What the action does | Removes the `L-KEYBRIDGE` link (six directed I-695 edges), recomputes every lens in the browser, fades the link line (no collapse animation) and raises the terrain where access changed. Button then reads "Removed"; Restore lives in Expert mode. |
| Caveat chip | Is this too small? (opens Popover 1a) |
| Popover 1a (40 words; the reported claim is one clause) | Free-flow: no traffic jams, so delays can be larger. Maryland Matters (via Baltimore Fishbowl, link) reported a Dundalk to Ferndale commute rising from about {{study.detour.beforeMin}} to {{study.detour.afterMin}} minutes. The model adds about {{study.detour.modelAddedMin}} minutes, or {{study.detour.bothTunnelsMin}} with both tunnels closed. |
| Popover 1a source | Maryland Matters, 28 March 2025; text read via Baltimore Fishbowl (link). Never quote more than the one clause above. Methodology, section 6.1. |
| Screen reader, before | Scene {{story.scene}} of {{story.total}}, the bridge. The map shows roads with the Key Bridge in place. Button: Remove the Key Bridge. |
| Screen reader, after (aria-live, polite) | The Key Bridge is removed. In the simulation, the average drive to jobs gets {{regional.addedS}} longer. |
| Map alt text | 3D map of the Baltimore area. Taller areas mean a longer average trip to jobs across the river. |

### Scene 2: The local story

| Field | Copy |
| --- | --- |
| id | `local` |
| Step label | The local story |
| Headline | Averages hide the local story |
| Sentence | Averages hide this: the worst-hit spots are near {{xharbor.worstAreaLabel}}. (12 words) |
| Big number | `{{xharbor.peopleGt10.value}}`, prefix "about", unit "people", tag "Simulated". |
| Caption | Reach over {{def.lossPct}}% fewer jobs across the river (8 words) |
| Range chip (always on the same line as the number) | Could be as low as about {{study.peopleGt10.lo}} or as high as about {{study.peopleGt10.hi}}, depending on assumptions. |
| Range chip button | Why such a wide range? (opens Popover 2a) |
| What a stranger should understand in five seconds | The average hides some places that are hit hard, and the exact number of people is uncertain. |
| Action button | Show me where |
| What the action does | Switches to the jobs-across-the-river view, flies the camera to the hardest-hit spots, turns on the hatch for more than 25% fewer jobs and marks them with the place label. |
| Popover 2a: why the range (30 words) | Move every driving speed {{study.speedVariantPct}}% up or down and the count swings from about {{study.peopleGt10.lo}} to about {{study.peopleGt10.hi}}. The extra drive time and the worst-hit areas change much less. |
| Popover 2b: quick method (35 words) | The app uses a quick way to estimate this count. It is within about {{study.fastErrPct}} of the slower exact method. When searching for ideas it uses a rougher setting, off by about {{study.fastErrFuturesPct}}. |
| Popover 2c: spots and names (20 words) | Spots are Census block groups, small areas used for Census counts. Place names are the nearest known place, not official borders. |
| Popover 2d: how bad in the worst spots (26 words) | In the worst-hit spots, people can reach {{xharbor.worstLossRangePct}} fewer jobs across the river. Reach means a drive of {{def.budgetMin}} minutes or less, with no traffic jams. |
| Screen reader | Scene {{story.scene}} of {{story.total}}. Simulated: {{xharbor.peopleGt10}} people reach over {{def.lossPct}}% fewer jobs across the river. It could be as low as about {{study.peopleGt10.lo}} or as high as about {{study.peopleGt10.hi}}. The worst-hit spots are near {{xharbor.worstAreaLabel}}. |
| Map alt text | Map of areas where people can reach fewer jobs across the river. Hatching marks areas with more than 25% fewer. |

### Scene 3: What held

| Field | Copy |
| --- | --- |
| id | `held` |
| Step label | What held |
| Headline | What did not break |
| Sentence | Both sides of the river have fire stations, so the time to the nearest one did not change. (18 words) |
| Big number | `{{ems.p90Min.value}}`, unit "minutes", tag "Simulated". Chip: Unchanged from before. |
| Caption | To a station, for {{def.emsPct}}% of people (7 words) |
| What a stranger should understand in five seconds | Fire and ambulance stations on both sides mean this part did not get worse. |
| Action button | Show both sides |
| What the action does | Switches to the station-time view and pulls the camera back so stations on both shores are visible. Shows before and now side by side. |
| Popover 3a: what is measured (35 words) | "First response" here means the time to the nearest of {{data.fireStations}} fire stations and {{data.ambulanceStations}} ambulance stations, plus a {{def.callDelayMin}}-minute delay to get moving. It ignores staffing, hospital transport and how many calls come in. |
| Popover 3b: what unchanged means (29 words) | Unchanged means this scenario does not change nearest-station times in the model. It does not say emergency response is good enough. It leaves out stations outside the study area. |
| Screen reader | Scene {{story.scene}} of {{story.total}}. Simulated: the time to the nearest station for {{def.emsPct}}% of people is {{ems.p90Min}} minutes, unchanged from before. |
| Map alt text | Map of fire and ambulance stations on both shores, with the time to the nearest station shown for each area. |

### Scene 4: Dangerous cargo

| Field | Copy |
| --- | --- |
| id | `hazmat` |
| Step label | Dangerous cargo |
| Headline | Tunnel rules change the trip |
| Sentence | Both tunnels bar listed hazardous loads, so in the model those trucks take much longer. (15 words) |
| Big number | `{{freight.hazmatMeanAddedMin.value}}`, prefix "about", unit "minutes", tag "Simulated". |
| Caption | Extra per trip; cars add {{freight.carMeanAddedMin}} (8 words) |
| Note line (always visible, small) | Escort options in Expert mode are made-up examples, not an MDTA program. (12 words) |
| Source line 1 | Maryland Transportation Authority (MDTA), "Transporting Hazardous Materials Across Our Toll Facilities", https://mdta.maryland.gov/TunnelRestrictionsAndVehiclePermits, accessed {{cite.mdtaAccessed}}. |
| Source line 2 | Alternate route: MDTA Key Bridge news, https://mdta.maryland.gov/keybridgenews, accessed {{cite.mdtaAccessed}}. |
| What a stranger should understand in five seconds | Some trucks cannot use the tunnels, so in the model their trips take much longer than a car's. |
| Action button | Show the detour |
| What the action does | Opens the trip with the largest added time and draws the car path and the truck path (dim = before, bright = now). Nothing on this screen tells anyone which way to drive. |
| Popover 4a: what "listed hazardous loads" means (33 words) | Both tunnels bar trucks carrying certain hazardous materials (like some fuels and chemicals). This summarizes a Maryland Transportation Authority (MDTA) rule; its published rules govern, not this tool. Not every truck carries them. |
| Popover 4b: "Simulation, not route guidance" (35 words) | Simulation, not route guidance. Drive times are simulated at free-flow speeds on the pre-collapse ({{snapshot.date}}) road network. Carriers must follow posted and designated hazardous-materials routes. Not affiliated with or endorsed by the MDTA. |
| Popover 4b links | MDTA rule (link, accessed {{cite.mdtaAccessed}}); Alternate route: MDTA Key Bridge news (link, accessed {{cite.mdtaAccessed}}). |
| Popover 4c: assumption and detour (37 words) | In the model, the Key Bridge carried these trucks: an assumption, since the MDTA tunnel rule does not cover the bridge. Without the bridge, in the model they take the western I-695 arc, MDTA's named alternate route. |
| Popover 4d: escort options (28 words; also the tooltip on every escort option in Expert) | The escort options in Expert mode are made-up examples. They are not an MDTA program, proposal or finding, and nothing here says they would be safe or lawful. |
| Escort option titles in Expert | Add the suffix " (hypothetical; not an MDTA program)" wherever a title is shown. |
| Screen reader | Scene {{story.scene}} of {{story.total}}. Simulated: in the model, trucks carrying listed hazardous materials add {{freight.hazmatMeanAddedMin}} minutes on average across {{freight.crossHarborTrips}} river trips. Cars add {{freight.carMeanAddedMin}} minutes. Simulation, not route guidance. |
| Map alt text | Map showing two simulated paths for one trip across the river: the car path and the longer path for trucks carrying listed hazardous materials. |

The caption renders "Extra per trip; cars add about 6 minutes"; the unit "minutes" after the big number and the unit
inside the caption are both slot-driven. The model times {{freight.crossHarborTrips}} set trips across the river
between {{freight.anchorCount}} road places at free-flow speeds; that method line lives in the Expert tooltip, not in
the story.

### Scene 5: What could help

| Field | Copy |
| --- | --- |
| id | `help` |
| Step label | What could help |
| Headline | What could help? |
| Sentence, ready | Test {{catalog.count}} what-if ideas and see which ones help most. (10 words) |
| Sentence, searching | Testing each idea in many what-if runs. (7 words); progress line below it: "{{search.done}} of {{search.total}} futures completed" |
| Sentence, finished or applied | The best idea we tried helps, but it does not undo the loss. (14 words) |
| Big number | Ready and searching: "--" (skeleton). Finished or applied: `{{options.best.recoveredPct.value}}`, prefix "about", unit "%", tag "Simulated". |
| Caption | Of the lost access to jobs won back (8 words) |
| Chip under the number (finished or applied) | Still affected: {{options.best.residualPeople}} people |
| Number tooltip | Measure: {{options.best.recoveryMeasure}}. Simulated in the world with the idea applied. |
| What a stranger should understand in five seconds | Some ideas win back part of the loss, none brings the bridge back, and the results rest on assumptions. |
| Goal preset line | Goal: cut the slowest trips to jobs across the river by {{goal.targetMin}}, cost up to {{goal.costTier}}. Change it in Expert mode. |
| Planner label | `search.mode` deterministic: "Deterministic search (no AI)". ai: "AI planner: {{ai.model}}". |
| Chips | Assumed speed factors (opens 5a). What-if ideas (opens 5b). Quick method (opens 2b). |
| Action button by state | Ready: Find a better future. Searching: Stop search. Finished: Apply the best idea. Applied: Continue. |
| What the action does | Runs the existing search with the preset goal, shows the three finalists in a compact list, and after Apply recomputes every lens and the big number from the applied world. Compare and Preview stay in Expert mode. Apply opens the dialog in section 9. |
| Popover 5a: assumed speed factors (33 words) | Every idea's effect is an assumption, not an agency finding. For example, some ideas make a road faster by an assumed amount. The share won back is only as reliable as those assumptions. |
| Popover 5b: what-if ideas (29 words) | All {{catalog.count}} ideas are what-ifs. No agency proposed, studied or backed them. Costs are rough levels, not dollar amounts. In our tests, {{catalog.helpfulCount}} help in a meaningful way. |
| Screen reader, ready | Scene {{story.scene}} of {{story.total}}. Button: Find a better future. Tests {{catalog.count}} what-if ideas. |
| Screen reader, progress (polite, at most every 10 seconds) | {{search.done}} of {{search.total}} futures completed. |
| Screen reader, finished | Search finished. Simulated: the best idea we tried wins back {{options.best.recoveredPct}} of the lost access to jobs. {{options.best.residualPeople}} people are still affected. |

The scene never says "fixed" or "solved". If the residual is above zero the sentence stands; other cases are in
section 14.

### Scene 6: Explore

| Field | Copy |
| --- | --- |
| id | `explore` |
| Step label | Explore |
| Headline | Now explore |
| Sentence | Now it is your turn: click the map, switch views, and check the assumptions. (14 words) |
| Big number | `{{xharbor.peopleGt10.value}}`, prefix "about", unit "people", tag "Simulated". Live: it follows the scenario the user builds. |
| Caption | Affected, as the map shows now (6 words) |
| Range chip | Same rule as scene 2; shown only in the reference world. |
| What a stranger should understand in five seconds | The whole tool is open now, and I can try things myself. |
| Action button | Open expert mode |
| What the action does | Closes the story bar, opens the full analyst workspace, keeps the current scenario. |
| Screen reader | Scene {{story.scene}} of {{story.total}}. Button: Open expert mode. |

## 6. Screen-reader conventions

- The story bar is a `region` labeled "Guided story". The sentence sits in a polite live region and is announced once
  per scene or state change. Numbers are announced with "Simulated", the unit and the caption in one string.
- Popover triggers are buttons with `aria-expanded`. Popover text is not a live region.
- Search progress announces at most every 10 seconds and on completion.
- The map is `role="img"` with the alt text of the current scene. The same information is in the sentence, so no
  information lives only on the map.
- Reduced motion: terrain and camera changes become a crossfade (existing behavior).

## 7. Loading, error, degraded and gate microcopy

| State | Copy |
| --- | --- |
| Snapshot loading | Loading the map, roads, people and jobs as of {{snapshot.date}}. This runs in your browser. |
| Snapshot loading, skeleton | "--" for the number, grayed caption, two skeleton lines for the sentence, `aria-busy="true"`. |
| Computing a scenario | Recalculating in your browser. |
| Snapshot failed | The map data did not load. Check your connection, then try again. Button: Retry. Link: Data sources and intended use. |
| Simulator stopped | The simulator stopped before it finished. Your scenario is unchanged. Button: Run again. |
| AI planner unavailable | Deterministic search (no AI). The AI planner is unavailable, so the same search runs without it. It follows the same steps every time. |
| AI planner setup in progress | The AI planner is not set up on this demo yet. Deterministic search (no AI) works now. |
| Daily AI budget reached | The shared daily AI budget is used up. Deterministic search (no AI) and exploring by hand still work. Try the AI planner again tomorrow. |
| Search running | {{search.done}} of {{search.total}} futures completed. (A future is one what-if run.) |
| Search partial | {{search.done}} of {{search.total}} futures completed. Results below use only those. |
| Search stopped by user | Search stopped at {{search.done}} of {{search.total}} futures. Results use the futures completed. |
| Cached news lookup | Saved lookup from {{cache.retrievedAt}}. News reports are unverified. |
| Cached simulator result | Calculated earlier for this exact scenario ({{cache.retrievedAt}}). |
| News lookup, nothing found | No usable closure reports found in the model area. Nothing was added. |
| News lookup unavailable | The news lookup is unavailable right now. The rest of the tool works. |
| Gate: bridge restored in scenes 2 to 5 | This scene needs the Key Bridge removed. Button: Remove the Key Bridge. |
| Gate: snapshot has no hazmat trips | Trips with dangerous cargo are not in this data snapshot. This scene is skipped. |
| Not available | Not available for this scenario. |
| Decision log: raw reasoning section (collapsed by default) | Model reasoning (raw, unverified; not a result). Written by an AI model and shown without human review. It may be wrong or inappropriate and is not the view of WorldSeed. |
| Decision log: reasoning blanked by the screen | The model's reasoning did not pass our text screen and was removed. The answer itself is still used. |
| Expert evidence panel, rail hint | Published sources about the 2024 detours (unverified) |

## 8. Expert mode toggle, ribbon tooltips, keyboard hints

**Toggle**

| Element | Copy |
| --- | --- |
| Control label | View mode |
| Segments | Guided story, Expert mode |
| Tooltip (story active) | Open the full workspace: every view, the map inspector, the assumptions and the idea search. |
| Tooltip (expert active) | Go back to the story at scene {{story.scene}}. |
| Return button in expert | Back to the story |
| First-time note in expert (dismissible) | Everything from the story is here. Nothing was reset. |
| Screen reader | Toggle button "Expert mode", pressed or not pressed. |

**Ribbon tiles (five, plus one optional).** Plain tooltips; the terms are defined in the glossary.

| Tile name | Tooltip |
| --- | --- |
| People affected | People who can reach over {{def.lossPct}}% fewer jobs across the river within a {{def.budgetMin}}-minute drive. It can change a lot with assumptions; see the range. |
| Low-wage workers | Low-wage workers who reach over {{def.lossPct}}% fewer jobs across the river, next to the same rate for everyone. |
| Regional drive | Change in the average drive from home areas to the region's main job centers, with no traffic jams. |
| Station time | Simulated time to the nearest fire or ambulance station for {{def.emsPct}}% of people, including a {{def.callDelayMin}}-minute delay to get moving. |
| Trip across the river | Average drive from home to jobs on the other side of the river, weighted by number of jobs, compared with before. |
| Dangerous cargo (optional sixth) | Simulated extra minutes for a truck carrying certain hazardous materials to cross the river, averaged over {{freight.crossHarborTrips}} set trips, with no traffic jams. Simulation, not route guidance. |

Chip words: "Unchanged", "Higher", "Lower". The word "held" stays in Expert only.

**Keyboard hints** (keys marked new do not exist yet and must be built or dropped)

| Keys | Hint |
| --- | --- |
| Right arrow | Next scene (new) |
| Left arrow | Previous scene (new) |
| E | Switch Expert mode on or off (new) |
| Escape | Close a popover or dialog; skip the intro |
| R | Reset the scenario (existing) |
| P | Presentation mode (existing) |
| Ctrl or Cmd + K | Open the command bar (existing) |
| ? | Show these shortcuts (new) |

## 9. Confirmation dialogs

**Apply an idea** (`role="alertdialog"`; Escape cancels)

| Element | Copy |
| --- | --- |
| Title | Apply this idea to the simulation? |
| List | {{option.titles}} |
| Body | This is a what-if idea with an assumed effect. It is not an agency plan or advice. It changes only this simulation, and every number is recalculated. Reset removes it. |
| Buttons | Apply in simulation, Cancel |

**Confirm a news-derived closure** (one at a time; a signed single-use token is required on the server)

| Element | Copy |
| --- | --- |
| Title | Add this closure to the simulation? |
| Body | {{closure.roadName}}, from a news report on {{closure.sourceDomain}} that we could not verify: "{{closure.quote}}" Read the source before you confirm. This changes only the simulation. Reset removes it. |
| Low-confidence line (warning tone) | Low confidence. The quote describes a possible future closure, not a current one. Open the source first. |
| Buttons | Open source, Add closure, Cancel |
| Badge on the card | Unverified news report |

## 10. About this tool (short)

**About WorldSeed.** WorldSeed is a research and educational prototype that explores what-if planning scenarios. It is
a planning simulation, not dispatch, and must not be used to direct or delay any real emergency response. In an
emergency, call 911. It gives no driving directions and does not check anyone's compliance with any rule.

**Dedication.** In memory of the six construction workers who died when the Francis Scott Key Bridge collapsed on
March 26, 2024.

**What you are seeing.** Simulated times on roads as of {{snapshot.date}}, with no traffic jams. They are not
measurements or predictions. Ideas are what-ifs for people to review, not advice.

**Who it is for.** Transportation and planning analysts who screen for weak links. It screens; it does not design.

**Not affiliated.** WorldSeed is not affiliated with or endorsed by any agency, hospital, fire company or ambulance
provider, the State of Maryland, the Maryland Transportation Authority (MDTA), Baltimore City or County, the U.S.
Census Bureau, the NTSB or the OpenStreetMap Foundation.

**Sources.** Roads: OpenStreetMap contributors (ODbL). People: U.S. Census Bureau ACS 5-year (via Census Reporter) and
TIGER/Line. Jobs: Census LEHD LODES. Facilities: OpenStreetMap and Maryland iMAP. Hazardous-materials tunnel rule and
alternate route: Maryland Transportation Authority, cited and linked, not affiliated. Reported commute: Maryland
Matters (via Baltimore Fishbowl, link). Basemap: OpenFreeMap, OpenMapTiles. Links: Methodology, Data sources,
Attributions.

**AI and search.** When available, NVIDIA Nemotron models on Nebius Token Factory pick ideas from a fixed list. They
never produce a number: the simulator calculates every result and templates write every result sentence. News lookups
use Tavily and stay unverified until you confirm them.

**AI-written text (plain wording of the required paragraph; same meaning).** The app itself creates every number,
result and finalist card, from simulator results and the idea list. AI-written text appears only in the decision log:
a labeled reason, and an optional raw-reasoning section that is shown with no human review. It may be wrong or
inappropriate and is not the view of WorldSeed. Quotes from news reports are word for word from their sources and
unverified.

**Privacy (plain wording of the required paragraph; same meaning).** WorldSeed has no accounts and sets no cookies.
Your browser's session storage keeps a random session ID and whether you have seen the intro. To enforce fair-use
limits, the server keeps a salted hash (a one-way scrambled code) of your IP address and session ID in a counter store
(Upstash) for at most about {{privacy.retentionDays}} days. WorldSeed does not store raw IP addresses. The host
(Vercel) processes request data, including IP addresses, in its logs under its own privacy policy. If the bot check is
on, Cloudflare Turnstile processes signals such as your IP address and browser details to detect bots. Text you type
as a goal is sent to Nebius Token Factory to run the AI model, so do not enter personal information. Questions: open a
GitHub issue.

## 11. Plain glossary (20 terms, for Expert-mode tooltips)

| Term | Plain definition |
| --- | --- |
| Simulation | A computer model of what could happen. It is not a forecast and not a measurement. |
| Baseline | The world before any change. |
| Scenario | One version of the world: bridge in place, bridge removed, or removed plus an idea. |
| Free-flow | Driving with no traffic jams, at posted speeds. Real trips can take longer. |
| Lower bound | A floor. Real delays are likely at least this large, not smaller. |
| Reach (job access) | The jobs you can drive to within {{def.budgetMin}} minutes, with no traffic jams. |
| Across the river | On the other shore of the Patapsco River from where a person lives. |
| Affected | Reaches over {{def.lossPct}}% fewer jobs across the river than before. |
| Spot (block group) | A small Census area. Place names are the nearest known place, not official borders. |
| Hexagon | One small tile on the map, holding estimates of people and jobs for that spot. |
| View (lens) | One way of measuring the change: jobs across the river, jobs across the region, or station time. |
| Station time (first response) | Simulated time to the nearest fire or ambulance station for {{def.emsPct}}% of people, plus a {{def.callDelayMin}}-minute delay to get moving. |
| Hazmat (dangerous cargo) | Hazardous materials, like some fuels and chemicals. The Maryland Transportation Authority (MDTA) bars trucks carrying certain ones from both harbor tunnels. |
| Assumption | A setting we chose rather than measured. The Assumptions panel lists them all. |
| Range chip | A note that shows how far a number moves when the assumptions change. |
| Future (what-if run) | One simulated set of conditions, such as busier roads or a closed road, used to test ideas. |
| Idea (option) | One what-if change from a fixed list of hypothetical ones. None is an agency plan. |
| Finalist | One of the three ideas that scored best in the search. |
| Deterministic search (no AI) | A search that follows the same steps every time and uses no AI. |
| Low-wage workers | Workers in the lowest pay band in the Census jobs data. |

## 12. Readability numbers

Formula: grade = 0.39 x (words / sentences) + 11.8 x (syllables / words) - 15.59, worked by hand on the rendered
sentence at the reference values. Convention A counts each numeral as one word and one syllable (the way common
readability tools treat digits). Convention B counts numerals as spoken ("20,000" as four syllables, "10%" as
three). A is the primary result; B is the stricter check.

| Text | Words | Syllables A | Grade A | Syllables B | Grade B |
| --- | --- | --- | --- | --- | --- |
| Scene 0 line 2 (premise) | 9 | 12 | 3.65 | 12 | 3.65 |
| Scene 0 line 1 (dedication, has a date) | 17 | 22 | 6.31 | 28 | 10.48 |
| Scene 0 whole card (3 sentences, 30 words) | 30 | 43 | 5.22 | 49 | 7.58 |
| Scene 1, before | 11 | 13 | 2.63 | 13 | 2.63 |
| Scene 1, after | 16 | 21 | 6.14 | 21 | 6.14 |
| Scene 2 | 12 | 17 | 5.81 | 17 | 5.81 |
| Scene 3 | 18 | 21 | 5.20 | 21 | 5.20 |
| Scene 4 | 15 | 21 | 6.78 | 21 | 6.78 |
| Scene 5, ready | 10 | 13 | 3.65 | 16 | 7.19 |
| Scene 5, searching | 7 | 12 | 7.37 | 12 | 7.37 |
| Scene 5, finished | 14 | 16 | 3.36 | 16 | 3.36 |
| Scene 6 | 14 | 16 | 3.36 | 16 | 3.36 |
| Caption 1 | 7 | 10 | 4.00 | 10 | 4.00 |
| Caption 2 | 8 | 12 | 5.23 | 14 | 8.18 |
| Caption 3 | 7 | 9 | 2.31 | 12 | 7.37 |
| Caption 4 | 8 | 11 | 3.76 | 11 | 3.76 |
| Caption 5 | 8 | 9 | 0.81 | 9 | 0.81 |
| Caption 6 | 6 | 8 | 2.48 | 8 | 2.48 |

Every scene sentence and caption is at grade 8 or lower under convention A. Under the stricter convention B two
items pass only narrowly or fail: caption 2 is 8.18 (it contains "10%"), and the dedication is 10.48 (it contains a
date). Both are unavoidable without dropping the threshold or the date. Other states (progress counters, flip
templates) contain slot numbers and were not scored; keep them under 18 words.

## 13. Where plainness cost precision

1. **"River" instead of "harbor".** The measure is about jobs on the other shore of the Patapsco. "Across the river"
   is what people say; the tunnels and the harbor keep their names elsewhere. Glossary defines it.
2. **"In the model" moved out of the sentences.** A "Simulated" tag inside every number tile and the About text now
   carry it. Risk: a cropped screenshot of a sentence loses the word. Keep the tag inside the tile.
3. **Scene 2 no longer shows the 27-77% range or the 30-minute window in the sentence.** They moved to Popover 2d.
   The caption keeps "over 10%", and the range chip stays next to the number. "Averages hide this" is the story;
   the depth is one tap away.
4. **Place label** dropped "the ... peninsula" (it is now "Sparrows Point and Edgemere"). The earlier word "mostly"
   was already removed because no slot computes it.
5. **"Dangerous cargo" instead of "hazmat".** The MDTA rule covers listed hazardous materials (for example bulk
   gasoline and explosives), which is narrower than "dangerous". Popover 4a gives the exact meaning.
6. **"Take much longer"** replaces the detour claim and the added-minutes figure in the sentence. "Much" is
   qualitative, the big number and caption carry the size, and the flip table handles the bridge-restored case. The
   headline "Tunnel rules change the trip" replaces "must detour", which could read as an instruction.
6a. **Legal wording beats plain wording in scene 4.** The sentence uses "Both tunnels bar listed hazardous loads"
   (grade-safe, and the wording the second legal review asked for). The fuller plain phrase "Both tunnels bar trucks
   carrying certain hazardous materials (like some fuels and chemicals)" is exact but scores about grade 12 as a scene
   sentence (13 words, 25 syllables), so it is the first line of Popover 4a instead of the on-screen sentence. If
   the owner wants it on screen, accept the readability miss for that one scene.
6b. **Popover 1a keeps the reported commute to one clause** and cites Maryland Matters (via Baltimore Fishbowl) with a
   link placeholder, per the second legal review. The model's own numbers are stated exactly; the source is not
   quoted beyond that clause.
6c. **Free-flow definition** in Popover 1a is now "Free-flow: no traffic jams" (a colon, not a sentence) to stay
   within 40 words.
7. **"Fire stations" and "did not change" instead of "first response ... unchanged in the model".** Ambulance stations
   stay out of the sentence because the docs do not say which shores they are on. The 1-minute delay and the
   "not adequate" caveat are only in the popovers.
8. **"A delay to get moving"** replaces "call-processing and turnout delay".
9. **"Free-flow" became "no traffic jams".** Free-flow also means no signals or turn delays; the glossary says
   "posted speeds".
10. **Range chip** says "depending on assumptions", not "speed and time-limit assumptions". Popover 2a names them.
11. **Popover 2a** dropped the "average added time between about 11 and 17 seconds" figure; it now says these
    "change much less". The figure stays in the slot table for Expert.
12. **Scene 5 sentence** no longer states the residual count (it is in the chip "Still affected") and says "the best
    idea we tried", not "top-ranked". The exhaustive check is not wired, so "best" must stay "best we tried".
13. **"What-if idea" and "spot"** replace "hypothetical option" and "block group". "Hypothetical" survives in
    Popover 5b as "what-ifs" and "No agency proposed, studied or backed them".
14. **Intro dedication is shortened** ("Key Bridge fell" for "Francis Scott Key Bridge collapsed"). The full wording
    is in About and DEDICATION.md.
15. **Scene 6 dropped "every result stays computed in your browser".** It remains in About and the tooltips.
16. **Mandated labels stay as written** ("Deterministic search (no AI)", "N of M futures completed") with a plain
    gloss next to them.

## 14. Sentences that can become false, and the conditional templates

The renderer picks the template from the resolved slots, never the other way around. Every template stays within 18
words at the reference values.

| Sentence | Becomes false when | Template to use instead |
| --- | --- | --- |
| 1 (after): "The average drive to jobs gets {{regional.addedS}} longer, since most trips skip the bridge." | An option is applied and the change is negative or near zero (about -5 s in testing); the world is not the bridge-only world; the link is restored. | `dir = shorter`: "In this scenario, the average drive to jobs gets {{regional.addedS}} shorter." `dir = none`: "In this scenario, the average drive to jobs hardly changes." Keep "since most trips skip the bridge" only in the bridge-only world. |
| 1 (before): "Remove the Key Bridge from the map to see what changes." | The link is already removed (user returns to scene 1). | "The Key Bridge is removed. Restore it in Expert mode to compare." |
| 2: "Averages hide this: the worst-hit spots are near {{xharbor.worstAreaLabel}}." | Bridge restored or no spot over 25% (`worstBgCount = 0`); an idea or closure changes which spots are worst; a different place becomes worst. | `worstBgCount = 0`: "In this scenario, no spot is hit hard." Otherwise the same template with the recomputed label; if the label is empty, "the hardest-hit spots". |
| 2 range chip: "Could be as low as ... or as high as ..." | Any world other than the exact bridge-removed reference world (an idea, a news closure, a tunnel closure). The study did not run on it. | "Range not tested for this scenario. Treat this count as sensitive to assumptions." |
| 2 caption and popover 2d: "reach over 10% fewer", "27-77%" | The scenario changes the values. | Slots recompute; if `worstBgCount = 0`, hide Popover 2d's range sentence. |
| 3: "Both sides of the river have fire stations, so the time to the nearest one did not change." | A closure or idea changes station time (for example a staging site or a news closure); `ems.shoresWithStations` is below 2. | `ems.state = moved`: "In this scenario, the time to the nearest station moves from {{ems.baselineP90Min}} to {{ems.p90Min}} minutes." (15 words) Chip becomes "Higher" or "Lower". Shore count below 2: "The time to the nearest station is {{ems.state}} in this scenario." |
| 4: "Both tunnels bar listed hazardous loads, so in the model those trucks take much longer." (implies the bridge carried those trucks; kept true by "in the model") | Bridge restored; a tunnel is also closed; an idea changes the paths; a truck's added time is within 0.5 minutes of a car's. | Not bridge-only, or difference under 0.5 minutes: "In the model, across {{freight.crossHarborTrips}} river trips, listed hazardous loads add {{freight.hazmatMeanAddedMin}} and cars add {{freight.carMeanAddedMin}}." (18 words) Use the original only in the bridge-only world. Never drop "in the model" from either. |
| 4 note and popovers: "Escort options ... are made-up examples, not an MDTA program" | Never false. It must show whenever an escort option is visible. | Always show; add the suffix " (hypothetical; not an MDTA program)" to every escort option title. |
| Popover 4c: "In the model, the Key Bridge carried these trucks" | Never false as worded (it is an assumption). | If the bridge is restored, keep the text; if a tunnel is also closed, keep it and drop the alternate-route sentence unless the world is bridge-only. |
| 5 (finished): "The best idea we tried helps, but it does not undo the loss." | Recovery is 100% or more on the stated measure (a three-idea bundle returned the average trip to before while the count stayed higher); recovery is 0 or less; the user picks another finalist; the idea is only previewed; residual is 0. | 100% or more: "The best idea we tried undoes the loss on this measure, but {{options.best.residualPeople}} people are still affected." (18 words) 0 or less: "The best idea we tried does not help on this measure." Another finalist: "The idea you chose helps, but it does not undo the loss." Preview: "The best idea we tried would help, but it would not undo the loss." Residual 0: "In this run, the best idea we tried leaves no one affected." |
| 5 chip "Still affected: ..." | Any change to the assumptions or time budget; the count is a cliff-edge statistic. | Always show the "Assumed speed factors" chip; outside "reference world plus idea", add the range-not-tested chip. |
| 5 ready: "Test {{catalog.count}} what-if ideas ..." | The catalog changes; the link is not removed. | If the link is not removed, show the gate in section 7. |
| Popover 1a: "The model adds about 1.2" | The scenario is not the reference world (the figure is only for it). | "Free-flow means no traffic jams, so real delays can be larger." |
| Popover 2a: range and "change much less" | Not the reference world. | Same as the range-chip rule above. |
| Popover 3b: "this scenario does not change" | The scenario changes station time. | "In this scenario, the time to the nearest station changed in the model." Keep the rest. |
| Scene 6 caption: "Affected, as the map shows now" | Never false; the range chip follows the range-chip rule. | None. |
| Any scene sentence after a lens switch in Expert | The story bar pins each scene to its own view, so a changed view can leave sentence and map out of step. | On return, re-pin the scene's view and legend; do not re-run the simulation. |

## 15. Claims checklist

| # | Claim in the copy | Where | Source |
| --- | --- | --- | --- |
| 1 | Six construction workers died when the Key Bridge fell on March 26, 2024 | Intro, About | [DEDICATION.md](DEDICATION.md). The only event fact in the deck; no cause or fault claim (LEGAL rule 9). |
| 2 | The model uses roads as of 1 March 2024 | About, loading | DATA_SOURCES 1; slot `snapshot.date`. |
| 3 | The average drive to jobs gets about 3 seconds longer | Scene 1 | Slot `regional.addedS`; METHODOLOGY 0 (+2.9 s); conclusion C1 held in 51 of 51 variants. |
| 4 | Most trips skip the bridge | Scene 1 | Interpretation in DATA_SOURCES 7 and README table; not computed. Bridge-only worlds. Add a share-of-trips slot or soften to "hardly changes". |
| 5 | No traffic jams means delays can be larger; commute rising from about 20 to 41 minutes vs model about 1.2 (9 with both tunnels closed) | Popover 1a | METHODOLOGY 6.1; `REPORTED_DETOUR`; Maryland Matters, 28 March 2025, text read via Baltimore Fishbowl (link). One clause only. Legal review 2 also asks for the byline and canonical URL in METHODOLOGY and notes a reported CC BY-NC-ND 4.0 republishing license (unverified). Reference world only. |
| 6 | About 20,000 people reach over 10% fewer jobs across the river | Scenes 2, 6 | Slot `xharbor.peopleGt10`; METHODOLOGY 0 (19,705 exact; app 20,100). Always with the range. |
| 7 | Could be as low as about 6,700 or as high as about 96,000 | Scene 2 chip | METHODOLOGY 0 and 5.1 (`PEOPLE_GT10_RANGE`). |
| 8 | The worst-hit spots are near Sparrows Point and Edgemere | Scene 2 | Slot `xharbor.worstAreaLabel`; METHODOLOGY 0 (nearest place names, approximate). Label table needs review. |
| 9 | Worst-hit spots reach 27-77% fewer jobs | Popover 2d | Slot `xharbor.worstLossRangePct`. Docs quote different subsets (README 27-77% for 8 spots; METHODOLOGY 0 peninsula 36-76%, Anne Arundel 23-29%); the screen governs. |
| 10 | "Reach" means a drive of 30 minutes or less; "affected" means over 10% fewer jobs | Popover 2d, captions, glossary | Slots `def.budgetMin`, `def.lossPct`; assumption `A-XHARBOR-T`; 20 and 40 minutes are sensitivity only. |
| 11 | Speeds moved 20% give about 6,700 to 96,000; extra drive time and worst-hit areas change much less | Popover 2a | METHODOLOGY 0 item 1 (6,667 to 96,277; mean added 11.4 to 17.0 s); C6 holds in 50 of 51 variants. |
| 12 | The quick method is within about 2% (default) and 9 to 11% (search) | Popover 2b | METHODOLOGY 7; README Validation. |
| 13 | The time to the nearest station did not change | Scene 3 | Slots `ems.p90Min`, `ems.state`; METHODOLOGY 0 (C2, 51 of 51). |
| 14 | Both sides of the river have fire stations | Scene 3 | README; PITCH question 6. Needs `ems.shoresWithStations`. Ambulance stations are not claimed: only 2 exist and their shores are not stated. |
| 15 | 74 fire and 2 ambulance stations; 1-minute delay | Popover 3a | README; METHODOLOGY 1 (76 sources); `A-CALL-TO-WHEELS`. |
| 16 | Staffing, hospital transport, call volume and outside stations are not modeled | Popovers 3a, 3b | README Known modeling limitations. |
| 17 | Both tunnels bar trucks carrying certain hazardous materials (like some fuels and chemicals) | Scene 4, popover 4a | MDTA page, accessed 26 September 2026; DATA_SOURCES 10 (`A-HAZMAT-TUNNELS`); COMAR 11.07.01 cited by MDTA. Paraphrase plus link; MDTA's published rules govern. |
| 18 | In the model, those trucks add about 15 minutes; cars about 6; 24 trips | Scene 4 | Slots `freight.*`; DATA_SOURCES 10 (12 pairs, both directions). |
| 19 | The Key Bridge carried these trucks, in the model (an assumption) | Popover 4c, scene 4 sentence | The MDTA tunnel page says nothing about the bridge (DATA_SOURCES 10; legal review 2). Labeled as an assumption in the model. |
| 19a | With the bridge removed, trucks take the western I-695 arc, MDTA's named alternate route | Popover 4c | MDTA Key Bridge news page, https://mdta.maryland.gov/keybridgenews, accessed 26 September 2026 (advisory to use the western section of I-695 around the tunnels); the model's hazmat path crosses the Beltway west of the harbor (test in DATA_SOURCES 10). |
| 19b | Simulation, not route guidance; carriers must follow posted and designated routes; not affiliated with MDTA | Popover 4b | Legal review 2, freight disclaimer (first two sentences verbatim, then the carrier and affiliation sentences). |
| 19c | Escort options are made-up examples, not an MDTA program, proposal or finding | Scene 4 note, popover 4d | Legal review 2; the MDTA page mentions no escort, window or permit. |
| 19d | No accounts, no cookies, hashed fair-use counter for about 2 days, Vercel and Turnstile process IPs, goal text goes to Nebius | About | Legal review 2 section 4 (LEGAL rule 14); retention slot must match limiter TTLs. |
| 19e | AI-written text only in the decision log; raw reasoning shown without review, may be wrong; news quotes verbatim and unverified | About, decision-log label | Legal review 2 section 3 (LEGAL rule 13). |
| 20 | 24 what-if ideas; no agency proposed or backed them; costs are rough levels | Scene 5, popover 5b | README; DATA_SOURCES 8; slot `catalog.count`. |
| 21 | About four ideas help in a meaningful way | Popover 5b | README finding; PITCH marks it [VERIFY]. Needs generated slot `catalog.helpfulCount`. |
| 22 | The best idea we tried wins back about X% | Scene 5 | Slot `options.best.recoveredPct`; README says about 40% for the best single idea, PITCH marks it [VERIFY]. Measure must be named (open issue A). |
| 23 | About N people are still affected | Scene 5 chip | Slot `options.best.residualPeople`, computed on the applied world. |
| 24 | Idea effects are assumptions, not agency findings | Popover 5a | README "effect sizes are labeled assumptions". |
| 25 | "Best" means best of those tried | Scene 5 | The exhaustive check is not wired in the interface (README); the wording says "we tried". |
| 26 | Results are calculated in your browser | Loading, About | README design rule 2. Census population figures are cited data, not calculated. |
| 27 | Not a prediction or advice | About | README Intended use; PITCH; LEGAL rule 1. |
| 28 | Planning simulation, not dispatch; call 911; not affiliated | Intro, About | README Intended use; LEGAL "Files that must exist". |
| 29 | Nemotron on Nebius picks ideas and never produces a number | About | README AI section. Live verification pending: show "AI planner unavailable" until `/api/health` reports a model. |
| 30 | News reports are unverified until confirmed, one at a time | Dialogs | README Tavily section; LEGAL rule 6. |
| 31 | Data sources and licenses | About | README table; DATA_SOURCES; LEGAL rules 2 to 4. |
| 32 | Glossary definitions (free-flow, reach, affected, station time, hazmat) | Section 11 | Same sources as rows 5, 10, 15 and 17. |

## 16. Open issues for the owner of the interface

- **A. Define "won back" before shipping scene 5.** In testing, the three-idea bundle left the count of people who
  reach over 10% fewer jobs at about 15,000 (from about 20,000, a quarter) while the average trip to jobs across the
  river returned to its earlier value. The README's "about 40%" does not name its measure. Pick one, name it in
  `options.best.recoveryMeasure`, and keep the "Still affected" chip so "does not undo the loss" stays computed.
- **B. Study numbers are not simulator output.** `study.*` and `catalog.helpfulCount` come from documents and
  scripts. Emit them into a snapshot file and show them only in the reference world.
- **C. New accessors.** `ems.shoresWithStations`, `freight.anchorCount`, `options.best.recoveryMeasure`, and a
  reviewed label table for `xharbor.worstAreaLabel`.
- **G. Legal review 2 follow-ups outside this file:** the DATA_SOURCES line about the bridge and hazmat, the
  METHODOLOGY byline and canonical URL for Maryland Matters, the NOTICE and ATTRIBUTIONS entries for the MDTA, and the
  suffix " (hypothetical; not an MDTA program)" on escort option titles in the UI. This deck only specifies the copy.
- **D. Stale README status.** README lists the freight and hazmat lens as planned; the interface already has it
  (DATA_SOURCES 10). Scene 4 assumes the built version.
- **E. Keys marked new** (arrows, E, ?) are proposals. Only Escape, R, P and Ctrl or Cmd + K exist today.
- **F. "Most trips skip the bridge"** is an interpretation, not a computed slot.

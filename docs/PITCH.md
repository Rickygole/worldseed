# WorldSeed pitches and judge Q&A

Markers: **[VERIFY]** depends on something that was not verified live on 2026-09-26
(the AI planner and critic on live Nemotron models, the Tavily lookups on the deployed
site, the deployed build matching the current code, or a figure to re-read from the
running app). **[VERIFY AFTER REDESIGN]** describes the guided-story interface, which
was being rebuilt. **[PLANNED]** does not exist yet. Resolve or cut all three before you
say the sentence out loud. Tone: confident, sober, no hype. This is built on a real loss.

Thesis: **Regional averages hide local disasters, and a good tool also shows what
didn't break.**

Tagline: **Don't predict the future. Simulate it.** (Kept: it names what the tool does,
a counterfactual run rather than a forecast. We make no prediction claim.)

## 30-second pitch

A regional model says losing the Key Bridge costs about three seconds on average. For
about twenty thousand people, mostly on the Sparrows Point and Edgemere peninsula, it cut
more than ten percent of the jobs they can reach across the harbor in thirty minutes, a
count that depends on assumptions, and we show the range. And
first-response times did not change at all, because both shores have their own
stations. And in the model, trucks carrying the hazardous materials MDTA lists, barred
from both harbor tunnels, add about fifteen minutes across the harbor. WorldSeed is a screening tool that shows these side by side,
computed in your browser on the 2024 road network. A deterministic search screens
hypothetical options with no AI; a Nemotron planner on Nebius Token Factory is built to
propose options from the same catalog, but the simulator scores everything, and the
model can never state a number. **[VERIFY: planner live on Nemotron; otherwise say
"built, pending live verification".]** It is a planning prototype, not dispatch, and a
human decides.

## 2-minute pitch

In memory of the six construction workers who died when the Francis Scott Key Bridge
collapsed on March 26, 2024.

When a crossing like that is lost, the average tells you very little. A regional model
says the Key Bridge costs about three seconds. That number is true, and it is the
wrong place to look. WorldSeed loads the pre-collapse OpenStreetMap road network for
Baltimore, dated March 1, 2024, with Census population and jobs data, and lets you
remove the link and recompute everything in your browser, at free-flow speeds.

Three lenses stay on screen at once. First response: unchanged, because both shores
have their own fire stations and hospitals. That is a resilience check that held, and
a good tool shows it. Regional job access: about three seconds. Cross-harbor job
access: for the Sparrows Point and Edgemere peninsula, the eight hardest-hit block
groups lose between twenty-seven and seventy-seven percent of the jobs on the other
shore that they could reach within thirty minutes, and about twenty thousand residents
lose more than ten percent. That head-count depends on speed and time-budget
assumptions: about 6,700 to 96,000 across the variants we tested. The time-based
measures, about eleven to seventeen seconds added on average, and the identity of the
worst-hit block groups, are stable. We defined that third lens before we saw its results,
because the bridge's function was crossing the Patapsco, and the regional average hides
it. Low-wage workers are not disproportionately hit; the tool reports that either way.

The largest effect in minutes is for hazmat trucks. Vehicles carrying the hazardous
materials the Maryland Transportation Authority lists are barred from both harbor
tunnels. That the bridge carried them before the collapse is our assumption; the rule
page does not cover the bridge. In the model, with the bridge removed they take the
western I-695 arc, the alternate route MDTA names, across twenty-four cross-harbor
trips between real port and industrial anchors: about fifteen minutes added on average
for a hazmat truck and about six for a car, at free-flow speeds. Closing the Harbor
Tunnel as well changes nothing for them, because they cannot use it anyway. This is a
simulation of one published rule, not route guidance.

Then the search screens where mitigation would matter, from sixteen hypothetical
options that no agency proposed. The deterministic search needs no AI: one run screens
every eligible bundle, then the top twelve are scored across paired stress futures in
your browser, and an audit of every bundle ranks its top pick first of one hundred
twenty-nine. **[VERIFY: re-read from the app.]** A Nemotron planner on Nebius Token
Factory is built to do the proposing, only by catalog ID, with validators rejecting
anything else. **[VERIFY: built and tested against fakes only; say "live on Nemotron"
only after one real end-to-end mission has run.]** The honest result is that there is
no fix. The best two-stage result, Beltway flow plus Harbor Tunnel approaches plus I-95
flow, cuts the residents who reach more than ten percent fewer cross-harbor jobs from
about twenty thousand to about fifteen thousand, about a quarter fewer. That rests on
assumed corridor speed factors and hypothetical options, and about fifteen thousand
people remain affected. **[VERIFY: re-read both counts from the app.]**

A Tavily feed can propose current closures near the model area, as unverified news
reports that you confirm before they touch the model. **[VERIFY: live key.]**

It is for resilience and criticality screening by state transportation and metropolitan
planning analysts, with emergency managers as a secondary audience. It is screening,
not design. The Key Bridge is the case study; screening other crossings is
**[PLANNED]**. The simulator matches an independent Python reference, the compute runs
in your browser so the demo costs nothing to keep alive, and the data is open.
Simulated, not measured. Not dispatch. A human decides.

## One-paragraph pitch

WorldSeed is a counterfactual infrastructure-planning simulator and screening tool. It
loads the 2024 pre-collapse OpenStreetMap road network for the Key Bridge region of
Baltimore with Census population and jobs data, lets you remove a link, and recomputes
first-response, regional access and cross-harbor access side by side in the browser at
free-flow speeds. The result: first response held, regional access moved about three
seconds, and for about twenty thousand people, mostly on the Sparrows Point and Edgemere
peninsula, cross-harbor job access fell by more than ten percent (a count that ranges
from about 6,700 to 96,000 across the assumptions we tested), and by 27 to 77 percent in
the eight hardest-hit block groups. In the model, trucks carrying the hazardous
materials MDTA lists, barred from both harbor tunnels, add about fifteen minutes on
average across 24 harbor trips. A deterministic two-stage
search screens a catalog of sixteen hypothetical options with no AI, and a Nemotron
planner on Nebius Token Factory is built to propose from the same catalog by ID only,
with strict validators, so the model can never state a number: the simulator computes
every metric. **[VERIFY: planner live; otherwise "built, pending live verification".]**
On assumed corridor speed factors and hypothetical options, the best result cuts the
residents who reach more than 10% fewer cross-harbor jobs from about 20,000 to about
15,000, and about 15,000 remain. It is a research prototype for resilience analysts,
not a dispatch system, and a human decides.

## Twelve likely judge questions

**1. Why only Baltimore?**
Depth and validation over breadth. One place, checked hex by hex against an independent
reference, with a finding that survived scrutiny, is more useful than ten places we
cannot check. The simulator runs in the browser, so more places would not add hosting
cost, and the data pipeline is configurable by bounding box. Screening other crossings
from the app is **[PLANNED]**; we have not done it, and we would validate each new place
before showing it.

**2. If the model never produces a number, what is the AI for?**
Search over a space the model cannot score, and an honest answer starts here: the search
already works without it. The deterministic two-stage search screens every eligible
bundle with one run and scores the top twelve across paired futures, and an audit of
every bundle ranks its top pick first of 129. **[VERIFY: re-read from the app.]** The
AI planner is built to explore that space more flexibly, from a plain-language goal, but
it has not been verified against live models, so we do not claim it beats the
deterministic search. The number of possible bundles of options is awkward for a person
to explore, so the planner proposes bundles, the simulator scores
them across many futures, and the planner refines. The model chooses catalog IDs and a
rationale from a fixed list; it does not write results. The critic picks a stress test
from a closed set, and the simulator re-scores the leaders under it. One labeled
exception: an optional raw reasoning string appears in a collapsed section of the
decision log, checked only for plain-text form, never used for a decision and never on
a card. Constraining the model this way is what makes the output safe to show and easy
to test. **[VERIFY: this describes the live run only after the planner and critic are
verified on Nemotron.]**

**3. What is live, and what is not?**
Live, with no key needed: the road graph and snapshot, the browser simulator, removing
the link, the cross-harbor, regional and first-response lenses, the inspector, the
assumptions drawer, the freight trips and the hazmat goal, the deterministic two-stage
search with its stress tests, the exhaustive audit, and Compare, Preview and Apply.
Built but not verified against a real service as of 2026-09-26: the AI planner and
critic on Nemotron via Token Factory (implemented and tested with a fake provider only;
no key deployed), the Tavily closure and evidence lookups, the Upstash shared limits and
the Turnstile hook. Planned, not built: screening other crossings, and a quantitative
comparison to observations. In progress: the guided-story interface.
**[VERIFY: confirm the deployed build matches this, since the deployed commit was not
confirmed; update this answer to the state on the day.]**

**4. How do you know it is right?**
We do not claim it is right; we claim we know how far it can be trusted. Three checks.
The TypeScript simulator matches an independent Python reference (networkx and scipy),
hex by hex. Against the public OpenStreetMap-based OSRM router, rank agreement over
about 5,000 origin-destination pairs is 0.98 (Spearman), and the model is about 22%
faster, because it is free-flow with no signals or turns. And we stress-tested the
finding across 51 assumption variants. The honest limit: we found one reported real
commute, Dundalk to Ferndale, about 20 minutes before the collapse and about 41 after,
and the model adds about 1.2 minutes for the same pair, about 9 even with both tunnels
also closed. So free-flow is a lower bound on real disruption; the model measures lost
connectivity, not queues. We have not compared the model to observed traffic beyond that
one commute. The reality-check endpoint only lists published sources, unverified, and a
quantitative comparison is **[PLANNED]**. One more caveat: the app's cross-harbor lens is
a faster variant of the exact all-pairs version. At its default setting its headline
count is within about 2% (about 19,700 exact versus about 20,100 in the app); at the
setting used for futures it is off by about 9 to 11%. Separately, the exhaustive audit
scores every eligible bundle of up to three options and ranks the search's top pick
among them (rank 1 of 129 in the reference run **[VERIFY: re-read from the app]**).
That checks the search, not the road model.

**5. Three seconds is tiny. Is your model just missing congestion?**
Partly, and we say so. The deterministic run uses free-flow speeds, so tunnel and
bridge-approach delays are understated. Congestion enters only in the stress futures.
The three-second regional figure is not a claim about real travel times. It is a claim
that, at equal conditions, most trips in the region never used the bridge, so the
average barely moves. That is the point: the average is the wrong place to look. The
local figure is also free-flow, so it is a lower bound: the one reported commute we could
source roughly doubled (about 20 to 41 minutes), far more than the model's free-flow
increase for that pair. With tunnel congestion after the closure, the median cross-harbor
resident's added time is about 11 to 17 seconds rather than under a second.

**6. First response did not change. Isn't that a sign the model is too simple?**
It is a limit and a result. Both shores have fire stations and hospitals inside the
study area, so nearest-station times do not depend on the bridge, and we report that as
a resilience check that held. What we do not model: unit counts, staffing, availability,
mutual-aid delays or stations outside the study area, so edge block groups can look
under-served. The tool says "in this model that held," not "response is fine."

**7. Who would use this, and how is it different from a traffic model?**
State transportation and metropolitan planning analysts doing resilience or criticality
screening: if this crossing is lost, who loses access, and where would mitigation
matter? Emergency managers are a secondary audience. It is not a replacement for a
calibrated regional travel model; it is a fast, open, browser-based screen that puts the
average, the local effect and what held on one screen, plus a guarded way to search
options. Screening, not design. We are not affiliated with or endorsed by any agency.

**8. Isn't this an emergency dispatch or triage system? Is it safe for AI?**
No. It is a counterfactual infrastructure-planning research prototype with a human in
the loop, and it says so throughout: it must not be used to direct, prioritize or delay
any real emergency response. It never claims to save lives, is not real-time, and the
first-response lens is a resilience check on a historical network. The model never
produces a number, its output is validated, and result text comes from templates.

**9. What stops someone from running up your token bill or abusing the demo?**
The server builds every prompt from templates and accepts only structured, validated
input, so it is not a generic model proxy. A global daily spend ceiling, per-mission
token budgets, per-client limits, an in-memory front door, an optional Turnstile check
and a kill switch cover the rest, and when the budget is spent the panel says so while
manual exploration still works. The server and abuse-control code was independently
red-teamed in multiple rounds, and the fixes are pinned by regression tests.

**10. Did you find a fix for the peninsula?**
No, and the tool is honest about it. The best two-stage search result, Beltway flow plus
Harbor Tunnel approaches plus I-95 flow, reduces the residents who reach more than ten
percent fewer cross-harbor jobs from about twenty thousand to about fifteen thousand,
about a quarter fewer. About fifteen thousand remain. That is based on assumed corridor
speed factors and hypothetical options, not an agency study, and the count is a
cliff-edge measure that our sensitivity study did not test in the option worlds. Shuttle
links did not help, and we pruned ten of the first 24 options for having no measurable
effect. All options are hypothetical, none was proposed or endorsed by any agency, and
costs are relative tiers. The tool screens where mitigation would matter; it does not
design it. **[VERIFY: re-read both counts from the app before saying them. Do not say
"recovers about 40%": that older figure was one option's share of the mean added
cross-harbor time on an assumed speed factor, not the measure the app shows.]**

**11. What did your sensitivity study break?**
Four things, and we published them (docs/METHODOLOGY.md). First, the head-count: about
20,000 residents losing more than 10% of cross-harbor jobs ranges from about 6,700 to
96,000 when speeds move 20%, and the time budget behaves the same way, so it is a
cliff-edge statistic and we quote it only with its range. Second, "the typical resident
is unaffected" holds only at free-flow: if the tunnels slow down after the closure, the
median added time is about 11 to 17 seconds. Third, the model does not reproduce the one
reported detour we could source (Dundalk to Ferndale, about 20 to 41 minutes, versus
about +1.2 minutes in the model), so free-flow is a lower bound. Fourth, against random
comparable motorway cuts the Key Bridge is not exceptional on the regional measure, so we
call it a concentrated cross-harbor bottleneck, not the most consequential link. What
held: the regional (about 3 s) and first-response (unchanged) conclusions in all 51
variants, and the peninsula block groups stayed the worst-hit in 50 of 51. Time-based
measures (about 11 to 17 s average added) are stable; counts are not. Three of 15 null
controls failed our pre-declared rule, all closures of a dead-end street a hex snaps to.

**12. Why hazmat trucks, and how sure are you of the fifteen minutes?**
Because it is the strongest effect we found, and the tunnel rule is published rather than
assumed: the Maryland Transportation Authority bars vehicles carrying listed hazardous
materials from the Fort McHenry and Harbor Tunnels (page accessed 26 September 2026).
That the Key Bridge carried hazmat before the collapse is our assumption: the rule page
does not cover the bridge, and MDTA's Key Bridge news page sends tunnel-prohibited
hazmat vehicles to the western I-695 arc, which is the route the model uses. We fixed 24
cross-harbor trips between seven road anchors at port and industrial sites before seeing
results. At free-flow, removing the bridge adds about 5.8 minutes for
a car and about 14.7 for a hazmat truck, and 23 of the 24 hazmat trips add more than five
minutes. It is one rule, one sample of trips, and no queues, permits, dwell time or real
freight volumes; general freight is not modeled. Two hypothetical escorted-window
options let hazmat trucks use a tunnel at an assumed delay: in the reference run the
Harbor Tunnel one cuts the mean from +14.7 to +10.2 minutes. That escort figure is a
hypothetical result: escorted windows are not an MDTA program, proposal or finding, and
nothing here says they would be safe or lawful. Nothing here is route guidance, and
carriers must follow posted and designated hazardous-materials routes. **[VERIFY: re-read 5.8, 14.7, 23 of 24 and 10.2
from the app.]**

## Numbers you may quote (all from the app and the snapshot, on 2026-09-26)

- 36,610 road nodes; OpenStreetMap as of 2024-03-01; 74 fire stations, 2 ambulance stations, 10 hospitals.
- First response: p90 6.1 min before and after; 96% of residents within 8 min.
- Regional job access: about +3 s on average.
- Cross-harbor: about 20,000 residents lose more than 10% of reachable jobs (app 20,100; exact reference 19,705), **always quoted with the range about 6,700 to 96,000 across the variants we tested**; about 11,400 lose more than 25%; the 8 hardest-hit block groups lose 27-77%; worst-off 1% add at least 4.3 min; average added time about 11 to 17 s across speed variants (stable).
- Study: 51 variants; regional and first-response conclusions held in all 51; peninsula worst-hit in 50 of 51; router rank agreement 0.98 (Spearman), model about 22% faster; reported Dundalk to Ferndale commute about 20 to 41 min versus about +1.2 min in the model (about +9 with both tunnels closed).
- Low-wage workers: 1,380 lose more than 10%, which is 1.8% of low-wage workers against 1.9% of all residents.
- Hazmat and freight (free-flow, Key Bridge removed, 24 cross-harbor trips between 7 anchors): cars +5.8 min mean; hazmat trucks +14.7 min mean; 23 of 24 hazmat trips add more than 5 min; Harbor Tunnel closure irrelevant to hazmat trucks; Harbor Tunnel escort window (hypothetical, not an MDTA program, assumed delay) cuts the hazmat mean from +14.7 to +10.2 min. MDTA rule page accessed 2026-09-26. **[VERIFY: re-read from the app.]**
- Catalog: 16 hypothetical options (an earlier 24 were pruned to 14, plus 2 hazmat windows); shuttle links did not help.
- Search: deterministic two-stage (screen every eligible bundle, paired futures on the top 12); the exhaustive audit ranks its top pick 1 of 129 **[VERIFY: re-read]**. Best two-stage result (Beltway flow + Harbor Tunnel approaches + I-95 flow): "residents who reach more than 10% fewer cross-harbor jobs" from about 20,000 to about 15,000, about a quarter fewer, on assumed corridor speed factors and hypothetical options; about 15,000 remain. Always name that measure. Do not quote a percent "recovered".
- AI planner: built, tested against fakes only, pending a real key. **[VERIFY before saying it ran.]**

If a number on screen differs from one here, trust the screen and fix this file.

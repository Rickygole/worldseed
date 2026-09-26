# WorldSeed pitches and judge Q&A

Markers: **[VERIFY]** depends on something that was not verified live on 2026-09-26
(the AI planner and critic on live Nemotron models, the finalist / futures flow, the
Tavily lookups on the deployed site). **[PLANNED]** does not exist yet. Resolve or cut both before you say
the sentence out loud. Tone: confident, sober, no hype. This is built on a real loss.

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
stations. WorldSeed is a screening tool that shows all three side by side, computed in
your browser on the 2024 road network. A Nemotron planner on Nebius Token Factory
proposes options from a catalog, but the simulator scores everything, and the model
can never state a number. **[VERIFY: planner live on Nemotron.]** It is a planning
prototype, not dispatch, and a human decides.

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

Then the planner can screen for where mitigation would matter. You describe a goal in
plain language. A small Nemotron model on Nebius Token Factory parses it, you confirm
it, and the planner, the largest Nemotron model available, proposes bundles from a
catalog of twenty-four hypothetical scenario options, only by catalog ID. The simulator
scores each bundle across many stress futures in your browser. Validators reject
anything outside the catalog. The model's explanation is a choice from a fixed list
that the application renders in a labeled log, and every result sentence is written by
a template. Between rounds a critic picks one stress test from a closed set, such as a
tunnel closed at rush hour, and the simulator re-scores the leaders under it before the
planner refines. **[VERIFY: planner and critic live on Nemotron; finalists, futures and
Apply flow working.]** The honest result is that it does not find a fix: only about four of the
twenty-four options meaningfully help, shuttle links did not, and the best one recovers
about forty percent of the loss on an assumed corridor speed. **[VERIFY: figure.]**

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
the eight hardest-hit block groups. A Nemotron planner on Nebius Token
Factory screens a catalog of twenty-four hypothetical options, but it chooses only by
catalog ID, strict validators reject anything else, and the simulator computes every
metric, so the model can never state a number. **[VERIFY: planner live.]** It is a
research prototype for resilience analysts, not a dispatch system, and a human decides.

## Eleven likely judge questions

**1. Why only Baltimore?**
Depth and validation over breadth. One place, checked hex by hex against an independent
reference, with a finding that survived scrutiny, is more useful than ten places we
cannot check. The simulator runs in the browser, so more places would not add hosting
cost, and the data pipeline is configurable by bounding box. Screening other crossings
from the app is **[PLANNED]**; we have not done it, and we would validate each new place
before showing it.

**2. If the model never produces a number, what is the AI for?**
Search over a space the model cannot score. The number of possible bundles of options is
awkward for a person to explore, so the planner proposes bundles, the simulator scores
them across many futures, and the planner refines. The model chooses catalog IDs and a
rationale from a fixed list; it does not write results. The critic picks a stress test
from a closed set, and the simulator re-scores the leaders under it. One labeled
exception: an optional raw reasoning string appears in a collapsed section of the
decision log, checked only for plain-text form, never used for a decision and never on
a card. Constraining the model this way is what makes the output safe to show and easy
to test. **[VERIFY: this describes the live run only after the planner and critic are
verified on Nemotron.]**

**3. What is live, and what is not?**
Live: the road graph and snapshot, the browser simulator, removing the link, the
side-by-side lenses, the inspector, the assumptions drawer. Not verified yet as of
2026-09-26: the planner against live Nemotron models on Token Factory (implemented and
tested with a fake provider; no key deployed), the Tavily lookups on the deployed site,
and the finalist flow. Built in code, pending live verification: the adversarial critic
loop (with a deterministic no-AI critic as the fallback), a reality-check endpoint that
lists Tavily sources about the 2024 detours, and an exhaustive-search check of the AI's
finalists against the true optimum; the last two are not yet wired into the interface.
Planned, not built: screening other crossings, a freight and hazmat trip lens, and a
quantitative comparison to observations. **[VERIFY: update this answer to the state on
the day.]**

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
setting used for futures it is off by about 9 to 11%. Separately, an exhaustive-search
check (built, interface wiring in progress) scores every bundle of up to three options
to test the AI's finalists against the true optimum. That checks the planner, not the
road model.

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
No, and the tool is honest about it. Of twenty-four hypothetical options, only about
four meaningfully help, shuttle links did not, and the best single option recovers about
forty percent of the cross-harbor loss. That number depends on an assumed corridor speed
factor, not an agency study. All options are hypothetical, none was proposed or endorsed
by any agency, and costs are relative tiers. The tool screens where mitigation would
matter; it does not design it. **[VERIFY: re-read the "about forty percent" figure from
the app or the candidate-effects data before saying it.]**

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

## Numbers you may quote (all from the app and the snapshot, on 2026-09-26)

- 36,610 road nodes; OpenStreetMap as of 2024-03-01; 74 fire stations, 2 ambulance stations, 10 hospitals.
- First response: p90 6.1 min before and after; 96% of residents within 8 min.
- Regional job access: about +3 s on average.
- Cross-harbor: about 20,000 residents lose more than 10% of reachable jobs (app 20,100; exact reference 19,705), **always quoted with the range about 6,700 to 96,000 across the variants we tested**; about 11,400 lose more than 25%; the 8 hardest-hit block groups lose 27-77%; worst-off 1% add at least 4.3 min; average added time about 11 to 17 s across speed variants (stable).
- Study: 51 variants; regional and first-response conclusions held in all 51; peninsula worst-hit in 50 of 51; router rank agreement 0.98 (Spearman), model about 22% faster; reported Dundalk to Ferndale commute about 20 to 41 min versus about +1.2 min in the model (about +9 with both tunnels closed).
- Low-wage workers: 1,380 lose more than 10%, which is 1.8% of low-wage workers against 1.9% of all residents.
- Catalog: 24 hypothetical options; only about four meaningfully help; shuttle links did not.

If a number on screen differs from one here, trust the screen and fix this file.

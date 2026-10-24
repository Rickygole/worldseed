# WorldSeed pitches and judge Q&A

Tone: confident, sober, no hype. This is built on a real loss.

Thesis: **A good tool also shows what didn't break.**

Tagline: **Regional averages hide local disasters. WorldSeed shows you where.**

As of today (2026-10-24): a real Nebius Token Factory account, billing and API key
exist, and the API is verified live — `GET /v1/models` resolves all four role model
IDs, structured output and streaming both work on both models used. What's still
pending: wiring that key into the deployed site's production environment (blocked on a
shared Upstash rate-limit store, so one script can't drain the shared AI budget across
serverless instances) and one full live mission through the app's own agent routes
(parse → plan → critique → finalize). Both are expected before the deadline; until then,
the deployed demo runs the deterministic search and says so. Every finding below is
independent of that and is true on the deployed app today.

## 30-second pitch

A regional model says losing the Key Bridge costs about three seconds on average.
Underneath that average: about twenty thousand people, mostly on the Sparrows Point and
Edgemere peninsula, lose more than ten percent of the jobs they can reach across the
harbor in thirty minutes. First-response times don't change at all, because both shores
have their own stations. And hazmat trucks, barred from both harbor tunnels by a
published rule, lose about fifteen minutes to the detour. WorldSeed puts all three side
by side, computed by a simulator in your browser, never by a model. A deterministic
search already finds the exhaustive-audit top bundle of 129 with no AI; Nemotron on
Nebius Token Factory is wired in as the search *policy* over that same simulator, with
an adversarial critic that picks the stress test meant to break the runner-up — verified
live against the real API today. It's a planning prototype, not dispatch, and a human
decides.

## 2-minute pitch

In memory of the six construction workers who died when the Francis Scott Key Bridge
collapsed on March 26, 2024.

When a crossing like that is lost, the average tells you very little. A regional model
says the Key Bridge costs about three seconds. That number is true, and it's the wrong
place to look. WorldSeed loads the pre-collapse OpenStreetMap road network for
Baltimore, dated March 1, 2024, with Census population and jobs data, and lets you
remove the link and recompute everything in your browser, at free-flow speeds.

Three lenses stay on screen at once. First response: unchanged, because both shores have
their own fire stations and hospitals — a resilience check that held, and a good tool
shows it. Regional job access: about three seconds. Cross-harbor job access: the eight
hardest-hit block groups on the peninsula lose between twenty-seven and seventy-seven
percent of the jobs across the harbor they could reach within thirty minutes, and about
twenty thousand residents lose more than ten percent — a count that depends on speed and
time-budget assumptions (about 6,700 to 96,000 across the variants we tested), while the
time-based measures and the identity of the worst-hit block groups are stable. We
defined that lens before we saw its results, because the bridge's function was crossing
the Patapsco and the regional average hides exactly that. Low-wage workers are not
disproportionately hit; the tool reports that either way.

The largest effect in minutes is hazmat trucks. Vehicles carrying MDTA-listed hazardous
materials are barred from both harbor tunnels; with the bridge removed, in the model
they take the western I-695 arc, the alternate route MDTA names. Across twenty-four
cross-harbor trips: about fifteen minutes added on average for a hazmat truck, about six
for a car. Closing the Harbor Tunnel too changes nothing for them, because they can't use
it anyway. One published rule, simulated — not route guidance.

Here's the actual idea in the system: a deterministic two-stage search — screen every
eligible bundle once, stress-test the top twelve — already finds the rank-1 bundle of
129 in an exhaustive audit, with zero AI. That proves the architecture: a planner
proposes, a simulator that can't be gamed scores everything, and an adversarial critic
picks one stress test from a closed set specifically to break the leaders. Nemotron on
Nebius Token Factory is wired in as the search policy over that identical simulator,
choosing only by catalog ID, with the same critic enforcing the same stress tests. The
Token Factory API is verified live today; the first full mission through the app's own
routes, and production wiring on the deployed site, land before judging. Even the best
search result is honest about its limits: Beltway flow plus Harbor Tunnel approaches
plus I-95 flow cuts the residents losing more than ten percent of cross-harbor jobs from
about twenty thousand to about fifteen thousand — a quarter fewer, not a fix. About
fifteen thousand remain.

It's for resilience and criticality screening by state DOT and metropolitan planning
analysts, with emergency managers as a secondary audience. It's screening, not design.
The simulator matches an independent Python reference hex by hex, the compute runs in
your browser so the demo costs nothing to keep alive, and the data is open. Simulated,
not measured. Not dispatch. A human decides.

## One-paragraph pitch

WorldSeed is a counterfactual infrastructure-planning simulator and screening tool. It
loads the 2024 pre-collapse OpenStreetMap road network for the Key Bridge region of
Baltimore with Census population and jobs data, lets you remove a link, and recomputes
first-response, regional access and cross-harbor access side by side in the browser at
free-flow speeds. Result: first response held, regional access moved about three
seconds, and about twenty thousand people on the Sparrows Point / Edgemere peninsula
lost more than ten percent of their cross-harbor job access (6,700 to 96,000 across the
assumptions we tested; 27-77% in the eight hardest-hit block groups), while hazmat
trucks lost about fifteen minutes to a published tunnel-detour rule against about six for
a car. A deterministic two-stage search already finds the exhaustive-audit rank-1 bundle
of 129 with no AI; a Nemotron model on Nebius Token Factory is wired in as the search
policy over that identical simulator, with an adversarial critic that picks a stress
test from a closed set to break the runner-up, verified live against the real Token
Factory API today, with production wiring and one full live mission landing before
judging. The best search result cuts the affected count by about a quarter, not to
zero — the tool says so. It's a research prototype for resilience analysts, not a
dispatch system, and a human decides.

## Twelve likely judge questions

**1. Why only Baltimore?**
Depth and validation over breadth. One place, checked hex by hex against an independent
reference, with a finding that survived a 51-variant sensitivity study, is more useful
than ten places we can't check. The simulator runs in the browser, so more places
wouldn't add hosting cost, and the data pipeline is already configurable by bounding
box. Screening other crossings from the app is planned, not built; we'd validate each
new place before showing it.

**2. If the model never produces a number, what is the AI for?**
It's the search *policy* over a simulator it can't bypass — not a competitor to the
deterministic search, but the same architecture with a model doing the proposing. The
deterministic search already proves the architecture works with zero AI: screen every
eligible bundle once, stress-test the top twelve, and the result audits out at rank 1 of
129. Nemotron sits on that exact structure: the planner proposes bundles by catalog ID
from a plain-language goal, the simulator scores them across many futures, and the
critic — the actual non-obvious piece — picks one stress test from a closed, enumerable
set specifically to break the leaderboard, forcing the simulator to re-score every
leader under it. That's adversarial pressure the model can't dodge, because the thing
attacking its answer is also deterministic and auditable. As of today the Token Factory
API is verified live (model resolution, structured output, streaming on both models);
what hasn't happened yet is one real end-to-end mission through the app's own routes.
That lands before judging. Until then, the deployed demo runs the deterministic path and
labels it "not AI."

**3. What is live, and what is not?**
Live, no key needed: the road graph and snapshot, the browser simulator, removing the
link, the cross-harbor, regional and first-response lenses, the inspector, the
assumptions drawer, the freight trips and hazmat goal, the deterministic two-stage
search with its stress tests, the exhaustive audit, and Compare, Preview and Apply.
Verified live against the real Token Factory API, not yet wired into the deployed
site's production path: the AI planner, critic, parser and extractor (model
resolution, structured output and streaming all confirmed on 2026-10-24; production
wiring is blocked on a shared Upstash rate-limit store). Built, not yet verified against
a real service: the Tavily closure and evidence lookups, the Turnstile hook. Planned,
not built: screening other crossings, a quantitative comparison to observations.

**4. How do you know it's right?**
We don't claim it's right; we claim we know how far it can be trusted. The TypeScript
simulator matches an independent Python reference (networkx and scipy), hex by hex.
Against the public OSRM router, rank agreement over about 5,000 origin-destination pairs
is 0.98 (Spearman); the model is about 22% faster, because it's free-flow with no
signals or turns. We stress-tested the finding across 51 assumption variants and ran 15
null-closure controls on edges far from the bridge (12 of 15 passed the rule we set in
advance; the three failures are a known modeling artifact — a stranded dead-end hex —
not a flaw in the finding). The honest limit: the one real commute we could source,
Dundalk to Ferndale, went from about 20 to 41 minutes; the model adds about 1.2 minutes
for the same pair, about 9 even with both tunnels also closed. Free-flow is a lower
bound on real disruption; we haven't compared the model to observed traffic beyond that
one commute. Separately, an exhaustive audit scores every eligible bundle of up to three
catalog options and checks the search's top pick against all of them — rank 1 of 129 in
the reference run. That checks the search, not the road model.

**5. Three seconds is tiny. Is your model just missing congestion?**
Partly, and we say so. Free-flow speeds understate tunnel and bridge-approach delays;
congestion only enters in the stress futures. The three-second regional figure isn't a
claim about real travel times — it's a claim that, at equal conditions, most trips in
the region never used the bridge, so the average barely moves. That's the point: the
average is the wrong place to look. The local figure is free-flow too, so it's a lower
bound: the one reported commute we could source roughly doubled (20 to 41 minutes), far
more than the model's free-flow increase for that pair. With tunnel congestion added
after the closure, the median cross-harbor resident's added time becomes about 11 to 17
seconds rather than under a second.

**6. First response didn't change. Isn't that a sign the model is too simple?**
It's a limit and a result. Both shores have fire stations and hospitals inside the study
area, so nearest-station times don't depend on the bridge — we report that as a
resilience check that held. What we don't model: unit counts, staffing, availability,
mutual-aid delays, or stations outside the study area, so edge block groups can look
under-served. The tool says "in this model that held," not "response is fine."

**7. Who would use this, and how is it different from a traffic model?**
State DOT and metropolitan planning analysts doing resilience or criticality screening:
if this crossing is lost, who loses access, and where would mitigation matter?
Emergency managers are a secondary audience. It's not a replacement for a calibrated
regional travel model; it's a fast, open, browser-based screen that puts the average,
the local effect and what held on one screen, plus a guarded way to search options.
Screening, not design. We're not affiliated with or endorsed by any agency.

**8. Isn't this an emergency dispatch or triage system? Is it safe for AI?**
No. It's a counterfactual infrastructure-planning research prototype with a human in the
loop, and it says so throughout: it must not direct, prioritize or delay any real
emergency response. It never claims to save lives, isn't real-time, and the
first-response lens is a resilience check on a historical network. The model never
produces a number; its output is validated; result text comes from templates.

**9. What stops someone from running up your token bill or abusing the demo?**
The server builds every prompt from templates and accepts only structured, validated
input — it's not a generic model proxy. A global daily spend ceiling, per-mission token
budgets, per-client limits, an in-memory front door, an optional Turnstile check and a
kill switch cover the rest; when the budget's spent the panel says so while manual
exploration still works. The server and abuse-control code went through several
adversarial review rounds, pinned by regression tests.

**10. Did you find a fix for the peninsula?**
No, and the tool is honest about it. The best two-stage search result — Beltway flow
plus Harbor Tunnel approaches plus I-95 flow — reduces the residents who reach more than
ten percent fewer cross-harbor jobs from about twenty thousand to about fifteen
thousand, about a quarter fewer. About fifteen thousand remain. That rests on assumed
corridor speed factors and hypothetical options, not an agency study, and it's a
cliff-edge measure that our sensitivity study didn't test in the option worlds. Shuttle
links didn't help, and we pruned ten of the first 24 options for having no measurable
effect. All options are hypothetical; none was proposed or endorsed by any agency. The
tool screens where mitigation would matter; it doesn't design it.

**11. What did your sensitivity study break?**
Four things, published in `docs/METHODOLOGY.md`. First, the head-count: about 20,000
residents losing more than 10% of cross-harbor jobs ranges from about 6,700 to 96,000
when speeds move 20%, and the time budget behaves the same way — a cliff-edge
statistic, quoted only with its range. Second, "the typical resident is unaffected"
holds only at free-flow: with tunnel congestion added after the closure, the median
added time becomes about 11 to 17 seconds. Third, the model doesn't reproduce the one
reported detour we could source (Dundalk to Ferndale, about 20 to 41 minutes, versus
about +1.2 minutes in the model), so free-flow is a lower bound. Fourth, against random
comparable motorway cuts the Key Bridge isn't exceptional on the regional measure, so we
call it a concentrated cross-harbor bottleneck, not the most consequential link. What
held: the regional (about 3 s) and first-response (unchanged) conclusions in all 51
variants, and the peninsula stayed worst-hit in 50 of 51. Three of 15 null controls
failed our pre-declared rule — all closures of a dead-end street a hex snaps to, a
modeling artifact, not evidence against the finding.

**12. Why hazmat trucks, and how sure are you of the fifteen minutes?**
Because it's the strongest effect we found, and the tunnel rule is published, not
assumed: the Maryland Transportation Authority bars vehicles carrying listed hazardous
materials from the Fort McHenry and Harbor Tunnels. That the Key Bridge carried hazmat
before the collapse is our assumption — the rule page doesn't cover the bridge, but
MDTA's own Key Bridge news page sends tunnel-prohibited hazmat vehicles to the western
I-695 arc, the route the model uses. We fixed 24 cross-harbor trips between seven road
anchors before seeing results. At free-flow, removing the bridge adds about 5.8 minutes
for a car and about 14.7 for a hazmat truck; 23 of the 24 hazmat trips add more than
five minutes. It's one rule, one sample of trips, no queues, permits or dwell time, and
general freight isn't modeled. Two hypothetical escort-window options let hazmat trucks
use a tunnel at an assumed delay; in the reference run the Harbor Tunnel option cuts the
mean from +14.7 to +10.2 minutes — a hypothetical result, not an MDTA program. Nothing
here is route guidance; carriers follow posted and designated hazmat routes.

## Numbers you may quote (all from the app and the snapshot, as of 2026-10-24)

- 36,610 road nodes; OpenStreetMap as of 2024-03-01; 74 fire stations, 2 ambulance
  stations, 10 hospitals.
- First response: p90 6.1 min, unchanged; 96% of residents within 8 min.
- Regional job access: about +3 s on average.
- Cross-harbor: about 20,000 residents lose more than 10% of reachable jobs (app
  20,100; exact reference 19,705), **always quoted with the range about 6,700 to
  96,000**; about 11,400 lose more than 25%; the 8 hardest-hit block groups lose
  27-77%; average added time about 11 to 17 s across speed variants (stable).
- Study: 51 variants; regional and first-response conclusions held in all 51; peninsula
  worst-hit in 50 of 51; 12 of 15 null controls passed our pre-declared rule; router rank
  agreement 0.98 (Spearman), model about 22% faster; reported Dundalk to Ferndale
  commute about 20 to 41 min versus about +1.2 min in the model.
- Low-wage workers: 1,380 lose more than 10%, which is 1.8% of low-wage workers against
  1.9% of all residents.
- Hazmat (free-flow, Key Bridge removed, 24 cross-harbor trips between 7 anchors): cars
  +5.8 min mean; hazmat trucks +14.7 min mean; 23 of 24 hazmat trips add more than 5
  min; Harbor Tunnel escort window (hypothetical, assumed delay) cuts the hazmat mean to
  +10.2 min.
- Search: deterministic two-stage (screen every eligible bundle, paired futures on the
  top 12); exhaustive audit ranks its top pick 1 of 129. Best result (Beltway flow +
  Harbor Tunnel approaches + I-95 flow): "residents reaching more than 10% fewer
  cross-harbor jobs" from about 20,000 to about 15,000, about a quarter fewer; about
  15,000 remain.
- AI: Token Factory account real, billing done, key live; `GET /v1/models` resolves all
  four role IDs; structured output and streaming confirmed on both models used
  (2026-10-24, `docs/FEEDBACK_NOTES.md`). Not yet true: production wiring on the
  deployed site, and one full live mission through the app's own routes.

If a number on screen differs from one here, trust the screen and fix this file.

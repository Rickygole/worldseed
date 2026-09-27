# Devpost submission text

Everything below is written to be pasted as is. Two kinds of marker need resolving
before you paste:

- **[VERIFY BEFORE SUBMIT]** marks a sentence that depends on something that was not
  verified when this was written (2026-09-26): the AI planner running against live
  Nemotron models on Token Factory (no key deployed yet; built and tested against fakes
  only), the Tavily lookups on the deployed site (pending key), the deployed build
  matching the current code (docs/STATUS.md could not confirm which commit is live), or
  a figure that must be re-read from the running app (the "rank 1 of 129" audit, the
  hazmat and escort minutes, the "about 15,000" search result). Confirm it is true,
  rewrite it, or delete the sentence.
- **[VERIFY AFTER REDESIGN]** marks a description of the guided story interface that
  was being rebuilt when this was written (scene names, button labels). Confirm it
  against the deployed build.
- **[PLANNED]** marks something that does not exist yet. Either delete the sentence
  or leave the marker in the pasted text so a judge reads it as a roadmap item.

Delete the marker text you resolve. Nothing else here should need editing except the
video link and the feedback section.

- Track: Best Apps and Agents
- Live demo: https://worldseed-mu.vercel.app
- Code: https://github.com/Rickygole/worldseed
- Video: [PASTE YOUTUBE LINK, under 3:00, public]
- Created during the Submission Period; first commit 2026-09-26.

### Testing instructions (paste into the Devpost testing field)

No login, no payment, no install. The simulation, map, inspector, freight panel and deterministic search run in your browser with no limits. Live AI and news-search calls are free; to keep the shared free budget available to every judge through 15 December, they carry per-visitor fair-use limits. If a limit is reached the app says so and the same search continues without AI. Contact: [CONTACT EMAIL: a project address].

**[VERIFY BEFORE SUBMIT: the "same search continues without AI" behavior and the "free" live calls must be true on the deployed build. Live AI calls cannot be offered until a key is deployed.]**

### Submission-form notes (do not paste)

- Do not select City Winner: Baltimore is not a listed city and no listed city event was attended (the 2026-10-02 Boston event is optional; select a city only if it was attended).
- Prize rule as read from the rules: one Overall OR one Track award, plus at most one Bonus (Tavily, City Winner and Most Valuable Feedback are all Bonus). Do not describe or claim any performance of Tavily or of any model in the text.
- Tag `v1.0-submission`, pin the judged deployment, and turn off production auto-deploy from `main` after the deadline (2026-10-30, 10:00am PT).
- GitHub disables scheduled workflows in public repos after 60 days without repository activity: commit before then to keep the health ping alive, or accept that it may stop.

---

## Project name

WorldSeed

## Tagline

Don't predict the future. Simulate it.

## Thesis

Regional averages hide local disasters, and a good tool also shows what didn't break.

## One-line version

WorldSeed is a counterfactual screening tool that shows who loses access when a crossing is removed, including hazmat trucks that must detour, and what did not break, with every number computed by a simulator and none by a language model.

## Two-sentence version

A regional model says losing the Key Bridge costs about 3 seconds on average; for about 20,000 people, mostly on the Sparrows Point / Edgemere peninsula, it cut more than 10% of the jobs they can reach across the harbor within 30 minutes (a count that depends on speed and time-budget assumptions, about 6,700 to 96,000 across the variants we tested), and WorldSeed shows both, plus the first-response times that held and the hazmat trucks that add about 15 minutes. A deterministic two-stage search screens 16 hypothetical options with no AI, and an NVIDIA Nemotron planner on Nebius Token Factory is built to propose options from the same catalog by ID only, while the simulator computes every metric. **[VERIFY BEFORE SUBMIT: the Nemotron planner must run live on the deployed site. If it has not, keep "is built to" and say the planner is pending live verification; if it has, change to "proposes".]**

---

## Project description

*In memory of the six construction workers who died when the Francis Scott Key Bridge collapsed on March 26, 2024. WorldSeed is a research and education prototype for infrastructure planning. It is not a dispatch, triage or operational system, and it is not affiliated with or endorsed by any agency.*

### Inspiration

A regional model says losing the Key Bridge costs about 3 seconds on average. For about 20,000 people, mostly on the Sparrows Point / Edgemere peninsula, it cut more than 10% of the jobs they can reach across the harbor within 30 minutes, and for the eight hardest-hit block groups, 27 to 77%. (The head-count depends on speed and time-budget assumptions, about 6,700 to 96,000 across the variants we tested; the time-based measures and the worst-hit places are stable.) Both statements are true. Only one of them tells a planner where to look.

We wanted a tool that puts the average and the local effect side by side, and that also shows what did not break, because "the thing you feared held" is a finding too. We also wanted an AI system that works with a simulator instead of pretending to be one. Language models are good at proposing options and bad at being trusted with numbers. So in WorldSeed the model proposes, the simulator scores, and application templates write every result sentence.

### What it does

WorldSeed loads the pre-collapse OpenStreetMap road network for the Baltimore region (dated March 1, 2024): 36,610 road nodes, the Key Bridge, both harbor tunnels, Census block groups, LEHD job counts, 74 fire stations, 2 ambulance stations and 10 hospitals. It computes consequences at free-flow speeds; congestion enters only in stress futures.

The interface is a map-first guided story of six scenes (The crossing is removed; Averages hide the local story; What did not break; Hazmat trucks must detour; What could help; Now explore) with an Expert mode toggle for the full analyst workspace. **[VERIFY AFTER REDESIGN: confirm the scene names and the Expert toggle on the deployed build.]** One click removes the Key Bridge link and every lens recomputes on the road network, in the browser. Terrain rises where the change is largest. Three lenses stay visible side by side so that no number can hide another:

- **First response held.** The simulated time from the nearest fire or EMS station does not change. Both shores have their own stations and hospitals.
- **Regional job access barely moved.** About 3 seconds on the average drive to the region's main job centers. Most trips never used the bridge.
- **Cross-harbor job access broke for one place.** The eight hardest-hit block groups on the peninsula lose 27 to 77% of the jobs on the other shore that were reachable within 30 minutes. About 20,000 residents lose more than 10% (the app shows 20,100; the exact reference is 19,705), but that count depends on speed and time-budget assumptions: about 6,700 to 96,000 across the variants we tested. The time-based measures (about 11 to 17 s average added) and the identity of the worst-hit block groups are stable.

Low-wage workers are not disproportionately hit: 1,380 of them lose more than 10%, which is 1.8% of low-wage workers against 1.9% of all residents. The tool reports that gap either way. Click any hexagon and WorldSeed shows its block group, Census figures and the route that changed. Every figure is computed by the simulator or is cited Census data, never typed by hand.

**Hazmat trucks lose the most minutes.** WorldSeed is an offline, retrospective planning simulation on a historical (2024) road network. It is not connected to, and must not be used as part of, any traffic management, traffic control, navigation, vehicle-routing or hazardous-materials compliance system. Hazmat results show how one published MDTA rule changes simulated travel times; they are not route guidance. Vehicles carrying the hazardous materials MDTA lists are barred from both harbor tunnels (Maryland Transportation Authority, https://mdta.maryland.gov/TunnelRestrictionsAndVehiclePermits, accessed 26 September 2026). With the bridge removed, in the model they take the western I-695 arc, the alternate route MDTA names (https://mdta.maryland.gov/keybridgenews, accessed 26 September 2026). That the Key Bridge carried hazmat before the collapse is an assumption: the MDTA rule page does not cover the bridge. WorldSeed times 24 fixed cross-harbor trips between real port and industrial anchors for two vehicle classes: a car, and a hazmat truck, meaning a vehicle carrying the listed materials. At free-flow with the bridge removed, cars add about 5.8 minutes on average and hazmat trucks about 14.7; 23 of the 24 hazmat trips add more than 5 minutes. Closing the Harbor Tunnel as well changes nothing for hazmat trucks, because they could not use it anyway. Only this one rule is modeled, and not every truck carries such materials. Not affiliated with or endorsed by the MDTA; the MDTA's published rules and COMAR 11.07.01 govern, not this tool.

Then the search can screen for where mitigation would matter. Pick a goal (cross-harbor access, first response, or hazmat truck detours) and the system searches bundles of up to three options from a 16-entry catalog of hypothetical scenario options (one shuttle link and two road connectors, eight corridor priorities, three staging sites, and two escorted hazmat windows for the hazmat goal). The deterministic search needs no AI and has two stages: one free-flow run screens every eligible bundle, then paired stress futures re-score the top 12, a deterministic critic stress-tests the leaders under a single-link closure, and you preview, compare and apply the finalists. Checked against an exhaustive audit of every eligible bundle, its top pick ranks 1 of 129. The AI planner path (a critic that picks a stress test from a closed set, and a planner that refines) is built and tested against fakes only, pending a real key. It does not find a fix. The best two-stage result (Beltway flow + Harbor Tunnel approaches + I-95 flow) reduces "residents who reach more than 10% fewer cross-harbor jobs" from about 20,000 to about 15,000, about a quarter fewer, and about 15,000 remain. That rests on assumed corridor speed factors and hypothetical options, not an agency study. For hazmat trucks, a hypothetical Harbor Tunnel escort window (hypothetical; not an MDTA program, proposal or finding, and nothing here says it would be safe or lawful) cuts the mean added time from +14.7 to +10.2 minutes in the reference run, at an assumed escort delay. **[VERIFY BEFORE SUBMIT: the search, futures view, finalists and Preview / Compare / Apply flow must all work on the deployed build; re-read "about 20,000 to about 15,000", "rank 1 of 129" and "+14.7 to +10.2" from the running app; and keep the AI-planner sentence as "built, pending a real key" unless one real end-to-end mission has run.]**

A Tavily-backed feed can propose current road closures near the model area. Each proposal is an unverified news report with its source link and quote, and nothing enters the model until you confirm it with a signed, single-use token. A separate reality-check endpoint lists recent sources about detours after the 2024 collapse (title, domain, date, snippet and link, all labeled unverified, with no model call); it does not compare anything to the simulator's numbers. Both are built and tested, with an evidence drawer in the interface. **[VERIFY BEFORE SUBMIT: the closure and evidence lookups must run with a real Tavily key on the deployed site. As of 2026-09-26 they are pending a key and have never run live.]**

**Who it is for.** Resilience and criticality screening for state DOT and metropolitan planning organization analysts, with emergency managers as a secondary audience through the first-response lens. It is screening, not design. The Key Bridge is the case study; screening any other crossing is **[PLANNED]**. We call the bridge a concentrated cross-harbor bottleneck, not the most consequential link: against random comparable motorway cuts it is unremarkable on the regional measure.

**What our own study says.** We stress-tested the finding across 51 variants of the assumptions (speeds, tunnel congestion, time budget, shore rule, snap time) and checked the model against an independent router and a reported commute. The regional conclusion (about 3 seconds; under 30 s in every variant) and the first-response conclusion (unchanged) held in all 51 variants, and the peninsula block groups stayed the worst-hit in 50 of 51. The head-count did not hold still: it depends on speed and time-budget assumptions, from about 6,700 to about 96,000 when speeds move 20%, so we quote it with its range. "The typical resident is unaffected" holds only at free-flow; if the tunnels slow down after the closure, the median added time is about 11 to 17 seconds. Free-flow is a lower bound on real disruption: one reported commute (Dundalk to Ferndale) went from about 20 to 41 minutes, while the model adds about 1.2 minutes (about 9 with both tunnels also closed). Against the public OpenStreetMap-based OSRM router, rank agreement is 0.98 (Spearman) and the model is about 22% faster. Full study: docs/METHODOLOGY.md in the repository.

### How we built it

- **A build-time data pipeline (Python 3.12).** It fetches OpenStreetMap history with a dated Overpass query, Census ACS, TIGER boundaries, LEHD LODES and Maryland iMAP facilities, builds the road graph and an H3 hexagon grid, verifies the Key Bridge and tunnel ways by ID and tags, and writes a committed, hashed snapshot.
- **A browser-side simulator (TypeScript, Web Workers).** Every change to the world compiles to an edge-cost vector over a fixed road graph, and the simulator is a pure function of it. It runs in the visitor's browser, so the demo costs nothing to keep alive. It is tested against an independent Python reference (networkx and scipy), hex by hex.
- **Three lenses, one of them defined in advance.** The cross-harbor lens (jobs on the opposite shore reachable within 30 minutes) was defined from the bridge's function before its results were seen, because the region-wide average hides what the bridge did. The freight trip set (7 anchors, 32 trips including 8 same-shore controls) was also fixed before its results were seen.
- **A search that works without a model.** A deterministic two-stage search screens every eligible bundle with one run and puts paired stress futures on the top 12, so the tool delivers finalists with no key, and an exhaustive audit checks its pick against every bundle.
- **A guarded AI layer.** Next.js route handlers on Vercel hold the keys, build every prompt on the server from templates, and accept only schema-validated structured input. Strict validators run in the browser and again on the server. Budgets, rate limits, a kill switch and an optional Turnstile check protect a free public demo. The server and abuse-control code was independently red-teamed in multiple rounds, with fixes pinned by regression tests.
- **A design that stays honest.** Every result is labeled "computed locally in your browser", every model parameter is listed in an Assumptions drawer, and the interface uses hatching and words, never color alone.

### Challenges we ran into

- **Our first hero metric was flat.** We planned to show emergency response time rising when the bridge is removed. A spike on the data showed it does not change. We rebuilt around an honest finding and kept first response visible as a resilience check that held.
- **The region-wide average hides the story.** Job access across the region moves by only 3 seconds. We defined the cross-harbor lens before looking at its results, and show both together.
- **Keeping a language model away from numbers.** The catalog shown to the model has no effect sizes, its output schema has no place for a number, and its "why" is a choice from a fixed list of eight rationale kinds that the application renders. Results and card text come only from the application. The one exception is an optional raw reasoning string, shown only in a collapsed, labeled section of the decision log ("Model reasoning (raw, unverified; not a result)"), checked only for plain-text form (no digits, links or markup), never used for a decision and never on a card.
- **Historical data.** Getting the road network as it was before the collapse meant dated Overpass queries, retries on gateway errors, and checks that the exact bridge and tunnel ways are present.
- **Public-demo abuse.** A free demo backed by a paid model API needs budgets, per-client limits, server-built prompts and a kill switch.
- **Tone.** This is built on a real loss. The bridge appears only as a removed link, nothing is animated, no one is named, and the interface says everywhere that it is a planning simulation.

### Accomplishments that we're proud of

- A finding we did not expect and did not tune: first response held, regional access barely moved, and the loss is concentrated on the peninsula. We then tried to break it with a 51-variant sensitivity study and reported what failed: the head-count moves by more than an order of magnitude, and one reported commute is far larger than the model's free-flow increase.
- A simulator in the browser that matches an independent reference, so the numbers on screen can be reproduced.
- An AI layer where the model has no route to a number, and where every rejected output is visible in a decision log. **[VERIFY BEFORE SUBMIT: confirm a real rejection is visible in the live decision log, or reword to "designed so that every rejected output is visible".]**
- An honest catalog result: we pruned ten of our first 24 options because they had no measurable effect (four shuttle links, six staging sites), and even the best bundle leaves about 15,000 residents still affected. The tool says so.
- A freight finding with a published rule behind it: in the model, hazmat trucks add about 14.7 minutes against about 5.8 for a car, because the MDTA bars listed hazardous materials from both tunnels. It is a simulation of one rule, not route guidance.
- A public demo that needs no login and runs its simulation in the visitor's browser, at no server cost.

### What we learned

- The most useful thing a simulator can do is tell you where the problem is not.
- A single region-wide average can be accurate and still be the wrong number to look at, and a head-count of people affected can be as assumption-sensitive as the average is misleading. Report the range, and prefer the measures that stay stable.
- Constraining a model to choose from a catalog and having software measure the outcome is far easier to trust and to test than asking it for an analysis.
- Historical open data (OpenStreetMap attic queries) is a strong base for counterfactual work.

### What's next

- Verify and tune the AI planner on live Nemotron models, and record how each model role behaves. The AI planner, the AI side of the adversarial critic loop (the critic picks a stress test from a closed set, the simulator re-scores the leaders under it, the planner refines) and the parser are built and tested against fakes only; the Tavily closure feed, the reality-check evidence drawer, the Upstash shared limits and the Turnstile hook are built and unverified against the real services. **[VERIFY BEFORE SUBMIT: state each as working only if it ran live on the deployed site.]**
- **[PLANNED]** Screening other crossings from the app. The pipeline is already configurable by bounding box.
- **[PLANNED]** A quantitative comparison of model output to published observations of the 2024 detours.
- Extend the catalog with options that agencies or planners have actually studied, with sourced effects instead of assumptions.

---

## How we used Token Factory and Nemotron

WorldSeed calls NVIDIA Nemotron models through Nebius Token Factory's OpenAI-compatible endpoint, from server-side route handlers only. Four roles map to models: a planner and a critic on the largest available Nemotron reasoning model, and a parser and an extractor on a small Nemotron model. Model IDs are resolved at runtime from the account's `/models` list, and the app shows which model actually ran. The planner proposes, refines and finalizes bundles of one to three options chosen only from catalog IDs; the critic reads the simulator's results, picks one stress test from a closed set (a tunnel closed and/or a time of day) for the simulator to re-score the leaders under, flags concerns and may veto bundles; the parser turns a plain-language goal into a structured one that the user confirms as chips; the extractor reads Tavily results and extracts closure claims with verbatim quotes.

The model never produces a number. The catalog it sees carries IDs, titles, types and cost tiers but no effect sizes; its output must pass strict schema validators in the browser and again on the server; its explanation is a choice from eight fixed rationale kinds that the application renders in the decision log, labeled "AI rationale (unverified; not a result)"; and all result text, including every finalist card, is written by application templates from simulator output. The one exception is an optional raw reasoning string, shown only in a collapsed section of the decision log labeled "Model reasoning (raw, unverified; not a result)": it is checked only for plain-text form (no digits, links or markup), never used for a decision and never placed on a card. Invalid output gets one repair turn, then the deterministic two-stage search runs, labeled "not AI" (it screens every eligible bundle once, then scores the top 12 across paired stress futures, with no model call). Spend is limited by a daily ceiling, per-mission token budgets, per-client limits and a kill switch.

**Model licenses, by role.** The candidate lists are Ultra then Super for the planner and critic, and Nano, then Lightning, then Super for the parser and extractor. Licenses as named on the Hugging Face model cards (BF16 repositories, read 2026-09-26): Nemotron 3 Nano and Nemotron 3 Super, NVIDIA Nemotron Open Model License (last modified 2025-12-15); Nemotron 3 Ultra and Nemotron 3.5 Lightning, OpenMDW License Agreement, version 1.1 (OpenMDW-1.1). WorldSeed calls these models through an API and does not distribute model weights or derivatives. Whether the copies Nebius serves carry the same terms is unverified.

**[VERIFY BEFORE SUBMIT: as of 2026-09-26 no Token Factory key was deployed and none of the model paths had been run against live Nemotron models. Legal review 2 also adds a denylist screen to the raw reasoning string (profanity and slurs, fault or cause words, and proper names that are not catalog, gazetteer or allowlisted place tokens); describe it, and the label "Written by an AI model and shown without human review. It may be wrong or inappropriate and is not the view of WorldSeed", only after it ships. If the live run is not done, replace the paragraph above with: "The planner, critic (including its stress-test step), parser and extractor paths are built and tested with a fake provider; live verification against Nemotron models on Token Factory was still pending at submission." If it is done, name the model the health check shows for each role, and add one concrete observation from FEEDBACK_NOTES.md.]**

## Feedback for Nebius and NVIDIA

**[FILL IN from docs/FEEDBACK_NOTES.md near the deadline. This is the only place in the repository or the submission where Token Factory observations may appear. Only real observations from our own app: onboarding steps, whether the models we asked for were available on our account, how our own validators and schema screens handled the replies we received, and where the documentation was accurate or not. No comparison of models or providers, no benchmarks, and nothing about Tavily's performance (Tavily's terms bar disclosing it). As of 2026-09-26 the log is empty.]**

If you publish any counts, use this wording exactly, with N and the dates filled in from the notes:

> Observations from WorldSeed's own validators on our own requests (N = __ missions, __ to __ 2026). They describe how our app's schema and screens handled the replies we received, not the quality or performance of Token Factory or any model. This is not a benchmark or a comparison with any other model or provider.

## Built with

Nebius Token Factory, NVIDIA Nemotron, Tavily, Next.js, React, TypeScript, Web Workers, deck.gl, MapLibre GL, OpenFreeMap, H3, Zustand, Framer Motion, d3, zod, Vercel, Python, NumPy, SciPy, NetworkX, GeoPandas, Shapely, pandas, scikit-learn, OpenStreetMap, U.S. Census Bureau ACS, TIGER/Line and LEHD LODES, Maryland iMAP.

## Category choice: Best Apps and Agents

WorldSeed is a complete application, not a demo of a model: a real dataset, a simulator, a designed interface and a public deployment that needs no login. It is also an agent with an unusual constraint. A planner model searches a space of options, a simulator it cannot bypass scores every option across many futures, and validators reject any output that steps outside the catalog. The agent acts through choices it cannot misuse, its steps are in a decision log, a human decides what to apply, and the result is a screening aid whose numbers can be reproduced. **[VERIFY BEFORE SUBMIT: confirm the planner runs live on Nemotron; otherwise change "A planner model searches" to "The planner is built to search" and mention the deterministic search.]**

## Disclaimer to keep at the end of the description

WorldSeed is a research and educational prototype for exploring counterfactual infrastructure-planning scenarios. It is not an emergency dispatch, triage, routing or operational decision system, and it is not route guidance: it is an offline, retrospective simulation on a historical road network, not connected to any traffic management, navigation or hazardous-materials compliance system. All figures are simulated from historical open data at free-flow speeds and are not measurements or predictions. Numbers, results and finalist cards are produced by the application from simulator results and catalog data. AI-written text appears only in the decision log: a labeled rationale choice, and an optional raw reasoning section shown without human review, which may be wrong or inappropriate and is not the view of WorldSeed. News-derived closure quotes are verbatim from their sources and unverified. Not affiliated with or endorsed by any agency, hospital, the Maryland Transportation Authority (MDTA), the State of Maryland, the U.S. Census Bureau, the NTSB or the OpenStreetMap Foundation. In an emergency, call 911.

## Privacy

WorldSeed has no accounts and sets no cookies. Your browser's session storage keeps a random session id and whether you have seen the intro. To enforce fair-use limits, the server keeps a salted hash of your IP address and session id in a counter store (Upstash) for at most about two days; WorldSeed does not store raw IP addresses. The host (Vercel) processes request data, including IP addresses, in its logs under its own privacy policy. If the bot check is on, Cloudflare Turnstile processes signals such as your IP address and browser details to detect bots. Text you type as a goal is sent to Nebius Token Factory to run the AI model, so do not enter personal information. Questions: open a GitHub issue. **[VERIFY BEFORE SUBMIT: the retention figure must match the limiter TTLs (daily cap keys are 2 days); Upstash and Turnstile apply only once enabled.]**

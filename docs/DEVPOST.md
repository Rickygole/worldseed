# Devpost submission text

Everything below is written to be pasted as is. Two kinds of marker need resolving
before you paste:

- **[VERIFY BEFORE SUBMIT]** marks a sentence that depends on something that was not
  live when this was written (2026-09-26): the AI planner running against live
  Nemotron models on Token Factory (no key deployed yet), the futures / finalist /
  deterministic-search flow, the Tavily lookup on the deployed site (pending key), or
  the guided tour. Confirm it is true, rewrite it, or delete the sentence.
- **[PLANNED]** marks something that does not exist yet. Either delete the sentence
  or leave the marker in the pasted text so a judge reads it as a roadmap item.

Delete the marker text you resolve. Nothing else here should need editing except the
video link and the feedback section.

- Track: Best Apps and Agents
- Live demo: https://worldseed-mu.vercel.app
- Code: https://github.com/Rickygole/worldseed
- Video: [PASTE YOUTUBE LINK, under 3:00, public]

---

## Project name

WorldSeed

## Tagline

Don't predict the future. Simulate it.

## Thesis

Regional averages hide local disasters, and a good tool also shows what didn't break.

## One-line version

WorldSeed is a counterfactual screening tool that shows who loses access when a crossing is removed, and what did not break, with every number computed by a simulator and none by the language model.

## Two-sentence version

A regional model says losing the Key Bridge costs about 3 seconds on average; for about 20,100 people on the Sparrows Point / Edgemere peninsula it cut more than 10% of the jobs they can reach across the harbor within 30 minutes, and WorldSeed shows both, plus the first-response times that held. NVIDIA Nemotron on Nebius Token Factory screens hypothetical options, but it only chooses from catalog IDs, and the simulator computes every metric. **[VERIFY BEFORE SUBMIT: the Nemotron screening must run live on the deployed site, or change "screens" to "is built to screen" and describe the deterministic search.]**

---

## Project description

*In memory of the six construction workers who died when the Francis Scott Key Bridge collapsed on March 26, 2024. WorldSeed is a research and education prototype for infrastructure planning. It is not a dispatch, triage or operational system, and it is not affiliated with or endorsed by any agency.*

### Inspiration

A regional model says losing the Key Bridge costs about 3 seconds on average. For about 20,100 people on the Sparrows Point / Edgemere peninsula it cut more than 10% of the jobs they can reach across the harbor within 30 minutes, and for the eight hardest-hit block groups, 27 to 77%. Both statements are true. Only one of them tells a planner where to look.

We wanted a tool that puts the average and the local effect side by side, and that also shows what did not break, because "the thing you feared held" is a finding too. We also wanted an AI system that works with a simulator instead of pretending to be one. Language models are good at proposing options and bad at being trusted with numbers. So in WorldSeed the model proposes, the simulator scores, and application templates write every result sentence.

### What it does

WorldSeed loads the pre-collapse OpenStreetMap road network for the Baltimore region (dated March 1, 2024): 36,610 road nodes, the Key Bridge, both harbor tunnels, Census block groups, LEHD job counts, 74 fire stations, 2 ambulance stations and 10 hospitals. It computes consequences at free-flow speeds; congestion enters only in stress futures.

One click removes the Key Bridge link and every lens recomputes on the road network, in the browser. Terrain rises where the change is largest. Three lenses stay visible side by side so that no number can hide another:

- **First response held.** The simulated time from the nearest fire or EMS station does not change. Both shores have their own stations and hospitals.
- **Regional job access barely moved.** About 3 seconds on the average drive to the region's main job centers. Most trips never used the bridge.
- **Cross-harbor job access broke for one place.** The eight hardest-hit block groups on the peninsula lose 27 to 77% of the jobs on the other shore that were reachable within 30 minutes. About 20,100 residents lose more than 10%.

Low-wage workers are not disproportionately hit: 1,380 of them lose more than 10%, which is 1.8% of low-wage workers against 1.9% of all residents. The tool reports that gap either way. Click any hexagon and WorldSeed shows its block group, Census figures and the route that changed. Every figure is computed by the simulator or is cited Census data, never typed by hand.

Then the planner can screen for where mitigation would matter. Describe a goal in plain language, and the system proposes bundles of options from a 24-entry catalog of hypothetical scenario options (shuttle links, corridor priorities, staging sites), scores each bundle across many simulated stress futures, and shows finalists you can preview, compare and apply. Between rounds, a critic picks one stress test from a closed set (a tunnel closed and/or a time of day), the simulator re-scores the leading bundles under it, and the planner refines. A deterministic, no-AI critic runs the same step when the AI is unavailable. It does not find a fix. Only about four of the 24 options meaningfully help, the shuttle links did not, and the best single option recovers about 40% of the cross-harbor loss, a result that comes from an assumed corridor speed factor rather than an agency study. **[VERIFY BEFORE SUBMIT: the search, futures view, finalists and the Preview / Compare / Apply flow must all be working on the deployed site, and the "about 40%" figure must be re-read from the app or the candidate-effects data.]**

A Tavily-backed feed can propose current road closures near the model area. Each proposal is an unverified news report with its source link and quote, and nothing enters the model until you confirm it with a signed, single-use token. A separate reality-check endpoint lists recent sources about detours after the 2024 collapse (title, domain, date, snippet and link, all labeled unverified, with no model call); it does not compare anything to the simulator's numbers, and its interface was still being wired. **[VERIFY BEFORE SUBMIT: the closure lookup must run with a real Tavily key on the deployed site. As of 2026-09-26 it is pending a key.]**

**Who it is for.** Resilience and criticality screening for state DOT and metropolitan planning organization analysts, with emergency managers as a secondary audience through the first-response lens. It is screening, not design. The Key Bridge is the case study; screening any other crossing is **[PLANNED]**.

### How we built it

- **A build-time data pipeline (Python 3.12).** It fetches OpenStreetMap history with a dated Overpass query, Census ACS, TIGER boundaries, LEHD LODES and Maryland iMAP facilities, builds the road graph and an H3 hexagon grid, verifies the Key Bridge and tunnel ways by ID and tags, and writes a committed, hashed snapshot.
- **A browser-side simulator (TypeScript, Web Workers).** Every change to the world compiles to an edge-cost vector over a fixed road graph, and the simulator is a pure function of it. It runs in the visitor's browser, so the demo costs nothing to keep alive. It is tested against an independent Python reference (networkx and scipy), hex by hex.
- **Three lenses, one of them defined in advance.** The cross-harbor lens (jobs on the opposite shore reachable within 30 minutes) was defined from the bridge's function before its results were seen, because the region-wide average hides what the bridge did.
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

- A finding we did not expect and did not tune: first response held, regional access barely moved, and the loss is concentrated on the peninsula.
- A simulator in the browser that matches an independent reference, so the numbers on screen can be reproduced.
- An AI layer where the model has no route to a number, and where every rejected output is visible in a decision log. **[VERIFY BEFORE SUBMIT: confirm a real rejection is visible in the live decision log, or reword to "designed so that every rejected output is visible".]**
- An honest catalog result: most of the options we wrote do not help, and the tool says so.
- A public demo that needs no login and runs its simulation in the visitor's browser, at no server cost.

### What we learned

- The most useful thing a simulator can do is tell you where the problem is not.
- A single region-wide average can be accurate and still be the wrong number to look at.
- Constraining a model to choose from a catalog and having software measure the outcome is far easier to trust and to test than asking it for an analysis.
- Historical open data (OpenStreetMap attic queries) is a strong base for counterfactual work.

### What's next

- Verify and tune the AI planner on live Nemotron models, and record how each model role behaves.
- Finish wiring and verifying what is already built in code: the adversarial critic loop (the critic picks a stress test from a closed set, the simulator re-scores the leaders under it, the planner refines; a deterministic no-AI critic does the same in the fallback), the exhaustive-search check of the AI's finalists against the true optimum over all bundles of up to three options, and the reality-check evidence panel (Tavily sources about the 2024 detours, unverified, no model call). **[VERIFY BEFORE SUBMIT: state each as live only if it works on the deployed site; the exhaustive check and evidence panel had no interface wiring as of this writing.]**
- **[PLANNED]** Screening other crossings from the app. The pipeline is already configurable by bounding box.
- **[PLANNED]** A freight and hazmat trip lens (pipeline work in progress).
- **[PLANNED]** A quantitative comparison of model output to published observations of the 2024 detours.
- Extend the catalog with options that agencies or planners have actually studied, with sourced effects instead of assumptions.

---

## How we used Token Factory and Nemotron

WorldSeed calls NVIDIA Nemotron models through Nebius Token Factory's OpenAI-compatible endpoint, from server-side route handlers only. Four roles map to models: a planner and a critic on the largest available Nemotron reasoning model, and a parser and an extractor on a small Nemotron model. Model IDs are resolved at runtime from the account's `/models` list, and the app shows which model actually ran. The planner proposes, refines and finalizes bundles of one to three options chosen only from catalog IDs; the critic reads the simulator's results, picks one stress test from a closed set (a tunnel closed and/or a time of day) for the simulator to re-score the leaders under, flags concerns and may veto bundles; the parser turns a plain-language goal into a structured one that the user confirms as chips; the extractor reads Tavily results and extracts closure claims with verbatim quotes.

The model never produces a number. The catalog it sees carries IDs, titles, types and cost tiers but no effect sizes; its output must pass strict schema validators in the browser and again on the server; its explanation is a choice from eight fixed rationale kinds that the application renders in the decision log, labeled "AI rationale (unverified; not a result)"; and all result text, including every finalist card, is written by application templates from simulator output. The one exception is an optional raw reasoning string, shown only in a collapsed section of the decision log labeled "Model reasoning (raw, unverified; not a result)": it is checked only for plain-text form (no digits, links or markup), never used for a decision and never placed on a card. Invalid output gets one repair turn, then a deterministic search labeled "not AI". Spend is limited by a daily ceiling, per-mission token budgets, per-client limits and a kill switch.

**[VERIFY BEFORE SUBMIT: as of 2026-09-26 no Token Factory key was deployed and none of the model paths had been run against live Nemotron models. If the live run is not done, replace the paragraph above with: "The planner, critic (including its stress-test step), parser and extractor paths are built and tested with a fake provider; live verification against Nemotron models on Token Factory was still pending at submission." If it is done, name the model the health check shows for each role, and add one concrete observation from FEEDBACK_NOTES.md.]**

## Feedback for Nebius and NVIDIA

**[FILL IN from docs/FEEDBACK_NOTES.md near the deadline. Only real observations: onboarding steps, model availability, structured-output behavior, latency, rate limits, docs accuracy. As of 2026-09-26 the log is empty.]**

## Built with

Nebius Token Factory, NVIDIA Nemotron, Tavily, Next.js, React, TypeScript, Web Workers, deck.gl, MapLibre GL, OpenFreeMap, H3, Zustand, Framer Motion, d3, zod, Vercel, Python, NumPy, SciPy, NetworkX, GeoPandas, Shapely, pandas, scikit-learn, OpenStreetMap, U.S. Census Bureau ACS, TIGER/Line and LEHD LODES, Maryland iMAP.

## Category choice: Best Apps and Agents

WorldSeed is a complete application, not a demo of a model: a real dataset, a simulator, a designed interface and a public deployment that needs no login. It is also an agent with an unusual constraint. A planner model searches a space of options, a simulator it cannot bypass scores every option across many futures, and validators reject any output that steps outside the catalog. The agent acts through choices it cannot misuse, its steps are in a decision log, a human decides what to apply, and the result is a screening aid whose numbers can be reproduced. **[VERIFY BEFORE SUBMIT: confirm the planner runs live on Nemotron; otherwise change "A planner model searches" to "The planner is built to search" and mention the deterministic search.]**

## Disclaimer to keep at the end of the description

WorldSeed is a research and educational prototype for exploring counterfactual infrastructure-planning scenarios. It is not an emergency dispatch, triage, routing or operational decision system. All figures are simulated from historical open data at free-flow speeds and are not measurements or predictions. Result text is written by application templates from simulator output and cited Census data; any AI-written rationale or raw reasoning appears only in a labeled section of the decision log, screened for plain-text form only, and may be inaccurate. Not affiliated with or endorsed by any agency, hospital, the State of Maryland, the U.S. Census Bureau, the NTSB or the OpenStreetMap Foundation. In an emergency, call 911.

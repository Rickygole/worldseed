# Devpost submission text

Everything below is written to be pasted as is.

- Track: Best Apps and Agents
- Live demo: https://worldseed-mu.vercel.app
- Code: https://github.com/Rickygole/worldseed
- Video: [PASTE YOUTUBE LINK, under 3:00, public]
- Created during the Submission Period; first commit 2026-09-26.

### Testing instructions (paste into the Devpost testing field)

No login, no payment, no install. The simulation, map, inspector, freight panel and
deterministic search run in your browser with no limits and no key. As of 2026-10-24
the deployed site's AI planner is live: the real Nebius Token Factory key is wired into
production (see "How we used Token Factory and Nemotron" below), and a real mission can
be run from Expert mode. Every finding and every number in this submission works
without it too, with no key. Contact: [CONTACT EMAIL: a project address].

### Submission-form notes (do not paste)

- Do not select City Winner: Baltimore is not a listed Builders & Brews city.
- Prize rule, per the rules' own "How To Enter" section: one Overall or one Track
  award, plus at most one Bonus (for example Best Use of Tavily or Most Valuable
  Feedback, never both, never City Winner here). The $25 promo code and the Nebius
  Builders program are offered identically to every entrant — nothing to flag there.
- Tag `v1.0-submission`, pin the judged deployment, and turn off production
  auto-deploy from `main` after the deadline (2026-10-30, 10:00am PT).

---

## Project name

WorldSeed

## Tagline

Regional averages hide local disasters. WorldSeed shows you where.

## Thesis

A good planning tool also shows what didn't break.

## One-line version

A regional model said losing the Key Bridge cost about 3 seconds on average; WorldSeed
found the 20,000 people on one peninsula that average was hiding, using a simulator —
never a language model — to compute who loses job access, whether first response
holds, and how far hazmat trucks must detour, with an NVIDIA Nemotron model sitting on
top as a search policy that can only choose from a catalog the simulator itself checks.

## Two-sentence version

A regional model says losing the Key Bridge costs about 3 seconds on average; underneath
that average, about 20,000 people on one peninsula lose over 10% of the jobs they can
reach across the harbor, first response doesn't change at all, and hazmat trucks lose
15 minutes to a published detour rule — three true, different answers the regional
number hides. A deterministic search already proves the architecture works, finding the
exhaustive-audit top bundle of 129 with no AI; Nemotron turns an open-ended goal into
that same checked search — the one job brute force can't do — with a critic that adds a
second check, picking a stress test from a closed set to try to break the runner-up,
verified live against the real Token Factory API today.

---

## Project description

*In memory of the six construction workers who died when the Francis Scott Key Bridge
collapsed on March 26, 2024. WorldSeed is a research and education prototype for
infrastructure planning. It is not a dispatch, triage or operational system, and it is
not affiliated with or endorsed by any agency.*

### Inspiration

A regional model says losing the Key Bridge costs about 3 seconds on average. That's
true, and it's the wrong place to look: about 20,000 people, mostly on the Sparrows
Point / Edgemere peninsula, lose more than 10% of the jobs they can reach across the
harbor within 30 minutes — up to 77% in the eight hardest-hit block groups. We wanted a
tool that shows the average and the local disaster side by side, and that also reports
what held, because "the thing you feared didn't happen" is a finding too.

We also wanted an AI system that can't fake a result. Most hackathon agents either
compute nothing (a model free-associating about traffic) or hide their computation (a
black-box score). We built the opposite: a simulator that is the only place a number
can come from, and a model whose entire job is to pick from choices the simulator can
verify.

### What it does, and the idea behind it

The non-obvious part isn't "the model never outputs a number" — that's a constraint.
The idea is that Nemotron's job is the one piece a brute-force search genuinely can't
do: turning an open-ended, plain-language goal into the structured mission the search
runs on. A second model, the critic, adds a check on top: it picks one stress test from
a closed, enumerable set (close a tunnel, shift the time of day) specifically to break
the leaderboard the planner just proposed, and the simulator is forced to re-score
every leader under that exact stress. The model can't game its way to a good-looking
bundle, because the thing attacking its bundle is also deterministic and auditable.

That idea is checkable without AI in the loop at all, and we checked it: a deterministic
two-stage search — screen every eligible bundle once, then paired stress futures on the
top 12 — finds the rank-1 bundle out of all 129 eligible combinations in the exhaustive
audit (`frontend/lib/agent/exhaustive.ts`). That isn't evidence the AI is unnecessary;
it's the provably-correct baseline the AI is checked against, which is what makes it
safe to demo in the first place. Nemotron's real job, the one piece exhaustive search
genuinely can't do, starts upstream of ranking bundles: turning an open-ended,
plain-language goal into the structured mission that search runs on — there's no
catalog of English sentences to enumerate. The critic adds a smaller, second check on
top: it picks one stress test from the same closed set the deterministic critic also
checks, specifically to try to break the leading bundle, so nothing survives on an
untested assumption. Neither role claims to out-rank brute force at its own game — the
planner's job is one brute force can't attempt at all, the critic's is making sure the
winner was actually tested. As of 2026-10-24 the real Nebius Token Factory API is live
and verified: `GET /v1/models` resolves all four role model IDs, structured
`json_schema` output and streaming both work on both models used, and a real
end-to-end mission through the app's own routes (parse → plan → critique → finalize)
ran locally the same day: 30 provider-backed calls, 90% valid on the first turn, and 3
clean falls-back to the deterministic critic on the rest — proof the catalog-only
validator holds against a real model's real mistakes, not just fake-provider tests. As
of 2026-10-24 that key is also wired into the deployed site's production environment,
behind a shared rate-limit store, and a second real mission has run through the live
site itself (Expert mode, a plain-language goal through parse → plan → critique →
finalize). The deployed demo now runs the AI path live; it falls back to the
deterministic path, labeled "not AI," only if the AI is unavailable, its output is
rejected, or the daily budget is spent.

Three lenses stay on screen together so no number hides another, for state DOT and MPO
resilience analysts asking "if this crossing is lost, who loses access, and where would
mitigation matter?":

- **First response held.** Simulated time from the nearest fire or EMS station doesn't
  change — both shores have their own stations.
- **Regional access barely moved.** About 3 seconds on the average drive to the
  region's job centers.
- **Cross-harbor access broke, locally.** About 20,000 residents on the peninsula lose
  more than 10% of the jobs across the harbor; the eight hardest-hit block groups lose
  27-77%; about 4,900 lose more than half. For scale, losing the Harbor Tunnel instead
  would hit 3.2x more people at the 10% threshold — the bridge is the more concentrated
  cut, not the biggest one.
- **Hazmat trucks lose the most minutes.** Vehicles carrying MDTA-listed hazardous
  materials are barred from both harbor tunnels; with the bridge gone, they detour the
  western I-695 arc — about 15 minutes added on average against about 6 for a car,
  across 24 cross-harbor trips.

### Why you can trust the numbers

- The cross-harbor lens, and its 20/30/40-minute sensitivity bands, were defined before
  anyone looked at the results.
- We tried to break our own finding with 51 sensitivity variants (speeds, tunnel
  congestion, time budget, shore boundary, snap time) plus 15 null-closure controls far
  from the bridge — 12 of 15 passed the rule we set in advance, and the three failures
  are a known modeling artifact (a stranded dead-end hex), not a flaw in the finding.
- The browser simulator matches an independent Python reference hex by hex, and ranks
  0.98 (Spearman) against the public OSRM router over about 5,000 origin-destination
  pairs.

### How we built it

- A build-time Python pipeline fetches dated OpenStreetMap history, Census
  ACS/TIGER/LODES and Maryland iMAP facilities, builds the road graph and hex grid, and
  writes a committed, hashed snapshot.
- A browser-side TypeScript simulator (Web Workers) is the only source of computed
  numbers, tested hex by hex against an independent Python reference.
- A deterministic two-stage search (screen every eligible bundle, then paired stress
  futures on the top 12) runs with zero AI dependency and is checked against an
  exhaustive audit of all 129 bundles.
- Next.js route handlers hold the only keys, build every prompt from server templates,
  and accept nothing but schema-validated structured input — there is no generic model
  proxy.
- Four Nemotron roles (planner, critic, parser, extractor), resolved at runtime from the
  account's live `/models` list, so the UI shows exactly which model ran.

### Challenges we ran into

- **Our first hero metric was flat.** We expected EMS response time to spike; it
  didn't. We rebuilt the story around an honest finding instead of a dramatic one.
- **Keeping a model away from numbers structurally, not by prompting.** The catalog it
  sees carries no effect sizes; its output schema has no field for a number; its "why"
  is a pick from eight fixed rationale kinds the application renders as a sentence.
- **Verifying a real API against a plan built entirely from public docs.** Every model
  ID we guessed from documentation in September resolved correctly on the first live
  `/models` call, and ten real missions through the app's own routes then confirmed the
  rest of the plumbing — the validator, the catalog-only constraint, the fallback path —
  holds against a real model's real mistakes, not just the fake-provider tests.
- **Tone.** This is built on a real loss. The bridge appears only as a removed link;
  nothing is animated; no one is named.

### Accomplishments that we're proud of

- A finding we didn't tune, that survived a 51-variant attempt to break it.
- A search architecture where the exhaustive audit — no AI, rank 1 of 129 — is also the
  proof that the AI search policy sitting on top of it has nothing to hide behind.
- A real Token Factory account, verified live at the API level (model resolution,
  structured output, streaming) six days before the deadline, wired into the deployed
  site's production environment, with real missions run both locally and through the
  live site itself.
- A public demo with zero server compute cost for its core simulation.

### What we learned

- The most useful thing a simulator can do is tell you where the problem is not.
- Constraining a model to choose from a catalog a simulator can check is easier to
  trust than asking it for an analysis — and it's a stronger agent story, not a weaker
  one: the audit that proves the search works without AI is the same audit that keeps
  the AI honest once it's switched on.
- A head-count can be as assumption-sensitive as a regional average is misleading;
  report the range, lead with the stable measures.

### What's next

- Compare model output quantitatively to published post-collapse observations.
- Screen crossings beyond the three already shipped (Key Bridge, Harbor Tunnel, Fort
  McHenry Tunnel); the pipeline is already bounding-box configurable for a new one.

---

## How we used Token Factory and Nemotron

WorldSeed calls NVIDIA Nemotron models through Nebius Token Factory's OpenAI-compatible
endpoint, from server-side route handlers only. Four roles map to models: a planner and
a critic on the largest available Nemotron reasoning model, and a parser and an
extractor on a small Nemotron model. Model IDs resolve at runtime from the account's
`/models` list, and the app shows which model actually ran.

The model never produces a number. The catalog it sees carries IDs, titles, types and
cost tiers but no effect sizes; its output must pass strict schema validators in the
browser and again on the server; its explanation is a choice from eight fixed rationale
kinds the application renders in the decision log, labeled "AI rationale (unverified;
not a result)"; all result text, including every finalist card, is written by
application templates from simulator output. One labeled exception: an optional
raw-reasoning string, shown only in a collapsed, labeled log section, checked only for
plain-text form, never used for a decision and never placed on a card.

**Where this stands today (2026-10-24).** A real Token Factory account, billing and API
key exist. `GET /v1/models` resolves all four role IDs we had guessed from public
documentation back in September — `nvidia/Nemotron-3-Ultra-550b-a55b` for
planner/critic, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` for parser/extractor — with no
change needed. Structured `json_schema` output and streaming both work on both models,
confirmed by real calls against the live API (latency, token counts and sample sizes in
`docs/FEEDBACK_NOTES.md`). A full mission has run end to end through the app's own
routes (parse → plan → critique → finalize), first locally (30 provider-backed calls
across 10 synthetic missions, 90% valid on the first turn, 3 clean falls-back to the
deterministic critic), then — as of 2026-10-24 — against the live deployed site itself,
behind an Upstash-backed shared rate-limit store so a single script can't drain the
shared AI budget across serverless instances. The deployed demo now runs the AI path
live, falling back to the deterministic two-stage search, labeled "not AI," only if the
AI is unavailable, its output is rejected, or the budget is spent — and that fallback's
own top pick already ranks first of 129 in the exhaustive audit, so there's no bad
outcome either way.

**Model licenses, by role.** Nemotron 3 Nano and Nemotron 3 Super: NVIDIA Nemotron Open
Model License (last modified 2025-12-15). Nemotron 3 Ultra and Nemotron 3.5 Lightning:
OpenMDW License Agreement v1.1. WorldSeed calls these models through an API and does not
distribute model weights or derivatives.

## Feedback for Nebius and NVIDIA

Compiled from `docs/FEEDBACK_NOTES.md`, which separates what we experienced from what we
read in docs. Paste the final write-up from that file's "Final feedback" section before
submitting; any published count uses the exact safe wording specified there (N
missions, dates, "not a benchmark or comparison").

## Built with

Nebius Token Factory, NVIDIA Nemotron, Tavily, Next.js, React, TypeScript, Web Workers,
deck.gl, MapLibre GL, OpenFreeMap, H3, Zustand, Framer Motion, d3, zod, Vercel, Python,
NumPy, SciPy, NetworkX, GeoPandas, Shapely, pandas, scikit-learn, OpenStreetMap, U.S.
Census Bureau ACS, TIGER/Line and LEHD LODES, Maryland iMAP.

## Category choice: Best Apps and Agents

WorldSeed is a complete application, not a demo of a model: a real dataset, a
simulator, a designed interface and a public deployment that needs no login. It's also
an agent with an unusual constraint: a planner model turns an open-ended goal into a
structured search of options — the one job a brute-force search genuinely can't do — a
simulator it cannot bypass scores every option across many futures, and a critic adds a
second check, picking the stress test designed to break the leaders. The search itself
is also provably correct without AI: a deterministic version of it already audits out
at rank 1 of 129. Nemotron is wired on top of that exact architecture, verified live
against the real Token Factory API, with ten real missions already run through the
app's own routes; wiring that same key into the deployed site's production environment
is what's left before judging.

## Disclaimer to keep at the end of the description

WorldSeed is a research and educational prototype for exploring counterfactual
infrastructure-planning scenarios. It is not an emergency dispatch, triage, routing or
operational decision system, and it is not route guidance: it is an offline,
retrospective simulation on a historical road network, not connected to any traffic
management, navigation or hazardous-materials compliance system. All figures are
simulated from historical open data at free-flow speeds and are not measurements or
predictions. Numbers, results and finalist cards are produced by the application from
simulator results and catalog data. AI-written text appears only in the decision log: a
labeled rationale choice, and an optional raw-reasoning section shown without human
review, which may be wrong or inappropriate and is not the view of WorldSeed. Not
affiliated with or endorsed by any agency, hospital, the Maryland Transportation
Authority (MDTA), the State of Maryland, the U.S. Census Bureau, the NTSB or the
OpenStreetMap Foundation. In an emergency, call 911.

## Limits

- **Free-flow is a lower bound.** The one real detour we could source (Dundalk to
  Ferndale, reported 20 to 41 minutes) is about 17 times the model's free-flow increase
  for that pair; the model measures lost connectivity, not queues on diversion routes.
- **The head-count is a cliff-edge statistic.** About 20,000 people lose more than 10%
  of cross-harbor jobs in the reference run, but that count ranges from about 6,700 to
  96,000 across the 51 sensitivity variants we ran. The time-based measures (11-17
  seconds average added) and which block groups are worst-hit are stable; quote the
  count with its range, never alone.
- **Hazmat on the bridge is an assumption.** The MDTA tunnel rule is published; that the
  Key Bridge itself carried hazmat traffic before the collapse is our inference, not
  MDTA's. The two escort-window options are hypothetical, not an MDTA program.
- **Not the single most consequential link, by every measure.** Against random
  comparable motorway cuts, the bridge is unremarkable on the regional-average measure
  (36th percentile) and high on concentrated harm to a few people (92nd percentile for
  share losing more than 25% of cross-harbor jobs). We call it a concentrated
  cross-harbor bottleneck, not the most important road in the region.
- **Not validated against observed post-collapse traffic**, beyond the one reported
  commute above.
- One bridge, one region, one historical snapshot: this is a screening tool, not a
  regional travel-demand model, and not a replacement for an agency study.

## Privacy

WorldSeed has no accounts and sets no cookies. Your browser's session storage keeps a
random session id and whether you've seen the intro. Once the shared rate-limit store
is configured in production, the server keeps a salted hash of your IP and session id
in it for at most about two days to enforce fair-use limits, and never stores raw IP
addresses; until then, limits are enforced per server instance instead and nothing is
stored centrally. The host (Vercel) processes request data, including IP addresses, in
its own logs. Text you type as a goal is sent to Nebius Token Factory to run the AI
model — don't enter personal information. Questions: open a GitHub issue.

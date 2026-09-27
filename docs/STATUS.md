# WorldSeed Status Board

Living task board. Update it whenever something moves. Last updated: 2026-09-26 (ops pass 2, evening local time).
Submission steps live in `docs/SUBMISSION_CHECKLIST.md`; this file tracks state, decisions and risks.

How to read the evidence tags: **verified** = checked by a request or file read on 2026-09-26; **as reported** = stated by
the agent that did the work and not re-run here; **unverified** = nobody has confirmed it.

## Key dates

| Date | Event |
|------|-------|
| 2026-10-02 | Boston Builders & Brews event (optional; the Devpost city field applies only if attended) |
| 2026-10-03 | Hard escalation date: a real Nebius key must be working and one real end-to-end mission must have run (see the ranked plan) |
| 2026-10-30, 10:00am PT | Submission deadline. Tag `v1.0-submission` and pin the judged deployment before this |
| 2026-12-01 to 2026-12-15 | Judging period |
| Through 2026-12-15 (12:00 PT per `docs/LEGAL.md`) | Demo must stay live and free to use, no login. Keep credits, quotas and hosting alive until then |

## State right now

### Live at https://worldseed-mu.vercel.app (checked 2026-09-26)

Reported as the commit 69c4fce era (**as reported**: the deployed commit SHA is **unverified**; Vercel builds from GitHub `main`).

- **Verified 2026-09-26:** the page loads (HTTP 200); its HTML contains the cross-harbor UI and the freight and hazmat text;
  `/snapshot/manifest.json` serves snapshot `keybridge-2024-03-01-v1` and `/snapshot/trips.json` serves the freight trip anchors;
  `/api/evidence` exists (a plain GET answers 405, so the route is there and expects POST).
- **Verified 2026-09-26, `GET /api/health`:** HTTP 200 with `ok: true`, `degraded: true`, reason `planner_unavailable`; provider not configured;
  Tavily not configured; protection `instance-local`; every role `unavailable`; evidence not available. So the deployment has no AI keys and
  no shared store, and the AI features are in their "AI planner unavailable, explore manually" state by design.
- **As reported (works without any key, not re-tested in a browser today):** the real browser-side simulator on the real snapshot with the
  cross-harbor, regional-access and first-response EMS lenses; freight trips (car and hazmat truck) and the freight search; the two-stage
  deterministic search; stress tests; the exhaustive check; compare and apply; closures and evidence drawers, which show an honest
  "unavailable" message when there are no keys.

### Built and unit-tested, unverified against real services

- AI planner and critic (model registry with runtime `/models` resolution, Token Factory client, validator, agent state machine, rationale-only
  model output), Tavily closure search and evidence, Upstash shared limits and budget ledger, and Cloudflare Turnstile.
- **Unverified:** none of these has run against real Nemotron, Tavily, Upstash or Turnstile. Model IDs, structured-output support, streaming,
  reasoning-token behavior, latency and the shared-store commands stay unverified until `frontend/scripts/smoke-token-factory.mjs` and
  `frontend/scripts/smoke-store.mjs` have run with real credentials (see `docs/SUBMISSION_CHECKLIST.md`, section 2).

### Test and CI state

- **Verified 2026-09-26** (fresh clone of the committed HEAD, no `node_modules`, no `data/raw`): the exact CI frontend commands (`npm ci`, `tsc --noEmit`, `eslint . --max-warnings 0`, `vitest run`, `WS_REQUIRE_SNAPSHOT=1 npm run build`) all pass: 47 test files, 919 tests passed and 1 skipped (vitest about 100 s), whole sequence about 2 minutes on the build Mac. This is the committed HEAD, not the uncommitted redesign in the working tree.
- **Verified 2026-09-26** (same fresh clone): `pytest` in `pipeline` gives 47 passed and 2 failed before this pass; the 2 failures read the
  git-ignored `data/raw/interim`. Those two tests now skip with a stated reason when the directory is absent (`needs_raw` in
  `pipeline/tests/test_snapshot.py`); with this change 18 of the 20 tests in that file pass and 2 skip on a fresh clone.
  The full pipeline suite was not re-run end to end after the change.
- **Verified 2026-09-26:** `scripts/check-repo-hygiene.sh` passes on a fresh clone with no dependencies installed; the
  `THIRD_PARTY_LICENSES.md` staleness check is skipped there and is only ever a warning.
- New today: `.github/workflows/ci.yml` and `.github/workflows/health.yml` (see `docs/CI.md`). **Unverified:** neither has run on GitHub yet
  (not pushed). The YAML parses and each command was run locally; the actions themselves (`actions/checkout@v4`, `actions/setup-node@v4`,
  `astral-sh/setup-uv@v5`) are unrun. First green run and first scheduled health run are the confirmation.

### In progress (other agents, uncommitted working tree)

- Full interface redesign: map-first guided story (scenes and copy deck in `docs/STORY.md`), map director, Expert mode toggle, keys dialog.
- Final review round over code, copy and numbers.
- Copy and docs: `README.md`, `docs/DEVPOST.md`, `docs/PITCH.md`, `docs/VIDEO_SCRIPT.md`, `docs/DESIGN.md`.

### Blocked on the user

- [ ] Nebius Builders verification email (not received) and the hackathon $25 credit email with the promo code (not received). **Hard date 2026-10-03:** a real key working and one real end-to-end mission run.
- [ ] Nebius Token Factory login, plus the billing card decision (the billing docs say a bank card is required to finish onboarding; see `docs/FEEDBACK_NOTES.md`).
- [ ] Upstash free account and the store variables (shared spend counters; without it the deployment runs "instance-local" with a lower daily budget).
- [ ] Optional: free Census API key (`CENSUS_API_KEY`) so a pipeline rebuild can use the official API instead of the Census Reporter mirror. Not needed for the submission.
- [ ] Optional: Cloudflare Turnstile keys, if the extra abuse gate is wanted.
- [ ] Devpost submission draft (text drafts: `docs/DEVPOST.md`) and the YouTube upload of the demo video (script: `docs/VIDEO_SCRIPT.md`).
- [ ] Optional: Boston Builders & Brews, 2026-10-02.
- [ ] Email Devpost support about Builders-program eligibility and keep the written answer (unverified until answered).

## Done

- [x] Public GitHub repo (Rickygole/worldseed), MIT license, README, `.env.example`.
- [x] Devpost: joined the hackathon.
- [x] Nebius Builders application submitted; hackathon $25 credit form submitted (both awaiting email).
- [x] Tavily free Researcher plan set up (pay-as-you-go is OFF). The key is not set on Vercel (health shows Tavily not configured).
- [x] Architecture plan, legal checklist, data-source log, feasibility spike (`docs/`, `spikes/`).
- [x] Snapshot pipeline and committed Key Bridge-era Baltimore snapshot (ODbL notice in `data/snapshot/LICENSE.md`).
- [x] Browser simulator (CSR graph, Dijkstra, EMS / access / cross-harbor lenses, correlated futures, worker pool) with golden-matched tests.
- [x] UI wired to the real simulator; deployed to Vercel Hobby from GitHub `main`.
- [x] Repo hygiene: local git hooks plus `scripts/check-repo-hygiene.sh`.
- [x] Simulator round 5 and pipeline round 3: point-to-point freight and hazmat trips with vehicle classes (MDTA rule sourced), catalog pruned to 16 with the pruned options recorded.
- [x] AI layer rounds 5-7: screened two-stage deterministic search, signed equity gap, stress loop, exhaustive-search check, freight lens, displayed-precision tie-breaks.
- [x] UI Part 2 (planner panel, freight panel, closures and reality-check drawers) deployed.
- [x] Methodology: null controls, 51-variant sensitivity study, validation against public sources (`docs/METHODOLOGY.md`).
- [x] Free scheduled health ping and CI workflows written (`docs/CI.md`); not yet run on GitHub.
- [x] Attributions, NOTICE and generated `THIRD_PARTY_LICENSES.md` (2026-09-26; items marked unverified are listed in `docs/ATTRIBUTIONS.md`).

## Next (unblocked)

- [ ] Finish the interface redesign and the final review round, commit, and confirm the deployment matches the tag candidate.
- [ ] Commit and push the workflows, then confirm the first CI run is green and trigger the Health workflow once by hand.
- [ ] Wire a link to `THIRD_PARTY_LICENSES.md` and the State of Maryland acknowledgement into the About dialog (frontend owner).
- [ ] Measure the futures run (N=100) in a browser on a low-end machine.

## Skeptic's ranked plan (from an independent review, 2026-09-26)

Progress as of 2026-09-26 (as reported): items 3, 4, 5, 7, 8, 9 and 10 are built and deployed or committed; 6 (any crossing) and 11 (reachability checks and fallback style) are not confirmed; 1 is blocked on the user; 2 is part of the redesign in progress.

Top priorities, roughly in order:

1. Get a real Nebius key working and run one real end-to-end mission by 2026-10-03 (hard escalation date).
2. Reframe the copy and the metrics ribbon to match what the numbers show (see the decision on the cross-harbor result below).
3. A visible adversarial critic stress loop.
4. A screened model rationale in the decision log (the app already renders a fixed rationale kind, labeled "AI rationale (unverified; not a result)").
5. A freight/hazmat trip lens (shipped; framing rules in `docs/LEGAL.md` rule 11).
6. Screen any crossing (not just the Key Bridge).
7. An exhaustive-search check panel (does the agent's pick match brute force over the catalog?).
8. Prune inert catalog options.
9. Cut the narrator role.
10. Pivot Tavily to a cited "reality check" evidence panel; live closure ingestion becomes secondary.
11. Reachability checks, with an OpenFreeMap fallback style.
12. A free scheduled health ping (GitHub Actions cron hitting `/api/health`). Written 2026-09-26 (`.github/workflows/health.yml`), not yet run on GitHub.

## Risks

- **No key means no stage-one API requirement.** If the AI features have never run against Token Factory, the submission cannot show Nemotron on Token Factory. Mitigation: the 2026-10-03 escalation date.
- **Credits and the daily cap (credit-budget arithmetic).** `WS_DAILY_BUDGET_USD` defaults to 1 USD per day (`.env.example`). From 2026-10-30 to 2026-12-15 is 46 days, so the default could spend up to 46 USD, more than the 25 USD hackathon credit (unreceived) plus the 1 USD trial credit (documented as valid 30 days). Set `WS_DAILY_BUDGET_USD` from the real balance after testing: cap per day = (credit remaining) / (days to 2026-12-15), for example 20 USD left is about 0.40 USD per day. The cap is a flat number; a date-aware cap is not built.
- **Model ID drift.** The catalog is moving (three models were removed from serverless on 2026-08-31). IDs may change between now and judging. Mitigation: runtime `/models` resolution and env overrides; re-run the smoke script shortly before tagging.
- **Video and demo must match.** The judged demo must match the tagged video and description; no changes after the deadline.
- **Cheap-laptop check.** Futures at N=100 have been measured only in Node/V8 on the build Mac (per the spike), never in a browser on a low-end device. Test before claiming interactive speed.
- **Vercel Hobby limits and fair use** under a judge burst: unverified; see the checklist.
- **CI and health are unrun.** Until the first GitHub run, a workflow mistake (an action version, the runner memory for the slow simulator tests) is possible. Scheduled workflows also pause after 60 days without repository activity.
- **Third-party availability.** OpenFreeMap has no availability promise (`docs/LEGAL.md`); Overpass is build-time only.
- **News citation.** The reported-commute passage has been credited to Maryland Matters, but both copies we could read name Capital News Service (Charlotte Kanner and Mira Beinart) and neither names Maryland Matters (read 2026-09-26). Credit and license (reported CC BY-NC-ND 4.0, unverified) must be settled before the video and Devpost text are final (`docs/METHODOLOGY.md` section 6.1).
- **Licenses.** Open items in `THIRD_PARTY_LICENSES.md` ("Needs a human look") and `docs/ATTRIBUTIONS.md`.

## Decisions

Record decisions here with a date and a one-line reason.

- 2026-09-26: Track is Best Apps and Agents.
- 2026-09-26: The hero lens is cross-harbor access (`xharbor`: jobs on the opposite shore reachable within 30 minutes, low-wage workers as the equity group). Regional job access and first-response EMS are kept as side-by-side comparison lenses so the region-wide number is never hidden.
- 2026-09-26: EMS finding, reported as is: first-due EMS response is essentially unchanged when the Key Bridge is removed (spike and pipeline run: zero change on the EMS lens), because both shores have their own stations and hospitals. The regional access lens moves only about 3 s per person. The app says so instead of showing invented mountains.
- 2026-09-26: The cross-harbor loss is not concentrated on low-wage workers: 1.8% of low-wage workers vs 1.9% of all residents lose more than 10% of cross-harbor jobs (`golden.json`, `xharbor`, `keybridge_removed`). Copy must not claim otherwise. Freight and hazmat trip times are in the product (freight lens, trips comparison, freight search); they are simulation results, not route guidance.
- 2026-09-26: Simulator and Monte Carlo run in the browser (TypeScript, Web Workers) so hosting stays free; results are labeled as computed locally.
- 2026-09-26: Every displayed number comes from the simulator; the language model never produces a metric.
- 2026-09-26: Strict prose screen, and cards are application text only: model output that reaches a reader is a selection from a fixed rationale table (`frontend/lib/agent/rationale.ts`), shown only in the decision log with the label "AI rationale (unverified; not a result)"; finalist cards contain no model text.
- 2026-09-26: Abuse and spend controls: per-client (IP) limits and a global daily spend cap (defaults in `.env.example`: 1 USD/day global, 0.20 USD/day per client, 8 new missions/hour per client in the shared store, 30 Tavily calls/day), no client-supplied prompts, keys server-side only.
- 2026-09-26: Deployment is Vercel Hobby, built from GitHub `main` (project `worldseed`), live at https://worldseed-mu.vercel.app. Hobby is non-commercial; no ads or paid tiers.
- 2026-09-26: The Key Bridge collapse is never animated, no individuals are named, and the tool is framed as a planning aid, not live dispatch (see `docs/DEDICATION.md`, `docs/LEGAL.md`).
- 2026-09-26: Second legal review adopted: `docs/LEGAL.md` rules 11 (hazmat and freight framing), 12 (no vendor performance disclosures), 13 (raw model text) and 14 (privacy notice). Freight copy says "Simulation, not route guidance"; the escorted hazmat windows are labeled hypothetical, not an MDTA program.
- 2026-09-26: Repo contains no AI-assistant attribution of any kind. Enforced by local git hooks (`.git/hooks/commit-msg`, `pre-commit`) and `scripts/check-repo-hygiene.sh`, which checks tracked files, paths and commit messages (and untracked files with `--include-untracked`).

## Submission checklist

The full, ordered checklist is `docs/SUBMISSION_CHECKLIST.md`. Summary of what is still open:

- [ ] Track selected: Best Apps and Agents
- [ ] Real Token Factory call working end to end (blocked on key)
- [ ] Demo URL loads and works in an incognito window
- [ ] Public GitHub repo with the license visible
- [ ] YouTube video under 3:00, public, audio covering Token Factory and Nemotron
- [ ] Project description and feedback section written
- [ ] Teammates: none (solo submission)
- [ ] Submitted before 2026-10-30 10:00am PT; tag `v1.0-submission`
- [ ] Demo kept live and free through 2026-12-15

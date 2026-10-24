# WorldSeed Status Board

Living task board. Update it whenever something moves. Last updated: 2026-10-24 (ops pass 3). The 2026-09-26 pass is kept
below where it still holds; anything re-checked today is marked as such. Submission steps live in
`docs/SUBMISSION_CHECKLIST.md`; this file tracks state, decisions and risks. **6 days remain to the 2026-10-30, 10:00am PT deadline.**

How to read the evidence tags: **verified** = checked by a request or file read on the date stated (2026-09-26 or
2026-10-24); **as reported** = stated by the agent that did the work and not re-run here; **unverified** = nobody has
confirmed it, and this pass did not guess at it either.

## Key dates

| Date | Event |
|------|-------|
| 2026-10-02 | Boston Builders & Brews event (optional; the Devpost city field applies only if attended) |
| 2026-10-03 | Hard escalation date (passed): a real Nebius key working. The key itself started working 2026-10-24 (later than planned). |
| 2026-10-24 | Nebius account, billing, promo code and API key done; raw-provider smoke test (plain + `--stream`) succeeded on all 4 model IDs. A real end-to-end mission through the app's own `/api/agent/*` routes also ran locally the same day (30 provider calls, 90% valid first-turn selection rate, 3 clean deterministic fallbacks on rejected output) — see `docs/FEEDBACK_NOTES.md`. Upstash still not set up (top blocker); live deployment still has no AI keys. |
| 2026-10-30, 10:00am PT | Submission deadline, 6 days from today. Tag `v1.0-submission` and pin the judged deployment before this |
| 2026-12-01 to 2026-12-15 | Judging period |
| Through 2026-12-15 (12:00 PT per `docs/LEGAL.md`) | Demo must stay live and free to use, no login. Keep credits, quotas and hosting alive until then |

## State right now

### Live at https://worldseed-mu.vercel.app (checked 2026-09-26; re-checked 2026-10-24)

Reported as the commit 69c4fce era (**as reported**: the deployed commit SHA is **unverified**; Vercel builds from GitHub `main`). No
production env vars have been set since 2026-09-26, so the live deployment's AI-related state is unchanged.

- **Verified 2026-09-26:** the page loads (HTTP 200); its HTML contains the cross-harbor UI and the freight and hazmat text;
  `/snapshot/manifest.json` serves snapshot `keybridge-2024-03-01-v1` and `/snapshot/trips.json` serves the freight trip anchors;
  `/api/evidence` exists (a plain GET answers 405, so the route is there and expects POST). Not re-checked today.
- **Verified 2026-09-26, `GET /api/health`:** HTTP 200 with `ok: true`, `degraded: true`, reason `planner_unavailable`; provider not configured;
  Tavily not configured; protection `instance-local`; every role `unavailable`; evidence not available.
- **Re-verified 2026-10-24, `GET /api/health`:** identical result — `provider.configured: false`, `protection: "instance-local"`,
  `tavily.configured: false`, every role `unavailable`. **This is the top remaining blocker before submission, and it is a distinct
  fact from the local smoke test below:** a real `NEBIUS_API_KEY` now exists and works locally against the raw Nebius provider, but it
  has not been pasted into Vercel's Production environment, and the standing decision (see Decisions) is not to do that until Upstash
  exists, so the shared store and spend limits aren't bypassed by an instance-local deploy. Until both are done, the LIVE site cannot
  make a single AI call — it is still in its "AI planner unavailable, explore manually" fallback state by design, not by accident.
- **As reported (works without any key, not re-tested in a browser this pass):** the real browser-side simulator on the real snapshot
  with the cross-harbor, regional-access and first-response EMS lenses; freight trips (car and hazmat truck) and the freight search; the
  two-stage deterministic search; stress tests; the exhaustive check; compare and apply; closures and evidence drawers, which show an
  honest "unavailable" message when there are no keys.

### Built and unit-tested; local provider now verified, app-level and shared-service calls still unverified

- AI planner and critic (model registry with runtime `/models` resolution, Token Factory client, validator, agent state machine, rationale-only
  model output), Tavily closure search and evidence, Upstash shared limits and budget ledger, and Cloudflare Turnstile.
- **Verified 2026-10-24, against the raw provider only (not the app):** a real `NEBIUS_API_KEY` works. `frontend/scripts/smoke-token-factory.mjs`
  (plain and `--stream`) confirmed: `GET /v1/models` lists 30 models and all 4 planned model IDs resolve exactly as designed on 2026-09-26
  with no key; structured JSON output (`response_format: json_schema`) works first-try on both role models used (Ultra for
  planner/critic, Nano for parser/extractor); streaming works on both. Full results and numbers are in `docs/FEEDBACK_NOTES.md`
  ("Live-key experiences", dated 2026-10-24).
- **Verified 2026-10-24, through the app's own agent routes (local, not yet the deployed site):** `scripts/smoke-token-factory.mjs
  --measure-screen --n 10` against a local instance of the real app drove 10 synthetic missions through `/api/agent/*` (parse, plan,
  critique, finalize) for 30 total provider-backed route calls. 27 of 30 returned a valid model selection on the first turn (90%),
  0 needed the one built-in repair turn, and 3 produced an invalid/out-of-catalog selection that the validator correctly rejected,
  falling back to the deterministic critic's own stress test — the model-can-only-select-from-a-catalog safety design held against a
  real model's real failure modes, not just the fake-provider tests. Full rationale-kind breakdown in `docs/FEEDBACK_NOTES.md`.
- **Still unverified:** this ran locally, not yet on the deployed site (pending Upstash + Vercel env vars). Tavily, Upstash and
  Turnstile are still completely unverified against real services (`TAVILY_API_KEY` and the `UPSTASH_*` / `KV_*` variables are
  confirmed empty in `.env` as of 2026-10-24).
  Reasoning-token behavior and shared-store command counts also remain unverified (see `docs/FEEDBACK_NOTES.md` for exact gaps).

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

- [x] **Done 2026-10-24.** Nebius Token Factory account, billing card, and the hackathon $25 promo code (balance $26.00).
- [ ] **Top remaining blocker (2026-10-24):** Upstash free account and the store variables (shared spend counters; without it the deployment runs "instance-local" with a lower daily budget, and the standing decision is not to put `NEBIUS_API_KEY` / `TAVILY_API_KEY` into Vercel's production env until this exists). Needs the user to sign up and create a database; an agent can then wire the resulting REST URL/token into Vercel.
- [ ] Pasting the confirmed keys into Vercel's Production environment variables (dashboard action; needs the user or someone with project access).
- [ ] Tavily key (still not obtained/set as of 2026-10-24).
- [ ] Optional: free Census API key (`CENSUS_API_KEY`) so a pipeline rebuild can use the official API instead of the Census Reporter mirror. Not needed for the submission.
- [ ] Optional: Cloudflare Turnstile keys, if the extra abuse gate is wanted.
- [ ] Devpost submission draft (text drafts: `docs/DEVPOST.md`) and the YouTube upload of the demo video (script: `docs/VIDEO_SCRIPT.md`) — recording/voiceover needs the user; form text can be drafted by an agent.
- [ ] Optional: Boston Builders & Brews, 2026-10-02 — date has passed; mark as missed/skipped unless attended.
- [ ] Email Devpost support about Builders-program eligibility and keep the written answer (unverified until answered).

## Done

- [x] Public GitHub repo (Rickygole/worldseed), MIT license, README, `.env.example`.
- [x] Devpost: joined the hackathon.
- [x] **Done 2026-10-24.** Nebius Token Factory account created, billing set up, $25 hackathon promo code applied ($26 total balance), `NEBIUS_API_KEY` generated and stored in the repo-root `.env` (git-ignored, never committed).
- [x] **Done 2026-10-24.** Raw-provider smoke test (`smoke-token-factory.mjs`, plain and `--stream`): all 4 planned model IDs resolve, structured JSON output and streaming both work on the planner/critic (Ultra) and parser/extractor (Nano) role models. Full numbers in `docs/FEEDBACK_NOTES.md`.
- [x] Tavily free Researcher plan set up (pay-as-you-go is OFF), per the 2026-09-26 entry — not re-verified on Tavily's side this pass. **Confirmed 2026-10-24:** `TAVILY_API_KEY` is still empty in the repo-root `.env`, so the key has not actually been generated/stored yet even if the plan exists. Not set on Vercel either way (health shows Tavily not configured).
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

1. Get a real Nebius key working (done 2026-10-24) and run one real end-to-end mission through the app itself (done 2026-10-24, local), then on the deployed site (still open; was due 2026-10-03, now the single highest-priority remaining item — blocked on Upstash + Vercel env vars).
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

- **No key means no stage-one API requirement — now partially mitigated, not resolved.** As of 2026-10-24, a real Nebius key exists and works against the raw Token Factory provider (model listing, structured output, streaming all confirmed; see `docs/FEEDBACK_NOTES.md`). That resolves the narrowest version of the risk: Nemotron on Token Factory has genuinely been exercised with a real key. It does NOT resolve the submission-relevant version: (1) the app's own agent routes (`/api/agent/*`) have never been called with this key — only the standalone smoke script has, which talks to Nebius directly and skips the app's state machine, validator and rationale logic entirely; (2) the deployed site at https://worldseed-mu.vercel.app still reports `provider.configured: false` (re-checked 2026-10-24), because the key has not been added to Vercel's Production environment — a decision deliberately deferred until Upstash exists, so the deploy doesn't fall back to the much lower instance-local budget. Until both a real in-app mission runs and the live deployment has the key, the submission still cannot demonstrate Nemotron on Token Factory in the thing judges will actually click. Mitigation: punch list in `docs/SUBMISSION_CHECKLIST.md` section 0a, days 0-2.
- **Credits and the daily cap (credit-budget arithmetic).** `WS_DAILY_BUDGET_USD` defaults to 1 USD per day (`.env.example`). From 2026-10-30 to 2026-12-15 is 46 days, so the default could spend up to 46 USD, more than the 25 USD hackathon credit (unreceived) plus the 1 USD trial credit (documented as valid 30 days). Set `WS_DAILY_BUDGET_USD` from the real balance after testing: cap per day = (credit remaining) / (days to 2026-12-15), for example 20 USD left is about 0.40 USD per day. The cap is a flat number; a date-aware cap is not built.
- **Model ID drift.** The catalog is moving (three models were removed from serverless on 2026-08-31). IDs may change between now and judging. Mitigation: runtime `/models` resolution and env overrides; re-run the smoke script shortly before tagging.
- **Video and demo must match.** The judged demo must match the tagged video and description; no changes after the deadline.
- **Cheap-laptop check.** Futures at N=100 have been measured only in Node/V8 on the build Mac (per the spike), never in a browser on a low-end device. Test before claiming interactive speed.
- **Vercel Hobby limits and fair use** under a judge burst: unverified; see the checklist.
- **CI and health, re-checked 2026-10-24: both green, not "unrun" anymore.** `gh run list` shows the scheduled Health workflow succeeding continuously on `main` (most recent runs every few hours through today, all `success`), including across the multi-week gap since the last push (2026-09-29). CI (`ci.yml`) last ran on that same 2026-09-29 push and was green; it has not run since because there have been no new pushes to `main` — so CI's green status is real but stale (not re-exercised against today's uncommitted `docs/FEEDBACK_NOTES.md` edit or any later change). The 60-day scheduled-workflow pause clock currently has headroom (last push 2026-09-29, about 25 days ago).
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
- 2026-10-24: Standing decision confirmed: do not add `NEBIUS_API_KEY` / `TAVILY_API_KEY` to Vercel's Production environment until Upstash exists, so the live deployment never silently runs on the much smaller `WS_INSTANCE_LOCAL_BUDGET_USD` fallback with real visitor traffic. This is why the live site still shows no AI keys configured even though a working key exists locally.

## Submission checklist

The full, ordered checklist is `docs/SUBMISSION_CHECKLIST.md` (section 0a has the day-by-day punch list for the remaining
6 days). Summary of what is still open as of 2026-10-24:

- [ ] Track selected: Best Apps and Agents (decision recorded 2026-09-26; not yet entered into an actual Devpost form)
- [x] Real Token Factory call working against the raw provider (done 2026-10-24) — [ ] still not working end to end through the app's own routes, and not yet live on the deployed site (blocked on Upstash + Vercel env vars)
- [ ] Demo URL loads and works in an incognito window (not re-tested this pass)
- [ ] Public GitHub repo with the license visible
- [ ] YouTube video under 3:00, public, audio covering Token Factory and Nemotron
- [ ] Project description and feedback section written (feedback source material is now ready in `docs/FEEDBACK_NOTES.md`)
- [ ] Teammates: none (solo submission)
- [ ] Submitted before 2026-10-30 10:00am PT; tag `v1.0-submission`
- [ ] Demo kept live and free through 2026-12-15

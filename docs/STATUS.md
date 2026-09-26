# WorldSeed Status Board

Living task board. Update it whenever something moves. Last updated: 2026-09-26 (evening, local time).
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

### Live at https://worldseed-mu.vercel.app (verified 2026-09-26)

- The page loads (HTTP 200) and its HTML contains the cross-harbor UI ("Cross-harbor access" lens, "Remove Key Bridge link" control).
- The snapshot is served from the site (`/snapshot/manifest.json`, id `keybridge-2024-03-01-v1`, same build time as the repo's `data/snapshot/manifest.json`).
- This is the real browser-side simulator on the real snapshot (no AI keys are needed for it): remove the Key Bridge link and
  the lenses (cross-harbor access, regional access, first-response EMS) recompute in the browser.
- `GET /api/health` reports: provider not configured, Tavily not configured, protection `instance-local`, planner unavailable,
  `degraded: true`. So there are no AI keys and no shared store on the deployment yet, and the AI features are in their
  "AI planner unavailable, explore manually" state by design.
- Which commit is deployed: **unverified** (Vercel builds from GitHub `main`; the local `origin/main` ref is at `df39085`, the same as local HEAD).

### Committed, not verified live (the AI layer)

- Model registry with runtime `/models` resolution, Token Factory client, validator, agent state machine, closure search via
  Tavily, front-door limiter, budget ledger, confirm tokens, prose screen, rationale-only model output (`9c23036`, `82986e8`, `df39085`).
- 450+ tests (as reported by the AI-layer work; not re-run for this update), reviewed in multiple adversarial rounds.
- **Never run against real Nemotron or real Upstash.** Model IDs, structured-output support, streaming, reasoning-token behavior,
  latency, and the shared store commands are all unverified until `scripts/smoke-token-factory.mjs` and `scripts/smoke-store.mjs`
  (both under `frontend/scripts/`) have been run with real credentials.

### In progress (other agents, uncommitted working tree)

- UI Part 2: the search experience.
- AI-layer round 3 fixes.
- Copy and docs: `README.md`, `docs/DEVPOST.md`, `docs/VIDEO_SCRIPT.md`, `docs/PITCH.md`, `docs/METHODOLOGY.md`, pipeline changes.
- This ops pass: `docs/STATUS.md`, `docs/ATTRIBUTIONS.md`, `docs/FEEDBACK_NOTES.md`, `docs/SUBMISSION_CHECKLIST.md`,
  `THIRD_PARTY_LICENSES.md` (generated), `NOTICE`, `scripts/gen-third-party-licenses.mjs`, hygiene script extension.

### Blocked on the user

- [ ] Create an Upstash free account and set the store variables (shared spend counters; without it the deployment runs "instance-local" with a lower daily budget).
- [ ] Nebius Builders program verification email: not yet received.
- [ ] Hackathon $25 credit email (promo code): not yet received.
- [ ] Nebius Token Factory login, plus the billing card decision (the billing docs say a bank card is required to finish onboarding; see `docs/FEEDBACK_NOTES.md`).
- [ ] Optional: free Census API key (`CENSUS_API_KEY`), which would let the pipeline use the official API instead of the Census Reporter mirror.
- [ ] Devpost submission draft (text drafts: `docs/DEVPOST.md`, in progress).
- [ ] YouTube upload of the demo video (script: `docs/VIDEO_SCRIPT.md`, in progress).
- [ ] Optional: Boston Builders & Brews, 2026-10-02.

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
- [x] Attributions, NOTICE and generated `THIRD_PARTY_LICENSES.md` (2026-09-26; items marked unverified are listed in `docs/ATTRIBUTIONS.md`).

## Next (unblocked)

- [ ] Finish UI Part 2 and AI-layer round 3, commit, and confirm the deployment matches.
- [ ] Skeptic's ranked plan below.
- [ ] Wire a link to `THIRD_PARTY_LICENSES.md` and the State of Maryland acknowledgement into the About dialog (frontend owner).

## Skeptic's ranked plan (from an independent review, 2026-09-26)

Top priorities, roughly in order:

1. Get a real Nebius key working and run one real end-to-end mission by 2026-10-03 (hard escalation date).
2. Reframe the copy and the metrics ribbon to match what the numbers show (see the decision on the cross-harbor result below).
3. A visible adversarial critic stress loop.
4. A screened model rationale in the decision log (the app already renders a fixed rationale kind, labeled "AI rationale (unverified; not a result)").
5. A freight/hazmat trip lens.
6. Screen any crossing (not just the Key Bridge).
7. An exhaustive-search check panel (does the agent's pick match brute force over the catalog?).
8. Prune inert catalog options.
9. Cut the narrator role.
10. Pivot Tavily to a cited "reality check" evidence panel; live closure ingestion becomes secondary.
11. Reachability checks, with an OpenFreeMap fallback style.
12. A free scheduled health ping (GitHub Actions cron hitting `/api/health`).

## Risks

- **No key means no stage-one API requirement.** If the AI features have never run against Token Factory, the submission cannot show Nemotron on Token Factory. Mitigation: the 2026-10-03 escalation date.
- **Credits and the daily cap.** The default daily cap (`WS_DAILY_BUDGET_USD`, default 1 USD per `.env.example`) is a flat number. It needs to be date-aware so budget is reserved for the whole judging window through 2026-12-15, given the trial credit is documented as 1 USD for 30 days and the hackathon credit is 25 USD (unreceived).
- **Model ID drift.** The catalog is moving (three models were removed from serverless on 2026-08-31). IDs may change between now and judging. Mitigation: runtime `/models` resolution and env overrides; re-run the smoke script shortly before tagging.
- **Video and demo must match.** The judged demo must match the tagged video and description; no changes after the deadline.
- **Cheap-laptop check.** Futures at N=100 have been measured only in Node/V8 on the build Mac (per the spike), never in a browser on a low-end device. Test before claiming interactive speed.
- **Vercel Hobby limits and fair use** under a judge burst: unverified; see the checklist.
- **Third-party availability.** OpenFreeMap has no availability promise (`docs/LEGAL.md`); Overpass is build-time only.
- **Licenses.** Open items in `THIRD_PARTY_LICENSES.md` ("Needs a human look") and `docs/ATTRIBUTIONS.md`.

## Decisions

Record decisions here with a date and a one-line reason.

- 2026-09-26: Track is Best Apps and Agents.
- 2026-09-26: The hero lens is cross-harbor access (`xharbor`: jobs on the opposite shore reachable within 30 minutes, low-wage workers as the equity group). Regional job access and first-response EMS are kept as side-by-side comparison lenses so the region-wide number is never hidden.
- 2026-09-26: EMS finding, reported as is: first-due EMS response is essentially unchanged when the Key Bridge is removed (spike and pipeline run: zero change on the EMS lens), because both shores have their own stations and hospitals. The regional access lens moves only about 3 s per person. The app says so instead of showing invented mountains.
- 2026-09-26: The cross-harbor loss is not concentrated on low-wage workers: 1.8% of low-wage workers vs 1.9% of all residents lose more than 10% of cross-harbor jobs (`golden.json`, `xharbor`, `keybridge_removed`). Copy must not claim otherwise. Freight and hazmat routing are planned, not in the product.
- 2026-09-26: Simulator and Monte Carlo run in the browser (TypeScript, Web Workers) so hosting stays free; results are labeled as computed locally.
- 2026-09-26: Every displayed number comes from the simulator; the language model never produces a metric.
- 2026-09-26: Strict prose screen, and cards are application text only: model output that reaches a reader is a selection from a fixed rationale table (`frontend/lib/agent/rationale.ts`), shown only in the decision log with the label "AI rationale (unverified; not a result)"; finalist cards contain no model text.
- 2026-09-26: Abuse and spend controls: per-client (IP) limits and a global daily spend cap (defaults in `.env.example`: 1 USD/day global, 0.20 USD/day per client, 8 new missions/hour per client in the shared store, 30 Tavily calls/day), no client-supplied prompts, keys server-side only.
- 2026-09-26: Deployment is Vercel Hobby, built from GitHub `main` (project `worldseed`), live at https://worldseed-mu.vercel.app. Hobby is non-commercial; no ads or paid tiers.
- 2026-09-26: The Key Bridge collapse is never animated, no individuals are named, and the tool is framed as a planning aid, not live dispatch (see `docs/DEDICATION.md`, `docs/LEGAL.md`).
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

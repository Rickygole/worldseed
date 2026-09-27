# Submission checklist

Ordered. Do the sections in order; within a section the order also matters. Deadline: **2026-10-30, 10:00am PT**. The
demo must stay live and free through **2026-12-15**. Written 2026-09-26; facts marked "unverified" were not confirmed.

Paths: the smoke scripts live in `frontend/scripts/`, so run them from `frontend/` (see section 2). The environment file is
`.env` at the repo root (git-ignored); `.env.example` is the template.

## 0. Blockers on the user (nothing below can be finished without these)

- [ ] Nebius Builders verification email received.
- [ ] Hackathon $25 promo code email received and redeemed (Token Factory: click balance, Top up, With promo code). The billing docs say promo codes usually expire; note the expiry date here: ______.
- [ ] Token Factory login done and the billing card decision made (the billing docs say a bank card is required to finish onboarding, and new accounts get 1 USD of trial credit valid 30 days).
- [ ] Nebius API key created and stored in `.env` (never committed).
- [ ] Tavily key in `.env` (free Researcher plan; pay-as-you-go stays OFF).
- [ ] Upstash free account created (free tier per Upstash's pricing page, read 2026-09-26: 256 MB and 500K commands per month). REST URL and token in `.env`.
- [ ] Optional: free Census API key (`CENSUS_API_KEY`) if you want the pipeline to use the official API on a rebuild. Not needed for the submission.
- [ ] Email Devpost support (before submitting) asking in writing whether this submission is eligible for the Builders program; keep the written answer with these notes. Eligibility is unverified until answered.
- [ ] Target date to have one real end-to-end mission working: **2026-10-03**. If the key is not working by then, escalate.

## 1. Environment variables to set on Vercel

Set in the Vercel project (`worldseed`) settings for Production, never in the repo. Names come from `.env.example`. Values marked
"secret" must not appear in any `NEXT_PUBLIC_` variable.

Required for the AI features:

- [ ] `NEBIUS_API_KEY` (secret).
- [ ] `NEBIUS_BASE_URL` = `https://api.tokenfactory.nebius.com/v1/` (must be https on `api.tokenfactory.nebius.com`, otherwise the provider is disabled).
- [ ] `TAVILY_API_KEY` (secret).
- [ ] `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (secret), or the marketplace names `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Without them the deployment is "instance-local" and the daily budget drops to `WS_INSTANCE_LOCAL_BUDGET_USD` (default 0.25).
- [ ] `WS_CONFIRM_SECRET` (secret; required in production, otherwise closure search answers "disabled"). Long random value, separate from every other secret, for example `openssl rand -hex 32`.

Strongly recommended:

- [ ] `WS_DAILY_BUDGET_USD`: set from the credit budget in section 6, not the default of 1.
- [ ] `WS_IP_DAILY_USD` (default 0.20 per client per day) and `WS_IP_MISSIONS_PER_HOUR` (default 8): keep or tighten.
- [ ] `WS_IP_HASH_SALT` (secret): a private salt. When unset it is derived from the store token and a warning is logged.
- [ ] `WS_MODEL_PRICES` or `WS_PRICE_IN_PER_M` / `WS_PRICE_OUT_PER_M`: real prices once known from the Token Factory console. The default is a conservative 1 in / 3 out USD per million tokens for every model, which is unverified.
- [ ] `WS_MODEL_PLANNER`, `WS_MODEL_CRITIC`, `WS_MODEL_PARSER`, `WS_MODEL_NARRATOR`, `WS_MODEL_EXTRACTOR`: set to the exact IDs that `GET /v1/models` lists for the key, if they differ from the defaults (the four IDs in `frontend/lib/server/models.ts` are unverified against a live key).
- [ ] `WS_LIVE_AI`: leave unset (AI on). Setting it to `off` is the kill switch; test that once.

Optional: `WS_TAVILY_DAILY_CAP` (default 30), `WS_TAVILY_CACHE_MS`, `WS_TURNSTILE_SECRET`, `WS_ALLOWED_ORIGINS`, and the front-door and store limits (`WS_FRONT_DOOR_*`, `WS_STORE_*`). Leave the trust-proxy variables alone on Vercel (address headers are believed on a serverless host).

After setting variables: redeploy, then `GET https://worldseed-mu.vercel.app/api/health` and confirm `provider.configured` is true, `protection` is no longer `instance-local`, and each role resolves to a listed model. (On 2026-09-26 it reported none of these: no key, no store.)

## 2. Pre-flight tests with real credentials

Run from the repo root shell with a filled `.env`:

- [ ] Shared store: `cd frontend && node --env-file=../.env scripts/smoke-store.mjs`. Every line must print PASS. It touches only `smoke:` keys and spends a few dozen store commands. Run it once, before relying on the limits.
- [ ] Token Factory: `cd frontend && node --env-file=../.env scripts/smoke-token-factory.mjs --stream`. It lists models, makes one tiny structured call per role model (a few cents of credit) and probes streaming. Paste the output into `docs/FEEDBACK_NOTES.md` (the "Live-key experiences" sections) with the date.
- [ ] Update the model chain if IDs differ (section 1) and re-run.
- [ ] One real end-to-end mission on the local app, then on the deployed site: parse, propose, evaluate, critique, finalize, closure search with confirmation.
- [ ] Optional, spends credit: `--measure-screen` measures how often the real model returns a valid rationale choice. **Warning:** it spends real model credit (about 3 x N calls, N defaults to 10) through the app's own key. Point it only at a LOCAL app (`--base http://localhost:3000`) that you started yourself WITHOUT any `UPSTASH_*` / `KV_*` variables, so it cannot burn the shared store's allowance or share limits with real visitors. It refuses a non-local `--base`. Give the local app room first, for example `WS_IP_MISSIONS_PER_HOUR=100 WS_FRONT_DOOR_PER_IP_PER_MIN=300 WS_IP_DAILY_USD=5 WS_IP_MISSIONS_PER_DAY=100 WS_NEW_MISSIONS_PER_HOUR=100`, then `node --env-file=../.env scripts/smoke-token-factory.mjs --measure-screen --n 10`. Run `--help` for the full text.
- [ ] Kill switch: set `WS_LIVE_AI=off` on a local run and confirm every AI route answers "AI planner unavailable" with no provider call; confirm the site still works manually.
- [ ] Budget exhaustion: confirm what visitors see when the daily cap is reached (the plan is a message pointing to the recorded run; check that it exists in the shipped UI).

## 3. Spend caps and credit budget through 2026-12-15

- [ ] Compute the daily cap from the real balance: cap per day = (credit remaining after testing) / (days from launch to 2026-12-15). From 2026-10-30 to 2026-12-15 is 46 days. **The default cap of 1 USD/day for 46 days would be 46 USD, more than the 25 USD hackathon credit plus the 1 USD trial credit.** Set `WS_DAILY_BUDGET_USD` accordingly (for example, with 20 USD left, about 0.40 USD/day) and write the chosen numbers here: balance ____ on ____, cap ____/day.
- [ ] `docs/STATUS.md` lists a date-aware cap (reserve budget for the whole judging window) as a risk; decide whether to implement it or to set a conservative flat cap.
- [ ] Provider-side limits: check the Token Factory console for a spend limit or billing threshold. Whether a hard spend cap exists is unverified; the billing docs describe only a "billing threshold" that triggers a card charge when reached and automatic charging if the balance goes negative. Do not attach a card without a cap you trust.
- [ ] Tavily: confirm pay-as-you-go is OFF and the plan quota covers `WS_TAVILY_DAILY_CAP` (30 calls/day by default) through 2026-12-15 (unverified: whether the free quota lasts).
- [ ] Upstash: the default store allowance is 6000 commands/day per process (`WS_STORE_DAILY_COMMANDS`), so at most about 180K commands in a 30-day month, under the 500K free tier. Confirm in the Upstash console after a day of traffic. The free-tier numbers come from Upstash's pricing page as read on 2026-09-26.
- [ ] Vercel Hobby: usage guidelines per Vercel's fair-use page (read 2026-09-26): 100 GB fast data transfer, 1,000,000 function invocations, 10 GB fast origin transfer, 4 hours active CPU per month. What Vercel does when they are exceeded is unverified. The snapshot is about 5.8 MB on disk per uncached visit (wire size not measured); measure the real transfer size in DevTools and estimate how many judge visits fit. Function routes set `maxDuration` of 60 s (health 30 s); the Hobby ceiling is stated in `docs/ARCHITECTURE.md` as 300 s.
- [ ] Hobby is non-commercial: no ads, no paid tiers on the deployment. (Whether a cash prize counts as commercial gain is unverified, low risk; see `docs/LEGAL.md`.)

## 4. Quality and legal checks on the deployed site

- [ ] Open https://worldseed-mu.vercel.app in an **incognito window** on desktop and on a phone: loads with no login, the first-run banner and intro appear, "Remove Key Bridge link" recomputes every lens, the AI panel works or shows its honest fallback.
- [ ] Cheap-laptop check: run futures at N=100 on a low-end machine and note the time. Measured only in Node on the build Mac so far (`spikes/SPIKE_REPORT.md`).
- [ ] OpenStreetMap attribution visible on the map itself and in the footer and About dialog, at desktop and mobile widths. The MapLibre attribution control must not be hidden or covered (`docs/LEGAL.md` item 4).
- [ ] Footer and About dialog show: "Planning simulation, not dispatch. Simulated times on historical open data. Not affiliated with any agency or hospital.", the Token Factory Terms link, and "AI-generated text may be inaccurate".
- [ ] Add the State of Maryland acknowledgement and a link to `THIRD_PARTY_LICENSES.md` in the About dialog (open items in `docs/ATTRIBUTIONS.md`).
- [ ] No collapse footage or animation, no victim names or images, no third-party logos anywhere in the app or video.
- [ ] Fallback basemap: confirm what happens if OpenFreeMap tiles fail (OpenFreeMap makes no availability promise).
- [ ] Uptime: the free scheduled ping is `.github/workflows/health.yml` (every 6 hours, plus manual run; see `docs/CI.md`). It is written but has not run on GitHub yet (unverified). After pushing: open Actions, run "Health" once by hand and confirm it is green. The ping is an unauthenticated GET of `/` and `/api/health` (the health route lists models, cached 10 minutes); confirm it does not spend store commands or model calls.
- [ ] Repository activity: GitHub disables scheduled workflows in public repos after 60 days without repository activity. Commit something before then (or re-enable the workflow in the Actions tab), and check that the Health workflow still has recent runs each week through 2026-12-15.

### 4a. CI

- [ ] `.github/workflows/ci.yml` is on `main` and the latest run of all three jobs (`frontend`, `hygiene`, `pipeline`) is green on the commit that will be tagged. Unverified until the first GitHub run (locally, on a fresh clone of the committed HEAD, all frontend commands passed and the pipeline suite passed with two tests skipped for the missing git-ignored `data/raw`).
- [ ] The `pipeline` job log lists the two skipped tests with their reason (`-rs`); nothing else is skipped there.
- [ ] Notification check: confirm GitHub emails you when a workflow run fails (Settings, Notifications). Whether GitHub sends scheduled-run failures to the person who last edited the schedule is per GitHub's docs and unverified for this repo.
- [ ] Neither workflow references a repository secret (`scripts/check-repo-hygiene.sh` enforces this).

### 4b. Guided story acceptance (copy deck: `docs/STORY.md`)

Run each on the deployed site in an incognito window, desktop and phone width. All are unverified until the redesign ships.

- [ ] Each scene is reachable from the story bar (intro, The crossing, The local story, What held, Hazmat trucks, What could help, Explore) by Next, Back and by clicking its step; the scene the bar shows matches the map and the numbers on screen.
- [ ] Scenes 2 to 5 behave sensibly if the visitor restores the bridge link mid-story (the gate in `docs/STORY.md` section 7), and nothing shows a blank, a zero or a stale number.
- [ ] Every number is slot-filled from the simulator, a cited data table or the documented sensitivity study; none is typed into a template. Change the scenario (restore, then remove the link) and confirm each number in the story changes or hides with "Not available for this scenario".
- [ ] Ranges are shown wherever the deck calls for them (head-counts and the hardest-hit range carry their range or "about"), and the range matches `docs/METHODOLOGY.md`.
- [ ] The disclaimer "Planning simulation, not dispatch. Simulated times on historical open data. Not affiliated with any agency or hospital." is visible in every scene and in Expert mode, at desktop and phone widths, and is not covered by the map attribution.
- [ ] Keyboard operation: Tab reaches every control in a sensible order with a visible focus ring; Right and Left arrows move to the next and previous scene; Escape closes dialogs and popovers; the Expert mode toggle works with the keyboard and switching to Expert and back keeps the scene and the applied changes.
- [ ] Screen reader spot check: the scene announcement ("Scene N of M") and the toggle state are read out.
- [ ] Reduced motion: with the operating-system reduced-motion setting on, no scene animates the map or the numbers; the collapse itself is never animated (a plain fade of the link line only).
- [ ] Skip is always visible; "Skip" and "Open expert mode" both land in a working Expert view.
- [ ] Expert rail hint for the evidence panel reads "Published sources about the 2024 detours (unverified)", not "reported impacts next to the model".
- [ ] About dialog carries the privacy notice, the AI-text paragraph and the "not affiliated" list, wording from `docs/LEGAL.md` rules 13 and 14, and the retention figure matches the limiter TTLs (daily cap keys live 2 days).
- [ ] Raw model reasoning (if shown): collapsed by default and labeled "Model reasoning (raw, unverified; not a result)"; the text is blanked when it trips the denylist (`docs/LEGAL.md` rule 13).

### 4c. Freight checks (scene 4 and the freight panel)

- [ ] Freight panel shows both vehicle classes for the cross-harbor trips with the bridge removed: hazmat truck and car, added minutes per trip and on average, both slot-filled from the simulator; the numbers match `data/snapshot/golden.json`.
- [ ] The freight panel says, in the panel and not only in the docs: "Simulation, not route guidance." with the full disclaimer from `docs/LEGAL.md` rule 11, and a source line for the MDTA tunnel rule (page URL, accessed 26 September 2026) and a second source line for the alternate route (MDTA Key Bridge news page).
- [ ] The tunnel sentence reads "Vehicles carrying the hazardous materials MDTA lists are barred from both harbor tunnels", not "prohibit hazmat loads" and not "hazmat vehicles are prohibited in both tunnels". "The bridge carried hazmat before the collapse" appears only as a labeled assumption.
- [ ] Every escorted-window option title carries " (hypothetical; not an MDTA program)".
- [ ] No text in the app, README, video or Devpost calls the freight lens "hazmat routing", "route guidance", "navigation", "traffic management", "safety-critical" or a "compliance tool" (grep the built site's text and the docs).
- [ ] Freight search: run one freight goal end to end; the deterministic two-stage search returns finalists with signed freight rows; compare and apply recompute the freight numbers from the applied world.
- [ ] Docs do not describe the freight lens as planned or [PLANNED] (it ships): `docs/ARCHITECTURE.md` still says so at line 544 as of 2026-09-26 (not edited by this pass).

## 5. Repository hygiene and legal files

- [ ] `bash scripts/check-repo-hygiene.sh --include-untracked` prints "Repo hygiene OK." (forbidden words, agent-config files, secrets, required files, `.env.example` values, `NEXT_PUBLIC_` secrets). Also run it without `--include-untracked` after committing so commit messages are checked.
- [ ] Remove agent-config files and directories from the working tree and confirm none is tracked: `git ls-files | grep -i -E 'agents\.md|\.env'` should show only `.env.example`.
- [ ] No keys anywhere: hygiene passes, and scan history: `git grep -I -l -E 'tvly-[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{20,}' $(git rev-list --all)` prints nothing (this returned nothing on 2026-09-26; `.env` and `.env.local` were never committed). Confirm the Vercel environment holds the only copy of the production keys.
- [ ] `node scripts/gen-third-party-licenses.mjs` run after the last dependency change and the file committed. Review "Needs a human look" at the top; in particular confirm whether an LGPL `sharp-libvips` binary is present in the deployment (unverified).
- [ ] `LICENSE` (MIT), `NOTICE`, `data/snapshot/LICENSE.md` (ODbL), `docs/ATTRIBUTIONS.md` present and consistent. Resolve or keep clearly marked every "unverified" item in `docs/ATTRIBUTIONS.md`.
- [ ] `docs/FEEDBACK_NOTES.md`: live-key sections filled with real observations; documented-only items labeled as such.

## 6. Freeze and pin the judged version

- [ ] All work merged to `main`; the deployed site matches the video and the Devpost description.
- [ ] On the pinned deployment itself, before tagging: one live Token Factory call and one live Tavily call have succeeded (the Tavily prize needs a live call). Keep budget for both through 2026-12-01 to 2026-12-15, the judging window: set `WS_DAILY_BUDGET_USD` and `WS_TAVILY_DAILY_CAP` from the balances so they last (section 3).
- [ ] Re-check the model IDs against `GET /v1/models` shortly before tagging (the catalog changed on 2026-08-31).
- [ ] Tag: `git tag v1.0-submission && git push origin v1.0-submission`.
- [ ] After the deadline, turn off production auto-deploy from `main` (Vercel project settings, Git) or set the Production Branch to a frozen `submission` branch, so a stray push cannot change the judged version. Record which you chose: ______.
- [ ] Pin the judged deployment. Vercel builds from branches, not tags, so choose a mechanism and record it here: stop pushing to `main` after the tag; or create a `submission` branch at the tag and make it the Production Branch; or use an Ignored Build Step. Which mechanism to use is unverified against the current Vercel settings UI. Note the deployment URL/ID that was judged: ______.
- [ ] After the deadline: no changes to the submission. Only operational care (keys, credits, caps) until 2026-12-15.

## 7. Video (YouTube)

- [ ] Under 3:00, set to **public** (test the link in an incognito window).
- [ ] Audio (voiceover) covers how **Nebius Token Factory** and **NVIDIA Nemotron** are used.
- [ ] No copyrighted music; no collapse footage; no victim names or images; no third-party logos.
- [ ] Shows the real, live demo and matches what is deployed. Script: `docs/VIDEO_SCRIPT.md`.
- [ ] Description credits, verbatim: "Map data (c) OpenStreetMap contributors (ODbL). Basemap: OpenFreeMap, (c) OpenMapTiles. Census data: U.S. Census Bureau (ACS via Census Reporter; TIGER/Line; LEHD LODES). Facility locations: MD iMAP, State of Maryland. Hazmat tunnel rule: Maryland Transportation Authority. Reported commute: Maryland Matters (via Baltimore Fishbowl). AI: NVIDIA Nemotron on Nebius Token Factory. Search: Tavily. WorldSeed is a research prototype and planning simulation: not dispatch, not route guidance. Not affiliated with or endorsed by any agency or company named. In memory of the six workers lost on March 26, 2024." Caution: both copies of the reported-commute article that we read credit Capital News Service (Charlotte Kanner and Mira Beinart), not Maryland Matters; settle the credit line before publishing (`docs/METHODOLOGY.md` section 6.1).
- [ ] The video shows the freight panel with its "Simulation, not route guidance." disclaimer readable, or does not show the freight panel.

## 8. Devpost submission form

Fill from `docs/DEVPOST.md` (in progress) and re-read the rules on the hackathon page before submitting, since the field list below comes from the task brief and was not re-read.

- [ ] Track: **Best Apps and Agents**.
- [ ] Testing instructions field, wording: "No login, no payment, no install. The simulation, map, inspector, freight panel and deterministic search run in your browser with no limits. Live AI and news-search calls are free; to keep the shared free budget available to every judge through 15 December, they carry per-visitor fair-use limits. If a limit is reached the app says so and the same search continues without AI. Contact: [email]." Fill the contact.
- [ ] Add "Created during the Submission Period; first commit 2026-09-26." to the description (the first commit date is from the repository history; re-check with `git log --reverse` before submitting).
- [ ] Do not select City Winner unless a listed city event was attended (Baltimore is not listed).
- [ ] Prizes: one Overall or one Track award, plus at most one Bonus (Tavily, City Winner and Most Valuable Feedback are all Bonus). This reading is unverified; re-read the rules page and choose what to enter.
- [ ] Token Factory feedback (Devpost feedback section) reports only our own app's observations, with N and dates and the safe wording from `docs/FEEDBACK_NOTES.md`; no model or provider comparison; no Tavily performance information anywhere (`docs/LEGAL.md` rule 12); the README stays qualitative.
- [ ] Project name, tagline and description (matches the video and the deployed demo; frames WorldSeed as a counterfactual infrastructure-planning research prototype, not dispatch).
- [ ] Explanation of how Nebius Token Factory and NVIDIA Nemotron are used (which roles, that the model never produces a displayed metric, that the simulator runs in the browser).
- [ ] Demo URL: https://worldseed-mu.vercel.app, tested in incognito (section 4).
- [ ] Public GitHub repo: https://github.com/Rickygole/worldseed. Open the repo page in a logged-out window and confirm the license shows in the About sidebar (MIT, detected from `LICENSE`).
- [ ] README: setup instructions, Nemotron / Token Factory highlights, "Intended use and limitations" and "License" sections (README is being edited by another agent; re-check it last).
- [ ] YouTube video URL (section 7).
- [ ] Feedback text for Nebius (from `docs/FEEDBACK_NOTES.md`; specifics, not general praise).
- [ ] City, only if you attended an event (Boston Builders & Brews, 2026-10-02, is optional).
- [ ] Teammates: none (solo).
- [ ] Prize-specific: the Best Use of Tavily prize needs a live Tavily call in the demo; any fallback fixture must be labeled "offline sample" (`docs/LEGAL.md` item 6).
- [ ] Submit before 2026-10-30 10:00am PT, then open the submitted Devpost page logged out and click every link.

## 9. After submitting (through 2026-12-15)

- [ ] Keep repo activity going so the scheduled Health workflow is not disabled after 60 days (or accept that it may stop).
- [ ] Keep the demo live and free: watch the uptime ping, Vercel usage, Token Factory balance, Tavily quota and Upstash usage weekly.
- [ ] Do not change the judged version. If a key runs out, prefer the built-in graceful fallback over a redeploy.

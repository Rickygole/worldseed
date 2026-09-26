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
- [ ] Uptime: set a free scheduled ping of `/api/health` (for example a GitHub Actions cron workflow, or a free uptime monitor; free-plan limits of any monitor are unverified). Keep the interval at 15 minutes or longer and check that each ping does not spend store commands or model calls (the health route lists models, cached 10 minutes).

## 5. Repository hygiene and legal files

- [ ] `bash scripts/check-repo-hygiene.sh --include-untracked` prints "Repo hygiene OK." (forbidden words, agent-config files, secrets, required files, `.env.example` values, `NEXT_PUBLIC_` secrets). Also run it without `--include-untracked` after committing so commit messages are checked.
- [ ] Remove agent-config files and directories from the working tree and confirm none is tracked: `git ls-files | grep -i -E 'agents\.md|\.env'` should show only `.env.example`.
- [ ] No keys anywhere: hygiene passes, and scan history: `git grep -I -l -E 'tvly-[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{20,}' $(git rev-list --all)` prints nothing (this returned nothing on 2026-09-26; `.env` and `.env.local` were never committed). Confirm the Vercel environment holds the only copy of the production keys.
- [ ] `node scripts/gen-third-party-licenses.mjs` run after the last dependency change and the file committed. Review "Needs a human look" at the top; in particular confirm whether an LGPL `sharp-libvips` binary is present in the deployment (unverified).
- [ ] `LICENSE` (MIT), `NOTICE`, `data/snapshot/LICENSE.md` (ODbL), `docs/ATTRIBUTIONS.md` present and consistent. Resolve or keep clearly marked every "unverified" item in `docs/ATTRIBUTIONS.md`.
- [ ] `docs/FEEDBACK_NOTES.md`: live-key sections filled with real observations; documented-only items labeled as such.

## 6. Freeze and pin the judged version

- [ ] All work merged to `main`; the deployed site matches the video and the Devpost description.
- [ ] Re-check the model IDs against `GET /v1/models` shortly before tagging (the catalog changed on 2026-08-31).
- [ ] Tag: `git tag v1.0-submission && git push origin v1.0-submission`.
- [ ] Pin the judged deployment. Vercel builds from branches, not tags, so choose a mechanism and record it here: stop pushing to `main` after the tag; or create a `submission` branch at the tag and make it the Production Branch; or use an Ignored Build Step. Which mechanism to use is unverified against the current Vercel settings UI. Note the deployment URL/ID that was judged: ______.
- [ ] After the deadline: no changes to the submission. Only operational care (keys, credits, caps) until 2026-12-15.

## 7. Video (YouTube)

- [ ] Under 3:00, set to **public** (test the link in an incognito window).
- [ ] Audio (voiceover) covers how **Nebius Token Factory** and **NVIDIA Nemotron** are used.
- [ ] No copyrighted music; no collapse footage; no victim names or images; no third-party logos.
- [ ] Shows the real, live demo and matches what is deployed. Script: `docs/VIDEO_SCRIPT.md`.
- [ ] Description credits: OpenStreetMap contributors, OpenFreeMap, plus the short disclaimer ("Planning simulation, not dispatch. Simulated times on historical open data. Not affiliated with any agency or hospital.").

## 8. Devpost submission form

Fill from `docs/DEVPOST.md` (in progress) and re-read the rules on the hackathon page before submitting, since the field list below comes from the task brief and was not re-read.

- [ ] Track: **Best Apps and Agents**.
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

- [ ] Keep the demo live and free: watch the uptime ping, Vercel usage, Token Factory balance, Tavily quota and Upstash usage weekly.
- [ ] Do not change the judged version. If a key runs out, prefer the built-in graceful fallback over a redeploy.

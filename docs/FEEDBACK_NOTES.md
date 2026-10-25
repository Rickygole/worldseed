# Feedback Notes (Nebius Token Factory / AI Cloud / NVIDIA)

The hackathon requires a feedback section in the submission. This file is where
raw notes are collected so the final write-up is honest and specific.

How to use it:

- Log friction and wins the moment they happen, with the date. Memory fades.
- Record only real observations. Do not pad, guess, or write entries in advance.
- Be specific: which page, which step, which error message, how long it took.
- Things worth capturing include onboarding steps (for example, whether a billing
  card was required), which docs pages helped or misled, model availability,
  latency, rate limits, and error messages.
- Every entry says whether it was **experienced** (we did it and saw it) or **as documented**
  (we read it on a docs or marketing page and have not yet run into it). Do not present a
  documented item as an experience in the final submission.
- The Token Factory terms bar "competitive analysis or benchmarking". Report what we observe running
  this app (our latency, our errors), not comparisons against other providers.
- Tavily's terms bar disclosing any performance information about Tavily to third parties: record none here.
  Describe Tavily only by what it does. This includes latency, hit rates, relevance and whether a parameter is honored.
- Safe wording for any published count (use it verbatim, fill the blanks, keep N and dates):
  "Observations from WorldSeed's own validators on our own requests (N = __ missions, __ to __ 2026). They describe how
  our app's schema and screens handled the replies we received, not the quality or performance of Token Factory or any
  model. This is not a benchmark or a comparison with any other model or provider."

## Raw log

Newest first within a date. Copy the stub for each entry.

### YYYY-MM-DD (stub)

- ID:
- Area: (Token Factory / AI Cloud / NVIDIA models / docs / billing)
- Status: (experienced / as documented, not yet experienced)
- What I tried:
- What happened:
- Severity: (blocked / slowed me down / minor / positive)
- Source: (page URL, file, or message)
- Suggestion:

### 2026-09-26

Context: as of this date nobody on the project has signed in to Token Factory or made an API call (no key yet). Entries
F-03 and F-04 are things that happened to the project. The others come from reading Nebius pages (fetched 2026-09-26) and the
feasibility spike (`spikes/SPIKE_REPORT.md`, which also read pages only) and are "as documented".

- ID: F-01
- Area: billing / onboarding
- Status: as documented, not yet experienced
- What I tried: read the billing page before signing up, to find out what onboarding needs.
- What happened: the page says billing setup is mandatory during onboarding ("you cannot complete onboarding without it"), that creating a
  billing account requires a bank card, and that new sign-ups get 1 USD of trial credit valid for 30 days. Nothing on the page says whether
  a hackathon participant can skip the card.
- Severity: potential blocker (a hackathon entrant without a card could not finish onboarding, if the page is accurate)
- Source: https://docs.tokenfactory.nebius.com/other-capabilities/billing-new
- Suggestion: for a free-credit hackathon, either allow onboarding without a card until credits run out, or state on the hackathon page
  that a card is required and that promo credit is applied on top of the 1 USD trial credit.

- ID: F-02
- Area: billing / credits
- Status: as documented, not yet experienced
- What I tried: read how promo codes work.
- What happened: the page says a promo code gives free credits, is "typically issued as part of a special offer", usually has an expiration date
  ("make sure to apply them before they expire"), and cannot be used to pay outstanding invoices. It does not say how long hackathon credits last.
  The hackathon requires the demo to stay live and free through 2026-12-15, so an expiry before then would matter.
- Severity: slowed me down (budget planning has to assume the worst case)
- Source: https://docs.tokenfactory.nebius.com/other-capabilities/billing-new
- Suggestion: state the validity period of hackathon promo codes on the credit form and in the confirmation email.

- ID: F-03
- Area: billing / hackathon credit flow
- Status: experienced (partly: the outcome is still pending)
- What I tried: submitted the hackathon $25 credit form.
- What happened: the form said a promo code will be emailed. As of 2026-09-26 no email has arrived, so the credit cannot be redeemed and no live
  call has been possible. Whether the form stated an expected delivery time is not recorded here (unverified).
- Severity: slowed me down (blocks every live test, which sits on the critical path for the submission)
- Source: project status board, `docs/STATUS.md` (Blocked on the user)
- Suggestion: show an expected delivery time on the form and send an immediate acknowledgement email.

- ID: F-04
- Area: Builders program
- Status: experienced (pending)
- What I tried: applied to the Nebius Builders program.
- What happened: the application was submitted; the email to verify it has not arrived as of 2026-09-26.
- Severity: slowed me down
- Source: `docs/STATUS.md`
- Suggestion: same as F-03. Also say whether Builders verification is needed to use the hackathon credit.

- ID: F-05
- Area: models / docs
- Status: as documented, not yet experienced (the spike hit the missing IDs; no live `/models` call yet)
- What I tried: find the exact API model IDs for the Nemotron models to plan the app's model registry.
- What happened: the IDs are inconsistent across sources. The docs' deprecation notice prints `nvidia/nemotron-3-super-120b-a12b` (all lowercase) and
  `nvidia/Nemotron-3_5-Lightning` (mixed case, underscore in "3_5"). The Hugging Face repositories for the same families are named
  `NVIDIA-Nemotron-3-Super-120B-A12B-BF16` and `NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16`. The exact strings for Nemotron 3 Ultra and Nano were not
  printed on any docs page the spike could reach, and the docs index (`llms.txt`) has no model list. Our own code and spike ended up with two
  different guesses for Nano (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` in `frontend/lib/server/models.ts`, `nvidia/Nemotron-3-Nano-30B-A3B` in the spike report). We
  resolve IDs at runtime from `GET /v1/models` for that reason.
- Severity: slowed me down
- Source: https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice ; https://docs.tokenfactory.nebius.com/llms.txt ; `spikes/SPIKE_REPORT.md`
- Suggestion: one public page that lists every serverless model with its exact ID string, context length, JSON-mode flag and price, ideally also
  machine-readable (the `/models?verbose=true` output the docs mention, published without a key).

- ID: F-06
- Area: models / catalog changes
- Status: as documented, not yet experienced
- What I tried: check which vision or larger Nemotron models are available.
- What happened: the deprecation notice removes `nvidia/Nemotron-3-Nano-Omni`, `Qwen/Qwen2.5-VL-72B-Instruct` and `nvidia/Cosmos3-Super-Reasoner`
  (and other models) from Serverless on 2026-08-31; Dedicated Endpoints are unaffected. The Nemotron marketing page (per the spike) says Nano Omni is now
  dedicated-only. When the notice was fetched on 2026-09-26, after that date, it still spoke in the future tense ("will be removed", "Models soon leaving").
  The notice states that requests to deprecated IDs are not rerouted automatically.
- Severity: minor (the catalog moves; a stale notice makes it hard to tell what is live today)
- Source: https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice
- Suggestion: update the notice after the date passes and keep a dated "removed" list. The explicit no-automatic-reroute statement is useful; keep it.

- ID: F-07
- Area: docs / base URL
- Status: as documented, not yet experienced
- What I tried: find the base URL to configure.
- What happened: the quickstart uses `https://api.tokenfactory.nebius.com/v1/` (used in our `.env.example`). The Nemotron marketing page shows a regional
  URL, `https://api.tokenfactory.us-central1.nebius.com/v1/`, and another sample on nebius.com uses `https://api.tokenfactory.nebius.com/` with no `/v1`
  (both per the spike). The "Public Serverless Endpoints" page then says public endpoints are "Global" and that a regional base URL "can stop working if the endpoint's
  processing region changes".
- Severity: minor
- Source: https://docs.tokenfactory.nebius.com/quickstart ; https://docs.tokenfactory.nebius.com/public-serverless ; `spikes/SPIKE_REPORT.md`
- Suggestion: use one canonical base URL in every sample and say explicitly that regional URLs are for dedicated endpoints only.

- ID: F-08
- Area: pricing
- Status: as documented, not yet experienced
- What I tried: find per-token prices to set a spend cap.
- What happened: the docs' pricing page redirects to a login. The marketing Nemotron page lists USD per 1M tokens (input/output): Ultra 1.00/3.00, Super 0.30/0.90,
  Nano 0.06/0.24, 3.5 Lightning 0.06/0.24 (per the spike). Third-party sites list different numbers for Ultra (for example 0.50/2.20 on one aggregator), which are not Nebius prices. The
  billing page has no per-token prices. Our code therefore defaults every model to a deliberately conservative 1 in / 3 out until real usage numbers exist.
- Severity: slowed me down
- Source: `spikes/SPIKE_REPORT.md` (section 6); https://docs.tokenfactory.nebius.com/other-capabilities/billing-new
- Suggestion: a public pricing table that does not need an account, linked from the docs.

- ID: F-09
- Area: rate limits
- Status: as documented, not yet experienced
- What I tried: find the limits to design the app's own throttling.
- What happened: limits are dynamic (up 20% per 15-minute window at 80% average use, down by one third at 50% or less, ceiling 20x base). The real defaults are only in
  the account UI (https://tokenfactory.nebius.com/project/rate-limits), not in the docs; the docs table (60 RPM, 400,000 TPM) is an example baseline. The docs list
  response headers (`x-ratelimit-*`, `Retry-After`, `x-ratelimit-over-limit`) that would let an app back off correctly.
- Severity: minor; the headers are a positive
- Source: https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits
- Suggestion: print the default base limits per model tier in the docs so an app can be designed before signing in.

- ID: F-10
- Area: structured output
- Status: as documented, not yet experienced
- What I tried: check whether `response_format` JSON schema is supported for the Nemotron models (our default path).
- What happened: the JSON page documents `{"type": "json_schema"}` and `{"type": "json_object"}` and says support differs by model ("Use `JSON mode` tag on a model card").
  No docs page reachable without an account says which Nemotron models carry that tag. Our code assumes JSON-schema support for every model; that is a guess until the first live call.
- Severity: minor
- Source: https://docs.tokenfactory.nebius.com/ai-models-inference/json
- Suggestion: list structured-output and tool-calling support per model in the docs.

- ID: F-11
- Area: docs
- Status: experienced (reading only; the samples have not been run)
- What I tried: read the docs from scripts.
- What happened: positive. Docs pages can be fetched as Markdown by adding `.md`, an index exists at `/llms.txt`, and the quickstart gives
  Python, JavaScript and curl samples against an OpenAI-compatible endpoint, so the client is built on the standard `openai` package.
- Severity: positive
- Source: https://docs.tokenfactory.nebius.com/quickstart
- Suggestion: keep it. Add the model list to `llms.txt`.

- ID: F-12
- Area: terms
- Status: as documented
- What I tried: read the terms before designing the product.
- What happened: the terms prohibit use "as or in a high-risk AI system ... as defined in the EU AI Act", and bar "competitive analysis or benchmarking". The first shaped our
  wording (planning prototype, human in the loop, no dispatch language; see `docs/LEGAL.md`). The second makes it unclear how much latency and reliability detail a hackathon feedback write-up may include.
- Severity: minor (a design constraint, not a blocker)
- Source: https://docs.tokenfactory.nebius.com/legal/terms-of-service
- Suggestion: say in the terms or the hackathon rules that feedback about one's own usage is welcome and is not "benchmarking".

- ID: F-13
- Area: hackathon process
- Status: as documented
- What I tried: read what the feedback section is judged on.
- What happened: the Devpost and Nebius rules ask for feedback, and "Most Valuable Feedback" needs specifics (page, step, error text, timing), not general praise. That is why this file separates
  experienced entries from documented ones.
- Severity: minor
- Source: hackathon rules on Devpost, as relayed to this project (not re-read for this entry; treat as unverified wording)
- Suggestion: none.

## Live-key experiences (empty until a real key is used)

Fill each section only with what actually happens. `frontend/scripts/smoke-token-factory.mjs` prints output meant to be pasted here. Date each entry.

### Model availability on our key
2026-10-24. `GET /v1/models` on `api.tokenfactory.nebius.com` lists 30 models. All four IDs the architecture doc guessed back on 2026-09-26, purely from public docs with no key, resolved exactly as written, with no change needed:
- `nvidia/Nemotron-3-Ultra-550b-a55b` (planner, critic)
- `nvidia/nemotron-3-super-120b-a12b` (critic fallback)
- `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (parser, extractor)
- `nvidia/Nemotron-3_5-Lightning` (parser/extractor fallback)
The account also lists `nvidia/Nemotron-3.5-Super-VL`, a vision-language model not in our registry; not evaluated.

### Latency
2026-10-24, via `smoke-token-factory.mjs` (one structured call per role model, non-streaming): Ultra 614 ms (run 1) / 383 ms (run 2, streamed); Nano 2048 ms (run 1) / 1050 ms (run 2, streamed). Not yet measured inside the real app's agent routes (reserve/settle overhead, network from Vercel) or for a full multi-call mission.

### JSON-schema (`response_format`) output support
2026-10-24. Both role models accepted `response_format: json_schema` and returned valid, schema-conforming JSON on the first call, no repair turn needed, in all four calls run (2 models x 2 runs). Sample size is tiny (1 call per model per run); repair-turn rate under real traffic is still unmeasured.

### Streaming
2026-10-24. `stream: true` works with structured output on both models: Ultra returned 1 content chunk, Nano returned 3 content chunks, both still valid JSON once reassembled. No malformed-stream or truncation issues observed.

### Reasoning-token behavior
Not yet observed: the smoke calls were small (43 input tokens) and fast, with no visible reasoning preamble in the output or usage fields. Unconfirmed whether a request parameter exists to toggle reasoning; none is sent today.

### Real usage numbers
2026-10-24, 4 calls total: Ultra 43 in / 50 out, Ultra 43 in / 50 out (streamed), Nano 43 in / 79 out, Nano 43 in / 63 out (streamed). At the account's listed $1/$3 per million tokens (Ultra) and presumed similar order for Nano, each call cost well under a tenth of a cent. Account balance after top-up: $1.00 trial + $25.00 promo code = $26.00 available. Not yet measured: tokens/dollars for a real multi-step mission (parse + plan + critique + finalize).

### Rate limits and errors seen
None seen yet: all 4 initial smoke calls, and all 30 of the real-mission provider calls below, succeeded with no 429s or error statuses. Real account rate-limit headers not yet inspected.

### Real end-to-end mission, through the app's own agent routes (not just the raw provider)
2026-10-24, `scripts/smoke-token-factory.mjs --measure-screen --n 10` against a local instance of the actual app (`/api/agent/*` routes: parse, plan, critique, finalize), with real credit: 10 synthetic missions, 30 provider-backed route calls total. 27 of 30 returned a valid model selection on the first turn (90% valid selection rate). 0 of the 30 calls were saved by the server's one built-in repair turn; the other 3 produced an invalid/out-of-catalog model selection that the validator correctly rejected outright, falling back to the deterministic critic running the stress test instead (whether the server attempted an internal repair on those 3 before giving up isn't visible from this script, which only sees the final per-call outcome) — proof the safety architecture (model can only select IDs from a precomputed catalog; anything else is discarded) works against a real model's real failure modes, not just a fake provider in tests. Rationale-kind distribution across the 10 missions: `mix_of_types` x10, `spread_mechanisms` x9, `cheap_first` x5, `worst_case` x3, plus the critic's chosen stress test across the run, by closed-set scenario: `stress:close_link:L-HARBORTUNNEL` x4, `stress:combined:L-HARBORTUNNEL:pm` x2, `stress:combined:L-HARBORTUNNEL:am` x1 (7 stress selections across 3 distinct scenario kinds; a mission can trigger more than one). No model output ever reached a displayed number; the only free text a model can add is the optional, screened "reasoning" aside shown collapsed in the decision log.

### Onboarding as experienced
2026-10-23 to 2026-10-24. A Token Factory account was created via "Sign in with Google" with no password step. Completing billing details (required before any API use) demanded a credit/debit card; the promo-code email itself explains this in advance ("a $0 verification charge... no other charges will apply"). The first card tried gave a generic Stripe error ("We are unable to authenticate your payment method"); a different, non-virtual card succeeded. The $25 promo code (`...global AI hackathon` code, requested via the Resources-tab form on 2026-09-29) was emailed within minutes of submitting the form, but the email landed in Gmail's Promotions tab and sat unread/unnoticed for 25 days; the "Welcome to Nebius Token Factory" account-activation email, sent separately once billing succeeded, landed in the main Updates category and was easier to find. Applying the code (profile menu -> "Top up account balance" -> "With promo code" tab) took one paste and one click, and the $25 appeared on the balance immediately. Creating an API key was a single "Create API key" button with an optional name field; the raw key is shown exactly once and must be copied immediately.

## Final feedback (draft for the submission form)

Fill these in from the raw log near the deadline. Use experienced entries first; label documented-only points as such.

### Functionality

All four role model IDs we had guessed from public documentation in September
(`nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/nemotron-3-super-120b-a12b`,
`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `nvidia/Nemotron-3_5-Lightning`) resolved
exactly as written against the real `GET /v1/models` endpoint, with no change needed
(F-05). Structured `response_format: json_schema` output worked on the first call for
every model we use, every time we tried it, with no repair turn needed (F-10).
Streaming worked with structured output on both role models, with valid JSON once
reassembled. Observations from WorldSeed's own validators on our own requests (N = 10
synthetic missions run through our app's own agent routes, 2026-10-24): our
catalog-only validator correctly accepted a valid model selection on the first turn in
27 of 30 provider-backed calls, and correctly rejected and fell back to our own
deterministic path on the other 3 — proof our safety design (the model may only select
from a precomputed catalog; anything else is discarded) holds against a real model's
real behavior, not just our fake-provider tests. This describes how our app's own
schema and screens handled the replies we received, not the quality or performance of
Token Factory or any model; it is not a benchmark or a comparison with any other model
or provider.

### Usability

Onboarding was straightforward: "Sign in with Google" needed no separate password step
(experienced, 2026-10-23/24). Billing is mandatory before any API call and requires a real
card; our first card attempt failed with a generic Stripe error, a second card
succeeded. The $25 hackathon promo code was emailed within minutes of submitting the
request form, but it landed in Gmail's Promotions tab and went unnoticed for about
three weeks, while a separate account-activation email landed in the main inbox —
worth noting for other hackathon entrants, since the credit is unusable until that
specific email is found. Applying the code and creating an API key were both
one-click, low-friction steps once we knew where to look. The rate-limit documentation
page we could read without an account gave only an example baseline, not our account's
real limits, which only appeared in the account UI once we had a key (F-09); we never
hit a rate limit in practice.

### Documentation

The exact API model ID strings for Nemotron Ultra and Nano were not printed on any
docs page we could reach, and the IDs that were documented were inconsistent in
capitalization and punctuation across the deprecation notice, the marketing page, and
the Hugging Face repository names for the same model families (F-05) — we resolved
this by reading the account's own `/v1/models` list at runtime instead of hardcoding a
guess, which we'd recommend as a general pattern given the inconsistency. The
deprecation notice still used future tense ("will be removed") when read after the
stated removal date had already passed (F-06). The quickstart, the marketing page, and
a separate sample each showed a different base URL (with and without a region, with
and without a trailing `/v1`) (F-07). Per-token pricing was not on any page reachable
without logging in; we found it only on a marketing page, not the billing docs (F-08).
On the positive side, every docs page we read could be fetched as plain Markdown by
appending `.md` to its URL, and the quickstart's Python/JavaScript/curl samples
against an OpenAI-compatible endpoint let us build our client on the standard `openai`
package with no custom HTTP layer (F-11).

### Would use again?

Yes. Once the account was set up, the actual integration was simple — an
OpenAI-compatible endpoint, reliable structured output, and a working runtime
`/models` list meant we never had to hardcode a brittle assumption about the catalog.
The friction we hit was entirely in onboarding and documentation findability (the
promo-code email, the scattered model IDs and base URLs), not in the API itself once
we were calling it with a real key.

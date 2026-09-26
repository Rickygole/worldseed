# Demo video script (target 2:50, hard limit under 3:00)

Status as of 2026-09-26: **the video cannot be recorded yet.** Moments 3 to 5 depend
on things that were not live: the AI planner verified against live Nemotron models on
Token Factory (no key deployed yet), the futures view, finalist cards and the search
flow being finished, and the critic's stress-test loop, which is built in code but
unverified against live models. Do not record until the checklist at the end passes.
Every marker below means the same as in docs/DEVPOST.md:

- **[VERIFY]** depends on something built or planned that is not verified live yet.
  Confirm it on the deployed site, and cut it if it does not work.
- **[PLANNED]** does not exist yet. Cut it from the recording unless it has shipped.

Rules this script follows (docs/LEGAL.md rule 7, docs/DEDICATION.md):

- The audio must cover how Token Factory and Nemotron were used (moments 3 and 4).
- No collapse footage or imagery, no animation of the collapse, no individual names,
  no third-party logos (the architecture shot is plain text, no vendor logos).
- No music. Voiceover and room-tone silence only, so there is nothing to license.
- Never say the tool saves lives, dispatches, triages or is real-time. It is a
  counterfactual infrastructure-planning research prototype and a human decides.
- Never say the tool "finds a fix". It screens where mitigation would matter.
- Never say the road network is "real" without the date: it is the 2024-03-01
  OpenStreetMap network at free-flow speeds, with congestion only in stress futures.
- Tone: calm, sober, no hype. Read slowly. Pauses are fine.
- Show the live site (https://worldseed-mu.vercel.app), not a mock-up. The intro is
  one sentence.

## The five moments

| # | Time | Moment | Length |
| --- | --- | --- | --- |
| 1 | 0:00 - 0:25 | Averages lie: regional +3 s versus the peninsula | 25 s |
| 2 | 0:25 - 0:45 | What did NOT break: first response held, and why | 20 s |
| 3 | 0:45 - 1:30 | Nemotron at work: mission, parse, confirm, propose, futures, critic, refine | 45 s |
| 4 | 1:30 - 1:50 | The guardrail: a visible validator rejection, and the one-line architecture | 20 s |
| 5 | 1:50 - 2:50 | Payoff and honesty: finalists, apply, terrain sinks, residual loss, the range and what our study found, audience | 60 s |

The voiceover is about 385 words (it grew when the sensitivity-study sentence was
added). Record it first in one calm take, time it, and trim the wording (not the speed)
if it runs over 2:52; the first candidates to cut are the "Regional averages hide local
disasters" line in moment 2 and the Tavily sentence in moment 4. Slack to the 3:00 limit is
about 20 s; do not use it.

## Moment by moment

### Moment 1: Averages lie (0:00 - 0:25)

- **On screen.**
  - 0:00-0:08. The intro overlay on its last card ("In memory of the six
    construction workers who died. Planning simulation, not dispatch."). Record the
    earlier cards separately and cut straight to this one, or click through them
    quickly. Hold this card 6 s. No image or animation of the event.
  - 0:08-0:14. Close the overlay. Baseline: flat map, the dashed "KEY BRIDGE" label,
    ribbon at baseline (cross-harbor 20.6 min, regional 0 s, first response 6.1 min).
  - 0:14-0:25. Click **Remove Key Bridge link**. Camera flies to the change, terrain
    rises over the Sparrows Point / Edgemere peninsula, the ribbon rolls. Cursor on the
    Regional tile ("+3 s"), then the Cross-harbor tile ("20,100"). Add the caption
    "Head-count depends on assumptions; range shown later" (see captions).
- **Voiceover.**
  > In memory of the six construction workers who died when the Francis Scott Key
  > Bridge collapsed on March 26, 2024.
  >
  > A regional model says losing the bridge costs about three seconds on average.
  > Remove it here, and for about twenty thousand people, mostly on the Sparrows Point
  > and Edgemere peninsula, more than ten percent of the jobs they can reach across the
  > harbor in thirty minutes are gone. About twenty thousand, and we show the range.

### Moment 2: What did not break (0:25 - 0:45)

- **On screen.** Click the **First response (EMS)** lens. The terrain is flat and
  teal, the ribbon tile reads "unchanged" (6.1 min, 96% within 8 min). Point at the
  tile. Switch back to Cross-harbor at the end so both stay in view. Leave the ribbon
  showing all lenses.
- **Voiceover.**
  > Just as important is what did not break. First-response times are unchanged. Both
  > shores have their own fire stations and hospitals, so in this model that held.
  > Regional averages hide local disasters, and a good tool also shows what did not
  > break.

### Moment 3: Nemotron at work, live (0:45 - 1:30)

**[VERIFY]** All of this moment needs a live, verified AI planner. Record one full
run and cut it down. If the AI planner is not verified by the recording day, do not
submit this cut; see the fallback at the end of this moment.

- **On screen, in order.**
  1. Planner panel. Type a mission in plain language (or click a suggested one), for
     example "Halve the residents losing more than 10% of cross-harbor jobs". Keep
     cost tier at $$.
  2. Click **Find a better future**. The parsed goal appears as chips; click to
     confirm. The chips, not the model, hold the numeric target.
  3. The decision log lists the planner's proposal of bundles by catalog ID, with the
     model name (as the app shows it) and the token counts. Hold on one line that
     reads "AI rationale (unverified; not a result)".
  4. The futures progress grid fills. This is real: the count is futures computed in
     the browser.
  5. **[VERIFY]** The critic picks a stress test from a closed set (a tunnel closed
     and/or a time of day), the log names it in an application-written label, the
     simulator re-scores the leaders under it, and the planner refines. This loop is
     built in code but not verified live. If the AI critic's answer is rejected, the
     deterministic (no-AI) critic runs the same step; the log says so, and the
     voiceover must then say so too.
  6. Optionally expand the collapsed "Model reasoning (raw, unverified; not a
     result)" section in the decision log for 2 s, to show it is labeled and set
     apart. Do not read it aloud or claim it is correct.
- **Voiceover.**
  > Now the planner. I describe a goal in plain language. A small Nemotron model on
  > Nebius Token Factory parses it into a structured goal, which I confirm. The
  > planner, the largest Nemotron model available, proposes bundles of options, but
  > only by catalog ID. The simulator scores every bundle across many futures, computed
  > here in the browser. **[VERIFY: A critic then picks a stress test, such as a tunnel
  > closed at rush hour, the simulator re-scores the leaders under it, and the planner
  > refines.]** Here are the model names and the token counts. None of it writes a
  > number.
- **Alternate sentence if the stress step does not run live.** "A critic model reads the
  results and can veto a bundle, and the planner refines." Say only what the recording
  shows.
- **Fallback if the AI planner is not verified.** Show the button labeled
  "Deterministic search (no AI)" and say "This deterministic search, labeled as not AI,
  scores bundles of options from a catalog across many futures. The Nemotron planner
  is implemented and pending live verification." This is a weaker submission, and the
  audio would then not truthfully cover live Nemotron use. Prefer to wait.

### Moment 4: The guardrail (1:30 - 1:50)

- **On screen.** One **real** validator rejection in the decision log (a red or
  amber line such as "Planner output rejected; repair requested" or "Planner output
  rejected; deterministic search used"). Then cut to the architecture shot: plain
  text, no logos, or the rendered README diagram. Highlight in turn: browser
  simulator, server routes with validators, "Nemotron via Nebius Token Factory",
  "Tavily closure search", and the line "the model proposes, the simulator scores, the
  model can never state a metric".
- **Do not fake the rejection.** Use one that a live run produced. If none occurs
  naturally after several runs, show the validator's regression test rejecting an
  option that is not in the catalog (`frontend/test/ai/validator.test.ts`), labeled on
  screen as a test.
- **Voiceover.**
  > The guardrail: a proposal that broke the rules was rejected by the validator, and
  > you can see it in the log. The model proposes, the simulator scores, and the model
  > can never state a metric. Tavily's live closure search feeds the same loop, and I
  > confirm every item before it touches the model.
- **Tavily line is [VERIFY]:** keep it only if the closure lookup works on the
  deployed site with a real key. Otherwise delete the last sentence.

### Moment 5: Payoff and honesty (1:50 - 2:50)

- **On screen.**
  1. **[VERIFY]** Three finalist cards with fan charts of their simulated futures
     (no "Recommended" badge). Click **Compare** to open the before/after slider, or
     **Preview**.
  2. Click **Apply**, then confirm. The terrain sinks outward from the option. Let it
     settle 3 s.
  3. Hold on the ribbon so the remaining loss is visible. The residual cross-harbor
     loss must be readable on screen: read the applied number from the app and say it
     as the app shows it.
  4. Show the range (5 s): the scoreboard table at the top of `docs/METHODOLOGY.md`
     on the repository page (51 variants; cross-harbor head-count 6,667 to 96,277 in
     the speed variants), or a plain text card with the same figures. The range must
     be on screen, not only spoken.
  5. Close on the Assumptions drawer for 3 s (every parameter listed), then the app
     footer and disclaimer, then a plain dark card with the wordmark and URL.
- **Voiceover.**
  > Finalists come back with the range of their simulated futures. I compare one, and
  > apply it, and the terrain sinks. But look at what remains: the best hypothetical
  > option recovers about forty percent of the cross-harbor loss, and that rests on an
  > assumed corridor speed. **[VERIFY: replace "about forty percent" with the figure
  > the app shows for the applied finalist, and say the remaining loss plainly.]** We
  > stress-tested this in fifty-one variants: the head-count ranges from about seven
  > thousand to ninety-six thousand, the peninsula stays worst hit in fifty, and
  > free-flow is a lower bound on real disruption. This is a screening tool for state
  > transportation and metropolitan planning analysts, with the Key Bridge as the case
  > study. It runs in your browser at no server cost, on open data. Simulated, not
  > measured, not dispatch, and a human decides. WorldSeed: don't predict the future,
  > simulate it.

## Full voiceover, one block (for the recording session)

> In memory of the six construction workers who died when the Francis Scott Key
> Bridge collapsed on March 26, 2024.
>
> A regional model says losing the bridge costs about three seconds on average. Remove
> it here, and for about twenty thousand people, mostly on the Sparrows Point and
> Edgemere peninsula, more than ten percent of the jobs they can reach across the
> harbor in thirty minutes are gone. About twenty thousand, and we show the range.
>
> Just as important is what did not break. First-response times are unchanged. Both
> shores have their own fire stations and hospitals, so in this model that held.
> Regional averages hide local disasters, and a good tool also shows what did not
> break.
>
> Now the planner. I describe a goal in plain language. A small Nemotron model on
> Nebius Token Factory parses it into a structured goal, which I confirm. The planner,
> the largest Nemotron model available, proposes bundles of options, but only by
> catalog ID. The simulator scores every bundle across many futures, computed here in
> the browser. [VERIFY, keep only if the stress step ran live: A critic then picks a
> stress test, such as a tunnel closed at rush hour, the simulator re-scores the
> leaders under it, and the planner refines.] Here are the model names and the token
> counts. None of it writes a number.
>
> The guardrail: a proposal that broke the rules was rejected by the validator, and you
> can see it in the log. The model proposes, the simulator scores, and the model can
> never state a metric. Tavily's live closure search feeds the same loop, and I confirm
> every item before it touches the model.
>
> Finalists come back with the range of their simulated futures. I compare one, and
> apply it, and the terrain sinks. But look at what remains: the best hypothetical
> option recovers about forty percent of the cross-harbor loss, and that rests on an
> assumed corridor speed. We stress-tested this in fifty-one variants: the head-count
> ranges from about seven thousand to ninety-six thousand, the peninsula stays worst
> hit in fifty, and free-flow is a lower bound on real disruption. This is a screening
> tool for state transportation and metropolitan planning analysts, with the Key
> Bridge as the case study. It runs in your browser at no server cost, on open data.
> Simulated, not measured, not dispatch, and a human decides. WorldSeed: don't predict
> the future, simulate it.

The bracketed critic sentence is a [VERIFY] item: keep it only if the stress step
actually ran, on camera, in the recording. If the deterministic (no-AI) critic ran
instead, say so in its place.

## On-screen captions (small, lower left, plain text)

- Moment 1: "Roads as of 1 March 2024, free-flow speeds. Computed locally in your browser."
- Moment 1 (on the Cross-harbor tile): "Head-count depends on assumptions: about 6,700 to 96,000 across variants tested."
- Moment 2: "Simulated results, not measurements."
- Moment 3: "Model names and token counts as shown by the app."
- Moment 5: "Hypothetical scenario options. No agency proposed these."
- Close: "Planning simulation, not dispatch. In an emergency, call 911."

## Screen-recording shot list

Record as separate takes so any moment can be redone without redoing the rest.

1. Intro overlay: all cards with steady Next clicks, then the last card held 8 s (moment 1).
2. Baseline, static hold, 6 s (moment 1).
3. Remove Key Bridge link, camera fly-to, hold 8 s, cursor on Regional and Cross-harbor tiles (moment 1).
4. First response lens, hold 8 s, cursor on the "unchanged" tile; switch back to cross-harbor (moment 2).
5. Mission entry, goal chips confirmed (moment 3). **[VERIFY]**
6. Decision log with the proposal, model name, token counts, and the rationale label (moment 3). **[VERIFY]**
7. Futures progress grid filling to completion (moment 3). **[VERIFY]**
8. **[VERIFY]** Critic stress test, the re-scored leaders and the planner's refinement (moment 3). Only if it ran live.
9. A real validator rejection in the decision log, or the validator test output labeled as a test (moment 4).
10. Architecture text slide, or the rendered README diagram with highlights (moment 4).
11. Finalist cards with fan charts, Compare slider (moment 5). **[VERIFY]**
12. Apply and confirm, terrain sinking, ribbon holding on the remaining loss (moment 5). **[VERIFY]**
13. Assumptions drawer, 3 s (moment 5).
14. Closing card, wordmark and URL, footer disclaimer visible (moment 5).
15. Optional 6 s insert, only if Tavily is verified live: the closures drawer with a proposal, its source link, quote, "unverified" label and the confirm step.

Capture settings: 1920x1080 window, browser zoom 100%, a clean profile with
bookmarks and extensions hidden, notifications off, system audio off. The
disclaimer banner stays visible on first run. Do not use presentation mode (P), it
hides the honesty text. Export MP4, upload to YouTube as public, and confirm the
duration is under 3:00.

YouTube description (paste):

> WorldSeed: a counterfactual infrastructure-planning simulator and screening tool for
> the Key Bridge region of Baltimore. In memory of the six construction workers who
> died on March 26, 2024. Live demo: https://worldseed-mu.vercel.app. Code:
> https://github.com/Rickygole/worldseed. Planning simulation, not dispatch; simulated
> results on historical open data at free-flow speeds, not measurements. Result text
> is written by application templates; any AI-written rationale is screened, labeled
> and may be inaccurate. Not affiliated with any agency or hospital. Road network and
> map: (c) OpenStreetMap contributors, OpenMapTiles, OpenFreeMap. Population and jobs:
> U.S. Census Bureau ACS, TIGER/Line, LEHD LODES. Built with NVIDIA Nemotron on Nebius
> Token Factory, and Tavily, for the Nebius x NVIDIA Global AI Hackathon.

## Checklist: verify live before recording

Run these on the deployed site in a clean incognito window, and again just before
recording.

- [ ] The site loads without login, and the first-run disclaimer banner shows.
- [ ] Baseline numbers read as expected: cross-harbor 20.6 min, first response 6.1 min. If they differ, re-read every figure in this script.
- [ ] After removal: regional +3 s, first response unchanged, cross-harbor about 20,100 residents losing more than 10% (the voiceover must match the screen; adjust the words, not the app). The voiceover must never give the head-count without saying the range is shown, and the range (about 6,700 to 96,000) must appear on screen.
- [ ] The figures in the study paragraph still match `docs/METHODOLOGY.md` (51 variants; peninsula worst-hit in 50 of 51; 6,667 to 96,277 across the speed variants).
- [ ] `/api/health` shows which model resolved for each role. Write down the actual planner, critic, parser and extractor models. The voiceover says "small Nemotron" and "largest Nemotron available"; if the app shows different model names on screen, make the words match.
- [ ] A full AI mission runs end to end on the deployed site: goal chips, proposal, futures grid, decision log with model names and token counts, three finalists with fan charts, Preview, Compare, Apply. Note how long it takes.
- [ ] A real validator rejection has been captured in the decision log (or the test-output fallback is prepared and labeled as a test).
- [ ] The decision log shows the "AI rationale (unverified; not a result)" label, and no model-written number appears anywhere on a card.
- [ ] The residual cross-harbor loss after Apply is readable on screen, and the "about forty percent" figure matches what the app or the candidate-effects data shows. If not, say the real figure.
- [ ] The critic's stress-test step runs end to end on the deployed site (AI critic, or the labeled deterministic critic). If not, use the alternate sentence or cut it.
- [ ] The collapsed "Model reasoning (raw, unverified; not a result)" section appears in the decision log and shows no digits, links or markup. Do not read it aloud.
- [ ] Tavily: the closures lookup returns a real result (or an honest "no closures found") on the deployed site. Only then keep the Tavily sentence and the optional insert.
- [ ] The daily AI budget has room for several takes. Check the budget state, and raise the ceiling temporarily only if the project owner agrees.
- [ ] Nothing in the recording shows an API key, an `.env` file, a terminal with secrets, or a personal email.
- [ ] No third-party logos, no music, no collapse imagery in any shot.
- [ ] Final cut duration is under 3:00 (target 2:50) and the audio names both Nebius Token Factory and NVIDIA Nemotron.
- [ ] The demo, the video and the Devpost description all say the same thing about what is live.

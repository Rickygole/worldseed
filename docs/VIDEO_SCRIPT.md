# Demo video script (target 2:50, hard limit under 3:00)

Status as of 2026-09-26: **the video cannot be recorded yet.** Two things block it.
First, the AI planner has not been verified against live Nemotron models on Token
Factory (no key deployed; it is built and tested against fakes only), and the audio
must cover how Token Factory and Nemotron were used (moments 3 and 4). Second, the
interface is being rebuilt as a guided story (map-first, six scenes, Expert mode
toggle; copy deck in docs/STORY.md), so every on-screen action below is marked
**[VERIFY AFTER REDESIGN]** until the deployed build shows it. Do not record until the
checklist at the end passes. Markers mean the same as in docs/DEVPOST.md:

- **[VERIFY]** depends on something built but not verified live yet (the AI planner and
  critic, Tavily, the deployed build matching the code, a figure to re-read from the
  app). Confirm it on the deployed site, and cut it if it does not work.
- **[VERIFY AFTER REDESIGN]** describes the guided-story interface: scene names, button
  labels, where a control lives. Confirm against the deployed build.
- **[PLANNED]** does not exist yet. Cut it from the recording unless it has shipped.
  (Screening other crossings is the only item in this file that is planned.)

Rules this script follows (docs/LEGAL.md rule 7, docs/DEDICATION.md):

- The audio must cover how Token Factory and Nemotron were used (moments 3 and 4).
- No collapse footage or imagery, no animation of the collapse (the story removes the
  link with a plain fade), no individual names, no third-party logos (the architecture
  shot is plain text, no vendor logos).
- No music. Voiceover and room-tone silence only, so there is nothing to license.
- Never say the tool saves lives, dispatches, triages or is real-time. It is a
  counterfactual infrastructure-planning research prototype and a human decides.
- Never say the tool "finds a fix" or "solves" anything. It screens where mitigation
  would matter, and the residual is always stated. Never quote a percent "recovered";
  say the measure the app shows (residents who reach more than 10% fewer cross-harbor
  jobs), say it rests on assumed corridor speed factors and hypothetical options, and
  say what remains.
- Never say the road network is "real" without the date: it is the 2024-03-01
  OpenStreetMap network at free-flow speeds, with congestion only in stress futures.
- Never give the 20,000 head-count without saying it is assumption-sensitive and having
  the range on screen.
- Say "job access" and "reach fewer jobs", never "jobs lost".
- Tone: calm, sober, no hype. Read slowly. Pauses are fine.
- Show the live site (https://worldseed-mu.vercel.app), not a mock-up. The intro is
  one sentence.

## The five moments (plus one beat)

The story's scenes map onto the five must-have moments. The hazmat scene is a sixth
beat between moments 2 and 3, so the five moments stay intact.

| # | Time | Moment | Story scene | Length |
| --- | --- | --- | --- | --- |
| 1 | 0:00 - 0:34 | Averages lie: regional +3 s versus the peninsula, with the range | Intro card; "The crossing is removed"; "Averages hide the local story" | 34 s |
| 2 | 0:34 - 0:50 | What did NOT break: first response held, and why | "What did not break" | 16 s |
| - | 0:50 - 1:06 | Beat: hazmat trucks must detour (about 15 min versus about 6 for a car) | "Hazmat trucks must detour" | 16 s |
| 3 | 1:06 - 1:38 | Nemotron at work: goal, parse, confirm, propose, futures, critic (with the labeled no-AI fallback) | "What could help" | 32 s |
| 4 | 1:38 - 2:00 | The guardrail: a visible validator rejection, the architecture line, the exhaustive audit | Expert mode | 22 s |
| 5 | 2:00 - 2:50 | Payoff and honesty: apply, terrain sinks, the residual, the range and what our study found, audience | "What could help" (applied); "Now explore" | 50 s |

The voiceover is about 370 words. Record it first in one calm take, time it, and trim
the wording (not the speed) if it runs over 2:52. The first candidates to cut are the
"Regional averages hide local disasters" line in moment 2, the "peninsula stays worst
hit in fifty" clause in moment 5, and the token-count sentence in moment 3. Slack to the
3:00 limit is about 20 s; do not use it.

## Moment by moment

### Moment 1: Averages lie (0:00 - 0:34)

- **On screen.** **[VERIFY AFTER REDESIGN for every step.]**
  - 0:00-0:07. The intro card with the dedication ("In memory of the six construction
    workers who died. Planning simulation, not dispatch."). Hold 6 s. No image or
    animation of the event. Skip straight past it if it has been recorded separately.
  - 0:07-0:11. Click **Start the walk-through**. Scene 1, "The crossing is removed":
    the road network as of 1 March 2024 with the Key Bridge in place, big number at
    0 seconds.
  - 0:11-0:19. Click **Remove the Key Bridge link**. The link line fades (no collapse
    animation), terrain rises over the Sparrows Point and Edgemere peninsula, the big
    number rolls to "about 3 seconds", caption "Average added drive time, per resident".
  - 0:19-0:34. Click Next to scene 2, "Averages hide the local story". The big number
    reads "about 20,000 residents" with the range chip on the same line ("Assumption
    range: about 6,700 to about 96,000"). Click **Show the peninsula**: the camera
    flies to the hardest-hit block groups and the hatching appears. Add the caption
    "Head-count depends on assumptions; range shown." The range must be readable on
    screen while the head-count is spoken.
- **Voiceover.**
  > In memory of the six construction workers who died when the Francis Scott Key
  > Bridge collapsed on March 26, 2024.
  >
  > Remove the bridge link from the March 2024 road network, and the average drive to
  > jobs grows about three seconds.
  >
  > But averages hide the local story: about twenty thousand people, mostly on the
  > Sparrows Point and Edgemere peninsula, reach more than ten percent fewer jobs
  > across the harbor. That count is assumption-sensitive, so the range is on screen.

### Moment 2: What did not break (0:34 - 0:50)

- **On screen.** **[VERIFY AFTER REDESIGN.]** Next to scene 3, "What did not break".
  Click **Show both shores**: the first-response lens, camera pulled back so stations
  on both shores are visible. The big number reads the simulated response time (about
  6.1 minutes) with the chip "Unchanged from baseline". Point at the chip. Leave the
  baseline and current values visible side by side.
- **Voiceover.**
  > What did not break: first-response time is unchanged in the model, because both
  > shores have their own fire stations. Regional averages hide local disasters, and a
  > good tool also shows what held.

### Beat: Hazmat trucks must detour (0:50 - 1:06)

- **On screen.** **[VERIFY AFTER REDESIGN.]** Next to scene 4, "Hazmat trucks must
  detour". The big number reads "about 15 minutes" (caption "Added per hazmat truck trip,
  on average"), with the sentence naming the 24 harbor trips and the car figure of about
  6 minutes, and the MDTA citation line on screen. Click **Show a hazmat detour**: the
  car path and the longer hazmat path for one trip, dim = before, bright = now. Numbers
  on screen come from the app: 5.8 min for a car and 14.7 min for a hazmat truck at
  free-flow, 23 of 24 hazmat trips over 5 minutes (say "about fifteen" and "about six").
- **Voiceover.**
  > Both tunnels bar listed hazardous loads, so in the model those trucks must detour:
  > about fifteen extra minutes on average across twenty-four harbor trips. A car adds
  > about six. A simulation of one published rule.
- **On screen with it.** The scene's disclaimer, at least its first sentence:
  "Simulation, not route guidance. Drive times are simulated at free-flow speeds on the
  pre-collapse (1 March 2024) road network." **[VERIFY AFTER REDESIGN: the popover or
  line that carries it.]** Also the two source lines: the MDTA rule page and the MDTA Key
  Bridge news page (the western I-695 alternate route), both accessed 26 September 2026.
- **Do not say** that the Key Bridge carried hazmat as a fact (that is an assumption:
  the MDTA rule page does not cover the bridge), that this is all freight (it is one
  rule, two vehicle classes), or anything that presents the scene as guidance for real
  trucks or carriers. Do not read out the escort figures unless you also say the escort
  windows are hypothetical and not an MDTA program.
- **Optional 3 s insert, only if it fits.** In Expert mode, the hazmat search goal
  offers two hypothetical escorted-window options; the Harbor Tunnel escort window cuts
  the hazmat mean from +14.7 to +10.2 minutes in the reference run. Keep it out of the
  voiceover unless the time is there.

### Moment 3: Nemotron at work, live (1:06 - 1:38)

**[VERIFY]** All of the AI version needs a live, verified AI planner. Record one full
run and cut it down. If the AI planner is not verified by the recording day, do not
submit this cut; see the fallback at the end of this moment.

- **On screen, in order.** **[VERIFY AFTER REDESIGN for where each control lives.]**
  1. Next to scene 5, "What could help". The sentence "Screen 16 hypothetical options
     ..." and the goal preset line. The planner label reads "AI planner: <model>" with
     the model name as the app shows it. **[VERIFY AFTER REDESIGN: the preset goal and
     lens the story uses.]**
  2. Click **Find a better future**. The parsed goal appears as chips; click to
     confirm. The chips, not the model, hold the numeric target.
  3. The progress sentence counts futures ("N of M completed"). This is real: the
     count is futures computed in the browser.
  4. **[VERIFY]** The critic picks a stress test from a closed set (a tunnel closed
     and/or a time of day), the log names it in an application-written label, the
     simulator re-scores the leaders under it, and the planner refines. Built in code
     and tested against fakes only; not verified live. If the AI critic's answer is
     rejected, the deterministic (no-AI) critic runs the same step; the log says so,
     and the voiceover must then say so too.
  5. Optionally, in Expert mode, expand the collapsed "Model reasoning (raw, unverified;
     not a result)" section in the decision log for 2 s, to show it is labeled and set
     apart. Do not read it aloud or claim it is correct.
- **Voiceover (AI version).**
  > Now the search. I set a goal and confirm it. A small Nemotron model on Nebius Token
  > Factory parses it, and the largest available Nemotron model proposes bundles of
  > options, only by catalog ID. The simulator scores every bundle across many
  > futures, in the browser, and a critic picks a stress test. Model names and token
  > counts are as the app shows them. None of it writes a number.
- **Alternate sentence if the stress step does not run live.** "A critic model reads
  the results and can veto a bundle, and the planner refines." Say only what the
  recording shows.
- **Fallback if the AI planner is not verified (the deterministic two-stage search).**
  The planner label reads "Deterministic search (no AI)". Voiceover: "Now the search. I
  set a goal and confirm it. With no AI key, the same search runs deterministically, and
  the app labels it: one run screens every eligible bundle, then the top twelve are
  stress-tested across paired futures, in the browser. A Nemotron planner on Nebius
  Token Factory is built for this step and pending live verification. None of it writes
  a number." This is a weaker submission, and the audio would then not truthfully cover
  live Nemotron use. Prefer to wait.

### Moment 4: The guardrail (1:38 - 2:00)

- **On screen.** Press **E** or click the Expert mode toggle (**[VERIFY AFTER
  REDESIGN]**; the keyboard shortcut is a proposal in docs/STORY.md).
  1. 1:38-1:45. One **real** validator rejection in the decision log (a red or amber
     line such as "Planner output rejected; repair requested" or "Planner output
     rejected; deterministic search used").
  2. 1:45-1:51. Cut to the architecture shot: plain text, no logos, or the rendered
     README diagram. Highlight in turn: browser simulator, server routes with
     validators, "Nemotron via Nebius Token Factory", and the line "the model proposes,
     the simulator scores, the model can never state a metric".
  3. 1:51-2:00. The finalist cards' exhaustive check line: "Exhaustive check (free-flow,
     no futures): rank 1 of 129". Record it separately (the check takes a moment to
     run) and cut it in. **[VERIFY: the rank and the 129 must be re-read from the
     deployed build; if they differ, say what the screen shows.]**
- **Do not fake the rejection.** Use one that a live run produced. If none occurs
  naturally after several runs, show the validator's regression test rejecting an
  option that is not in the catalog (`frontend/test/ai/validator.test.ts`), labeled on
  screen as a test.
- **Voiceover.**
  > The guardrail: when a proposal breaks the rules, the validator rejects it, and the
  > log shows it. The model proposes, the simulator scores, and the model can never
  > state a metric. And the search is audited against every eligible bundle: its top
  > pick ranks first of one hundred twenty-nine.
- **If the deterministic search ran** (fallback), say "the deterministic search's top
  pick" instead of "its top pick", and use the deterministic-search rejection line or
  the labeled test for the rejection shot.
- **Optional Tavily insert, only if the closure lookup is verified live with a real
  key.** Add one sentence: "Tavily's closure search feeds the same loop, and I confirm
  every item before it touches the model." Otherwise leave it out.

### Moment 5: Payoff and honesty (2:00 - 2:50)

- **On screen.** **[VERIFY AFTER REDESIGN for every step.]**
  1. 2:00-2:04. Click **Back to the story**, back on scene 5 with three finalists
     listed (no "Recommended" badge). Compare and Preview stay in Expert mode; use
     them only if there is time.
  2. 2:04-2:12. Click **Apply the top option**, then confirm **Apply in simulation**.
     The terrain sinks outward from the option. Let it settle 3 s.
  3. 2:12-2:24. Hold on the applied scene: the big number, and the sentence with the
     residual ("... residents still reach over 10% fewer jobs across the harbor"). The
     measure must be named on screen (the number's tooltip or caption), and the
     residual, about 15,000 (from about 20,000), must be readable. Read both counts
     from the app and say them as the app shows them. **[VERIFY: docs/STORY.md open
     issue A. The scene's big number must show the count measure, not an unnamed
     percent.]**
  4. 2:24-2:32. Show the range (5 s): the scoreboard table at the top of
     `docs/METHODOLOGY.md` on the repository page (51 variants; cross-harbor
     head-count 6,667 to 96,277 in the speed variants), or a plain text card with the
     same figures. The range must be on screen, not only spoken.
  5. 2:32-2:38. Next to scene 6, "Now explore" (2 s), then the Assumptions panel for
     3 s (every parameter listed).
  6. 2:38-2:50. The app footer and disclaimer, then a plain dark card with the wordmark
     and URL.
- **Voiceover.**
  > Back in the story, I apply the top option, and the terrain sinks. On assumed
  > corridor speed factors and hypothetical options, the residents who reach more than
  > ten percent fewer cross-harbor jobs fall from about twenty thousand to about
  > fifteen thousand, about a quarter fewer. About fifteen thousand remain. We
  > stress-tested the finding in fifty-one variants: the head-count ranges from about
  > seven thousand to ninety-six thousand, the peninsula stays worst hit in fifty, and
  > free-flow is a lower bound. A screening tool for planning analysts, on open data, in
  > your browser. Simulated, not measured, not dispatch, and a human decides.
  > WorldSeed: don't predict the future, simulate it.
  >
  > **[VERIFY: replace "twenty thousand" and "fifteen thousand" with the figures the
  > app shows for the applied world, and if the best bundle is not Beltway flow + Harbor
  > Tunnel approaches + I-95 flow, do not name it.]**

## Full voiceover, one block (for the recording session)

> In memory of the six construction workers who died when the Francis Scott Key
> Bridge collapsed on March 26, 2024.
>
> Remove the bridge link from the March 2024 road network, and the average drive to
> jobs grows about three seconds.
>
> But averages hide the local story: about twenty thousand people, mostly on the
> Sparrows Point and Edgemere peninsula, reach more than ten percent fewer jobs across
> the harbor. That count is assumption-sensitive, so the range is on screen.
>
> What did not break: first-response time is unchanged in the model, because both
> shores have their own fire stations. Regional averages hide local disasters, and a
> good tool also shows what held.
>
> Both tunnels bar listed hazardous loads, so in the model those trucks must detour:
> about fifteen extra minutes on average across twenty-four harbor trips. A car adds
> about six. A simulation of one published rule.
>
> Now the search. I set a goal and confirm it. [VERIFY, AI version only: A small
> Nemotron model on Nebius Token Factory parses it, and the largest available Nemotron
> model proposes bundles of options, only by catalog ID. The simulator scores every
> bundle across many futures, in the browser, and a critic picks a stress test. Model
> names and token counts are as the app shows them.] None of it writes a number.
>
> The guardrail: when a proposal breaks the rules, the validator rejects it, and the
> log shows it. The model proposes, the simulator scores, and the model can never state
> a metric. And the search is audited against every eligible bundle: its top pick ranks
> first of one hundred twenty-nine.
>
> Back in the story, I apply the top option, and the terrain sinks. On assumed corridor
> speed factors and hypothetical options, the residents who reach more than ten percent
> fewer cross-harbor jobs fall from about twenty thousand to about fifteen thousand,
> about a quarter fewer. About fifteen thousand remain. We stress-tested the finding in
> fifty-one variants: the head-count ranges from about seven thousand to ninety-six
> thousand, the peninsula stays worst hit in fifty, and free-flow is a lower bound. A
> screening tool for planning analysts, on open data, in your browser. Simulated, not
> measured, not dispatch, and a human decides. WorldSeed: don't predict the future,
> simulate it.

The bracketed AI passage in the search paragraph is a [VERIFY] item: keep it only if
the AI planner and the critic's stress step actually ran, on camera, in the recording.
If the deterministic search ran instead, use the fallback paragraph in moment 3 in its
place, and if only the AI critic's step did not run, use the alternate sentence.

## On-screen captions (small, lower left, plain text)

- Moment 1: "Roads as of 1 March 2024, free-flow speeds. Computed locally in your browser."
- Moment 1 (on the head-count): "Head-count depends on assumptions: about 6,700 to 96,000 across variants tested."
- Moment 2: "Simulated results, not measurements."
- Hazmat beat: "Simulation, not route guidance. Hazmat truck: a vehicle carrying the hazardous materials MDTA lists as barred from both tunnels (MDTA, accessed 26 September 2026). Free-flow, 24 fixed trips. Bridge assumed open to hazmat before the collapse."
- Moment 3: "Model names and token counts as shown by the app." (AI version) or "Deterministic search (no AI)" (fallback)
- Moment 5: "Hypothetical scenario options, assumed corridor speed factors. No agency proposed these."
- Close: "Planning simulation, not dispatch. In an emergency, call 911."

## Screen-recording shot list

Record as separate takes so any moment can be redone without redoing the rest. Every
shot is **[VERIFY AFTER REDESIGN]** until the story build is deployed.

1. Intro card with the dedication, held 8 s, then **Start the walk-through** (moment 1).
2. Scene 1, baseline with the Key Bridge in place, static hold, 4 s (moment 1).
3. **Remove the Key Bridge link**, the link fading, terrain rising, hold 8 s (moment 1).
4. Scene 2, the range chip and the "about 20,000" number in the same frame, then **Show the peninsula**, hold 10 s (moment 1).
5. Scene 3, **Show both shores**, hold 8 s on the "Unchanged from baseline" chip (moment 2).
6. Scene 4, the hazmat number, the MDTA citation line, then **Show a hazmat detour**, hold 10 s (beat).
7. Scene 5 ready state, the planner label, **Find a better future**, goal chips confirmed (moment 3). **[VERIFY]**
8. Progress sentence counting futures to completion (moment 3). **[VERIFY]**
9. **[VERIFY]** Critic stress test, the re-scored leaders and the planner's refinement (moment 3). Only if it ran live. In Expert mode, the decision log with the proposal, model name, token counts and the rationale label.
10. A real validator rejection in the decision log, or the validator test output labeled as a test (moment 4).
11. Architecture text slide, or the rendered README diagram with highlights (moment 4).
12. Exhaustive check line on the finalist cards, "rank 1 of 129" (moment 4). **[VERIFY]**
13. **Back to the story**, finalists, **Apply the top option**, confirm, terrain sinking, the residual sentence held 12 s with the measure named (moment 5).
14. The METHODOLOGY scoreboard or a plain text range card, 5 s (moment 5).
15. Scene 6, then the Assumptions panel, 3 s (moment 5).
16. Closing card, wordmark and URL, footer disclaimer visible (moment 5).
17. Optional 6 s insert, only if Tavily is verified live: the closures drawer with a proposal, its source link, quote, "unverified" label and the confirm step.

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
> and may be inaccurate. Credits: Map data (c) OpenStreetMap contributors (ODbL).
> Basemap: OpenFreeMap, (c) OpenMapTiles. Census data: U.S. Census Bureau (ACS via
> Census Reporter; TIGER/Line; LEHD LODES). Facility locations: MD iMAP, State of
> Maryland. Hazmat tunnel rule: Maryland Transportation Authority. Reported commute:
> Maryland Matters (via Baltimore Fishbowl). AI: NVIDIA Nemotron on Nebius Token
> Factory. Search: Tavily. WorldSeed is a research prototype and planning simulation:
> not dispatch, not route guidance. Not affiliated with or endorsed by any agency or
> company named. In memory of the six workers lost on March 26, 2024. For the Nebius x
> NVIDIA Global AI Hackathon.

**[VERIFY: keep the "AI: NVIDIA Nemotron on Nebius Token Factory" and "Search: Tavily"
credits only for services that ran live in the submitted build. The credits block is the
legal-review wording; the sentence before it is ours. Add the Maryland Matters
canonical URL when METHODOLOGY has it.]**

## Checklist: verify live before recording

Run these on the deployed site in a clean incognito window, and again just before
recording.

- [ ] The deployed build is the current `main` (docs/STATUS.md could not confirm which commit is live) and shows the guided story with its six scenes and the Expert mode toggle. **[VERIFY AFTER REDESIGN]**
- [ ] The site loads without login, and the first-run disclaimer banner shows.
- [ ] Baseline numbers read as expected: cross-harbor 20.6 min, first response 6.1 min. If they differ, re-read every figure in this script.
- [ ] After removal: regional about +3 s, first response unchanged, cross-harbor about 20,100 residents losing more than 10% (the voiceover must match the screen; adjust the words, not the app). The voiceover must never give the head-count without saying it is assumption-sensitive, and the range (about 6,700 to 96,000) must appear on screen in the same scene.
- [ ] The figures in the study sentence still match `docs/METHODOLOGY.md` (51 variants; peninsula worst-hit in 50 of 51; 6,667 to 96,277 across the speed variants).
- [ ] Hazmat scene: the app shows about 15 minutes for a hazmat truck (14.7) and about 6 for a car (5.8) over 24 trips, with the MDTA citation, and 23 of 24 hazmat trips over 5 minutes in Expert mode. If not, say the real figures.
- [ ] `/api/health` shows which model resolved for each role. Write down the actual planner, critic, parser and extractor models. The voiceover says "small Nemotron" and "largest Nemotron available"; if the app shows different model names on screen, make the words match.
- [ ] A full AI mission runs end to end on the deployed site: goal chips, proposal, futures progress, decision log with model names and token counts, three finalists, Compare, Preview, Apply. Note how long it takes. If no key is deployed, use the labeled deterministic fallback and its voiceover, and accept the weaker audio.
- [ ] A real validator rejection has been captured in the decision log (or the test-output fallback is prepared and labeled as a test).
- [ ] The decision log shows the "AI rationale (unverified; not a result)" label, and no model-written number appears anywhere on a card.
- [ ] After Apply, the residual is readable on screen with its measure named: residents who reach more than 10% fewer cross-harbor jobs, about 20,000 down to about 15,000 for the best bundle. The voiceover says the figure the screen shows, says it rests on assumed corridor speed factors and hypothetical options, and says the remainder. No "recovers about 40%" anywhere.
- [ ] The exhaustive check shows "rank 1 of 129" (or the real rank and count), and the voiceover matches.
- [ ] The critic's stress-test step runs end to end on the deployed site (AI critic, or the labeled deterministic critic). If not, use the alternate sentence or cut it.
- [ ] The collapsed "Model reasoning (raw, unverified; not a result)" section appears in the decision log and shows no digits, links or markup. Do not read it aloud.
- [ ] Tavily: the closures lookup returns a real result (or an honest "no closures found") on the deployed site. Only then keep the Tavily sentence and the optional insert.
- [ ] The daily AI budget has room for several takes. Check the budget state, and raise the ceiling temporarily only if the project owner agrees.
- [ ] Nothing in the recording shows an API key, an `.env` file, a terminal with secrets, or a personal email.
- [ ] No third-party logos, no music, no collapse imagery in any shot.
- [ ] Final cut duration is under 3:00 (target 2:50) and the audio names both Nebius Token Factory and NVIDIA Nemotron.
- [ ] The demo, the video and the Devpost description all say the same thing about what is live.

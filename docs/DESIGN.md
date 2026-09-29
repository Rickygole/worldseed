# WorldSeed design system

The interface for a counterfactual planning simulator of the Key Bridge region. This file is the source of
truth for how the app looks, moves and reads. Tokens live in `frontend/app/globals.css` (`@theme`); the
components that implement them live in `frontend/components/ui/`. Wireframes are in `docs/design/`.

## 1. Principles

1. **The map is the argument.** The 3D terrain carries the story. Everything else is a caption. In Story
   mode the map owns at least 65% of the screen; panels float on it, never beside it.
2. **One thing per screen.** Each scene has exactly one big number, one sentence, one action. One element
   per screen carries a semantic accent; everything else is neutral.
3. **Numbers are computed, never typed.** Every figure comes from the simulator through the selector libs
   (`lib/ui/explainer.ts`, `ribbon.ts`, `methodology.ts`, `story.ts`). Copy has `{{slots}}`, not digits.
4. **Honest by construction.** Head counts are rounded ("about 20,000") and always travel with their
   assumption range. Free-flow is labeled a lower bound. Options are labeled hypothetical. The planner
   says "Deterministic search (no AI)" whenever the model is not available. The planning-simulation notice
   and the map attribution are visible on every screen.
5. **Depth on demand.** The story is shallow and calm. Expert mode has everything, but folds it: one planner
   step at a time, collapsed sections, tooltips instead of paragraphs.
6. **Sober.** This is built on a real loss. No collapse animation (the bridge is a dashed marker), no
   celebratory motion, no exclamation marks, a short dedication.

### 1a. The owner's simplicity rules (they override anything below)

1. The first screen is only the map, the name, one dedication line, one plain sentence, one button and the slim
   planning notice (plus the map attribution). No numbers, panels, legends or chips.
2. Every story scene: one picture (the map state), one big number (with a "Simulated" tag and an eight-word
   caption), one sentence, one button. Ranges, sources and methods sit behind "How do we know?". The only
   extras allowed on the card are one quiet chip (the assumption range for head counts, which the honesty rules
   require on the number itself) and one muted line (the planner in use, a progress count, the escort note).
3. Plain language at a 7th to 8th grade level on the default path, sentences of about 18 words or fewer; no
   "lens", "futures", "p90", "bundle", "deterministic" except the mandated label "Deterministic search (no AI)".
   `test/ui/readability.test.ts` fails any sentence above grade 9.
4. At most one floating card plus the story bar; number 64 to 88 px, sentence 26 px, button 18 px; no more than
   three colors at once (white, gray and the scene's one accent).
5. Expert mode is a quiet ghost button ("Expert mode", key E) and never opens by itself.

### 1b. Five-second test (what a stranger should say after five seconds on each screen)

| Screen | Five-second answer | Checked against |
|---|---|---|
| Intro | "A bridge was lost and people are remembered; this shows who a lost bridge affects." | redo-*-00-intro |
| 1 The bridge | "Across the whole region, losing the bridge adds only a few seconds." | redo-*-02-crossing-after (0 rolls to about 3) |
| 2 The local story | "But about 20,000 people near Sparrows Point and Edgemere reach far fewer jobs; the count is uncertain." | redo-*-03-local, 03c |
| 3 What held | "Fire-station response did not get worse; both sides have stations." | redo-*-04-held |
| 4 Dangerous cargo | "Trucks with dangerous loads can't use the tunnels, so their trips get about 15 minutes longer (cars about 6)." | redo-*-05b-detour |
| 5 What could help | "The best idea wins back about a quarter; about 15,000 people are still affected." | redo-*-06c, 06e |
| 6 Explore | "Now I can try things myself in Expert mode." | redo-*-07-explore |

## 2. Color roles

Dark ground, near-black navy. Semantic colors are reserved for meaning and are always paired with a label,
icon or shape (never hue alone).

| Token | Value | Role | Contrast on `bg` / `panel` |
|---|---|---|---|
| `bg` | `#070B12` | page ground, map fallback | - |
| `panel` | `#0F1520` | solid surface behind glass | - |
| `raised` | `#161E2C` | hover, selected rows, inputs | - |
| `line` | `rgb(148 163 184 / 0.14)` | hairlines, dividers (sparingly) | decorative |
| `line-strong` | `rgb(148 163 184 / 0.28)` | control boundaries | 3:1 against panel |
| `text` | `#EEF2F7` | primary text, big numbers (neutral) | 17.5 / 16.3 |
| `text-2` | `#A9B4C4` | secondary text, sentences under numbers | 9.4 / 8.7 |
| `muted` | `#8391A5` | labels, captions, units | 6.2 / 5.7 |
| `faint` | `#5B687B` | disabled, decorative ticks only (never text that matters) | 3.5 |
| `ok` | `#2DD4BF` | held / improved / baseline | 10.6 |
| `warn` | `#F5A524` | caution, hazmat route, assumptions | 9.7 |
| `critical` | `#FF3D71` | worse / removed link / hard-hit | 5.8 / 5.4 |
| `ai` | `#4C8DFF` | the planner (AI or deterministic search), focus ring | 6.2 |
| `future` | `#A78BFA` | futures, options, previews | 7.2 |

Rules:
- **One accent per screen.** In a story scene the big number takes the scene's tone; the action button is
  neutral (light fill). The planner's search button is the only filled `ai` button in the product.
- **Tone is a pair.** Up arrow + `critical`; down arrow + `ok`; shield + `ok` for "held"; triangle +
  `warn` for caveats. Hatching on the map for ">25% lost" (map legend).
- Terrain ramp is owned by `lib/ui/lenses.ts` and the map director; the UI legend mirrors it.

## 3. Type

Three faces, all SIL OFL 1.1, self-hosted by `next/font` at build time:

- **Space Grotesk** (display): big numbers and scene headlines only. Tabular figures (`tnum`) on for numbers.
- **Inter** (text): everything else.
- **JetBrains Mono** (data): IDs, dense table cells, keyboard hints. Never for sentences.

Scale (px, line-height). No sizes outside this list.

| Token | Size / LH | Use |
|---|---|---|
| `text-2xs` | 11 / 14 | map legend ticks only |
| `text-xs` | 12 / 16 | labels (uppercase +0.06em), captions, units |
| `text-sm` | 14 / 20 | UI text, buttons, table cells |
| `text-base` | 16 / 24 | body |
| `text-lg` | 20 / 28 | the scene sentence (desktop), dialog titles |
| `text-xl` | 24 / 32 | section titles, KPI values in Expert ribbon |
| `text-2xl` | 32 / 36 | secondary big figure (comparison value) |
| `text-display` | 88 / 84 | the scene number (desktop, 1366 and up) |
| `text-display-sm` | 64 / 64 | the scene number (390 px, short screens) |

Measure: story sentences are capped at 36ch (they are one sentence, at most 22 words); body text in dialogs
sits at 60 to 72ch with 24 px line height.

## 4. Space, radii, elevation

- **8 px grid.** Steps: 4 (hairline gaps only), 8, 12, 16, 24, 32, 48, 64. Related things 8 to 12 apart;
  groups 24 to 32 apart.
- **Radii:** 6 (small controls, chips inside tables), 10 (buttons, inputs), 16 (panels, cards), 24 (story
  card and mobile sheet), full (pills).
- **Elevation.** Three levels, each a pair of fill and shadow; borders only as a 1 px inner highlight.
  - `e1` glass: `rgb(12 17 26 / 0.72)`, `backdrop-filter: blur(20px) saturate(140%)`, inner top highlight
    `rgb(255 255 255 / 0.06)`, shadow `0 12px 40px rgb(0 0 0 / 0.35)`. Panels over the map.
  - `e2` popover: `rgb(16 22 33 / 0.94)`, blur 16, shadow `0 16px 48px rgb(0 0 0 / 0.5)`. Menus, popovers, tooltips.
  - `e3` modal: solid `panel`, shadow `0 24px 80px rgb(0 0 0 / 0.6)`, over a `rgb(4 7 12 / 0.6)` scrim.
- **Blur budget.** At most three blurred layers on screen at once (header, story card, one popover). Blur
  is disabled under `prefers-reduced-transparency` and on the low map-quality tier.

## 5. Iconography

Lucide only, 16 px in UI, 14 px inside chips, 20 px in the story action. Stroke 1.75. Icons never carry
meaning alone: every icon button has an `aria-label` and a tooltip.

## 6. Motion

Motion says where a thing came from and where it went. Nothing loops except progress.

| Token | Duration | Easing | Use |
|---|---|---|---|
| `micro` | 150 ms | ease-out `cubic-bezier(0.22,1,0.36,1)` | hover, press, chip toggles |
| `panel` | 200 ms in / 150 ms out | ease-out in, ease-in `cubic-bezier(0.4,0,1,1)` out | popovers, drawers, rail sections |
| `scene` | 250 ms per element, 60 ms stagger | ease-out | story card content: eyebrow, number, sentence, action |
| `roll` | 900 ms | ease-out | number roll-ups when a value changes |
| `camera` | owned by the map director (`goToScene`) | - | fly-to between scenes |

Scene change choreography: old content exits down 8 px and fades (150 ms, ease-in); the camera starts at
the same moment; new content enters up 12 px in the order eyebrow, number, sentence, action (60 ms
stagger); the number rolls from the previous scene's value only when both are the same quantity, otherwise
it fades in.

**Reduced motion** (`prefers-reduced-motion: reduce`): crossfades only (120 ms), numbers land instantly,
camera cuts (`goToScene(id, { instant: true })`), no orbit, no shimmer.

## 7. Layout

- **Story mode (default).** Full-bleed map. Header (56 px, transparent over a top gradient) with the wordmark, the
  story bar in the center (6 steps, the current one labeled) and the quiet Expert-mode button. Story card
  bottom-left (460 px wide, 24 px from edges); its popovers open beside it, over the map. Slim footer line with
  the planning notice and "About and sources"; the MapLibre attribution stays on at bottom right. No legend and
  no map toolbar in story mode (the legend text lives in "How do we know?").
  At < 768 px the card becomes a bottom sheet (full width, 24 px top radius, drag handle), the progress
  bar becomes dots at the top of the sheet, and the header keeps only the wordmark, the mode toggle and About.
- **Expert mode.** Header with the mode toggle and tools; a left rail (280 px) with scenario, lenses and
  tools; the right planner (360 px) showing one step at a time; a bottom ribbon of five KPIs (96 px);
  the map in between (never less than 60% of the width at 1366).

### Pages

Real URLs (App Router): `/` intro, `/story/<slug>` one scene each, `/explore` Expert mode, `/about` and `/methodology`
documents. The map, simulator and worker pool are mounted once in the root layout and persist across pages; each page
renders only its overlay. Document pages cover the map with a dim scrim in a 720 px reading column and leave the bottom
36 px strip clear for the map attribution. The mode switch is a link (story to `/explore`, Expert back to the last
scene); arrow keys and the story bar navigate by URL, so the browser's back and forward buttons work.

## 8. Components (in `components/ui/`)

Every interactive component has default, hover, focus-visible, active/pressed, disabled and loading states.
Focus is a 2 px `ai` ring with 2 px offset, never removed.

| Component | Notes and states |
|---|---|
| `Button` | variants: `primary` (light fill, dark text), `planner` (the one `ai` fill), `secondary` (glass, line-strong), `ghost`, `icon`. Sizes 32 / 40 / 48. `loading` swaps the icon for a spinner and keeps the width. |
| `Chip` | pill, 24 / 28 px. Tones: neutral, ok, warn, critical, ai, future (tinted fill 10%, text in tone, icon). |
| `Caveat` | a `?` chip that opens a popover with one short paragraph and an optional source link. Keyboard: Enter/Space opens, Escape closes and returns focus. |
| `Popover` | e2, max 320 px wide, arrow-less, anchored; closes on outside click and Escape. |
| `BigNumber` | display face, tabular, rolls on change (`roll`), optional prefix sign, unit in `text-lg muted`, tone. Announces the settled value to screen readers only once. |
| `StoryCard` | eyebrow (step n of 6 and scene title), number block, sentence, action, caveats row. Empty, loading (skeleton number with the same box, no reflow), error states. |
| `StoryProgress` | 6 steps, `role="tablist"`-free: a `nav` of buttons with `aria-current="step"`. Left/Right arrows move between scenes anywhere on the page (except inside inputs). |
| `ModeToggle` | segmented radio group: Story / Expert. Always in the header. |
| `Collapsible` | disclosure button (`aria-expanded`) + region, 200 ms height animation (instant under reduced motion). |
| `Stepper` | planner steps Mission, Search, Finalists, Apply; the current step is open, earlier ones collapse to a one-line summary with an Edit link. |
| `Kpi` | label, value (text-xl display), delta chip with arrow, one caption line, tooltip with the long explanation. |
| `Dialog` / `Drawer` | e3, focus trapped, Escape closes, focus restored. |
| `Skeleton` | same box as the content it replaces; shimmer off under reduced motion. |

## 9. Accessibility floor

- WCAG AA contrast (table above). Hit targets at least 32 px desktop, 44 px at 390 px.
- Landmarks: `header`, `main` (map + story), `nav` (story progress), `aside` (rail, planner), `footer`.
- Each scene change moves focus to the scene heading and is announced once through a polite live region
  ("Step 2 of 6: Averages hide the local story. About 20,000 residents...").
- Everything is reachable by keyboard; focus order follows the visual order (header, story card, progress,
  footer). Escape closes popovers, dialogs and drawers; Enter confirms.
- `prefers-reduced-motion` and `prefers-reduced-transparency` are honored.

## 10. Wording guard

User-visible text must pass `frontend/test/ai/hygiene.test.ts`. Never describe our features with the
operational-emergency words that test lists. The planning-simulation notice text lives only in
`components/DisclaimerBanner.tsx` (exported constants) and is imported everywhere else.

## 11. Third-party assets added by this design

- Space Grotesk (Florian Karsten), SIL Open Font License 1.1, self-hosted via `next/font/google` (downloaded
  at build time, served from the app origin). Record it in `THIRD_PARTY_LICENSES.md` next to Inter and
  JetBrains Mono when that file is regenerated.
- No new npm dependencies.

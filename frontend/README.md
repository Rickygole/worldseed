# WorldSeed frontend

The WorldSeed app: a counterfactual planning simulator for the Key Bridge region of Baltimore, running the
snapshot-backed simulator in the browser (Web Workers). Next.js (App Router) + TypeScript (strict) +
Tailwind v4, deck.gl + MapLibre GL, Zustand, Framer Motion, d3, lucide-react. Everything is free / open
source. No API keys are needed for the map or the simulator.

## Run

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (type-checks)
npm run lint
npm run typecheck
npm test           # vitest
```

Requires Node 20+ (developed on Node 24). `predev` / `prebuild` copy MapLibre's worker files into
`public/maplibre/` and the pipeline snapshot (`data/snapshot/`) into `public/snapshot/` (both git-ignored);
see `scripts/`.

## Try it

The app opens in the **guided story** (map first). Each scene shows one number, one sentence and one button over the
3D map; ranges, sources and methods are behind "How do we know?". Every number comes from the simulator (or, for the
labeled study ranges, from `docs/METHODOLOGY.md`, only in the exact Key Bridge-removed world).

1. Intro: the dedication and one sentence. **Start the walk-through** (Escape skips).
2. The bridge: **Remove the Key Bridge**. The regional average rolls from 0 to about 3 seconds.
3. The local story: about 20,000 people reach over 10% fewer jobs across the river (with the assumption range).
   **Show me where** switches to the cross-harbor view and flies to the peninsula.
4. What held: the time to the nearest fire station did not change.
5. Dangerous cargo: tunnel rules make hazmat-truck trips about 15 minutes longer (cars about 6); **Show the detour**
   draws one trip's routes.
6. What could help: **Find a better future** runs the search (the AI planner when `/api/health` reports it, otherwise
   "Deterministic search (no AI)"), then **Apply the best idea** (after a confirmation) and the honest residual.
7. Explore: **Open expert mode**.

**Expert mode** (the quiet button top right, or `E`) is the full workspace: scenario and lens rail with the legend and
tools (hazmat and car trips, closure notices, reality check), the planner one step at a time (goal, search, finalists,
apply) with the futures fan, finalist cards, exhaustive check and decision log, a comparison strip over the map, the
neighborhood inspector (click a hexagon) and a ribbon of five numbers.

URLs: `?mode=expert` opens Expert mode; `?scene=averages` (or any scene id: crossing, averages, held, freight, fix,
explore, intro) opens the story at that scene.

Keys: `Right` / `Left` next and previous scene, `E` story or Expert mode, `?` shortcuts, `R` reset, `P` presentation
mode (Expert), `Cmd/Ctrl-K` command bar, `Esc` closes popovers, dialogs and the inspector (and skips the intro).

## What is real vs placeholder

| Piece | Status |
| --- | --- |
| Terrain, ribbon, explainer, inspector | Real: `lib/sim` in Web Workers |
| Search (futures, fan, grid, finalists, stress tests, exhaustive check) | Real: scored by the simulator's worker pool (`lib/ui/agentBridge.ts`) |
| AI planner, parser, critic | Live only when `/api/health` reports the planner available; otherwise the deterministic search runs, labeled "no AI" |
| Closure notices, Reality check | Live only when the server has a Tavily key and confirm secret; otherwise "Live feed unavailable" |
| Sensitivity ranges and the reported-detour comparison | Documented results from `docs/METHODOLOGY.md` (not computed in the browser), shown only for the Key Bridge-removed world and linked |
| Recorded AI run | None exists; nothing claims one |
| Demo mock (`lib/sim/mock.ts`) | Dev fallback only, when `/snapshot/graph.meta.json` is absent; the footer then shows "Demo data" |

## How the UI reads the simulator

- `lib/store.ts` (Zustand): the world, `baseline` / `current` (cross-harbor runs; every run computes all three lenses),
  `view` / `viewBaseline` (the active lens), `applyScenario(scenario, {strict, staggerFrom, fx})` (every record passes the
  closures gate), `peek(scenario, lens)` (cached single-lens result for preview and compare), `selectHex`.
- `lib/ui/search.ts`: the planner machine (`lib/agent/machine.ts`), health polling, the per-option futures the charts draw,
  preview / compare / apply, and the exhaustive check.
- `lib/ui/agentBridge.ts`: the evaluator. Options are scored in the world on screen with paired stress futures (same seed
  and draws for every option, the pre-collapse network and doing nothing); stress rounds close the named links (and change
  time of day) in every world compared. P(goal) = share of futures within the target of the pre-collapse network in the
  same future. The planner's baseline row is doing nothing. The equity field sent to the planner is the one-sided
  disadvantage `max(0, gap)` because the planner contract requires non-negative times.
- `lib/ui/lenses.ts` maps a lens field to height, color and hatch (one shared scale for the two added-time lenses).
- Tests for the pure pieces: `test/ui/`.

## Design system

`docs/DESIGN.md` is the source of truth (principles, the owner's simplicity rules, the five-second test per scene,
color roles, type scale, spacing, elevation, motion, components). Tokens are in `app/globals.css` (`@theme`): a
near-black navy ground, semantic ok / warn / critical, ai (the planner), future (options); Space Grotesk for display
numbers, Inter for text, JetBrains Mono for data. Wireframes: `docs/design/wireframes.md`. Story copy: `lib/ui/storyCopy.ts`
(transcribed from `docs/STORY.md`), rendered with computed slots by `lib/ui/storyFigures.ts`; scene orchestration
(world, lens, camera through the map director) in `lib/ui/story.ts`.

Tests: `test/ui/readability.test.ts` (every default-path sentence at or below grade 9, no jargon),
`test/ui/story.test.ts` (study constants against `pipeline/sensitivity/out`, the privacy retention against the limiter
TTL, the scene templates and their conditional variants).

## Notes

- Env keys, when they arrive, are read only from `process.env` on the server. Never use `NEXT_PUBLIC_` for keys.
- Attribution: the MapLibre attribution control stays on in both modes; the footer carries the planning notice and
  "About and sources" (story) or the full data, AI and search credits with the Token Factory terms link (Expert).
- The planning notice is always visible in the footer line; the full intended-use text is in About.
- `prefers-reduced-motion`: crossfades only, numbers land without rolling, camera moves become cuts (map director).

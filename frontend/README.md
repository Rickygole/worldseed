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

1. Skip the intro (two slides).
2. **Remove Key Bridge link** (Scenario panel). Every lens is recomputed on the road network in your browser; the terrain
   rises over the Sparrows Point / Edgemere peninsula, the camera flies there, the ribbon rolls, and "What this shows"
   explains the result. Job-only hexagons (no residents) are drawn faded.
3. Switch the lens (Cross-harbor access / Regional access / First response (EMS)) or click a ribbon tile. The ribbon
   always shows all three lenses; first response is marked "held" when it does not move.
4. Click a hexagon: block group, Census figures, absolute cross-harbor minutes before and after, and the route that
   changed (dim = before, bright = now).
5. **Find a better future** (Planner panel). Confirm the goal first; nothing runs before you confirm. With the AI planner
   unavailable (no keys), the same button runs the **Deterministic search (no AI)**. Watch the futures fan grow, the
   stress-test beats, and the progress grid (real completed futures). Then Preview (violet wireframe), Compare (swipe
   slider), and Apply (confirm first; the option draws itself and the terrain changes outward from it).
6. **Exhaustive check** (Finalists): scores every bundle of one to three eligible options with one free-flow run each and
   says where the top pick ranks.
7. **Closure notices** and **Reality check** (Scenario panel): Tavily-backed, labeled unverified; closures need an explicit
   confirmation and a server-redeemed token before they enter the world.
8. `?tour=keybridge` runs a five-step guided tour; every step is a real action on the live simulator.

Keys: `P` presentation mode (hides panels, slow orbit), `R` reset, `Cmd/Ctrl-K` command bar (commands, "close harbor
tunnel", "reset", and plain-language goals when the AI planner is available), `Esc` closes overlays and the inspector.

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

## Design tokens

Defined in `app/globals.css` (`@theme`) as Tailwind theme values and CSS vars:
bg, surface, surface-2, border, text, muted, ok (teal), warn (amber), critical
(magenta), ai (blue, used only for the one primary button), future (violet).
Type scale 12/14/16/20/28/48/72, 12px card radius, numbers in JetBrains Mono
with tabular-nums (`.num`). Severe cells are never color-only: they carry a
diagonal hatch on the map and in the legend; every ribbon change has an arrow
and a word ("unchanged") as well as a color.

## Notes

- Env keys, when they arrive, are read only from `process.env` on the server.
  Never use `NEXT_PUBLIC_` for keys.
- Attribution: the MapLibre attribution control stays on (above the footer),
  and the footer carries the data, AI and search credits plus the Token Factory
  terms link.
- First run shows the disclaimer banner ("Planning simulation, not dispatch...");
  after dismissal the short form stays in the top bar and the full intended-use
  text is in About.
- `prefers-reduced-motion`: no orbit, no fly-to, no stagger; the terrain
  crossfades over 400 ms and counters snap.

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

1. Skip (or step through) the intro.
2. Click **Remove Key Bridge link** in the Scenario panel. Every lens is recomputed on the road network in
   your browser; the terrain rises over the Sparrows Point / Edgemere peninsula, the camera flies to where
   the change is, the ribbon numbers roll, and "What this shows" explains the result in plain sentences.
3. Switch the lens (Cross-harbor access / Regional access / First response (EMS)) above the map, or click a
   ribbon tile. The ribbon always shows all three lenses side by side.
4. Click any hexagon for its block group, Census figures and the route that changed (dim = before,
   bright = now).
5. **Assumptions** (top bar) lists every model parameter from the snapshot, the data vintages and what is
   simplified.

Keys: `P` presentation mode (hides panels, slow orbit), `R` reset, `Cmd/Ctrl-K` command bar, `Esc` closes
overlays and the inspector. Arrow keys move within the lens control.

## What is real vs placeholder

| Piece | Status |
| --- | --- |
| Terrain, ribbon, explainer, inspector numbers | Real: computed by `lib/sim` (snapshot-backed, in Web Workers) |
| Block-group figures (population, zero-vehicle households, low-wage workers) | Real: `blockgroups.json` (ACS 5-year via Census Reporter, LODES) |
| Assumptions drawer | Real: `assumptions.json` and `manifest.json` as shipped |
| Cross-harbor lens in the UI | Fast variant (job-weighted anchors, labeled in the drawer); the exact all-pairs version is the test oracle |
| Mission, decision log, futures, finalists (Planner panel) | Placeholders: honest empty states until the AI planner is wired |
| Demo mock (`lib/sim/mock.ts`) | Dev fallback only, when `/snapshot/graph.meta.json` is absent; the footer then shows "Demo data" |

## How the UI reads the simulator

The UI talks to the `Simulator` from `createSimulator()` (`lib/sim/index.ts`). State lives in
`lib/store.ts` (Zustand):

- `baseline` / `current`: cross-harbor runs of the baseline and the current scenario. Every run computes all
  three lenses, so the ribbon (`lib/ui/ribbon.ts`) and the explainer (`lib/ui/explainer.ts`) read
  `detail.lenses` and never depend on the active lens.
- `view` / `viewBaseline`: the active lens for the current scenario and the baseline (terrain, inspector).
- `applyScenario(scenario)`: runs a scenario (removed links plus `mutations`) on every lens and makes it
  current. This is the hook the planner uses to apply a bundle.
- `selectHex(i)`: opens the inspector and asks the simulator's `explain()` for the causal chain.
- Results are memoized per (scenario, lens), so switching lenses back and forth is instant.

`lib/ui/lenses.ts` maps a lens field to height, color and hatch. The cross-harbor and regional lenses share
one added-minutes scale, so the regional effect looks exactly as small as it is.

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

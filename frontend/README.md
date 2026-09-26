# WorldSeed frontend

App shell for WorldSeed: layout, design system, and the hero terrain visual on
real map tiles, running on **mock data**. Next.js (App Router) + TypeScript
(strict) + Tailwind v4, deck.gl + MapLibre GL, Zustand, Framer Motion, d3,
lucide-react. Everything is free / open source. No API keys are needed.

## Run

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (type-checks)
npm run lint
npm run typecheck
```

Requires Node 20+ (developed on Node 24). `predev` / `prebuild` copy MapLibre's
worker files into `public/maplibre/` (git-ignored); see
`scripts/copy-maplibre-worker.mjs` for why.

## Try it

1. Skip (or step through) the intro.
2. Click **Remove Key Bridge link** in the left panel. The hex terrain rises
   over Dundalk / Hawkins Point / Sollers Point / Curtis Bay, the camera flies
   in, the ribbon numbers roll, and the event log appends lines.
3. **Restore** sinks it back. `R` resets the world.

Keys: `P` presentation mode (hides panels), `R` reset, `Cmd/Ctrl-K` command
bar, `Esc` closes overlays. The map toolbar toggles the slow orbit.

## What is mock vs real

| Piece | Status |
| --- | --- |
| Map tiles (OpenFreeMap vector tiles, custom dark style in `lib/mapStyle.ts`) | Real |
| H3 res-9 hex grid (`h3-js`) | Real geometry |
| "Land" mask, response times, metrics, assumptions | **Mock**: `lib/sim/mock.ts` (seeded, deterministic, clearly not from the road network) |
| Runner label "Local (browser)" | Honest: the mock runs in your browser |
| Find a better future, futures panel, decision log | Placeholders |
| Time-of-day chip | Static |

## Swapping in real data

The UI talks only to the `Simulator` interface in `lib/sim/types.ts`
(`loadWorld()` returns cells + assumptions, `run(world, scenario)` returns
per-cell minutes + the five metrics). Implement it against the snapshot /
server runner and return it from `createSimulator()` in `lib/sim/index.ts`.
State lives in `lib/store.ts` (Zustand); the map animates whenever `revision`
changes.

## Design tokens

Defined in `app/globals.css` (`@theme`) as Tailwind theme values and CSS vars:
bg, surface, surface-2, border, text, muted, ok (teal), warn (amber), critical
(magenta), ai (blue, used only for the one primary button), future (violet).
Type scale 12/14/16/20/28/48/72, 12px card radius, numbers in JetBrains Mono
with tabular-nums (`.num`). Isolated zones are never color-only: they carry a
diagonal hatch on the map and in the legend.

## Notes

- Env keys, when they arrive, are read only from `process.env` on the server.
  Never use `NEXT_PUBLIC_` for keys.
- Attribution ("© OpenStreetMap contributors", OpenFreeMap, OpenMapTiles) is
  always visible in the footer.
- `prefers-reduced-motion`: no orbit, no fly-to, no stagger; the terrain
  crossfades over 400 ms and counters snap.

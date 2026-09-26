# Attributions (DRAFT)

Draft list of third-party data, libraries, fonts, and services used by WorldSeed.
License details marked "to verify" are pending legal review, which will supply
the exact required notice text. Do not treat this file as final.

## Data

| Source | Use | License / terms | Status |
|--------|-----|-----------------|--------|
| OpenStreetMap contributors | Road network and base geography | ODbL 1.0; attribution "(c) OpenStreetMap contributors" required | To verify: exact attribution wording and share-alike scope for derived data |
| US Census Bureau ACS | Demographics | US government work; public domain | To verify: exact citation text and vintage year |
| US Census Bureau TIGER/Line | Boundaries | US government work; public domain | To verify: exact citation text and vintage year |

## Map and visualization

| Component | Use | License | Status |
|-----------|-----|---------|--------|
| OpenFreeMap | Vector tile hosting / basemap | To verify (service terms and data attribution) | To verify |
| MapLibre GL JS | Map rendering | To verify (expected BSD-3-Clause) | To verify |
| deck.gl | Data layers | To verify (expected MIT) | To verify |
| H3 | Hexagonal spatial index | To verify (expected Apache-2.0) | To verify |

## Fonts

| Font | License | Status |
|------|---------|--------|
| Inter | SIL Open Font License 1.1 | To verify |
| JetBrains Mono | SIL Open Font License 1.1 | To verify |
| Space Grotesk | SIL Open Font License 1.1 | To verify |

## Icons

| Component | License | Status |
|-----------|---------|--------|
| Lucide | ISC | To verify |

## Services and models

| Service | Use | Terms | Status |
|---------|-----|-------|--------|
| NVIDIA Nemotron via Nebius Token Factory | Language model that proposes and explains interventions; it never produces a metric | To verify (model license and Token Factory terms) | To verify; exact model name pending availability check |
| Tavily | Web search for context | To verify (Tavily terms of service) | To verify |

## Notes for the legal review

- Confirm ODbL obligations for any derived road-network data shipped in the repo or demo.
- Confirm where attribution must be visible in the running app (map corner, about panel).
- Add exact license texts or links for each dependency once versions are pinned.

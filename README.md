# WorldSeed

**Don't predict the future. Simulate it.**

A counterfactual decision engine for infrastructure planners, built for the
Nebius x NVIDIA Global AI Hackathon. It models a real place (the Key Bridge
region of Baltimore), lets you change it, computes the consequences on the real
road network, and uses NVIDIA Nemotron on Nebius Token Factory to search for the
intervention that fixes it. Every number comes from the simulator; the language
model never produces a metric.

> In memory of the six construction workers lost when the Francis Scott Key
> Bridge collapsed on March 26, 2024. This is a planning tool, not live dispatch.

Status: under construction.

License: MIT

## Docs

- [Status board](docs/STATUS.md): what is done, in progress, next, blocked; submission checklist and key dates.
- [Feedback notes](docs/FEEDBACK_NOTES.md): running log for the Nebius / NVIDIA feedback the hackathon requires.
- [Attributions](docs/ATTRIBUTIONS.md): data, library, font, and service credits (draft, pending legal review).
- [Dedication](docs/DEDICATION.md): in memory of the six workers lost in the Key Bridge collapse.

Repo hygiene: run `scripts/check-repo-hygiene.sh` before pushing.

# Legal and compliance checklist

A risk read gathered 2026-09-26 from the published terms of each service (not legal advice).
Items marked UNVERIFIED could not be confirmed from a primary source.

## Rules that shape the product
1. **Wording.** The Nebius Token Factory terms forbid use in "high-risk AI systems" as defined by the
   EU AI Act, which lists emergency-dispatch systems. The Tavily terms bar unattended automated
   decisions in high-risk areas. WorldSeed is therefore always described as a counterfactual
   infrastructure-planning research prototype with a human in the loop. Never describe our own
   features with "dispatch", "triage", "prioritize responders", or "real-time". Modeling parameters
   use neutral names (for example "call-to-wheels delay").
   Sources: https://docs.tokenfactory.nebius.com/legal/terms-of-service, https://www.tavily.com/terms,
   https://artificialintelligenceact.eu/annex/3/
2. **OpenStreetMap data is ODbL.** The derived snapshot in `data/snapshot/` is a derivative
   database and is licensed ODbL 1.0, not MIT. Code stays MIT. Strip `user`, `uid` and `changeset`
   fields. Use Overpass at build time only, never from the running demo, with an identifying
   User-Agent and no parallel queries.
   Sources: https://opendatacommons.org/licenses/odbl/1-0/, https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
3. **Census data** is public domain. Cite the source in the form the Census Bureau asks for, label
   per-hex values as derived estimates, and never re-identify households. If the Census Data API is
   used, show: "This product uses the Census Bureau Data API but is not endorsed or certified by the
   Census Bureau." Source: https://www.census.gov/about/policies/citation.html
4. **Map attribution stays on.** Do not disable the MapLibre attribution control. Text:
   "(c) OpenStreetMap contributors, (c) OpenMapTiles, OpenFreeMap". Keep a fallback basemap ready
   because OpenFreeMap offers no availability promise.
5. **Token Factory.** Keys are server-side only (never `NEXT_PUBLIC_*`). The API accepts only
   structured scenario inputs and builds prompts on the server, with no raw chat proxy. Per-IP
   throttle plus a global daily spend cap. Footer links to the Token Factory terms and says that
   AI-generated text may be inaccurate.
6. **Tavily.** Server-side key, fixed query shape, throttled. Do not commit search results or article
   text. The demo must make a live Tavily call (required for the Best Use of Tavily prize); any
   fallback fixture is labeled "offline sample". Show title, source, link and a short snippet only.
   The user confirms before any closure enters the model.
7. **Hackathon rules.** The demo must be free, unrestricted, and working through 2026-12-15 12:00 PT
   (no login wall; credits, quotas and hosting must last). No changes to the submission after the
   deadline: tag `v1.0-submission` and pin the judged deployment to it. The demo must match the
   video and description. No collapse footage, no victim names or images, no third-party logos,
   no copyrighted music. The audio must cover how Token Factory and Nemotron were used.
8. **Vercel Hobby** is non-commercial. A free hackathon demo fits; no ads or paid tiers on the
   deployment. Whether a cash prize counts as financial gain is UNVERIFIED (low risk).
9. **Tone.** Keep the dedication short. No "lives saved" framing, no claims about the cause of the
   collapse or fault beyond cited NTSB findings.
10. **Fonts and icons.** Self-host fonts and ship each OFL text next to the font files; keep the
    Lucide (ISC) and Feather (MIT) notices; generate a THIRD_PARTY_LICENSES file from the build.

## Files that must exist before submission
- `NOTICE` (done) and README "Intended use and limitations" and "License" sections (done).
- `data/snapshot/LICENSE.md` with the ODbL notice, OSM date and bbox, Census citations, and a
  statement that contributor metadata was removed (owned by the pipeline task).
- In-app footer and first-run banner: "Planning simulation, not dispatch. Simulated times on
  historical open data. Not affiliated with any agency or hospital."
- Video and YouTube description credits: OSM/OpenFreeMap, plus the short disclaimer.

## Open verification items
- Exact license on the model card of each Nemotron model used (NOTICE line depends on it).
- Whether the hosted Tavily free quota lasts through Dec 15 at demo traffic.
- Vercel Hobby and prize money (optional support email).

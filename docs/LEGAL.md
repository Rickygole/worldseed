# Legal and compliance checklist

A risk read gathered 2026-09-26 from the published terms of each service (not legal advice).
Items marked UNVERIFIED could not be confirmed from a primary source.

## Rules that shape the product
1. **Wording.** The Nebius Token Factory terms forbid use in "high-risk AI systems" as defined by the
   EU AI Act, which lists emergency-dispatch systems. The Tavily terms bar unattended automated
   decisions in high-risk areas. WorldSeed is therefore always described as a counterfactual
   infrastructure-planning research prototype with a human in the loop. Never describe our own
   features with "dispatch", "triage", "prioritize responders", "real-time", "hazmat routing",
   "route guidance", "navigation", "traffic management", "safety-critical" or "compliance tool".
   Modeling parameters use neutral names (for example "call-to-wheels delay").
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
11. **Hazmat and freight framing** (second legal review, 2026-09-26). WorldSeed is an offline, retrospective planning
    simulation on a historical (2024) road network. It is not connected to, and must not be used as part of, any traffic
    management, traffic control, navigation, vehicle-routing or hazardous-materials compliance system. Hazmat results
    show how one published MDTA rule changes simulated travel times; they are not route guidance. Never write "hazmat
    routing", "route guidance", "navigation", "traffic management", "safety-critical" or "compliance tool" about our
    own features. Escorted hazmat windows are hypothetical, not an MDTA program: label each such option
    "(hypothetical; not an MDTA program)". The MDTA rule as published: vehicles carrying the listed hazardous materials
    are prohibited from the Fort McHenry Tunnel (I-95) and the Baltimore Harbor Tunnel (I-895), citing COMAR 11.07.01;
    the page mentions no escort, time window or permit and says nothing about the Key Bridge. MDTA's Key Bridge news
    page says tunnel-prohibited hazmat vehicles "should use the western section of I-695 around tunnels". Paraphrase and
    link; quote at most one sentence. "The bridge carried hazmat before the collapse" is an ASSUMPTION and stays labeled
    as one. Say "Both tunnels bar listed hazardous loads", not "prohibit hazmat loads". Freight panel disclaimer:
    "Simulation, not route guidance. Drive times are simulated at free-flow speeds on the pre-collapse (1 March 2024)
    road network. The tunnel rule is summarized from the Maryland Transportation Authority (link); the MDTA's published
    rules and COMAR 11.07.01 govern, not this tool. Carriers must follow posted and designated hazardous-materials
    routes. The escorted-window options are hypothetical: they are not an MDTA program, proposal or finding, and nothing
    here says they would be safe or lawful. Not affiliated with or endorsed by the MDTA."
    Sources: https://artificialintelligenceact.eu/annex/3/, https://mdta.maryland.gov/TunnelRestrictionsAndVehiclePermits,
    https://mdta.maryland.gov/keybridgenews
12. **No vendor performance disclosures.** Tavily's terms bar disclosing "any performance information or analysis
    relating to the Services" to third parties (https://www.tavily.com/terms): never publish Tavily latency, hit rates,
    relevance or behavior (including whether a parameter is honored); describe Tavily only by what it does. Nebius bars
    "competitive analysis or benchmarking" (https://docs.tokenfactory.nebius.com/legal/terms-of-service): Token Factory
    feedback reports only our own app's observations, never a comparison of models or providers, with N and dates, and
    goes in the Devpost feedback section; the README stays qualitative. Safe wording for any published count:
    "Observations from WorldSeed's own validators on our own requests (N = __ missions, __ to __ 2026). They describe
    how our app's schema and screens handled the replies we received, not the quality or performance of Token Factory
    or any model. This is not a benchmark or a comparison with any other model or provider."
13. **Raw model text.** The optional reasoning field is blanked if it contains denylisted words: profanity and slurs;
    fault or cause words (blame, fault, negligen*, guilty, killed, died, victim, the ship's name); and any proper name
    that is not a catalog, gazetteer or allowlisted place token. It stays collapsed by default. Label: "Model reasoning
    (raw, unverified; not a result). Written by an AI model and shown without human review. It may be wrong or
    inappropriate and is not the view of WorldSeed." About-dialog paragraph (also replaces the README "AI-generated
    text" paragraph): "Numbers, results and finalist cards are produced by the application from simulator results and
    catalog data. AI-written text appears only in the decision log: a labeled rationale choice, and an optional raw
    reasoning section shown without human review, which may be wrong or inappropriate and is not the view of WorldSeed.
    News-derived closure quotes are verbatim from their sources and unverified."
14. **Privacy notice** (About dialog and README). "WorldSeed has no accounts and sets no cookies. Your browser's session
    storage keeps a random session id and whether you have seen the intro. To enforce fair-use limits, the server keeps
    a salted hash of your IP address and session id in a counter store (Upstash) for at most about two days; WorldSeed
    does not store raw IP addresses. The host (Vercel) processes request data, including IP addresses, in its logs under
    its own privacy policy. If the bot check is on, Cloudflare Turnstile processes signals such as your IP address and
    browser details to detect bots. Text you type as a goal is sent to Nebius Token Factory to run the AI model, so do
    not enter personal information. Questions: open a GitHub issue." The retention figure must match the limiter TTLs
    (daily cap keys live 2 days); re-check when the limiter changes.

## Files that must exist before submission
- `NOTICE` (done) and README "Intended use and limitations" and "License" sections (done).
- `data/snapshot/LICENSE.md` with the ODbL notice, OSM date and bbox, Census citations, and a
  statement that contributor metadata was removed (owned by the pipeline task).
- In-app footer and first-run banner: "Planning simulation, not dispatch. Simulated times on
  historical open data. Not affiliated with any agency or hospital."
- Video and YouTube description credits: OSM/OpenFreeMap, plus the short disclaimer.

## Open verification items
- Exact license on the model card of each Nemotron model used: read 2026-09-26 (see `docs/ATTRIBUTIONS.md`); whether the copies Nebius serves carry the same terms is unverified.
- Builders-program eligibility: email Devpost support, ask in writing whether this submission is eligible, and keep the written answer. Unverified until answered.
- Promo-credit expiry: the billing docs say promo codes usually expire; record the real date when the code arrives. Unverified.
- Tavily plan and credits through 2026-12-15: whether the free quota lasts at demo traffic, and that pay-as-you-go is off. Unverified.
- Maryland Matters license and byline: both syndicated copies we read (2026-09-26) carry the byline Charlotte Kanner and Mira Beinart, Capital News Service, and neither names Maryland Matters, so the "Maryland Matters" credit used in drafts is unverified; the canonical URL was not confirmed (the original returned HTTP 403) and the republishing license is reported as CC BY-NC-ND 4.0 (unverified). See `docs/METHODOLOGY.md` section 6.1.
- Prize-combination reading (unverified against the rules page): one Overall or one Track award, plus at most one Bonus (Tavily, City Winner and Most Valuable Feedback are all Bonus). Re-read the rules before choosing what to enter.
- GitHub disables scheduled workflows in public repositories after 60 days without repository activity, so the health ping (`.github/workflows/health.yml`) may stop on its own; see `docs/CI.md`.
- Vercel Hobby and prize money (optional support email).

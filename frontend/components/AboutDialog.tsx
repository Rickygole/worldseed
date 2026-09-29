"use client";

import { METHODOLOGY_URL } from "@/lib/ui/methodology";

export const TOKEN_FACTORY_TERMS = "https://docs.tokenfactory.nebius.com/legal/terms-of-service";

/** The /about page body: intended use and limitations, AI text, privacy, sources, licenses and the dedication. */
export default function AboutContent() {
  return (
    <div className="space-y-4 text-sm leading-6 text-text-2">
      <p className="text-base leading-6 text-text">
        A counterfactual planning simulator for the Key Bridge region of Baltimore. Change the road network, and every number is
        recomputed on it, in your browser.
      </p>
      <div className="card p-4">
        <p className="font-medium">Planning simulation, not dispatch.</p>
        <p className="text-muted">Simulated times on historical open data. Not affiliated with any agency or hospital. In an emergency, call 911.</p>
      </div>

      <h3 className="label pt-2">Intended use and limitations</h3>
      <p>
        <strong className="font-medium">Intended use.</strong> WorldSeed is a research and educational prototype for exploring counterfactual
        infrastructure-planning scenarios. It is not an emergency dispatch, triage, routing, or operational decision system, and it must not
        be used to direct, prioritize, or delay any real emergency response. In an emergency, call 911.
      </p>
      <p>
        <strong className="font-medium">Simulated results.</strong> All travel times, coverage figures, and other metrics are outputs of a
        simplified simulation using historical, possibly incomplete or outdated open data (OpenStreetMap, U.S. Census Bureau). They are not
        measurements or predictions of real-world performance and do not reflect the actual capabilities, staffing, capacity, or protocols of
        any hospital, fire, EMS, or government agency.
      </p>
      <p>
        <strong className="font-medium">AI-generated text.</strong> Numbers, results and finalist cards are produced by the application from simulator results and catalog
        data. AI-written text appears only in the decision log: a labeled rationale choice, and an optional raw reasoning section shown without human review, which
        may be wrong or inappropriate and is not the view of WorldSeed. News-derived closure quotes are verbatim from their sources and unverified. All options are
        proposals for human review, not recommendations. AI-generated text may be inaccurate.
      </p>
      <p>
        <strong className="font-medium">Planning simulation, not route guidance.</strong> WorldSeed is an offline, retrospective planning simulation on a historical
        (2024) road network. It is not connected to, and must not be used as part of, any traffic control, vehicle-routing or hazardous-materials system. Hazmat
        results show how one published MDTA rule changes simulated travel times; they are not route guidance. Escorted hazmat windows are hypothetical, not an MDTA
        program.
      </p>
      <p>
        <strong className="font-medium">Privacy.</strong> WorldSeed has no accounts and sets no cookies. Your browser&apos;s session storage keeps a random session id and
        whether you have seen the intro. To enforce fair-use limits, the server keeps a salted hash of your IP address and session id in a counter store (Upstash) for
        at most about two days; WorldSeed does not store raw IP addresses. The host (Vercel) processes request data, including IP addresses, in its logs under its own
        privacy policy. If the bot check is on, Cloudflare Turnstile processes signals such as your IP address and browser details to detect bots. Text you type as a
        goal is sent to Nebius Token Factory to run the AI model, so do not enter personal information. Questions: open a GitHub issue.
      </p>
      <p>
        <strong className="font-medium">No affiliation.</strong> Names of hospitals, stations, and agencies identify real-world locations only.
        WorldSeed is not affiliated with, endorsed by, or produced in cooperation with any of them, the State of Maryland, Baltimore City or
        County, the U.S. Census Bureau, the NTSB, or the OpenStreetMap Foundation.
      </p>
      <p>
        <strong className="font-medium">No warranty.</strong> Provided &quot;as is&quot;, without warranty of any kind, under MIT (code) and ODbL 1.0 (data snapshot); see Licenses below.
      </p>

      <h3 className="label pt-2">Data sources and services</h3>
      <ul className="list-disc space-y-1 pl-5 text-muted">
        <li>
          Road network, facilities and place names: 
          <a className="underline decoration-border underline-offset-2 hover:text-text" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            &copy; OpenStreetMap contributors
          </a>
          , Open Database License (ODbL) 1.0, as of 1 March 2024.
        </li>
        <li>
          Map tiles: 
          <a className="underline decoration-border underline-offset-2 hover:text-text" href="https://openfreemap.org" target="_blank" rel="noreferrer">
            OpenFreeMap
          </a> 
          <a className="underline decoration-border underline-offset-2 hover:text-text" href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">
            &copy; OpenMapTiles
          </a> 
          Data from OpenStreetMap.
        </li>
        <li>
          U.S. Census Bureau: American Community Survey 5-year estimates (population, vehicles; obtained via the Census Reporter mirror), TIGER/Line
          boundaries, and LEHD LODES (jobs, low-wage workers). Per-hexagon values are derived estimates.
        </li>
        <li>
          Fire station and hospital locations: MD iMAP (State of Maryland). Source credits: MD iMAP, DoIT, MCAC, MSFA (fire stations); MD iMAP, DHMH
          OHCQ (hospitals).
        </li>
        <li>
          AI: NVIDIA Nemotron via Nebius Token Factory (
          <a className="underline decoration-border underline-offset-2 hover:text-text" href={TOKEN_FACTORY_TERMS} target="_blank" rel="noreferrer">
            terms
          </a>
          ). Search: Tavily.
        </li>
        <li>
          Hazardous-materials tunnel rule: Maryland Transportation Authority,{" "}
          <a className="underline decoration-border underline-offset-2 hover:text-text" href="https://mdta.maryland.gov/TunnelRestrictionsAndVehiclePermits" target="_blank" rel="noreferrer">
            Transporting Hazardous Materials Across Our Toll Facilities
          </a>{" "}
          and{" "}
          <a className="underline decoration-border underline-offset-2 hover:text-text" href="https://mdta.maryland.gov/keybridgenews" target="_blank" rel="noreferrer">
            Key Bridge news
          </a>
          , accessed 26 September 2026. Cited and linked, not affiliated.
        </li>
        <li>Reported commute: Capital News Service (via Baltimore Fishbowl), 28 March 2025.</li>
      </ul>
      <p className="text-muted">
        WorldSeed is not affiliated with or endorsed by the OpenStreetMap Foundation, OpenFreeMap, OpenMapTiles, the U.S. Census Bureau, the State of
        Maryland, the Maryland Transportation Authority (MDTA), the NTSB, NVIDIA, Nebius, Tavily, or any agency, hospital, fire company or EMS provider.
      </p>

      <p className="text-muted">
        How the model works, what held up under sensitivity tests, and where it falls short:{" "}
        <a className="underline decoration-border underline-offset-2 hover:text-text" href={METHODOLOGY_URL} target="_blank" rel="noreferrer">
          Methodology
        </a>
        .
      </p>

      <h3 className="label pt-2">Licenses</h3>
      <ul className="list-disc space-y-1 pl-5 text-muted">
        <li>
          Source code: MIT (
          <a className="underline decoration-border underline-offset-2 hover:text-text" href="https://github.com/Rickygole/worldseed/blob/main/LICENSE" target="_blank" rel="noreferrer">
            LICENSE
          </a>
          ).
        </li>
        <li>
          Data snapshot (data/snapshot): Open Database License 1.0, derived from OpenStreetMap (
          <a className="underline decoration-border underline-offset-2 hover:text-text" href="https://github.com/Rickygole/worldseed/blob/main/data/snapshot/LICENSE.md" target="_blank" rel="noreferrer">
            data/snapshot/LICENSE.md
          </a>
          ).
        </li>
        <li>
          Third-party software, fonts and icons (
          <a className="underline decoration-border underline-offset-2 hover:text-text" href="https://github.com/Rickygole/worldseed/blob/main/THIRD_PARTY_LICENSES.md" target="_blank" rel="noreferrer">
            THIRD_PARTY_LICENSES.md
          </a>
          ).
        </li>
      </ul>

      <p className="border-t border-border pt-4 text-muted">
        In memory of the six construction workers lost when the Francis Scott Key Bridge collapsed on March 26, 2024.
      </p>
    </div>
  );
}

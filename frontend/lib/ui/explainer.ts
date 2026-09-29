/**
 * "What this shows": fixed sentence templates whose numbers are slots filled from the simulator result.
 * Nothing in here is a typed-in figure. Which template is used can depend on the computed values (for
 * example "unchanged" versus "changes"), never the other way around.
 */
import { fmtCount, fmtDurText, fmtMin, fmtPct1 } from "../format";
import type { Scenario, SimOutput } from "../sim/types";
import type { TripsResult } from "../sim/trips";
import { blockGroupAt, placesFor, type AuxIndex } from "./snapshotAux";
import { ribbonValues } from "./ribbon";
import { CONGESTED_MEDIAN_ADDED_S, fmtAbout, LOWER_BOUND_SENTENCE, MEAN_ADDED_RANGE_S, PEOPLE_GT10_RANGE } from "./methodology";

/** A number slot: rendered in the mono face, optionally toned. */
export interface Num {
  n: string;
  tone?: "bad" | "good";
}
export type Seg = string | Num;

export interface Para {
  id: "regional" | "xharbor" | "where" | "equity" | "ems" | "baseline" | "next" | "bound" | "firm" | "freight";
  /** Link shown after the paragraph (a documented source, never a result). */
  link?: { href: string; text: string };
  heading: string;
  segs: Seg[];
  /** Short form shown when the section is folded (defaults to its first number). */
  summary?: string;
}

const num = (n: string, tone?: Num["tone"]): Num => ({ n, tone });

/** "a, b and c" */
function list(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

export interface ExplainInput {
  baseline: SimOutput;
  current: SimOutput;
  scenario: Scenario;
  aux: AuxIndex | null;
  /** Model parameters (seconds / minutes) from the snapshot. */
  params: { emsThresholdS: number; call_to_wheels_delay_min: number } | null;
  /** Freight and hazmat trips in the current world (runTrips); null when the snapshot has none. */
  trips?: TripsResult | null;
}

export function explain({ baseline, current, scenario, aux, params, trips }: ExplainInput): Para[] {
  const b = ribbonValues(baseline);
  const c = ribbonValues(current);
  const xd = current.detail?.xharbor;
  if (!b || !c) return [];
  const changed = scenario.removedLinks.length > 0 || (scenario.mutations?.length ?? 0) > 0;
  const onlyBridge = scenario.removedLinks.length === 1 && scenario.removedLinks[0] === "key_bridge" && !(scenario.mutations?.length);
  const thresholdMin = params ? params.emsThresholdS / 60 : null;

  if (!changed) {
    const jobs = xd?.headline.baselineMeanJobs ?? current.detail?.xharbor?.headline.worldMeanJobs;
    const out: Para[] = [];
    if (jobs !== undefined) {
      out.push({
        id: "baseline",
        heading: "Baseline",
        segs: [
          "With the Key Bridge in place, a resident can reach on average ",
          num(fmtCount(jobs)),
          " jobs on the other shore of the Patapsco within 30 minutes of free-flow driving.",
        ],
      });
    }
    out.push({
      id: "ems",
      heading: "First response",
      segs: [
        "90% of residents are within ",
        num(`${fmtMin(b.v.ems / 60)} min`),
        " of a fire or EMS station in the simulation",
        ...(params ? [", including a ", num(`${fmtMin(params.call_to_wheels_delay_min)} min`), " call-processing and turnout delay."] : ["."]),
      ],
    });
    out.push({
      id: "next",
      heading: "Try it",
      segs: ["Remove the Key Bridge link. Every number on this screen is then recomputed on the road network, in your browser."],
    });
    return out;
  }

  const subject = onlyBridge ? "Removing the bridge" : "This scenario";
  const out: Para[] = [];

  // 1. The regional average: small, and said first so it is never hidden.
  const dReg = c.v.regional - b.v.regional;
  out.push({
    id: "regional",
    heading: "Across the region",
    segs: [
      dReg < -0.5 ? `${subject} saves ` : `${subject} adds `,
      num(fmtDurText(Math.abs(dReg)), dReg < -0.5 ? "good" : undefined),
      onlyBridge
        ? " on average to a resident's drive to the region's main job centers, at free-flow speeds. Most trips in the region do not use the bridge."
        : " on average to a resident's drive to the region's main job centers, at free-flow speeds.",
    ],
  });

  // 2. Cross-harbor: where the bridge mattered.
  out.push({
    id: "xharbor",
    heading: "Across the river",
    segs: [
      "About ",
      num(fmtAbout(c.v.xhPeople), c.v.xhPeople > b.v.xhPeople ? "bad" : undefined),
      " residents reach more than 10% fewer of the jobs across the river within 30 minutes; about ",
      num(fmtAbout(c.x.xhPeopleGt25), c.x.xhPeopleGt25 > b.x.xhPeopleGt25 ? "bad" : undefined),
      " reach more than 25% fewer.",
    ],
  });

  // 2a. Freight and hazmat trips: point-to-point, the largest effect in minutes.
  const car = trips?.summary.car;
  const hz = trips?.summary.hazmat_truck;
  if (car && hz) {
    const mechanism = onlyBridge && hz.crossHarborMeanAddedMinutes > car.crossHarborMeanAddedMinutes + 0.5;
    out.push({
      id: "freight",
      heading: "Freight and hazmat trips",
      summary: `hazmat +${fmtMin(hz.crossHarborMeanAddedMinutes)} min`,
      segs: [
        `Across ${hz.crossHarborTrips} cross-harbor trips between real road anchors, a car adds `,
        num(`${fmtMin(car.crossHarborMeanAddedMinutes)} min`, car.crossHarborMeanAddedMinutes > 0.5 ? "bad" : undefined),
        " on average and a truck carrying tunnel-prohibited hazardous materials adds ",
        num(`${fmtMin(hz.crossHarborMeanAddedMinutes)} min`, hz.crossHarborMeanAddedMinutes > 0.5 ? "bad" : undefined),
        ` (${hz.crossHarborOver5Min} of ${hz.crossHarborTrips} hazmat trips add more than 5 min, free-flow). `,
        mechanism ? "Hazmat vehicles are prohibited in both Baltimore tunnels, so with the bridge closed they must use the western Beltway arc." : "",
      ],
      link: mechanism ? { href: "https://mdta.maryland.gov/TunnelRestrictionsAndVehiclePermits", text: "MDTA rule (accessed 26 September 2026)" } : undefined,
    });
  }

  // 2b. How firm those counts are (documented sensitivity study; shown with its source).
  out.push({
    id: "firm",
    heading: "How firm these numbers are",
    summary: "counts vary; times stable",
    segs: onlyBridge
      ? [
          `The counts depend on speed and time-budget assumptions: about ${fmtAbout(PEOPLE_GT10_RANGE.lo)} to ${fmtAbout(PEOPLE_GT10_RANGE.hi)} residents across the variants tested. The time-based measures are stable: the average added cross-harbor time stays between about ${Math.round(MEAN_ADDED_RANGE_S.lo)} and ${Math.round(MEAN_ADDED_RANGE_S.hi)} s. The typical resident is unaffected at free-flow, but not if the tunnels congest after the closure (median added time then about ${Math.round(CONGESTED_MEDIAN_ADDED_S.lo)} to ${Math.round(CONGESTED_MEDIAN_ADDED_S.hi)} s).`,
        ]
      : ["The counts depend on speed and time-budget assumptions; the time-based measures are the steadier guide."],
    link: { href: "https://github.com/Rickygole/worldseed/blob/main/docs/METHODOLOGY.md", text: "Methodology" },
  });

  // 3. Where: the worst block groups, named by the OSM places their hexes fall in.
  const worst = (xd?.worstBlockGroups.byLossPct ?? []).filter((w) => w.meanLossPct > 25);
  if (worst.length > 0) {
    const lo = Math.min(...worst.map((w) => w.meanLossPct));
    const hi = Math.max(...worst.map((w) => w.meanLossPct));
    let where: string;
    if (aux) {
      const hexes = worst.flatMap((w) => blockGroupAt(aux, w.bg)?.hexes ?? []);
      const names = placesFor(aux, hexes).slice(0, 3);
      where = names.length > 0 ? `around ${list(names)}` : "";
    } else {
      where = "";
    }
    out.push({
      id: "where",
      heading: "Where",
      segs: [
        `The ${worst.length === 1 ? "hardest-hit block group" : `${worst.length} hardest-hit block groups`}${where ? ` lie ${where}` : ""}. `,
        worst.length === 1 ? "It reaches " : "They reach ",
        num(lo === hi ? `${Math.round(hi)}%` : `${Math.round(lo)}-${Math.round(hi)}%`, "bad"),
        " fewer of those jobs. Where people live, the hardest-hit hexagon adds ",
        num(`${fmtMin(c.x.xhAddedMaxPopS / 60)} min`, "bad"),
        " to its average cross-harbor trip; the worst-off 1% of residents add at least ",
        num(`${fmtMin(c.x.xhAddedP99S / 60)} min`, "bad"),
        ".",
      ],
    });
  }

  // 4. First response: the resilience check.
  const dEms = c.v.ems - b.v.ems;
  const dWithin = c.x.emsPctWithin - b.x.emsPctWithin;
  const emsSame = Math.abs(dEms) < 1 && Math.abs(dWithin) < 0.05;
  out.push({
    id: "ems",
    heading: "First response",
    summary: emsSame ? "unchanged" : `${fmtMin(b.v.ems / 60)} -> ${fmtMin(c.v.ems / 60)} min`,
    segs: emsSame
      ? [
          "Unchanged. The simulated p90 stays at ",
          num(`${fmtMin(c.v.ems / 60)} min`, "good"),
          thresholdMin !== null ? ` and the share of residents within ${fmtMin(thresholdMin)} min stays at ` : "",
          ...(thresholdMin !== null ? [num(`${fmtPct1(c.x.emsPctWithin)}%`)] : []),
          ". Both shores have their own fire and EMS stations.",
        ]
      : [
          "The simulated p90 moves from ",
          num(`${fmtMin(b.v.ems / 60)} min`),
          " to ",
          num(`${fmtMin(c.v.ems / 60)} min`, dEms > 0 ? "bad" : "good"),
          ".",
        ],
  });

  // 5. Equity: low-wage workers versus everyone, whichever way it falls.
  const lw = c.x.lowWageSharePct;
  const all = c.x.peopleSharePct;
  const gap = lw - all;
  const verdict =
    Math.abs(gap) < 0.25
      ? " The loss falls on them about as often as on everyone else."
      : gap > 0
        ? " They are hit more often than residents overall."
        : " They are hit less often than residents overall.";
  out.push({
    id: "equity",
    heading: "Low-wage workers",
    segs: [
      num(`${fmtPct1(lw)}%`),
      " of low-wage workers reach more than 10% fewer jobs across the river, compared with ",
      num(`${fmtPct1(all)}%`),
      ` of all residents.${verdict}`,
    ],
  });

  // 6. What free-flow cannot see.
  out.push({
    id: "bound",
    heading: "Free-flow is a lower bound",
    summary: "see why",
    segs: [LOWER_BOUND_SENTENCE],
    link: { href: "https://github.com/Rickygole/worldseed/blob/main/docs/METHODOLOGY.md", text: "Methodology (sources)" },
  });

  return out;
}

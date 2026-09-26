/**
 * "What this shows": fixed sentence templates whose numbers are slots filled from the simulator result.
 * Nothing in here is a typed-in figure. Which template is used can depend on the computed values (for
 * example "unchanged" versus "changes"), never the other way around.
 */
import { fmtCount, fmtDurText, fmtMin, fmtPct1 } from "../format";
import type { Scenario, SimOutput } from "../sim/types";
import { blockGroupAt, placesFor, type AuxIndex } from "./snapshotAux";
import { ribbonValues } from "./ribbon";

/** A number slot: rendered in the mono face, optionally toned. */
export interface Num {
  n: string;
  tone?: "bad" | "good";
}
export type Seg = string | Num;

export interface Para {
  id: "regional" | "xharbor" | "where" | "equity" | "ems" | "baseline" | "next";
  heading: string;
  segs: Seg[];
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
}

export function explain({ baseline, current, scenario, aux, params }: ExplainInput): Para[] {
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
      `${subject} adds `,
      num(fmtDurText(dReg)),
      onlyBridge
        ? " on average to a resident's drive to the region's main job centers. Most trips in the region do not use the bridge."
        : " on average to a resident's drive to the region's main job centers.",
    ],
  });

  // 2. Cross-harbor: where the bridge mattered.
  out.push({
    id: "xharbor",
    heading: "Across the harbor",
    segs: [
      num(fmtCount(c.v.xhPeople), c.v.xhPeople > b.v.xhPeople ? "bad" : undefined),
      " residents lose more than 10% of the jobs on the other shore they could reach within 30 minutes; ",
      num(fmtCount(c.x.xhPeopleGt25), c.x.xhPeopleGt25 > b.x.xhPeopleGt25 ? "bad" : undefined),
      " lose more than 25%.",
    ],
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
        worst.length === 1 ? "It loses " : "They lose ",
        num(lo === hi ? `${Math.round(hi)}%` : `${Math.round(lo)}-${Math.round(hi)}%`, "bad"),
        " of those jobs. The worst-off 1% of residents add at least ",
        num(`${fmtMin(c.x.xhAddedP99S / 60)} min`, "bad"),
        " to their average cross-harbor trip.",
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
      " of low-wage workers lose more than 10% of their cross-harbor jobs, compared with ",
      num(`${fmtPct1(all)}%`),
      ` of all residents.${verdict}`,
    ],
  });

  return out;
}

/**
 * Story copy, transcribed from docs/STORY.md (plain-language and legal pass). Words only: every figure is a
 * {{slot}} filled from the simulator (or, for "study" slots, from the documented sensitivity study, shown only
 * in the exact Key Bridge-removed reference world) by lib/ui/storyFigures.ts.
 *
 * Owner rules for the default path (2026-09-26) win where STORY.md differs: one number, one sentence, one
 * button per scene; detail behind "How do we know?"; sentences at grade 9 or below (test/ui/readability.test.ts).
 */
import type { SceneId } from "./mapDirector";
import { REPORTED_DETOUR_ARTICLE } from "./methodology";
import { MIN_PER_SEC } from "../../components/map/trailModel";

export interface CaveatCopy {
  id: string;
  /** Section label (Expert mode chips). */
  label: string;
  /** Section heading in "How do we know?". */
  title: string;
  body: string;
  /** Small source line under the body. */
  source?: string;
  link?: { href: string; text: string };
  /** A second link (e.g. the MDTA alternate-route page). */
  link2?: { href: string; text: string };
  /** Real sources, shown as clickable cards (title, publisher, domain, date). */
  sources?: SourceRef[];
  /** One small real visual computed from the simulator or the study. */
  visual?: CaveatVisual;
}

export interface SourceRef {
  title: string;
  publisher: string;
  date?: string;
  href: string;
  /** A short label under the title ("Unverified news report", "Official rule page"). */
  kind: string;
}

export type CaveatVisual =
  /** Where the on-screen count sits inside the tested range (log scale: the range spans an order of magnitude). */
  | { kind: "range"; lo: number; hi: number; value: number; loLabel: string; hiLabel: string; valueLabel: string }
  /** The spread of a finalist's change versus doing nothing across the what-if runs (futuresMath ridge). */
  | { kind: "ridge"; values: number[]; unit: "s"; caption: string };

export const MDTA_URL = "https://mdta.maryland.gov/TunnelRestrictionsAndVehiclePermits";
export const MDTA_NEWS_URL = "https://mdta.maryland.gov/keybridgenews";
export const METHODOLOGY_DOC = "https://github.com/Rickygole/worldseed/blob/main/docs/METHODOLOGY.md";
export const MDTA_ACCESSED = "26 September 2026";
/** privacy.retentionDays: must equal the limiter's daily-cap key TTL (2 * DAY_MS in lib/server/ratelimit.ts; checked by test/ui/story.test.ts). */
export const PRIVACY_RETENTION_DAYS = 2;

/** STORY.md section 4 (owner rule: one sentence, one button; Escape skips). */
export const INTRO = {
  dedication: "In memory of the six construction workers who died when the Key Bridge fell, March 26, 2024.",
  sentence: "See who is affected if the bridge is removed.",
  primary: "Start the walk-through",
};

export const HOW = "How do we know?";
export const SIMULATED = "Simulated";

/** Legal review 2, exact wording (freight panel). */
export const FREIGHT_DISCLAIMER =
  "Simulation, not route guidance. Drive times are simulated at free-flow speeds on the pre-collapse (1 March 2024) road network. The tunnel rule is summarized from the Maryland Transportation Authority (link); the MDTA's published rules and COMAR 11.07.01 govern, not this tool. Carriers must follow posted and designated hazardous-materials routes. The escorted-window options are hypothetical: they are not an MDTA program, proposal or finding, and nothing here says they would be safe or lawful. Not affiliated with or endorsed by the MDTA.";

/** Story-bar labels and card headlines (STORY.md section 2). Keyed by the map director's scene ids. */
export const STEPS: Record<Exclude<SceneId, "intro">, string> = {
  crossing: "The bridge",
  averages: "The local story",
  held: "What held",
  freight: "Dangerous cargo",
  fix: "What could help",
  explore: "Explore",
};

export const HEADLINES: Record<Exclude<SceneId, "intro">, string> = {
  crossing: "The crossing is removed",
  averages: "Averages hide the local story",
  held: "What did not break",
  freight: "Tunnel rules change the trip",
  fix: "What could help?",
  explore: "Now explore",
};

/** Sentences, captions and actions (STORY.md section 5); conditional variants from section 14. */
export const T = {
  crossing: {
    unit: "seconds",
    caption: "Extra drive time, across the whole region",
    before: "Remove the Key Bridge from the map to see what changes.",
    alreadyRemoved: "The Key Bridge is removed. Restore it in Expert mode to compare.",
    // Coordinator decision F: "since most trips skip the bridge" is not a computed slot, so it is not said.
    afterLonger: "On average, a drive to jobs in the region gets only {{regionalAdded}} longer.",
    afterShorter: "In this scenario, the average drive to jobs gets {{regionalAdded}} shorter.",
    afterNone: "In this scenario, the average drive to jobs hardly changes.",
    action: "Remove the Key Bridge",
  },
  averages: {
    unit: "people",
    caption: "Reach over {{lossPct}}% fewer jobs across the river",
    // The headline already says "Averages hide the local story"; the sentence does not repeat it.
    sentence: "The worst-hit spots are near {{worstArea}}.",
    sentenceMost: "Most of the worst-hit spots are near {{worstArea}}.",
    none: "In this scenario, no spot is hit hard.",
    noPlace: "Some spots are hit much harder than others.",
    rangeChip: "About {{lo}} to {{hi}}, depending on assumptions",
    rangeNotTested: "Range not tested for this scenario",
    action: "Show me where",
  },
  held: {
    unit: "minutes",
    caption: "To a station, for {{emsPct}}% of people",
    both: "Both sides of the river have fire stations, so the time to the nearest one did not change.",
    unchanged: "The time to the nearest station is unchanged in this scenario.",
    moved: "In this scenario, the time to the nearest station moves from {{emsBefore}} to {{emsAfter}} minutes.",
    chipUnchanged: "Unchanged from before",
    chipHigher: "Higher",
    chipLower: "Lower",
    action: "Show both sides",
  },
  freight: {
    unit: "minutes",
    caption: "Extra per trip; cars add {{carAdded}}",
    detour: "Both tunnels bar listed hazardous loads, so in the model those trucks take much longer.",
    plain: "In the model, these trucks add {{hazmatAdded}} per river trip, and cars add {{carAdded}}.",
    note: "Escort options in Expert mode are made-up examples, not an MDTA program.",
    action: "Show the detour",
    unavailable: "Trips with dangerous cargo are not in this data snapshot.",
  },
  fix: {
    readyUnit: "what-if ideas",
    ready: "Test each one in many what-if runs and see which ones help most.",
    searchUnit: "what-if runs done",
    searching: "Testing each idea in many what-if runs.",
    screenUnit: "ideas checked",
    screening: "First, every mix of ideas gets one quick run.",
    progress: "{{done}} of {{total}} futures completed",
    recoveredUnit: "%",
    caption: "Of the lost access to jobs won back",
    helps: "The best idea we tried helps, but it does not undo the loss.",
    wouldHelp: "The best idea we tried would help, but it would not undo the loss.",
    chosenHelps: "The idea you chose helps, but it does not undo the loss.",
    undoes: "The best idea we tried undoes the loss on this measure, but {{residual}} people are still affected.",
    noHelp: "The best idea we tried does not help on this measure.",
    zero: "In this run, the best idea we tried leaves no one affected.",
    stillAffected: "Still affected: {{residual}} people",
    computing: "Working out what the best idea would change.",
    stopped: "Search stopped at {{done}} futures. Start it again to see the best ideas.",
    gate: "This scene needs the Key Bridge removed.",
    deterministic: "Deterministic search (no AI): the same steps every time",
    ai: "AI planner: {{model}}",
    actionReady: "Find a better future",
    actionSearching: "Stop search",
    actionFinalists: "Apply the best idea",
    actionApplied: "Continue",
  },
  stress: {
    eyebrow: "Stress test",
    title: "What if the {{link}} closes too?",
    keeps: "The idea keeps about {{pct}}% of its benefit with the {{link}} also closed.",
    more: "The idea matters more when the {{link}} also closes: it spares about {{stressed}} people, against about {{normal}} with the tunnel open.",
    moreUnit: "fewer people affected with both closed",
    keepsUnit: "of its benefit kept",
    lost: "With the {{link}} also closed, the idea no longer helps on this measure.",
    detail: "People affected with both closed: about {{without}} without the idea, about {{with}} with it.",
    method: "Simulated, free flow, one run per world. The search runs this kind of attack on every leading idea; the full log is in Expert mode.",
    running: "Testing the idea with the {{link}} also closed.",
    dismiss: "Dismiss the stress test",
    open: "See the search's stress tests",
  },
  explore: {
    unit: "people",
    caption: "Affected, as the map shows now",
    sentence: "Now it is your turn. Each tile opens one tool in expert mode.",
    action: "Open expert mode",
  },
  common: {
    next: "Next",
    back: "Back",
    notAvailable: "Not available for this scenario.",
    gateAction: "Remove the Key Bridge",
    loading: "Loading the map, roads, people and jobs as of {{snapshotDate}}. This runs in your browser.",
    loadingNoDate: "Loading the map, roads, people and jobs. This runs in your browser.",
    computing: "Recalculating in your browser.",
    failed: "The map data did not load. Check your connection, then try again.",
    retry: "Retry",
  },
};

/** "How do we know?" sections (STORY.md popovers). Study slots only resolve in the reference world. */
export const CAVEATS = {
  lowerBoundStudy: {
    id: "lowerBound",
    label: "Is this too small?",
    title: "Is this too small?",
    body: "Free-flow: no traffic jams, so delays can be larger. Capital News Service (via Baltimore Fishbowl) reported a Dundalk to Ferndale commute rising from about {{before}} to {{after}} minutes. The model adds about {{modelAdded}} minutes, or {{bothTunnels}} with both tunnels closed.",
    source: "The model comparison is from our sensitivity study (Methodology, section 6.1).",
    link: { href: METHODOLOGY_DOC, text: "Methodology" },
    sources: [
      {
        title: REPORTED_DETOUR_ARTICLE.title,
        publisher: REPORTED_DETOUR_ARTICLE.publisher,
        date: REPORTED_DETOUR_ARTICLE.date,
        href: REPORTED_DETOUR_ARTICLE.url,
        kind: "News report (unverified; one clause cited)",
      },
    ],
  },
  lowerBound: {
    id: "lowerBound",
    label: "Is this too small?",
    title: "Is this too small?",
    body: "Free-flow means no traffic jams, so real delays can be larger.",
    link: { href: METHODOLOGY_DOC, text: "Methodology" },
  },
  heldMapKey: {
    id: "heldMapKey",
    label: "Reading the map",
    title: "Reading the map",
    body: "In this scene the map shows the change in the time to the nearest station. A flat, calm map means nothing changed.",
  },
  routeKey: {
    id: "routeKey",
    label: "Reading the map",
    title: "Reading the map",
    body: `The white line is the car route and the amber line is the route for a truck with a dangerous load. The moving trails are sped up: 1 second on screen is ${MIN_PER_SEC} minutes of driving.`,
  },
  range: {
    id: "range",
    label: "Why such a wide range?",
    title: "Why such a wide range?",
    body: "Move every driving speed {{speedPct}}% up or down and the count swings from about {{lo}} to about {{hi}}. The extra drive time and the worst-hit areas change much less.",
    source: "From our sensitivity study, on the Key Bridge-removed world only.",
    link: { href: METHODOLOGY_DOC, text: "Methodology" },
  },
  rangeNotTested: {
    id: "range",
    label: "Range not tested",
    title: "Range not tested for this scenario",
    body: "Range not tested for this scenario. Treat this count as sensitive to assumptions.",
    link: { href: METHODOLOGY_DOC, text: "Methodology" },
  },
  fastVariant: {
    id: "fast",
    label: "Quick method",
    title: "A quick method",
    body: "The app uses a quick way to estimate this count. It is within about {{defaultPct}}% of the slower exact method. When searching for ideas it uses a rougher setting, off by about {{futLo}} to {{futHi}}%.",
    source: "From our sensitivity study.",
    link: { href: METHODOLOGY_DOC, text: "Methodology" },
  },
  places: {
    id: "places",
    label: "Spots and names",
    title: "Spots and names",
    body: "Spots are Census block groups, small areas used for Census counts. Place names are the nearest known place, not official borders.",
  },
  worstSpots: {
    id: "worstSpots",
    label: "How bad in the worst spots",
    title: "How bad in the worst spots",
    body: "In the worst-hit spots, people can reach {{worstLossRange}} fewer jobs across the river. Reach means a drive of {{budgetMin}} minutes or less, with no traffic jams.",
  },
  emsLens: {
    id: "emsLens",
    label: "What is measured",
    title: "What is measured",
    body: '"First response" here means the time to the nearest of {{fire}} fire stations and {{ambulance}} ambulance stations, plus a {{delay}}-minute delay to get moving. It ignores staffing, hospital transport and how many calls come in.',
  },
  emsUnchanged: {
    id: "emsUnchanged",
    label: "What unchanged means",
    title: "What unchanged means",
    body: "Unchanged means this scenario does not change nearest-station times in the model. It does not say emergency response is good enough. It leaves out stations outside the study area.",
  },
  emsChanged: {
    id: "emsUnchanged",
    label: "What changed",
    title: "What changed",
    body: "In this scenario, the time to the nearest station changed in the model. It does not say emergency response is good enough. It leaves out stations outside the study area.",
  },
  hazmatWhat: {
    id: "hazmatWhat",
    label: 'What "listed hazardous loads" means',
    title: 'What "listed hazardous loads" means',
    body: "Both tunnels bar trucks carrying certain hazardous materials (like some fuels and chemicals). This summarizes a Maryland Transportation Authority (MDTA) rule; its published rules govern, not this tool. Not every truck carries them.",
  },
  notGuidance: {
    id: "notGuidance",
    label: "Simulation, not route guidance",
    title: "Simulation, not route guidance",
    body: "Simulation, not route guidance. Drive times are simulated at free-flow speeds on the pre-collapse ({{snapshotDate}}) road network. Carriers must follow posted and designated hazardous-materials routes. Not affiliated with or endorsed by the MDTA.",
    sources: [
      { title: "Transporting Hazardous Materials Across Our Toll Facilities", publisher: "Maryland Transportation Authority", date: `accessed ${MDTA_ACCESSED}`, href: MDTA_URL, kind: "The tunnel rule" },
      { title: "Key Bridge news: the alternate route for tunnel-prohibited loads", publisher: "Maryland Transportation Authority", date: `accessed ${MDTA_ACCESSED}`, href: MDTA_NEWS_URL, kind: "The alternate route" },
    ],
  },
  hazmatAssumption: {
    id: "hazmatAssumption",
    label: "Assumption and detour",
    title: "Assumption and detour",
    body: "In the model, the Key Bridge carried these trucks: an assumption, since the MDTA tunnel rule does not cover the bridge. Without the bridge, in the model they take the western I-695 arc, MDTA's named alternate route.",
  },
  hazmatAssumptionNoRoute: {
    id: "hazmatAssumption",
    label: "Assumption",
    title: "Assumption",
    body: "In the model, the Key Bridge carried these trucks: an assumption, since the MDTA tunnel rule does not cover the bridge.",
  },
  escorts: {
    id: "escorts",
    label: "Escort options",
    title: "Escort options",
    body: "The escort options in Expert mode are made-up examples. They are not an MDTA program, proposal or finding, and nothing here says they would be safe or lawful.",
  },
  speedFactors: {
    id: "speedFactors",
    label: "Assumed speed factors",
    title: "Assumed speed factors",
    body: "Every idea's effect is an assumption, not an agency finding. For example, some ideas make a road faster by an assumed amount. The share won back is only as reliable as those assumptions.",
  },
  hypothetical: {
    id: "hypothetical",
    label: "What-if ideas",
    title: "What-if ideas",
    // The "about four help" sentence is left out on the coordinator's instruction (no generated slot backs it).
    body: "All {{catalogCount}} ideas are what-ifs. No agency proposed, studied or backed them. Costs are rough levels, not dollar amounts.",
  },
  measure: {
    id: "measure",
    label: "What is won back",
    title: "What is won back",
    body: "Measure: people who reach over {{lossPct}}% fewer jobs across the river within {{budgetMin}} minutes, about {{before}} without the idea. Simulated in the world with the idea applied.",
  },
  goal: {
    id: "goal",
    label: "The goal",
    title: "The goal of the search",
    body: "Keep the slowest trips across the river within {{target}} of before the collapse, using ideas that cost up to {{tier}}. Change it in Expert mode. {{mode}}.",
  },
} satisfies Record<string, CaveatCopy>;

/** Scene 6: what Expert mode offers, one tile per tool (each opens it at /explore?open=<id>). {{n}} slots are computed. */
export const EXPLORE_TILES = [
  { id: "freight", title: "Freight and hazmat trips", hint: "{{trips}} trips across the river, car against truck, with routes on the map" },
  { id: "exhaustive", title: "Test an idea against every possibility", hint: "Score every mix of ideas and see where the search's pick ranks" },
  { id: "compare", title: "Compare two futures side by side", hint: "Swipe between the map now and the map with an idea" },
  { id: "command", title: "Close any road", hint: "Type \"close harbor tunnel\" in the command bar (Ctrl or Cmd K)" },
  { id: "closures", title: "Live closure and source lookups", hint: "News reports and published sources, confirmed one at a time" },
] as const;
export type ExploreTileId = (typeof EXPLORE_TILES)[number]["id"];

/** Expert-mode toggle and keyboard help (STORY.md section 8). */
export const TOGGLE = {
  label: "View mode",
  story: "Guided story",
  expert: "Expert mode",
  tipStory: "Open the full workspace: every view, the map inspector, the assumptions and the idea search.",
  tipExpert: "Go back to the story at scene {{scene}}.",
  back: "Back to the story",
  firstNote: "Everything from the story is here. Nothing was reset.",
};

export const KEYS: { keys: string[]; hint: string }[] = [
  { keys: ["→"], hint: "Next scene" },
  { keys: ["←"], hint: "Previous scene" },
  { keys: ["E"], hint: "Switch Expert mode on or off" },
  { keys: ["Esc"], hint: "Close a popover or dialog; skip the intro" },
  { keys: ["R"], hint: "Reset the scenario" },
  { keys: ["P"], hint: "Presentation mode (Expert mode)" },
  { keys: ["Ctrl", "K"], hint: "Open the command bar (Cmd K on a Mac)" },
  { keys: ["?"], hint: "Show these shortcuts" },
];

/** Plain glossary (STORY.md section 11), for Expert-mode tooltips. Slots are filled where used. */
export const GLOSSARY = {
  simulation: "A computer model of what could happen. It is not a forecast and not a measurement.",
  baseline: "The world before any change.",
  scenario: "One version of the world: bridge in place, bridge removed, or removed plus an idea.",
  freeFlow: "Driving with no traffic jams, at posted speeds. Real trips can take longer.",
  lowerBound: "A floor. Real delays are likely at least this large, not smaller.",
  reach: "The jobs you can drive to within 30 minutes, with no traffic jams.",
  acrossTheRiver: "On the other shore of the Patapsco River from where a person lives.",
  affected: "Reaches over 10% fewer jobs across the river than before.",
  spot: "A small Census area (block group). Place names are the nearest known place, not official borders.",
  hexagon: "One small tile on the map, holding estimates of people and jobs for that spot.",
  view: "One way of measuring the change (a lens): jobs across the river, jobs across the region, or station time.",
  stationTime: "Simulated time to the nearest fire or ambulance station for 90% of people, plus a delay to get moving.",
  hazmat: "Hazardous materials, like some fuels and chemicals. The MDTA bars trucks carrying certain ones from both harbor tunnels.",
  assumption: "A setting we chose rather than measured. The Assumptions panel lists them all.",
  rangeChip: "A note that shows how far a number moves when the assumptions change.",
  future: "One simulated set of conditions (a what-if run), such as busier roads or a closed road, used to test ideas.",
  idea: "One what-if change (an option) from a fixed list of hypothetical ones. None is an agency plan.",
  finalist: "One of the three ideas that scored best in the search.",
  deterministic: "A search that follows the same steps every time and uses no AI.",
  lowWage: "Workers in the lowest pay band in the Census jobs data.",
  pGoal: "Chance of meeting the goal: the share of what-if runs in which the idea meets it.",
};

/** Fill a {{slot}} template. Unknown slots stay visible (never invented); callers check `resolved`. */
export function fill(template: string, slots: Record<string, string | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => slots[k] ?? m);
}

/** True when every slot in the template has a value. */
export function resolved(template: string, slots: Record<string, string | undefined>): boolean {
  return [...template.matchAll(/\{\{(\w+)\}\}/g)].every((m) => slots[m[1]] !== undefined);
}

/** Fill, or null when a slot is missing: the caller shows "Not available for this scenario" instead. */
export function fillOrNull(template: string, slots: Record<string, string | undefined>): string | null {
  return resolved(template, slots) ? fill(template, slots) : null;
}

/**
 * Every default-path sentence and caption rendered with sample slot values at the reference-world shape, for the
 * readability test. Keep in step with the templates above.
 */
export function defaultPathSamples(): { id: string; text: string }[] {
  const slots = {
    lossPct: "10",
    budgetMin: "30",
    emsPct: "90",
    worstArea: "Sparrows Point and Edgemere",
    emsBefore: "6.1",
    emsAfter: "6.4",
    carAdded: "about 6 minutes",
    hazmatAdded: "about 15 minutes",
    trips: "24",
    residual: "about 15,000",
    regionalAdded: "about 3 seconds",
    done: "480",
    total: "720",
  };
  const out: { id: string; text: string }[] = [
    { id: "intro", text: INTRO.sentence },
  ];
  const add = (id: string, text: string) => out.push({ id, text: fill(text, slots) });
  add("crossing.before", T.crossing.before);
  add("crossing.removed", T.crossing.alreadyRemoved);
  add("crossing.after", T.crossing.afterLonger);
  add("crossing.shorter", T.crossing.afterShorter);
  add("crossing.none", T.crossing.afterNone);
  add("crossing.caption", T.crossing.caption);
  add("local", T.averages.sentence);
  add("local.most", T.averages.sentenceMost);
  add("local.none", T.averages.none);
  add("local.noPlace", T.averages.noPlace);
  add("local.caption", T.averages.caption);
  add("held", T.held.both);
  add("held.unchanged", T.held.unchanged);
  add("held.moved", T.held.moved);
  add("held.caption", T.held.caption);
  add("cargo", T.freight.detour);
  add("cargo.plain", T.freight.plain);
  add("cargo.caption", T.freight.caption);
  add("cargo.note", T.freight.note);
  add("help.ready", T.fix.ready);
  add("help.searching", T.fix.searching);
  add("help.screening", T.fix.screening);
  add("help.helps", T.fix.helps);
  add("help.would", T.fix.wouldHelp);
  add("help.chosen", T.fix.chosenHelps);
  add("help.undoes", T.fix.undoes);
  add("help.noHelp", T.fix.noHelp);
  add("help.zero", T.fix.zero);
  add("help.caption", T.fix.caption);
  add("help.gate", T.fix.gate);
  add("explore", T.explore.sentence);
  add("explore.caption", T.explore.caption);
  return out;
}

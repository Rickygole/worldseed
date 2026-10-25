/**
 * Display metadata for the three real, snapshot-backed crossings a visitor can close in Expert mode's
 * comparison tool (lib/sim/types.ts has the LinkId type and its snapshot graph ids; lib/geo.ts has the map
 * labels and tunnel geometry comes from links.geojson via components/map/crossings.ts).
 */
import { LINK_GRAPH_IDS, type LinkId, type Scenario } from "../sim/types";

export interface CrossingInfo {
  id: LinkId;
  /** Short name for buttons, chips and table rows. */
  label: string;
  /** Full name with route, for log lines and headings. */
  fullName: string;
}

export const CROSSINGS: readonly CrossingInfo[] = [
  { id: "key_bridge", label: "Key Bridge", fullName: "Francis Scott Key Bridge (I-695)" },
  { id: "harbor_tunnel", label: "Harbor Tunnel", fullName: "Baltimore Harbor Tunnel (I-895)" },
  { id: "fort_mchenry", label: "Fort McHenry Tunnel", fullName: "Fort McHenry Tunnel (I-95)" },
];

export const CROSSING_BY_ID: Record<LinkId, CrossingInfo> = Object.fromEntries(CROSSINGS.map((c) => [c.id, c])) as Record<LinkId, CrossingInfo>;

/**
 * Every crossing closed in `scenario`: by `removedLinks` (Expert mode's picker) OR by a `close_link` mutation
 * for the same snapshot link (Cmd-K's "close <name>" shortcut, or a confirmed news closure). This union is
 * the single source of truth for "is this crossing closed" - the picker and the top bar both read it, so a
 * closure made through one path is never invisible to, or re-closeable from, another.
 */
export function closedCrossingIds(scenario: Scenario | undefined | null): Set<LinkId> {
  if (!scenario) return new Set<LinkId>();
  const out = new Set<LinkId>(scenario.removedLinks);
  const byMutation = new Set((scenario.mutations ?? []).flatMap((r) => (r.m.kind === "close_link" ? [r.m.linkId] : [])));
  for (const c of CROSSINGS) if (byMutation.has(LINK_GRAPH_IDS[c.id])) out.add(c.id);
  return out;
}

/** Names of the crossings closedCrossingIds returns, in CROSSINGS order. Empty on the baseline or before the scenario loads. */
export function closedCrossingNames(scenario: Scenario | undefined | null): string[] {
  const closed = closedCrossingIds(scenario);
  return CROSSINGS.filter((c) => closed.has(c.id)).map((c) => c.label);
}

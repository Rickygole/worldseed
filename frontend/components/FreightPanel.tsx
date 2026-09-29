"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, ChevronsUpDown, ChevronUp, ExternalLink, Truck, X } from "lucide-react";
import { useApp, snapshotSimulator } from "@/lib/store";
import { useSearch } from "@/lib/ui/search";
import { withBundle } from "@/lib/ui/agentBridge";
import type { TripClassResult, TripResult, TripsResult } from "@/lib/sim/trips";
import type { Scenario } from "@/lib/sim/types";
import { fmtMin } from "@/lib/format";
import { optionName, optionTitle } from "./planner/labels";
import { FREIGHT_DISCLAIMER } from "@/lib/ui/storyCopy";
import { eligibleCandidates } from "@/lib/agent/catalog";

export const MDTA_URL = "https://mdta.maryland.gov/TunnelRestrictionsAndVehiclePermits";
export const MDTA_NEWS_URL = "https://mdta.maryland.gov/keybridgenews";
export { FREIGHT_DISCLAIMER };
const CLASS_LABEL: Record<string, string> = { car: "Car", hazmat_truck: "Hazmat truck" };

const signed = (m: number | null) => (m === null ? "--" : `${m >= 0 ? "+" : "-"}${fmtMin(Math.abs(m))}`);

/**
 * Color of an added-time change, by direction and goodness (more time is worse): over 5 min critical, any other
 * increase warn, a decrease ok, no change muted. The signed number always carries the direction too.
 */
function changeColor(d: number | null): string {
  if (d === null || Math.abs(d) < 0.05) return "var(--color-muted)";
  if (d < 0) return "var(--color-ok)";
  return d > 5 ? "var(--color-critical)" : "var(--color-warn)";
}

const TD = "num py-1.5 pl-2 text-right";
/** The first column of a class group: a wider gap on its left separates the car and hazmat groups. */
const TD0 = "num py-1.5 pl-4 text-right";

/** One vehicle class as three aligned columns: before (pre-collapse), now, change. */
function Cells({ c }: { c: TripClassResult | undefined }) {
  if (!c) {
    return (
      <>
        <td className={`${TD0} text-muted`}>--</td>
        <td className={`${TD} text-muted`}>--</td>
        <td className={`${TD} text-muted`}>--</td>
      </>
    );
  }
  const before = <td className={`${TD0} text-muted`}>{c.baselineMinutes === null ? "--" : fmtMin(c.baselineMinutes)}</td>;
  if (c.unreachable || c.currentMinutes === null) {
    return (
      <>
        {before}
        <td className={`${TD} text-text`} colSpan={2}>
          no route
        </td>
      </>
    );
  }
  const big = (c.addedMinutes ?? 0) > 5;
  return (
    <>
      {before}
      <td className={`${TD} text-text`}>{fmtMin(c.currentMinutes)}</td>
      <td className={TD} style={{ color: changeColor(c.addedMinutes) }} title={c.ratio !== null ? `x${c.ratio.toFixed(2)} the pre-collapse time` : undefined}>
        {c.addedMinutes !== null && Math.abs(c.addedMinutes) < 0.05 ? "0.0" : signed(c.addedMinutes)}
        {big && <span className="sr-only"> (more than 5 min added)</span>}
      </td>
    </>
  );
}

type SortKey = "trip" | "car" | "hazmat_truck";

function SortHead({ k, label, sort, onSort, className }: { k: SortKey; label: string; sort: { k: SortKey; desc: boolean } | null; onSort: (k: SortKey) => void; className?: string }) {
  const on = sort?.k === k;
  const Icon = !on ? ChevronsUpDown : sort.desc ? ChevronDown : ChevronUp;
  return (
    <th scope="col" className={className} aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" className={`inline-flex items-center gap-0.5 font-medium hover:text-text ${on ? "text-text" : ""}`} onClick={() => onSort(k)}>
        {label}
        <Icon size={12} aria-hidden className={on ? "" : "opacity-50"} />
      </button>
    </th>
  );
}

/** A column-group label with a hairline under exactly its three columns (the gap on its left separates the groups). */
function GroupHead({ label }: { label: string }) {
  return (
    <th scope="colgroup" colSpan={3} className="pb-1 pl-4 text-center font-medium text-text-2">
      <span className="block border-b border-line-strong pb-0.5">{label}</span>
    </th>
  );
}

/** The two-row header shared by the trip tables: class groups over before / now / change. */
function TripHead({ first, sort, onSort }: { first: string; sort?: { k: SortKey; desc: boolean } | null; onSort?: (k: SortKey) => void }) {
  const H = "pb-1 pl-2 text-right font-medium";
  const H0 = "pb-1 pl-4 text-right font-medium";
  return (
    <thead className="text-muted">
      <tr>
        <td />
        <GroupHead label="Car, min" />
        <GroupHead label="Hazmat truck, min" />
      </tr>
      <tr className="border-b border-line-strong">
        {onSort ? (
          <SortHead k="trip" label={first} sort={sort ?? null} onSort={onSort} className="pb-1 pr-2 text-left" />
        ) : (
          <th scope="col" className="pb-1 pr-2 text-left font-medium">
            {first}
          </th>
        )}
        {(["car", "hazmat_truck"] as const).map((c) => (
          <Fragment key={c}>
            <th scope="col" className={H0}>
              Before
            </th>
            <th scope="col" className={H}>
              Now
            </th>
            {onSort ? (
              <SortHead k={c} label="Change" sort={sort ?? null} onSort={onSort} className={H} />
            ) : (
              <th scope="col" className={H}>
                Change
              </th>
            )}
          </Fragment>
        ))}
      </tr>
    </thead>
  );
}

const COLS = (
  <colgroup>
    <col />
    <col className="w-[54px]" />
    <col className="w-[46px]" />
    <col className="w-[58px]" />
    <col className="w-[54px]" />
    <col className="w-[46px]" />
    <col className="w-[58px]" />
  </colgroup>
);

/** What the escorted hazmat windows would do, computed by runTrips in each option's world. */
function EscortOptions() {
  const catalog = useSearch((s) => s.catalog);
  const raw = useSearch((s) => s.hazmatOptions);
  // The same eligibility rule the freight mission uses; the raw list only if the catalog cannot say.
  const options = useMemo(() => {
    const el = catalog ? eligibleCandidates(catalog, { lens: "freight", maxCostTier: "$$$", types: [] }) : [];
    return el.length > 0 ? el.map((c) => ({ id: c.id, title: c.title, costTier: c.costTier })) : raw;
  }, [catalog, raw]);
  const scenario = useApp((s) => s.scenario);
  const trips = useApp((s) => s.trips);
  const applyScenario = useApp((s) => s.applyScenario);
  const log = useApp((s) => s.log);
  const [rows, setRows] = useState<{ id: string; title: string; tier: string; res: TripsResult | null; applied: boolean }[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const appliedIds = useMemo(() => new Set((scenario.mutations ?? []).flatMap((r) => (r.m.kind === "apply_candidate" ? [r.m.candidateId] : []))), [scenario]);

  useEffect(() => {
    const sb = snapshotSimulator();
    if (!sb || options.length === 0) return;
    let live = true;
    void Promise.all(
      options.map(async (c) => ({
        id: c.id,
        title: optionTitle(c.title, "hazmat_window"),
        tier: c.costTier,
        applied: appliedIds.has(c.id),
        res: appliedIds.has(c.id) ? null : await sb.runTrips(withBundle(scenario, `HW${c.id}`, [c.id], "user", catalog)).catch(() => null),
      })),
    ).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [options, scenario, catalog, appliedIds]);

  if (options.length === 0) {
    return <p className="text-xs text-muted">No escort options in this snapshot&apos;s catalog (or the catalog is still loading).</p>;
  }
  const now = trips?.summary.hazmat_truck;
  return (
    <ul className="space-y-2">
      {(rows ?? options.map((c) => ({ id: c.id, title: optionTitle(c.title, "hazmat_window"), tier: c.costTier, res: null, applied: appliedIds.has(c.id) }))).map((r) => {
        const s = r.res?.summary.hazmat_truck;
        return (
          <li key={r.id} className="card p-3 text-xs">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm">{r.title}</p>
              <span className="chip num h-5 shrink-0 px-2">{r.tier}</span>
            </div>
            {r.applied ? (
              <p className="mt-1 text-ok">Applied in this world.</p>
            ) : s && now ? (
              <p className="num mt-1 text-muted">
                Hazmat truck cross-harbor trips: mean <span className="text-text">{signed(s.crossHarborMeanAddedMinutes)} min</span> (now {signed(now.crossHarborMeanAddedMinutes)} min);
                trips adding more than 5 min: <span className="text-text">{s.crossHarborOver5Min}</span> (now {now.crossHarborOver5Min}).
              </p>
            ) : (
              <p className="mt-1 text-muted">Computing...</p>
            )}
            {!r.applied &&
              (confirm === r.id ? (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-muted">Add this hypothetical option to the world?</span>
                  <button
                    className="btn h-7 border-ai px-2 text-xs"
                    onClick={async () => {
                      setConfirm(null);
                      log("USER", `Apply hypothetical option ${r.id} (freight panel)`);
                      await applyScenario(withBundle(scenario, "HW", [r.id], "user", catalog), { fx: { candidateIds: [r.id] } });
                    }}
                  >
                    Apply
                  </button>
                  <button className="btn h-7 px-2 text-xs" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="btn mt-2 h-7 px-2 text-xs" onClick={() => setConfirm(r.id)}>
                  Apply...
                </button>
              ))}
          </li>
        );
      })}
    </ul>
  );
}

/** Freight and hazmat trips: point-to-point free-flow drive times between real road anchors, car vs hazmat truck. */
export default function FreightPanel() {
  const open = useApp((s) => s.freightOpen);
  const setOpen = useApp((s) => s.setFreightOpen);
  return <AnimatePresence>{open && <Inner key="freight" onClose={() => setOpen(false)} />}</AnimatePresence>;
}

function Inner({ onClose }: { onClose: () => void }) {
  const reduced = !!useReducedMotion();
  const trips = useApp((s) => s.trips);
  const sel = useApp((s) => s.freightSel);
  const selectTrip = useApp((s) => s.selectTrip);
  const cmp = useApp((s) => s.freightCompare);
  const setCmp = useApp((s) => s.setFreightCompare);
  const catalog = useSearch((s) => s.catalog);
  const bundles = useSearch((s) => s.bundles);
  const removed = useApp((s) => s.scenario.removedLinks.includes("key_bridge"));
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cross = trips?.trips.filter((t) => t.kind === "cross_harbor") ?? [];
  const controls = trips?.trips.filter((t) => t.kind === "same_shore_control") ?? [];
  const car = trips?.summary.car;
  const hz = trips?.summary.hazmat_truck;

  const cmpById = new Map((cmp?.res.trips ?? []).map((t) => [t.id, t]));
  /** Added minutes now, with the option, and the change between them (negative = the option helps). */
  const cmpCells = (a: TripClassResult | undefined, b: TripClassResult | undefined) => {
    const now = a?.addedMinutes ?? null;
    const w = b?.addedMinutes ?? null;
    const d = now !== null && w !== null ? w - now : null;
    return (
      <>
        <td className={`${TD0} text-muted`}>{signed(now)}</td>
        <td className={`${TD} text-text`}>{signed(w)}</td>
        <td className={TD} style={{ color: d !== null && d < -0.05 ? "var(--color-ok)" : d !== null && d > 0.05 ? "var(--color-critical)" : "var(--color-muted)" }}>
          {d === null ? "--" : Math.abs(d) < 0.05 ? "0.0" : `${d < 0 ? "-" : "+"}${fmtMin(Math.abs(d))}`}
        </td>
      </>
    );
  };
  const tripButton = (t: TripResult, on: boolean, world?: { scenario: Scenario; label: string }) => (
    <button
      className="w-full truncate text-left hover:text-text"
      aria-pressed={on}
      onClick={() => void selectTrip(on ? null : t.id, world)}
      title={`${t.names.origin} → ${t.names.destination} (show ${world ? `the route with ${cmp?.bundleId}` : "it"} on the map)`}
    >
      {t.names.origin} → {t.names.destination}
    </button>
  );
  const cmpRows = (list: TripResult[]) =>
    list.map((t) => {
      const on = sel?.tripId === t.id;
      const o = cmpById.get(t.id);
      return (
        <tr key={t.id} className="border-t border-border" style={on ? { background: "var(--color-surface-2)" } : undefined}>
          <th scope="row" className="py-1.5 pr-2 text-left font-normal">
            {tripButton(t, on, cmp ? { scenario: cmp.scenario, label: `with ${cmp.bundleId}` } : undefined)}
          </th>
          {cmpCells(t.classes.car, o?.classes.car)}
          {cmpCells(t.classes.hazmat_truck, o?.classes.hazmat_truck)}
        </tr>
      );
    });

  const onSort = (k: SortKey) => setSort((s) => (s?.k === k ? (s.desc ? { k, desc: false } : null) : { k, desc: k !== "trip" }));
  const sorted = (list: TripResult[]) => {
    if (!sort) return list;
    const key = (t: TripResult) => (sort.k === "trip" ? `${t.names.origin} ${t.names.destination}` : (t.classes[sort.k]?.addedMinutes ?? Number.POSITIVE_INFINITY));
    return [...list].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
      return sort.desc ? -c : c;
    });
  };
  const rows = (list: TripResult[]) =>
    list.map((t) => {
      const on = sel?.tripId === t.id;
      return (
        <tr key={t.id} className="border-t border-border hover:bg-[rgb(148_163_184/0.05)]" style={on ? { background: "var(--color-surface-2)" } : undefined}>
          <th scope="row" className="py-1.5 pr-2 text-left font-normal">
            {tripButton(t, on)}
          </th>
          <Cells c={t.classes.car} />
          <Cells c={t.classes.hazmat_truck} />
        </tr>
      );
    });

  return (
    <motion.section
      aria-labelledby="freight-h"
      className="sheet fixed bottom-[144px] left-4 top-[72px] z-30 flex w-[560px] flex-col overflow-hidden"
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: -32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduced ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, x: -32, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 id="freight-h" className="flex items-center gap-2 text-base font-medium">
          <Truck size={16} aria-hidden /> Freight and hazmat trips
        </h2>
        <button className="btn-icon" aria-label="Close freight and hazmat trips (Esc)" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {!trips ? (
          <p className="text-sm text-muted">This snapshot has no trip definitions, so freight trips cannot be shown.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {(["car", "hazmat_truck"] as const).map((c) => {
                const s = trips.summary[c];
                return (
                  <div key={c} className="card p-3">
                    <p className="text-xs font-medium text-muted">{CLASS_LABEL[c]}, added per trip</p>
                    <p className="display mt-1 text-2xl font-medium" style={{ fontVariantNumeric: "proportional-nums", fontFeatureSettings: '"pnum" 1' }}>
                      {s ? `${signed(s.crossHarborMeanAddedMinutes)}` : "--"}
                      <span className="ml-1 font-sans text-xs font-normal text-muted">min</span>
                    </p>
                    <p className="num text-xs text-muted">
                      mean over {s?.crossHarborTrips ?? 0} cross-harbor trips · {s?.crossHarborOver5Min ?? 0} add more than 5 min
                      {s && s.unreachableTrips > 0 ? ` · ${s.unreachableTrips} unreachable` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
            {removed && car && hz && hz.crossHarborMeanAddedMinutes > car.crossHarborMeanAddedMinutes + 0.5 && (
              <p className="text-sm leading-5 text-text-2">
                Vehicles carrying the hazardous materials MDTA lists are barred from both harbor tunnels (
                <a className="link" href={MDTA_URL} target="_blank" rel="noreferrer">
                  MDTA <ExternalLink size={10} className="inline" aria-hidden />
                </a>
                , accessed 26 September 2026). With the bridge removed, in the model they take the western I-695 arc, the alternate route MDTA names: a hazmat truck adds{" "}
                <span className="num text-warn">{fmtMin(hz.crossHarborMeanAddedMinutes)} min</span> on average, a car <span className="num text-text">{fmtMin(car.crossHarborMeanAddedMinutes)} min</span>.
              </p>
            )}
            <p className="text-xs text-muted">
              Free-flow drive times between real road points (no signals, congestion, loading or dwell). Hazmat truck = a vehicle carrying material the tunnels bar, not every truck. Baseline = the
              pre-collapse network. Select a trip to show it on the map.
            </p>
            {cmp && (
              <section aria-labelledby="cmp-h" className="card space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 id="cmp-h" className="text-sm font-medium">
                    Doing nothing vs with {cmp.bundleId}:{" "}
                    {cmp.bundleId && (bundles[cmp.bundleId]?.candidateIds ?? []).map((id) => optionName(catalog, id)).join(" + ")}
                  </h3>
                  <button className="btn h-7 shrink-0 px-2 text-xs" onClick={() => setCmp(null)}>
                    Close comparison
                  </button>
                </div>
                <p className="num text-xs text-muted">
                  Hazmat trucks: mean {signed(hz?.crossHarborMeanAddedMinutes ?? null)} → {signed(cmp.res.summary.hazmat_truck?.crossHarborMeanAddedMinutes ?? null)} min, trips over 5 min{" "}
                  {hz?.crossHarborOver5Min ?? "--"} → {cmp.res.summary.hazmat_truck?.crossHarborOver5Min ?? "--"}. Cars: mean {signed(car?.crossHarborMeanAddedMinutes ?? null)} →{" "}
                  {signed(cmp.res.summary.car?.crossHarborMeanAddedMinutes ?? null)} min. Added minutes versus the pre-collapse network; select a trip to see its routes with the option.
                </p>
                <table className="w-full table-fixed text-xs">
                  <caption className="sr-only">Added minutes versus the pre-collapse network, now and with {cmp.bundleId}</caption>
                  {COLS}
                  <thead className="text-muted">
                    <tr>
                      <td />
                      <GroupHead label="Car, added min" />
                      <GroupHead label="Hazmat truck, added min" />
                    </tr>
                    <tr className="border-b border-line-strong">
                      <th scope="col" className="pb-1 pr-2 text-left font-medium">
                        Cross-harbor trip
                      </th>
                      {["car", "hazmat"].map((c) => (
                        <Fragment key={c}>
                          <th scope="col" className="pb-1 pl-4 text-right font-medium">
                            Now
                          </th>
                          <th scope="col" className="pb-1 pl-2 text-right font-medium">
                            With
                          </th>
                          <th scope="col" className="pb-1 pl-2 text-right font-medium">
                            Change
                          </th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{cmpRows(cross)}</tbody>
                </table>
              </section>
            )}
            <table className="w-full table-fixed text-xs">
              <caption className="mb-2 text-left text-sm font-medium text-text">
                Cross-harbor trips <span className="num font-normal text-muted">({cross.length})</span>
              </caption>
              {COLS}
              <TripHead first="Trip" sort={sort} onSort={onSort} />
              <tbody>{rows(sorted(cross))}</tbody>
            </table>
            <table className="w-full table-fixed text-xs">
              <caption className="mb-2 text-left text-sm font-medium text-text">
                Same-shore controls <span className="num font-normal text-muted">({controls.length})</span>
                <span className="block text-xs font-normal text-muted">These should not depend on the harbor crossings.</span>
              </caption>
              {COLS}
              <TripHead first="Trip" />
              <tbody>{rows(controls)}</tbody>
            </table>
            <section aria-labelledby="escort-h">
              <h3 id="escort-h" className="label mb-1">
                Options that act on hazmat trips
              </h3>
              <p className="mb-2 text-xs text-muted">
                Hypothetical escorted windows through a tunnel, not an MDTA program. The planner scores them the same way; this list applies one directly, after a
                confirmation.
              </p>
              <EscortOptions />
            </section>
            <div className="space-y-2 border-t border-border pt-3 text-xs text-muted">
              <p className="num">{trips.meta.ms.toFixed(0)} ms, computed in your browser.</p>
              <p>
                Tunnel rule: Maryland Transportation Authority,{" "}
                <a className="link" href={MDTA_URL} target="_blank" rel="noreferrer">
                  Transporting Hazardous Materials Across Our Toll Facilities
                </a>
                , accessed 26 September 2026.
              </p>
              <p>
                Alternate route: MDTA Key Bridge news,{" "}
                <a className="link" href={MDTA_NEWS_URL} target="_blank" rel="noreferrer">
                  https://mdta.maryland.gov/keybridgenews
                </a>
                , accessed 26 September 2026.
              </p>
              <p>{FREIGHT_DISCLAIMER}</p>
            </div>
          </>
        )}
      </div>
    </motion.section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ExternalLink, Truck, X } from "lucide-react";
import { useApp, snapshotSimulator } from "@/lib/store";
import { useSearch } from "@/lib/ui/search";
import { withBundle } from "@/lib/ui/agentBridge";
import type { TripClassResult, TripResult, TripsResult } from "@/lib/sim/trips";
import { fmtMin } from "@/lib/format";
import { stripHypothetical } from "./planner/labels";

export const MDTA_URL = "https://mdta.maryland.gov/TunnelRestrictionsAndVehiclePermits";
const CLASSES = ["car", "hazmat_truck"] as const;
const CLASS_LABEL: Record<string, string> = { car: "Car", hazmat_truck: "Hazmat truck" };

const signed = (m: number | null) => (m === null ? "--" : `${m >= 0 ? "+" : "-"}${fmtMin(Math.abs(m))}`);

function Cell({ c }: { c: TripClassResult | undefined }) {
  if (!c) return <td className="num px-1 py-1 text-right text-muted">--</td>;
  if (c.unreachable || c.currentMinutes === null) {
    return (
      <td className="num px-1 py-1 text-right text-critical" title="No route in this world">
        no route
      </td>
    );
  }
  const big = (c.addedMinutes ?? 0) > 5;
  return (
    <td className="num px-1 py-1 text-right" title={`${fmtMin(c.baselineMinutes ?? 0)} -> ${fmtMin(c.currentMinutes)} min${c.ratio !== null ? `, x${c.ratio.toFixed(2)}` : ""}`}>
      <span className="text-muted">{c.baselineMinutes === null ? "--" : fmtMin(c.baselineMinutes)}</span>
      <span className="text-muted"> → </span>
      <span>{fmtMin(c.currentMinutes)}</span>
      <span className="ml-1" style={{ color: big ? "var(--color-critical)" : "var(--color-muted)" }}>
        {signed(c.addedMinutes)}
        {big && <span className="sr-only"> (more than 5 min added)</span>}
      </span>
    </td>
  );
}

/** What the escorted hazmat windows would do, computed by runTrips in each option's world. */
function EscortOptions() {
  const catalog = useSearch((s) => s.catalog);
  const options = useSearch((s) => s.hazmatOptions);
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
        title: stripHypothetical(c.title),
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
      {(rows ?? options.map((c) => ({ id: c.id, title: stripHypothetical(c.title), tier: c.costTier, res: null, applied: appliedIds.has(c.id) }))).map((r) => {
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
  const removed = useApp((s) => s.scenario.removedLinks.includes("key_bridge"));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cross = trips?.trips.filter((t) => t.kind === "cross_harbor") ?? [];
  const controls = trips?.trips.filter((t) => t.kind === "same_shore_control") ?? [];
  const car = trips?.summary.car;
  const hz = trips?.summary.hazmat_truck;

  const rows = (list: TripResult[]) => (
    <>
      {list.map((t) => {
        const on = sel?.tripId === t.id;
        return (
          <tr key={t.id} className="border-t border-border" style={on ? { background: "var(--color-surface-2)" } : undefined}>
            <th scope="row" className="px-1 py-1 text-left font-normal">
              <button className="w-full truncate text-left hover:text-text" aria-pressed={on} onClick={() => void selectTrip(on ? null : t.id)} title={`${t.names.origin} → ${t.names.destination} (show on the map)`}>
                {t.names.origin} → {t.names.destination}
              </button>
            </th>
            {CLASSES.map((c) => (
              <Cell key={c} c={t.classes[c]} />
            ))}
          </tr>
        );
      })}
    </>
  );

  return (
    <motion.section
      aria-labelledby="freight-h"
      className="panel fixed bottom-[148px] left-4 top-[104px] z-30 flex w-[560px] flex-col overflow-hidden"
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
                    <p className="label">{CLASS_LABEL[c]}</p>
                    <p className="num mt-1 text-2xl font-medium">{s ? `${signed(s.crossHarborMeanAddedMinutes)}` : "--"}<span className="ml-1 text-xs text-muted">min</span></p>
                    <p className="num text-xs text-muted">
                      mean over {s?.crossHarborTrips ?? 0} cross-harbor trips · {s?.crossHarborOver5Min ?? 0} add more than 5 min
                      {s && s.unreachableTrips > 0 ? ` · ${s.unreachableTrips} unreachable` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
            {removed && car && hz && hz.crossHarborMeanAddedMinutes > car.crossHarborMeanAddedMinutes + 0.5 && (
              <p className="text-sm leading-5">
                Hazmat vehicles are prohibited in both Baltimore tunnels (
                <a className="underline decoration-border underline-offset-2 hover:text-text" href={MDTA_URL} target="_blank" rel="noreferrer">
                  MDTA <ExternalLink size={10} className="inline" aria-hidden />
                </a>
                , accessed 26 September 2026), so with the bridge closed they must use the western Beltway arc: a hazmat truck adds{" "}
                <span className="num text-critical">{fmtMin(hz.crossHarborMeanAddedMinutes)} min</span> on average across the harbor, a car{" "}
                <span className="num">{fmtMin(car.crossHarborMeanAddedMinutes)} min</span>.
              </p>
            )}
            <p className="text-xs text-muted">
              Free-flow node-to-node drive times between real road anchors (no signals, congestion, loading or dwell). Hazmat truck = a vehicle carrying material the
              tunnels prohibit, not every truck. Baseline = the pre-collapse network. Select a trip to show it on the map.
            </p>
            <table className="w-full table-fixed text-xs">
              <caption className="label mb-1 text-left">Cross-harbor trips ({cross.length})</caption>
              <thead>
                <tr className="text-left text-muted">
                  <th scope="col" className="w-[44%] px-1 pb-1 font-medium">Trip</th>
                  <th scope="col" className="px-1 pb-1 text-right font-medium">Car, min</th>
                  <th scope="col" className="px-1 pb-1 text-right font-medium">Hazmat truck, min</th>
                </tr>
              </thead>
              <tbody>
                {rows(cross)}
              </tbody>
            </table>
            <table className="w-full table-fixed text-xs">
              <caption className="label mb-1 text-left">Same-shore controls ({controls.length}): should not depend on the harbor crossings</caption>
              <tbody>
                {rows(controls)}
              </tbody>
            </table>
            <section aria-labelledby="escort-h">
              <h3 id="escort-h" className="label mb-1">
                Options that act on hazmat trips
              </h3>
              <p className="mb-2 text-xs text-muted">
                Escorted hazmat windows through a tunnel (hypothetical). The planner searches cross-harbor access options, so these are shown here with their trip numbers.
              </p>
              <EscortOptions />
            </section>
            <p className="num text-xs text-muted">
              {trips.meta.ms.toFixed(0)} ms, computed locally in your browser. Source for the tunnel rule: Maryland Transportation Authority,{" "}
              <a className="underline decoration-border underline-offset-2 hover:text-text" href={MDTA_URL} target="_blank" rel="noreferrer">
                Transporting Hazardous Materials Across Our Toll Facilities
              </a>
              , accessed 2026-09-26.
            </p>
          </>
        )}
      </div>
    </motion.section>
  );
}

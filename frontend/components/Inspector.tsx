"use client";

import { useEffect, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, X } from "lucide-react";
import { useApp, simInfo } from "@/lib/store";
import { fmtCount, fmtMin, fmtPct1, fmtSignedDur } from "@/lib/format";
import { blockGroupAt, blockGroupLabel, loadAux, placesFor } from "@/lib/ui/snapshotAux";
import { useSnapshotFile } from "@/lib/ui/useSnapshotFile";
import type { CausalChain } from "@/lib/sim";

/** Fill a {{slot}} template from the chain's computed slots. Unknown slots stay visible, never invented. */
function fill(template: string, slots: Record<string, string>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (m, k: string) => slots[k] ?? m);
}

function linkName(id: string): string {
  return simInfo()?.links.find((l) => l.id === id)?.name ?? id;
}

function Row({ label, before, after, unit, note }: { label: string; before?: string; after: string; unit?: string; note?: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-1">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="num text-right text-sm">
        {before !== undefined && before !== after && (
          <>
            <span className="text-muted">{before}</span>
            <span className="mx-1 text-muted" aria-label="to">
              &rarr;
            </span>
          </>
        )}
        <span className="text-text">{after}</span>
        {unit && <span className="ml-1 text-xs text-muted">{unit}</span>}
        {note && <span className="block text-xs text-muted">{note}</span>}
      </dd>
    </div>
  );
}

function Chain({ chain }: { chain: CausalChain }) {
  const focusName = chain.focus.name ?? "the nearest station";
  const d = chain.focus.kind === "destination" ? chain.focus.deltaS : chain.deltaS;
  const chips: { text: string; tone?: "bad" | "good" }[] = [];
  for (const l of chain.lostLinks) chips.push({ text: `${linkName(l)} closed`, tone: "bad" });
  if (chain.routeChanged) {
    const via = chain.after.viaLinks.length > 0 ? chain.after.viaLinks.map(linkName).join(", ") : "local roads";
    chips.push({ text: `Fastest route now via ${via}` });
  } else {
    chips.push({ text: "Fastest route unchanged" });
  }
  const cluster = chain.focus.kind === "destination" ? chain.focus.cluster : undefined;
  chips.push({
    text: `${fmtSignedDur(d)} ${chain.focus.kind === "destination" ? (cluster ? `to the ${focusName}` : `to ${focusName}`) : "response"}`,
    tone: d > 0.5 ? "bad" : d < -0.5 ? "good" : undefined,
  });

  return (
    <div>
      <ol className="flex flex-wrap items-center gap-1" aria-label="Causal chain">
        {chips.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ArrowRight size={12} className="text-muted" aria-hidden />}
            <span
              className="chip h-auto min-h-6 whitespace-normal px-2 py-0.5 text-xs"
              style={
                c.tone === "bad"
                  ? { color: "var(--color-critical)", borderColor: "rgb(255 61 113 / 0.5)" }
                  : c.tone === "good"
                    ? { color: "var(--color-ok)", borderColor: "rgb(45 212 191 / 0.5)" }
                    : undefined
              }
            >
              {c.text}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs leading-4 text-muted">
        {chain.focus.kind === "destination" && cluster ? (
          <>
            Route on the map: to the <span className="text-text">{focusName}</span> (<span className="num">{fmtCount(cluster.jobs)}</span> jobs in{" "}
            <span className="num">{cluster.hexes}</span> hexagons),{" "}
            {d > 0 ? "the group of jobs across the harbor whose trip grew the most from here." : "the largest group of jobs across the harbor (no trip got longer)."}
          </>
        ) : chain.focus.kind === "destination" ? (
          <>
            Route on the map: to <span className="text-text">{focusName}</span>,{" "}
            {d > 0 ? "the regional job center whose trip grew the most here." : "the job center that weighs most here (no trip got longer)."}
          </>
        ) : (
          <>
            Route on the map: from <span className="text-text">{focusName}</span>, the fastest station.
          </>
        )}
      </p>
      <p className="mt-2 text-xs leading-4 text-muted">
        {chain.lens === "xharbor" ? "All jobs across the harbor, job-weighted: " : chain.focus.kind === "destination" ? "All regional job centers, job-weighted: " : ""}
        <span className="text-text">{fill(chain.template, chain.slots)}</span>
      </p>
      {chain.routeChanged && (
        <p className="mt-2 flex items-center gap-4 text-xs text-muted" aria-label="Map key for routes">
          <span className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-5 rounded bg-muted" aria-hidden /> before (dim)
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-1 w-5 rounded bg-text" aria-hidden /> now (bright)
          </span>
        </p>
      )}
    </div>
  );
}

export default function Inspector() {
  const selectedHex = useApp((s) => s.selectedHex);
  const selectHex = useApp((s) => s.selectHex);
  const inspection = useApp((s) => s.inspection);
  const current = useApp((s) => s.current);
  const view = useApp((s) => s.view);
  const viewBaseline = useApp((s) => s.viewBaseline);
  const status = useApp((s) => s.status);
  const reduced = !!useReducedMotion();
  const { data: aux, error: auxError } = useSnapshotFile(loadAux, status === "ready");
  const open = selectedHex !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void selectHex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, selectHex]);

  const bg = useMemo(() => {
    if (selectedHex === null || !aux) return null;
    const row = blockGroupAt(aux, aux.hexes.bg[selectedHex]);
    if (!row) return null;
    const place = placesFor(aux, [selectedHex])[0] ?? placesFor(aux, row.hexes)[0] ?? null;
    return { row, place, shore: aux.hexes.shore[selectedHex] };
  }, [selectedHex, aux]);

  const h = selectedHex;
  const xd = current?.detail?.xharbor;
  const emsView = view?.detail?.lens === "ems" ? view : null;
  const emsBase = viewBaseline?.detail?.lens === "ems" ? viewBaseline : null;
  const shoreName = (s: number) => (s === 0 ? "north/east shore" : s === 1 ? "south/west shore" : "harbor divider (ambiguous shore)");

  return (
    <AnimatePresence>
      {open && h !== null && (
        <motion.aside
          key="inspector"
          aria-labelledby="inspector-h"
          className="panel pointer-events-auto absolute bottom-12 right-4 top-4 z-20 flex flex-col overflow-hidden"
          style={{ width: "var(--ws-right)" }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, x: 24, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-4 py-2">
            <div className="min-w-0">
              <p className="label">Neighborhood</p>
              <h2 id="inspector-h" className="truncate text-base font-medium">
                {bg?.place ? `Near ${bg.place}` : bg ? "Block group" : "Loading..."}
              </h2>
            </div>
            <button className="btn-icon shrink-0" aria-label="Close neighborhood details (Esc)" onClick={() => void selectHex(null)}>
              <X size={16} aria-hidden />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {auxError && <p className="mb-4 text-sm text-critical">Block-group data could not be loaded: {auxError}</p>}
            {bg && (
              <section aria-label="Block group" className="mb-4">
                <p className="text-sm">{blockGroupLabel(bg.row.geoid, bg.row.county)}</p>
                <p className="num text-xs text-muted">
                  GEOID {bg.row.geoid} · {shoreName(bg.shore)}
                </p>
                <dl className="mt-2 border-t border-border pt-2">
                  <Row label="Population" after={fmtCount(bg.row.pop)} />
                  <Row label="Households without a vehicle" after={fmtCount(bg.row.zvh)} note={bg.row.households > 0 ? `${fmtPct1((100 * bg.row.zvh) / bg.row.households)}% of ${fmtCount(bg.row.households)} households` : undefined} />
                  <Row label="Low-wage workers living here" after={fmtCount(bg.row.lowWageWorkers)} />
                </dl>
                <p className="mt-1 text-xs text-muted">
                  Whole block group. U.S. Census Bureau ACS 5-year estimates (population, vehicles) and LEHD LODES (low-wage workers); estimates carry sampling error.
                </p>
              </section>
            )}

            <section aria-label="This hexagon" className="mb-4">
              <h3 className="label mb-1">This hexagon</h3>
              {xd ? (
                xd.isOrigin[h] === 0 ? (
                  <p className="text-sm text-muted">On the harbor divider, so the cross-harbor lens does not score it.</p>
                ) : (
                  <dl>
                    <Row
                      label="Cross-harbor jobs within 30 min"
                      before={fmtCount(xd.baselineJobsWithin[h])}
                      after={fmtCount(xd.jobsWithin[h])}
                      note={xd.lossFrac[h] > 0.0005 ? `${fmtPct1(100 * xd.lossFrac[h])}% lost` : "no loss"}
                    />
                    <Row
                      label="Avg trip to jobs across the harbor"
                      before={Number.isFinite(xd.meanBeforeMin[h]) ? fmtMin(xd.meanBeforeMin[h]) : undefined}
                      after={Number.isFinite(xd.meanAfterMin[h]) ? fmtMin(xd.meanAfterMin[h]) : "--"}
                      unit="min"
                      note={`${xd.addedMin[h] >= 0 ? "+" : ""}${fmtMin(xd.addedMin[h])} min`}
                    />
                    {emsView && emsBase && (
                      <Row label="Simulated first response" before={fmtMin(emsBase.minutes[h])} after={fmtMin(emsView.minutes[h])} unit="min" />
                    )}
                  </dl>
                )
              ) : (
                <div className="skeleton h-12 w-full" aria-hidden />
              )}
              {xd &&
                (xd.residents[h] < 0.5 ? (
                  <p className="mt-1 text-xs text-muted">
                    No residents live in this hexagon (Census ACS estimates); it is in the study area for its jobs. The values above are trip times from this location.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted">
                    About <span className="num">{fmtCount(xd.residents[h])}</span> residents, derived from Census ACS estimates by area share. Jobs from LEHD LODES.
                  </p>
                ))}
            </section>

            <section aria-label="Why it changed">
              <h3 className="label mb-2">Why</h3>
              {inspection?.status === "loading" && (
                <div className="space-y-2" aria-hidden>
                  <div className="skeleton h-6 w-full" />
                  <div className="skeleton h-4 w-3/4" />
                </div>
              )}
              {inspection?.status === "error" && <p className="text-sm text-muted">Could not trace the route: {inspection.error}</p>}
              {inspection?.status === "ready" && inspection.chain && <Chain chain={inspection.chain} />}
            </section>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

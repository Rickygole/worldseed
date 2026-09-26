"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useApp } from "@/lib/store";
import { fmtDate } from "@/lib/format";
import { loadAssumptions, loadManifest, type ManifestSource } from "@/lib/ui/snapshotAux";
import { useSnapshotFile } from "@/lib/ui/useSnapshotFile";
import { useDialog } from "@/lib/ui/useDialog";
import type { AssumptionRecord } from "@/lib/sim";

/** Plain-language list of what the model leaves out. Definitions only; no results. */
const SIMPLIFIED: { title: string; body: string }[] = [
  {
    title: "Free-flow driving",
    body: "Speeds come from OpenStreetMap speed tags or a default per road class. The deterministic run has no traffic signals, turn delays or congestion, so real trips, especially through the tunnels at rush hour, take longer.",
  },
  {
    title: "Cars only",
    body: "Every time is a car trip. Transit, walking, cycling and freight schedules are not modeled.",
  },
  {
    title: "Which shore a place is on",
    body: "Baltimore County is the north/east shore, Anne Arundel and Howard the south/west shore, and Baltimore City is split by a hand-drawn harbor divider. Hexagons right on the divider are left out of the cross-harbor lens.",
  },
  {
    title: "Fire and EMS stations",
    body: "Every active fire station and EMS station counts as a response source, so most sources are fire stations. Unit counts, staffing and availability are not in any source used. Stations outside the study area are not included, which makes edge areas look slower than they are.",
  },
  {
    title: "Hazardous materials",
    body: "The harbor tunnels are flagged as closed to hazardous materials (an assumption, not re-verified against current rules). The car trips shown here do not use that flag.",
  },
  {
    title: "Census figures",
    body: "Population and vehicle counts are ACS 5-year estimates with sampling error, spread over hexagons by area. They were fetched through Census Reporter, a third-party mirror of the official ACS tables, because the official API required a key on the build day.",
  },
  {
    title: "Jobs and low-wage workers",
    body: "LEHD LODES job counts include deliberate noise for confidentiality. 'Low-wage' is the lowest LODES earnings band (the exact cut is in the parameters below), a proxy for income. Federal military jobs are not included.",
  },
];

function Badge({ status }: { status: AssumptionRecord["status"] }) {
  const sourced = status === "sourced";
  return (
    <span
      className="chip num h-5 shrink-0 px-2 text-xs"
      style={sourced ? { color: "var(--color-ok)", borderColor: "rgb(45 212 191 / 0.5)" } : { color: "var(--color-warn)", borderColor: "rgb(245 165 36 / 0.5)" }}
    >
      {sourced ? "Sourced" : "Assumption"}
    </span>
  );
}

function fmtValue(a: AssumptionRecord): string {
  const v = typeof a.value === "boolean" ? (a.value ? "yes" : "no") : String(a.value);
  return a.unit ? `${v} ${a.unit}` : v;
}

function SourceItem({ s }: { s: ManifestSource }) {
  const mirror = s.officialApi === false || /third-party/i.test(s.transport ?? "");
  return (
    <li className="border-b border-border py-2 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm">
          {s.url ? (
            <a className="underline decoration-border underline-offset-2 hover:text-text" href={s.url} target="_blank" rel="noreferrer">
              {s.name}
            </a>
          ) : (
            s.name
          )}
        </p>
        {mirror && (
          <span className="chip h-5 shrink-0 px-2 text-xs text-warn" style={{ borderColor: "rgb(245 165 36 / 0.5)" }}>
            via third-party mirror
          </span>
        )}
      </div>
      <p className="text-xs text-muted">
        {[s.vintage, s.use, s.license].filter(Boolean).join(" · ")}
      </p>
      {mirror && s.transport && <p className="mt-1 text-xs text-muted">{s.transport}</p>}
    </li>
  );
}

export default function AssumptionsDrawer() {
  const open = useApp((s) => s.assumptionsOpen);
  const setOpen = useApp((s) => s.setAssumptionsOpen);
  return <AnimatePresence>{open && <DrawerInner key="assumptions" onClose={() => setOpen(false)} />}</AnimatePresence>;
}

function DrawerInner({ onClose }: { onClose: () => void }) {
  const reduced = !!useReducedMotion();
  const ref = useDialog<HTMLElement>(true, onClose);
  const { data: manifest, error: mErr } = useSnapshotFile(loadManifest);
  const { data: assumptions, error: aErr } = useSnapshotFile(loadAssumptions);
  const approximation = useApp((s) => s.current?.detail?.approximation);
  const simKind = useApp((s) => s.simKind);

  const vintages: [string, string | undefined][] = manifest
    ? [
        ["Road network (OpenStreetMap)", manifest.osmDate ? fmtDate(manifest.osmDate) : undefined],
        ["Census ACS", manifest.acsVintage],
        ["Jobs (LEHD LODES)", manifest.lodes],
        ["Study area (W, S, E, N)", manifest.bbox?.join(", ")],
        ["Hexagon grid", manifest.h3Res !== undefined ? `H3 resolution ${manifest.h3Res}` : undefined],
        ["Snapshot", manifest.snapshotId],
        ["Built", manifest.builtAt ? fmtDate(manifest.builtAt) : undefined],
      ]
    : [];

  return (
    <>
      <motion.div
        className="fixed inset-0 z-30"
        style={{ background: "rgb(10 14 20 / 0.5)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.15 } }}
        onClick={onClose}
      />
      <motion.aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="assumptions-h"
        tabIndex={-1}
        className="panel fixed bottom-4 right-4 top-4 z-40 flex w-[480px] flex-col overflow-hidden"
        initial={reduced ? { opacity: 0 } : { opacity: 0, x: 32 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduced ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, x: 32, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 id="assumptions-h" className="text-base font-medium">
            Data and assumptions
          </h2>
          <button className="btn-icon" aria-label="Close data and assumptions" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
          {simKind === "mock" && (
            <p className="text-sm text-warn">Demo data is showing: the snapshot below is what the real simulator would use.</p>
          )}

          <section aria-labelledby="vintage-h">
            <h3 id="vintage-h" className="label mb-2">
              Data vintages
            </h3>
            {mErr && <p className="text-sm text-muted">manifest.json could not be loaded: {mErr}</p>}
            {!manifest && !mErr && <div className="skeleton h-24 w-full" aria-hidden />}
            {manifest && (
              <dl>
                {vintages
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[1fr_auto] gap-4 py-1">
                      <dt className="text-sm text-muted">{k}</dt>
                      <dd className="num text-right text-sm">{v}</dd>
                    </div>
                  ))}
              </dl>
            )}
            {manifest?.sources && (
              <>
                <h4 className="label mb-1 mt-4">Sources</h4>
                <ul>
                  {manifest.sources.map((s) => (
                    <SourceItem key={s.name} s={s} />
                  ))}
                </ul>
              </>
            )}
          </section>

          <section aria-labelledby="simplified-h">
            <h3 id="simplified-h" className="label mb-2">
              What is simplified
            </h3>
            <ul className="space-y-3">
              {SIMPLIFIED.map((s) => (
                <li key={s.title}>
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-sm text-muted">{s.body}</p>
                </li>
              ))}
              {approximation && (
                <li>
                  <p className="text-sm font-medium">Cross-harbor lens, interactive mode</p>
                  <p className="text-sm text-muted">{approximation}. The exact all-pairs version is the test reference.</p>
                </li>
              )}
            </ul>
          </section>

          <section aria-labelledby="params-h">
            <h3 id="params-h" className="label mb-2">
              Model parameters{assumptions ? ` (${assumptions.length})` : ""}
            </h3>
            <p className="mb-2 text-xs text-muted">From the snapshot&apos;s assumptions.json. &quot;Sourced&quot; values cite a dataset; &quot;Assumption&quot; values are choices, stated so you can check them.</p>
            {aErr && <p className="text-sm text-muted">assumptions.json could not be loaded: {aErr}</p>}
            {!assumptions && !aErr && <div className="skeleton h-40 w-full" aria-hidden />}
            {assumptions && (
              <ul>
                {assumptions.map((a) => (
                  <li key={a.id} className="border-b border-border py-3 last:border-0">
                    <div className="flex items-start justify-between gap-4">
                      <p className="text-sm">{a.label}</p>
                      <Badge status={a.status} />
                    </div>
                    <p className="num mt-1 break-words text-sm text-text">{fmtValue(a)}</p>
                    {(a.min !== undefined || a.max !== undefined) && (
                      <p className="num text-xs text-muted">
                        Documented range {a.min ?? "--"} to {a.max ?? "--"}
                        {a.unit ? ` ${a.unit}` : ""}
                      </p>
                    )}
                    {a.source && <p className="mt-1 text-xs text-muted">Source: {a.source}</p>}
                    {a.note && <p className="mt-1 text-xs text-muted">{a.note}</p>}
                    <p className="num mt-1 text-xs text-muted">{a.id}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </motion.aside>
    </>
  );
}

"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ExternalLink, Loader2, Scale, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { fetchEvidence } from "@/lib/agent/evidence";
import type { EvidenceResponse, EvidenceTopic } from "@/lib/agent/protocol";
import { useDialog } from "@/lib/ui/useDialog";
import { ribbonValues } from "@/lib/ui/ribbon";
import { LOWER_BOUND_SENTENCE, METHODOLOGY_URL, REPORTED_DETOUR } from "@/lib/ui/methodology";
import { fmtDurText, fmtMin } from "@/lib/format";

const TOPICS: { id: EvidenceTopic; label: string }[] = [
  { id: "detours", label: "Detours" },
  { id: "traffic", label: "Traffic" },
  { id: "freight", label: "Freight" },
];

const UNAVAILABLE: Record<string, string> = {
  no_key: "No search key is configured for this deployment.",
  cap_reached: "Today's search allowance is used up.",
  upstream_error: "The search service did not answer.",
  rate_limited: "Too many searches from this connection. Try again later.",
  disabled: "Live search is turned off for this deployment.",
  protection_unavailable: "Abuse protection is unavailable, so live search is paused.",
};

type State = { status: "idle" } | { status: "loading" } | { status: "done"; res: EvidenceResponse };

/** "Reality check": what news reports say happened after the collapse, next to what the simulation says. Sources only; nothing here is a result. */
export default function EvidenceDrawer() {
  const open = useApp((s) => s.evidenceOpen);
  const setOpen = useApp((s) => s.setEvidenceOpen);
  return <AnimatePresence>{open && <Inner key="evidence" onClose={() => setOpen(false)} />}</AnimatePresence>;
}

function Inner({ onClose }: { onClose: () => void }) {
  const reduced = !!useReducedMotion();
  const ref = useDialog<HTMLElement>(true, onClose);
  const [topic, setTopic] = useState<EvidenceTopic>("detours");
  const [state, setState] = useState<Record<string, State>>({});
  const baseline = useApp((s) => s.baseline);
  const current = useApp((s) => s.current);
  const removed = useApp((s) => s.scenario.removedLinks.includes("key_bridge"));
  const b = ribbonValues(baseline);
  const c = ribbonValues(current);
  const st = state[topic] ?? { status: "idle" };

  const load = async (t: EvidenceTopic) => {
    setState((s) => ({ ...s, [t]: { status: "loading" } }));
    const res = await fetchEvidence(t);
    setState((s) => ({ ...s, [t]: { status: "done", res } }));
  };

  return (
    <>
      <motion.div className="fixed inset-0 z-30" style={{ background: "rgb(10 14 20 / 0.5)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} onClick={onClose} />
      <motion.aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-h"
        tabIndex={-1}
        className="panel fixed bottom-4 left-4 top-4 z-40 flex w-[460px] flex-col overflow-hidden"
        initial={reduced ? { opacity: 0 } : { opacity: 0, x: -32 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduced ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, x: -32, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 id="evidence-h" className="text-base font-medium">
            Reality check
          </h2>
          <button className="btn-icon" aria-label="Close reality check" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <section aria-labelledby="sim-h" className="card p-3">
            <h3 id="sim-h" className="label mb-1">
              What the simulation says (free-flow)
            </h3>
            {removed && b && c ? (
              <p className="text-sm">
                With the Key Bridge removed, the average trip to jobs across the harbor grows by <span className="num">{fmtDurText(c.v.xhTime - b.v.xhTime)}</span>; where people
                live, the hardest-hit place adds <span className="num">{fmtMin(c.x.xhAddedMaxPopS / 60)} min</span>.
              </p>
            ) : (
              <p className="text-sm text-muted">Remove the Key Bridge link to see the simulated detour next to the reports.</p>
            )}
            <p className="mt-2 text-xs text-muted">
              {LOWER_BOUND_SENTENCE} Source: {REPORTED_DETOUR.source};{" "}
              <a className="underline decoration-border underline-offset-2 hover:text-text" href={METHODOLOGY_URL} target="_blank" rel="noreferrer">
                Methodology
              </a>
              .
            </p>
          </section>

          <div role="tablist" aria-label="Topic" className="grid grid-cols-3 gap-1 rounded-ctl bg-bg/60 p-1">
            {TOPICS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={topic === t.id}
                onClick={() => setTopic(t.id)}
                className="h-8 rounded-[6px] text-sm"
                style={topic === t.id ? { background: "var(--color-surface-2)", color: "var(--color-text)", boxShadow: "inset 0 0 0 1px var(--color-border)" } : { color: "var(--color-muted)" }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button className="btn w-full" onClick={() => void load(topic)} disabled={st.status === "loading"} data-autofocus>
            {st.status === "loading" ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Scale size={14} aria-hidden />}
            {st.status === "loading" ? "Searching news sources..." : st.status === "done" ? "Search again" : "Search news sources (Tavily)"}
          </button>

          {st.status === "done" && st.res.status === "unavailable" && (
            <div role="status" className="rounded-ctl border border-border p-3">
              <p className="text-sm font-medium">Live sources unavailable</p>
              <p className="text-xs text-muted">{UNAVAILABLE[st.res.reason] ?? st.res.message}</p>
            </div>
          )}
          {st.status === "done" && st.res.status === "ok" && (
            <section aria-label="Sources">
              <p className="mb-2 text-xs text-muted" role="status">
                {st.res.message}
                {st.res.cached ? ` (${st.res.cachedNotice ?? "cached result"})` : ""} Retrieved {new Date(st.res.retrievedAt).toLocaleString("en-US")}.
              </p>
              {st.res.sources.length === 0 ? (
                <p className="text-xs text-muted">No sources found for this topic.</p>
              ) : (
                <ul className="space-y-2">
                  {st.res.sources.map((s, i) => (
                    <li key={i} className="card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <a className="text-sm underline decoration-border underline-offset-2 hover:text-text" href={s.url} target="_blank" rel="noreferrer">
                          {s.title} <ExternalLink size={10} className="inline" aria-hidden />
                        </a>
                        <span className="chip h-5 shrink-0 px-2 text-xs text-warn" style={{ borderColor: "rgb(245 165 36 / 0.5)" }}>
                          unverified source
                        </span>
                      </div>
                      <p className="num text-xs text-muted">
                        {s.domain}
                        {s.publishedDate ? ` · ${s.publishedDate}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted">{s.snippet}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </motion.aside>
    </>
  );
}

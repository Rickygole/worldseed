"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ExternalLink, Loader2, Newspaper, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { assertMutationRecordAllowed, confirmClosureProposal, fetchClosures, recordUserConfirmation, toMutationRecord } from "@/lib/agent/closures";
import { useSearch } from "@/lib/ui/search";
import type { ClosureProposal, ClosuresResponse } from "@/lib/agent/protocol";
import { useDialog } from "@/lib/ui/useDialog";
import { shortModel } from "@/lib/ui/agentBridge";

type Fetch = { status: "idle" } | { status: "loading" } | { status: "done"; res: ClosuresResponse; at: number } | { status: "error"; message: string };

const REASONS: Record<string, string> = {
  not_in_model_area: "not in the model area",
  ambiguous: "road name is ambiguous",
  unsupported_kind: "not a closure the model can represent",
  already_ended: "already ended",
  not_yet_started: "not started yet",
  unclear_status: "status unclear",
  partial_closure: "partial closure (lanes only)",
  completed_event: "event already over",
  hypothetical_scenario: "a hypothetical, not a notice",
  hearsay: "second-hand report",
};

const UNAVAILABLE: Record<string, string> = {
  no_key: "No search key is configured for this deployment.",
  cap_reached: "Today's search allowance is used up.",
  upstream_error: "The search service did not answer.",
  rate_limited: "Too many searches from this connection. Try again later.",
  catalog_unavailable: "The road catalog could not be loaded.",
  disabled: "Live search is turned off for this deployment.",
  protection_unavailable: "Abuse protection is unavailable, so live search is paused.",
};

const host = (u: string) => {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return u;
  }
};

function Proposal({ p }: { p: ClosureProposal }) {
  const [step, setStep] = useState<"idle" | "confirm" | "working" | "done" | "error">("idle");
  const [err, setErr] = useState("");
  const scenario = useApp((s) => s.scenario);
  const applyScenario = useApp((s) => s.applyScenario);
  const log = useApp((s) => s.log);
  // A low-confidence proposal (the quote may not state a current closure) needs the source opened first.
  const [opened, setOpened] = useState(false);
  const low = p.confidence === "low";
  const canConfirm = !!p.confirmToken && (!low || opened);

  return (
    <li className="card p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{p.matchedName}</p>
          <p className="text-xs text-muted">Report names: {p.road}</p>
        </div>
        <span className="chip h-6 shrink-0 px-2 text-xs text-warn" style={{ borderColor: "rgb(245 165 36 / 0.5)" }}>
          Unverified news report
        </span>
      </div>
      <blockquote className="mt-2 border-l-2 border-border pl-2 text-xs italic text-muted">&ldquo;{p.provenance.quote}&rdquo;</blockquote>
      {low && (
        <p className="mt-2 text-xs text-warn">
          Low confidence. {p.reviewHint ?? "The quote may not describe a current closure."} Open the source before confirming.
        </p>
      )}
      <p className="mt-1 text-xs text-muted">
        <a
          className="inline-flex items-center gap-1 underline decoration-border underline-offset-2 hover:text-text"
          href={p.provenance.url}
          target="_blank"
          rel="noreferrer"
          onClick={() => setOpened(true)}
        >
          {host(p.provenance.url)} <ExternalLink size={10} aria-hidden />
        </a>
        {p.startDate ? ` · from ${p.startDate}` : ""}
        {p.endDate ? ` · until ${p.endDate}` : ""}
      </p>
      {step === "idle" && (
        <button className="btn mt-2 h-8 w-full text-xs" disabled={!canConfirm} onClick={() => setStep("confirm")} title={canConfirm ? undefined : low && !opened ? "Open the source first." : "This proposal cannot be confirmed right now."}>
          Add this closure to the world...
        </button>
      )}
      {step === "confirm" && (
        <div className="mt-2 space-y-2 rounded-ctl border border-border p-2">
          <p className="text-xs">
            Close <span className="font-medium">{p.matchedName}</span> in the simulation? The report is unverified; nothing outside this simulation changes. Reset (R) removes it.
          </p>
          <div className="flex gap-2">
            <button
              className="btn h-8 flex-1 border-ai text-xs"
              onClick={async () => {
                // The user's click is the confirmation; the server redeems its single-use token.
                const confirmation = recordUserConfirmation(p);
                setStep("working");
                try {
                  const confirmed = await confirmClosureProposal(p, confirmation);
                  const record = toMutationRecord(confirmed);
                  assertMutationRecordAllowed(record);
                  log("USER", `Confirmed closure from an unverified news report: ${record.label}`);
                  await applyScenario({ removedLinks: scenario.removedLinks, mutations: [...(scenario.mutations ?? []), record] }, { strict: true });
                  setStep("done");
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                  setStep("error");
                }
              }}
            >
              Confirm closure
            </button>
            <button className="btn h-8 text-xs" onClick={() => setStep("idle")}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {step === "working" && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted">
          <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden /> Confirming and recomputing...
        </p>
      )}
      {step === "done" && <p className="mt-2 text-xs text-ok">Added to the world. Every lens was recomputed.</p>}
      {step === "error" && <p className="mt-2 text-xs text-critical">Not added: {err}</p>}
    </li>
  );
}

export default function ClosuresDrawer() {
  const open = useApp((s) => s.closuresOpen);
  const setOpen = useApp((s) => s.setClosuresOpen);
  return <AnimatePresence>{open && <Inner key="closures" onClose={() => setOpen(false)} />}</AnimatePresence>;
}

function Inner({ onClose }: { onClose: () => void }) {
  const reduced = !!useReducedMotion();
  const ref = useDialog<HTMLElement>(true, onClose);
  const [f, setF] = useState<Fetch>({ status: "idle" });
  const health = useSearch((s) => s.health);
  // Without a confirmation secret on the server nothing could be confirmed, so the feed is off.
  const disabled = (health.status === "available" || health.status === "unavailable") && !health.info.tavily;

  const check = async () => {
    setF({ status: "loading" });
    try {
      const res = await fetchClosures();
      if (!res || typeof res !== "object" || !("status" in res)) throw new Error("unexpected answer");
      setF({ status: "done", res, at: Date.now() });
    } catch (e) {
      setF({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <motion.div className="fixed inset-0 z-30" style={{ background: "rgb(10 14 20 / 0.5)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} onClick={onClose} />
      <motion.aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="closures-h"
        tabIndex={-1}
        className="panel fixed bottom-4 left-4 top-4 z-40 flex w-[440px] flex-col overflow-hidden"
        initial={reduced ? { opacity: 0 } : { opacity: 0, x: -32 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduced ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, x: -32, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 id="closures-h" className="text-base font-medium">
            Live closure notices
          </h2>
          <button className="btn-icon" aria-label="Close closure notices" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <p className="text-sm text-muted">
            Searches current news for road closures in the model area (Tavily), and matches road names to the road network. Results are unverified reports. Nothing enters the world unless you
            confirm it, one closure at a time.
          </p>
          {disabled && (
            <div role="status" className="rounded-ctl border border-border p-3">
              <p className="text-sm font-medium">Live feed unavailable</p>
              <p className="text-xs text-muted">Live closure search is not configured for this deployment.</p>
            </div>
          )}
          <button className="btn w-full" onClick={() => void check()} disabled={f.status === "loading" || disabled} data-autofocus>
            {f.status === "loading" ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Newspaper size={14} aria-hidden />}
            {f.status === "loading" ? "Searching (up to 45 s)..." : f.status === "done" ? "Check again" : "Check live closure notices"}
          </button>

          {f.status === "error" && (
            <div role="alert" className="rounded-ctl border border-border p-3">
              <p className="text-sm font-medium">Live feed unavailable</p>
              <p className="text-xs text-muted">The closure service could not be reached ({f.message}).</p>
            </div>
          )}

          {f.status === "done" && f.res.status === "unavailable" && (
            <div role="status" className="rounded-ctl border border-border p-3">
              <p className="text-sm font-medium">Live feed unavailable</p>
              <p className="text-xs text-muted">{UNAVAILABLE[f.res.reason] ?? f.res.message}</p>
            </div>
          )}

          {f.status === "done" && f.res.status === "ok" && (
            <div className="space-y-4">
              <p className="text-xs text-muted" role="status">
                {f.res.message}
                {f.res.cached ? ` (${f.res.cachedNotice ?? "cached result"})` : ""}
                {f.res.model ? ` Road names extracted by ${shortModel(f.res.model)} and checked against the source text.` : ""} Retrieved {new Date(f.res.retrievedAt).toLocaleString("en-US")}.
              </p>
              <section aria-labelledby="prop-h">
                <h3 id="prop-h" className="label mb-2">
                  Matched to the road network ({f.res.proposals.length})
                </h3>
                {f.res.proposals.length === 0 ? (
                  <p className="text-xs text-muted">None matched a road in the model area.</p>
                ) : (
                  <ul className="space-y-2">
                    {f.res.proposals.map((p) => (
                      <Proposal key={p.id} p={p} />
                    ))}
                  </ul>
                )}
              </section>
              {f.res.unmatched.length > 0 && (
                <section aria-labelledby="unm-h">
                  <h3 id="unm-h" className="label mb-2">
                    Found but not usable ({f.res.unmatched.length})
                  </h3>
                  <ul className="space-y-1 text-xs text-muted">
                    {f.res.unmatched.map((u, i) => (
                      <li key={i}>
                        {u.road}: {REASONS[u.reason] ?? u.reason} ·{" "}
                        <a className="underline decoration-border underline-offset-2 hover:text-text" href={u.sourceUrl} target="_blank" rel="noreferrer">
                          {host(u.sourceUrl)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {f.res.sources.length > 0 && (
                <section aria-labelledby="src-h">
                  <h3 id="src-h" className="label mb-2">
                    Sources searched ({f.res.sources.length})
                  </h3>
                  <ul className="space-y-2 text-xs">
                    {f.res.sources.map((s, i) => (
                      <li key={i}>
                        <a className="underline decoration-border underline-offset-2 hover:text-text" href={s.url} target="_blank" rel="noreferrer">
                          {s.title}
                        </a>
                        <span className="text-muted"> · {s.source}</span>
                        <p className="text-muted">{s.snippet}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      </motion.aside>
    </>
  );
}

"use client";

import { useMemo, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { useApp, simInfo } from "@/lib/store";
import { explain, type Seg } from "@/lib/ui/explainer";
import { loadAux } from "@/lib/ui/snapshotAux";
import { useSnapshotFile } from "@/lib/ui/useSnapshotFile";

function Segs({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) =>
        typeof s === "string" ? (
          <span key={i}>{s}</span>
        ) : (
          <span
            key={i}
            className="num font-medium"
            style={{ color: s.tone === "bad" ? "var(--color-critical)" : s.tone === "good" ? "var(--color-ok)" : "var(--color-text)" }}
          >
            {s.n}
          </span>
        ),
      )}
    </>
  );
}

/** The story's core stays open; supporting sections fold to a one-line summary (their key figure). */
const OPEN_TALL = new Set(["baseline", "next", "regional", "xharbor", "freight"]);
const OPEN_SHORT = new Set(["baseline", "next", "regional", "xharbor"]);

/** Tall screens open more sections than short ones. */
function useTall(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const q = window.matchMedia("(min-height: 860px)");
      q.addEventListener("change", cb);
      return () => q.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-height: 860px)").matches,
    () => true,
  );
}

/** "What this shows": computed sentences from fixed templates. Every number is a slot. */
export default function Explainer() {
  const baseline = useApp((s) => s.baseline);
  const current = useApp((s) => s.current);
  const scenario = useApp((s) => s.scenario);
  const status = useApp((s) => s.status);
  const trips = useApp((s) => s.trips);
  const simKind = useApp((s) => s.simKind);
  const { data: aux } = useSnapshotFile(loadAux, status === "ready");

  const paras = useMemo(() => {
    if (!baseline || !current) return null;
    const info = simInfo();
    return explain({ baseline, current, scenario, aux, params: info ? info.params : null, trips });
  }, [baseline, current, scenario, aux, trips]);

  const runner = current?.detail?.runnerText;
  const tall = useTall();
  const approx = current?.detail?.approximation;

  return (
    <section aria-labelledby="explainer-h" className="pb-4">
      <h2 id="explainer-h" className="sr-only">
        What this shows
      </h2>
      {status === "error" ? (
        <p className="text-sm text-muted">Nothing to explain until the simulation loads.</p>
      ) : !paras ? (
        <div className="space-y-2" aria-hidden>
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-11/12" />
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton mt-4 h-4 w-full" />
          <div className="skeleton h-4 w-5/6" />
        </div>
      ) : simKind === "mock" || paras.length === 0 ? (
        <p className="text-sm text-muted">Demo data: the simulation snapshot is not available, so there is nothing real to explain.</p>
      ) : (
        <div className="space-y-1.5">
          {paras.map((p, i) => {
            const first = p.segs.find((x): x is Exclude<Seg, string> => typeof x !== "string");
            return (
              <details key={`${p.id}-${tall ? "t" : "s"}`} open={(tall ? OPEN_TALL : OPEN_SHORT).has(p.id) || i === 0} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1 py-0.5 text-xs font-medium text-text-2 hover:text-text [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={12} className="transition-transform duration-150 group-open:rotate-90" aria-hidden />
                  <h3 className="inline">{p.heading}</h3>
                  {(p.summary ?? first?.n) && <span className="num ml-auto font-normal group-open:hidden">{p.summary ?? first?.n}</span>}
                </summary>
                <p className="pb-1 pl-4 text-sm leading-5 text-text-2">
                  <Segs segs={p.segs} />
                  {p.link && (
                    <>
                      {" "}
                      <a className="text-xs text-muted underline decoration-border underline-offset-2 hover:text-text" href={p.link.href} target="_blank" rel="noreferrer">
                        {p.link.text}
                      </a>
                    </>
                  )}
                </p>
              </details>
            );
          })}
          {runner && (
            <p className="num border-t border-border pt-2 text-xs text-muted">
              <span title={approx ? `Cross-harbor lens: ${approx}` : undefined}>{runner}.</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

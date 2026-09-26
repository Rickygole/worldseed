"use client";

import { useMemo } from "react";
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

/** "What this shows": computed sentences from fixed templates. Every number is a slot. */
export default function Explainer() {
  const baseline = useApp((s) => s.baseline);
  const current = useApp((s) => s.current);
  const scenario = useApp((s) => s.scenario);
  const status = useApp((s) => s.status);
  const simKind = useApp((s) => s.simKind);
  const { data: aux } = useSnapshotFile(loadAux, status === "ready");

  const paras = useMemo(() => {
    if (!baseline || !current) return null;
    const info = simInfo();
    return explain({ baseline, current, scenario, aux, params: info ? info.params : null });
  }, [baseline, current, scenario, aux]);

  const runner = current?.detail?.runnerText;
  const approx = current?.detail?.approximation;

  return (
    <section aria-labelledby="explainer-h" className="px-4 pb-4 pt-4">
      <h2 id="explainer-h" className="label mb-3">
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
        <div className="space-y-2">
          {paras.map((p) => (
            <div key={p.id}>
              <h3 className="text-xs font-medium text-muted">{p.heading}</h3>
              <p className="text-sm leading-5 text-text/90">
                <Segs segs={p.segs} />
              </p>
            </div>
          ))}
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

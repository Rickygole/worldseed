"use client";

import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, Bot, CheckCircle2, Circle, Cpu, Info, ListChecks, ShieldCheck } from "lucide-react";
import { PROSE_CLAIM } from "@/lib/agent/prose";
import type { LogEntry } from "@/lib/agent/machine";
import { useSearch } from "@/lib/ui/search";
import { shortModel } from "@/lib/ui/agentBridge";
import { REASONING_LABEL } from "@/lib/agent/reasoning";
import Collapsible from "../ui/Collapsible";

const KIND: Record<LogEntry["kind"], { label: string; icon: typeof Info; tone?: string }> = {
  decision: { label: "Decision", icon: CheckCircle2 },
  validator: { label: "Validator", icon: ShieldCheck, tone: "var(--color-warn)" },
  fallback: { label: "Fallback", icon: AlertTriangle, tone: "var(--color-warn)" },
  info: { label: "Info", icon: Info },
  evaluation: { label: "Simulator", icon: Cpu },
  state: { label: "Step", icon: Circle },
  commentary: { label: "AI rationale", icon: Bot },
  reasoning: { label: "Model reasoning", icon: Bot },
};

const fmtT = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

interface Row {
  e: LogEntry;
  /** Model rationale and raw reasoning attached to this entry: shown only in its expandable detail, never as a result. */
  rationale: LogEntry[];
  reasoning: LogEntry[];
}

/** Model commentary never stands alone in the log: it is folded into the application entry it follows. */
function group(log: readonly LogEntry[]): Row[] {
  const out: Row[] = [];
  for (const e of log) {
    const last = out[out.length - 1];
    if (e.kind === "commentary" && last) last.rationale.push(e);
    else if (e.kind === "reasoning" && last) last.reasoning.push(e);
    else if (e.kind !== "commentary" && e.kind !== "reasoning") out.push({ e, rationale: [], reasoning: [] });
  }
  return out;
}

function Entry({ row }: { row: Row }) {
  const { e, rationale, reasoning } = row;
  const k = KIND[e.kind];
  const Icon = k.icon;
  const hasDetail = e.raw !== undefined || (e.errors && e.errors.length > 0) || rationale.length > 0 || reasoning.length > 0 || e.model;
  return (
    <li className="grid grid-cols-[16px_1fr] gap-x-2">
      <Icon size={14} className="mt-0.5" style={{ color: k.tone ?? "var(--color-muted)" }} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm leading-5">
          <span className="sr-only">{k.label}: </span>
          {e.sentence}
        </p>
        <p className="num text-xs text-muted">
          {fmtT(e.t)} · {k.label}
          {e.model ? ` · ${shortModel(e.model)}` : ""}
        </p>
        {hasDetail && (
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer text-muted hover:text-text">Details</summary>
            <div className="mt-1 space-y-2 rounded-[10px] bg-[rgb(7_11_18/0.5)] p-2 shadow-[inset_0_0_0_1px_var(--color-border)]">
              {e.model && <p className="text-muted">Model: <span className="num text-text">{e.model}</span></p>}
              {e.errors && e.errors.length > 0 && (
                <div>
                  <p className="text-muted">Validator verdicts</p>
                  <ul className="num mt-1 flex flex-wrap gap-1">
                    {e.errors.map((x, i) => (
                      <li key={i} className="chip h-auto min-h-5 whitespace-normal px-2 py-0.5 text-warn" style={{ borderColor: "rgb(245 165 36 / 0.5)" }}>
                        {x}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {rationale.map((r) => (
                <p key={r.id} className="text-text/90">
                  {r.sentence}
                  {r.model ? <span className="num text-muted"> · {shortModel(r.model)}</span> : null}
                </p>
              ))}
              {reasoning.map((r) =>
                r.reasoning ? (
                  <div key={r.id}>
                    <p className="text-muted">{REASONING_LABEL}</p>
                    <p className="num text-muted">
                      {r.reasoning.role} · {shortModel(r.reasoning.model)} · {r.reasoning.tokensIn.toLocaleString("en-US")} in / {r.reasoning.tokensOut.toLocaleString("en-US")} out ·{" "}
                      {(r.reasoning.latencyMs / 1000).toFixed(1)} s
                    </p>
                    <p className="mt-0.5 text-text/90">{r.reasoning.text}</p>
                  </div>
                ) : null,
              )}
              {e.raw !== undefined && (
                <div>
                  <p className="text-muted">Tool output after client validation</p>
                  <pre className="num mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted">{JSON.stringify(e.raw, null, 2)}</pre>
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    </li>
  );
}

export default function DecisionLog() {
  const m = useSearch((s) => s.m);
  const ref = useRef<HTMLOListElement>(null);
  const rows = useMemo(() => group(m?.log ?? []), [m?.log]);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "auto" });
  }, [rows.length]);
  const b = m?.budget;
  const ai = m?.mode === "ai" && (m.log.some((e) => e.model) || Object.keys(m.models).length > 0);

  return (
    <Collapsible title="Decision log" meta={rows.length > 0 ? <span className="num">{rows.length}</span> : "empty"} headerClassName="py-3">
      {rows.length === 0 ? (
        <p className="flex gap-2 pb-4 text-xs leading-4 text-muted">
          <ListChecks size={14} className="shrink-0" aria-hidden />
          No search yet. Each step is listed here in plain sentences, with every number filled in from the simulator.
        </p>
      ) : (
        <div className="pb-4">
          {ai && (
            <p className="mb-2 text-xs text-muted">
              {PROSE_CLAIM} AI-generated text may be inaccurate.
              {b && b.limitIn > 0 && (
                <span className="num">
                  {" "}
                  Tokens this mission: {b.inputTokens.toLocaleString("en-US")} in / {b.outputTokens.toLocaleString("en-US")} out.
                </span>
              )}
            </p>
          )}
          <ol ref={ref} aria-live="polite" className="max-h-[240px] space-y-3 overflow-y-auto pr-1">
            {rows.map((r) => (
              <Entry key={r.e.id} row={r} />
            ))}
          </ol>
        </div>
      )}
    </Collapsible>
  );
}

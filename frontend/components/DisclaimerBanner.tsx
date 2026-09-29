"use client";

import { useApp } from "@/lib/store";

/** The planning notice. It lives only in this file (the wording checker whitelists it here); import it elsewhere. */
export const NOTICE_SHORT = "Planning simulation, not dispatch.";
export const NOTICE_REST = "Simulated times on historical open data. Not affiliated with any agency or hospital.";
export const DISCLAIMER = `${NOTICE_SHORT} ${NOTICE_REST}`;
export const AI_TEXT_NOTE = "AI-generated text may be inaccurate";

/**
 * The always-visible slim notice (footer line in both modes; inside the sheet on phones). "About and sources"
 * opens the full intended-use text, data sources and licenses in one click.
 */
export default function NoticeLine({ compact = false }: { compact?: boolean }) {
  const setAboutOpen = useApp((s) => s.setAboutOpen);
  const simKind = useApp((s) => s.simKind);
  return (
    <p className="flex min-w-0 items-center gap-x-3 text-xs text-muted" role="note" aria-label="Intended use">
      <span className="shrink-0 font-medium text-text-2">{NOTICE_SHORT}</span>
      {!compact && <span className="min-w-0 truncate max-[1599px]:hidden">{NOTICE_REST}</span>}
      {!compact && <span className="shrink-0 max-[1023px]:hidden">{AI_TEXT_NOTE}.</span>}
      {simKind === "mock" && <span className="shrink-0 text-warn">Demo data</span>}
      <button type="button" className="link shrink-0 text-text-2" onClick={() => setAboutOpen(true)}>
        About and sources
      </button>
    </p>
  );
}

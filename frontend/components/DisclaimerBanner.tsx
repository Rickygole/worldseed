"use client";

import Link from "next/link";
import { useApp } from "@/lib/store";
import { TOKEN_FACTORY_TERMS } from "./AboutDialog";

/** The planning notice. It lives only in this file (the wording checker whitelists it here); import it elsewhere. */
export const NOTICE_SHORT = "Planning simulation, not dispatch.";
export const NOTICE_REST = "Simulated times on historical open data. Not affiliated with any agency or hospital.";
export const DISCLAIMER = `${NOTICE_SHORT} ${NOTICE_REST}`;
export const AI_TEXT_NOTE = "AI-generated text may be inaccurate";

/**
 * The always-visible notice. The full sentence is never hidden by width: it is set as running text, so on
 * narrow screens it wraps onto a second line at a word break. Each part carries its gap as a right margin, which
 * falls harmlessly at a line end instead of indenting the wrapped line; links never split mid-label.
 *   - "full": Expert footer. Adds the AI-text note (the footer's credits carry the Token Factory terms link).
 *   - "story": the guided story. No AI text there to disclaim, so no AI note, but the terms link rides along,
 *     since story mode has no credits footer.
 *   - "compact": document pages only, whose own body carries the full About text.
 * "About and sources" opens the full intended-use text, data sources and licenses in one click.
 */
export default function NoticeLine({ variant = "full" }: { variant?: "full" | "story" | "compact" }) {
  const simKind = useApp((s) => s.simKind);
  return (
    <p className="min-w-0 text-pretty text-xs leading-[18px] text-muted" role="note" aria-label="Intended use">
      <span className="mr-2 font-medium text-text-2">{NOTICE_SHORT}</span>{" "}
      {variant !== "compact" && <><span className="mr-2">{NOTICE_REST}</span>{" "}</>}
      {variant === "full" && <><span className="mr-2">{AI_TEXT_NOTE}.</span>{" "}</>}
      {simKind === "mock" && <><span className="mr-2 text-warn">Demo data</span>{" "}</>}
      <Link href="/about" className="link mr-2 whitespace-nowrap text-text-2">
        About and sources
      </Link>
      {variant === "story" && (
        <>
          {" "}
          <a className="link whitespace-nowrap text-text-2" href={TOKEN_FACTORY_TERMS} target="_blank" rel="noreferrer">
            Token Factory terms
          </a>
        </>
      )}
    </p>
  );
}

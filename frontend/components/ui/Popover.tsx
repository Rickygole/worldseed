"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ExternalLink, HelpCircle, X } from "lucide-react";
import type { CaveatCopy } from "@/lib/ui/storyCopy";
import { CaveatVisualView, SourceCards } from "./CaveatExtras";

const W = 360;

interface Props {
  /** Trigger content. */
  trigger: ReactNode;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
  triggerLabel?: string;
  title: string;
  children: ReactNode;
  /** Preferred side; flips when there is no room. */
  side?: "top" | "bottom";
}

/**
 * Anchored popover (e2). Enter/Space opens, Escape or an outside click closes and returns focus to the
 * trigger. Not modal and not a live region: the text is read when focus moves into it.
 */
export default function Popover({ trigger, triggerClassName, triggerStyle, triggerLabel, title, children, side = "top" }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const reduced = !!useReducedMotion();

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(W, vw - 16);
    // Inside the story card on wide screens: open beside the card, over the map, so the card stays readable.
    const edge = btn.current?.closest<HTMLElement>("[data-popover-edge]")?.getBoundingClientRect();
    if (edge && vw >= 768 && edge.right + 16 + width < vw - 8) {
      setPos({ left: edge.right + 16, bottom: Math.max(16, vh - r.bottom - 8), width });
      return;
    }
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    const roomAbove = r.top > 220;
    const up = side === "top" ? roomAbove : vh - r.bottom < 220 && roomAbove;
    setPos(up ? { left, bottom: vh - r.top + 8, width } : { left, top: r.bottom + 8, width });
  }, [side]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onResize = () => place();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onResize);
    // Move focus into the popover so its text is read; Tab continues from there.
    const t = window.setTimeout(() => pop.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(t);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={triggerClassName}
        style={triggerStyle}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={triggerLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.div
                ref={pop}
                id={id}
                role="dialog"
                aria-label={title}
                tabIndex={-1}
                className="pop fixed z-[70] p-4 text-sm outline-none"
                style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: pos.bottom !== undefined ? 4 : -4 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }}
                exit={{ opacity: 0, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } }}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-text">{title}</p>
                  <button type="button" className="btn-icon -mr-2 -mt-1 !h-7 !w-7" aria-label="Close" onClick={() => { setOpen(false); btn.current?.focus(); }}>
                    <X size={14} aria-hidden />
                  </button>
                </div>
                <div className="text-sm leading-5 text-text-2">{children}</div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

/** A caveat: a small "?" chip that opens its popover (title, one short paragraph, optional source and link). */
export function Caveat({ c, tone }: { c: CaveatCopy; tone?: "warn" }) {
  return (
    <Popover
      title={c.title}
      triggerClassName={`chip h-7 cursor-pointer px-2.5 text-xs transition-colors duration-150 hover:bg-[rgb(148_163_184/0.16)] ${tone === "warn" ? "text-warn" : "text-text-2"}`}
      trigger={
        <>
          <HelpCircle size={13} aria-hidden />
          {c.label}
        </>
      }
    >
      <CaveatBody c={c} />
    </Popover>
  );
}

export function CaveatBody({ c }: { c: CaveatCopy }) {
  return (
    <>
      <p>{c.body}</p>
      {c.visual && <CaveatVisualView v={c.visual} />}
      {c.sources && c.sources.length > 0 && <SourceCards sources={c.sources} />}
      {c.source && <p className="mt-2 text-xs text-muted">{c.source}</p>}
      {(c.link || c.link2) && (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {[c.link, c.link2].filter((l): l is { href: string; text: string } => !!l).map((l) => (
            <a key={l.href} className="link inline-flex items-center gap-1 text-xs text-text-2" href={l.href} target="_blank" rel="noreferrer">
              {l.text}
              <ExternalLink size={11} aria-hidden />
            </a>
          ))}
        </p>
      )}
    </>
  );
}

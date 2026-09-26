"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog behavior: Escape closes, Tab is trapped inside, focus moves in on open and returns to
 * whatever had it before on close. Attach the returned ref to the dialog element.
 */
export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void, opts: { trap?: boolean } = {}) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const trap = opts.trap ?? true;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Focus the first control (or the dialog itself) once it has rendered.
    const t = window.setTimeout(() => {
      const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? el)?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (!trap || e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open, trap]);

  return ref;
}

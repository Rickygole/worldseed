"use client";

import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";

interface Props {
  title: ReactNode;
  /** Shown on the right of the header (a count, a one-line summary). */
  meta?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
}

/** Disclosure section: a button with aria-expanded and a region that animates its height (instant under reduced motion). */
export default function Collapsible({ title, meta, defaultOpen = false, open: controlled, onOpenChange, children, className = "", headerClassName = "" }: Props) {
  const [inner, setInner] = useState(defaultOpen);
  const open = controlled ?? inner;
  const setOpen = (v: boolean) => {
    if (controlled === undefined) setInner(v);
    onOpenChange?.(v);
  };
  const id = useId();
  const reduced = !!useReducedMotion();
  return (
    <section className={className}>
      <button
        type="button"
        className={`group flex w-full items-center gap-2 py-2 text-left ${headerClassName}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={14} className="shrink-0 text-muted transition-transform duration-200 group-hover:text-text" style={{ transform: open ? "rotate(90deg)" : "none" }} aria-hidden />
        <span className="label min-w-0 flex-1 truncate group-hover:text-text">{title}</span>
        {meta && <span className="shrink-0 text-xs text-muted">{meta}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            key="body"
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } }}
            style={{ overflow: "hidden" }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

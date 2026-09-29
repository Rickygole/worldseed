"use client";

import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";

export const TONE_COLOR: Record<string, string> = {
  neutral: "var(--color-text)",
  ok: "var(--color-ok)",
  warn: "var(--color-warn)",
  critical: "var(--color-critical)",
  ai: "var(--color-ai)",
  future: "var(--color-future)",
};

interface Props {
  /** Same key as the previous render: roll from the old value. A new key: land on the value (the parent fades it in). */
  rollKey: string;
  value: number;
  format: (v: number) => string;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

/**
 * Display number that rolls to its new value (900 ms ease-out; instant under reduced motion). The text updates
 * through a motion value, so rolling never re-renders React per frame.
 */
export default function BigNumber({ rollKey, value, format, className, style, title }: Props) {
  const reduced = !!useReducedMotion();
  const mv = useMotionValue(value);
  const fmt = useRef(format);
  useEffect(() => {
    fmt.current = format;
  }, [format]);
  const text = useTransform(mv, (v) => fmt.current(v));
  const lastKey = useRef(rollKey);

  useEffect(() => {
    if (reduced || lastKey.current !== rollKey) {
      lastKey.current = rollKey;
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value, rollKey, reduced, mv]);

  return (
    <motion.span className={`display ${className ?? ""}`} style={style} title={title} aria-hidden>
      {text}
    </motion.span>
  );
}

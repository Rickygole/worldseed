"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";

interface Props {
  value: number;
  format: (v: number) => string;
  /** Seconds. Matches the terrain animation so numbers land with the hexes. */
  duration?: number;
  delay?: number;
  className?: string;
  /** Mono face (default) or inherit the parent's face (display numbers). */
  mono?: boolean;
}

/** Tabular mono counter that rolls to its new value (instant under reduced motion). */
export default function RollingNumber({ value, format, duration = 1.5, delay = 0.2, className, mono = true }: Props) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, format);

  useEffect(() => {
    if (reduced) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration, delay, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [value, reduced, duration, delay, mv]);

  return <motion.span className={`${mono ? "num" : ""} ${className ?? ""}`}>{text}</motion.span>;
}

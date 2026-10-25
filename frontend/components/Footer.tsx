"use client";

import { useEffect, useRef } from "react";
import NoticeLine from "./DisclaimerBanner";
import { TOKEN_FACTORY_TERMS } from "./AboutDialog";

/**
 * Footer line: the planning notice on the left, data and service credits on the right. Always visible, never
 * truncated: when both do not fit on one line the credits wrap onto a second row. Its live height is published
 * as `--ws-footer-h`, so the map attribution can sit clear of it when the footer floats over the map.
 */
export default function Footer() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--ws-footer-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <footer
      ref={ref}
      className="pointer-events-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-0.5 px-4 py-1.5 text-xs leading-[18px] text-muted"
      style={{ minHeight: "var(--ws-footer)" }}
    >
      <NoticeLine />
      <p className="min-w-0">
        Data:{" "}
        <a className="link" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          &copy; OpenStreetMap contributors
        </a>{" "}
        (ODbL) · U.S. Census Bureau · MD iMAP · AI: NVIDIA Nemotron via Nebius Token Factory (
        <a className="link" href={TOKEN_FACTORY_TERMS} target="_blank" rel="noreferrer">
          Terms
        </a>
        ) · Search: Tavily
      </p>
    </footer>
  );
}

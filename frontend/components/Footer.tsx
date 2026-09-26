"use client";

import { useApp } from "@/lib/store";

const linkCls = "underline decoration-border underline-offset-2 hover:text-text";

export default function Footer() {
  const provenance = useApp((s) => s.world?.provenance);
  return (
    <footer
      className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-4 border-t border-border px-4 text-xs text-muted"
      style={{ height: "var(--ws-footer)", background: "rgb(10 14 20 / 0.92)", backdropFilter: "blur(8px)" }}
    >
      <ul className="flex items-center gap-4" aria-label="Legend">
        <li className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-sm bg-ok" aria-hidden />
          <span>Within 8 min</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-sm bg-warn" aria-hidden />
          <span>Degraded</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="hatch-critical inline-block size-3 rounded-sm" aria-hidden />
          <span>Isolated (hatched)</span>
        </li>
        <li className="text-muted">Height = response time</li>
      </ul>
      <div className="flex items-center gap-4">
        {provenance && (
          <span className="chip h-5 px-2" style={{ borderColor: "rgb(245 165 36 / 0.5)" }}>
            <span className="text-warn">Demo data</span>
          </span>
        )}
        <span>
          <a className={linkCls} href="https://openfreemap.org" target="_blank" rel="noreferrer">
            OpenFreeMap
          </a>{" "}
          <a className={linkCls} href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">
            &copy; OpenMapTiles
          </a>{" "}
          <a className={linkCls} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            &copy; OpenStreetMap contributors
          </a>
        </span>
      </div>
    </footer>
  );
}

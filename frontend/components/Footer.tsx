"use client";

import { useApp } from "@/lib/store";
import { TOKEN_FACTORY_TERMS } from "./AboutDialog";

const linkCls = "underline decoration-border underline-offset-2 hover:text-text";

export default function Footer() {
  const simKind = useApp((s) => s.simKind);
  const setAboutOpen = useApp((s) => s.setAboutOpen);
  return (
    <footer
      className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-4 border-t border-border px-4 text-xs text-muted"
      style={{ height: "var(--ws-footer)", background: "rgb(10 14 20 / 0.92)", backdropFilter: "blur(8px)" }}
    >
      <p className="min-w-0 truncate">
        Data:{" "}
        <a className={linkCls} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          &copy; OpenStreetMap contributors
        </a>{" "}
        (ODbL) · U.S. Census Bureau ACS/TIGER/LEHD · MD iMAP · AI: NVIDIA Nemotron via Nebius Token Factory (
        <a className={linkCls} href={TOKEN_FACTORY_TERMS} target="_blank" rel="noreferrer">
          Terms
        </a>
        ) · Search: Tavily
      </p>
      <div className="flex shrink-0 items-center gap-4">
        {/* Kept outside the truncating credits so it is never clipped. */}
        <span>AI-generated text may be inaccurate</span>
        {simKind === "mock" && (
          <span className="chip h-5 px-2" style={{ borderColor: "rgb(245 165 36 / 0.5)" }}>
            <span className="text-warn">Demo data</span>
          </span>
        )}
        <button className={linkCls} onClick={() => setAboutOpen(true)}>
          Data sources and intended use
        </button>
      </div>
    </footer>
  );
}

"use client";

import NoticeLine from "./DisclaimerBanner";
import { TOKEN_FACTORY_TERMS } from "./AboutDialog";

/** Slim footer line: the planning notice on the left, data and service credits on the right. Always visible. */
export default function Footer() {
  return (
    <footer className="pointer-events-auto flex h-8 items-center justify-between gap-6 px-4 text-xs text-muted" style={{ height: "var(--ws-footer)" }}>
      <div className="shrink-0">
        <NoticeLine />
      </div>
      <p className="hidden min-w-0 truncate lg:block">
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

"use client";

import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import { useApp } from "@/lib/store";

export const DISCLAIMER = "Planning simulation, not dispatch. Simulated times on historical open data. Not affiliated with any agency or hospital.";
const ACK_KEY = "worldseed.disclaimer.ack";

/**
 * First-run banner with the full disclaimer. Dismissal is remembered (localStorage, guarded); the short form
 * stays visible afterwards in the top bar, and the full text in About.
 */
export default function DisclaimerBanner() {
  const [open, setOpen] = useState(false);
  const setAboutOpen = useApp((s) => s.setAboutOpen);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(ACK_KEY) === "1";
    } catch {}
    // Reading storage must wait for the client; this runs once after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!seen) setOpen(true);
  }, []);

  if (!open) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(ACK_KEY, "1");
    } catch {}
    setOpen(false);
  };

  return (
    <div role="note" aria-label="Disclaimer" className="flex shrink-0 items-center justify-center gap-4 border-b border-border bg-surface-2 px-4 py-2 text-sm">
      <Info size={16} className="shrink-0 text-muted" aria-hidden />
      <p className="text-text">{DISCLAIMER}</p>
      <button className="text-sm text-muted underline decoration-border underline-offset-2 hover:text-text" onClick={() => setAboutOpen(true)}>
        Intended use
      </button>
      <button className="btn-icon !h-7 !w-7" aria-label="Dismiss disclaimer" onClick={dismiss}>
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

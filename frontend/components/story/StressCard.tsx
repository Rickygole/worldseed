"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Loader2, ShieldAlert, X } from "lucide-react";
import { fmtAbout } from "@/lib/ui/methodology";
import { stressKeep, fmtPct2 } from "@/lib/ui/storyFigures";
import { fill, T } from "@/lib/ui/storyCopy";
import { useStory } from "@/lib/ui/story";

/**
 * Scene 5, after Apply: one computed beat of the propose, simulate, attack, refine loop. The applied idea is
 * re-run with a tunnel also closed (the link the search's critic attacked with). Optional and dismissible.
 */
export default function StressCard({ className = "card mt-6 p-4" }: { className?: string }) {
  const c = useStory((s) => s.stressCheck);
  const reduced = !!useReducedMotion();
  if (!c || c.status === "dismissed" || c.status === "error") return null;
  const k =
    c.status === "ready" && c.base !== undefined && c.withIdea !== undefined && c.stressBase !== undefined && c.stressWithIdea !== undefined
      ? stressKeep({ base: c.base, withIdea: c.withIdea, stressBase: c.stressBase, stressWithIdea: c.stressWithIdea })
      : null;
  if (c.status === "ready" && !k) return null;
  const slots = { link: c.link };
  const more = !!k && k.keepPct > 100;
  const sentence = !k
    ? fill(T.stress.running, slots)
    : k.stressedBenefit <= 0.5
      ? fill(T.stress.lost, slots)
      : more
        ? fill(T.stress.more, { ...slots, stressed: fmtAbout(k.stressedBenefit), normal: fmtAbout(k.benefit) })
        : fill(T.stress.keeps, { ...slots, pct: fmtPct2(k.keepPct) });

  return (
    <motion.aside
      aria-labelledby="stress-h"
      aria-live="polite"
      className={className}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 text-2xs uppercase tracking-[0.1em] text-warn">
          <ShieldAlert size={13} aria-hidden /> {T.stress.eyebrow}
        </p>
        <button type="button" className="btn-icon -mr-2 -mt-2 !h-7 !w-7" aria-label={T.stress.dismiss} onClick={() => useStory.setState({ stressCheck: { ...c, status: "dismissed" } })}>
          <X size={14} aria-hidden />
        </button>
      </div>
      <h3 id="stress-h" className="mt-1 text-base font-medium text-text">
        {fill(T.stress.title, slots)}
      </h3>
      {k ? (
        <div className="mt-2 flex items-baseline gap-3">
          {more && <span className="text-sm text-text-2">about</span>}
          <span className="display whitespace-nowrap text-2xl font-medium text-warn">{k.stressedBenefit <= 0.5 ? "0%" : more ? fmtAbout(k.stressedBenefit) : `${fmtPct2(k.keepPct)}%`}</span>
          <span className="text-sm text-text-2">{more ? T.stress.moreUnit : T.stress.keepsUnit}</span>
        </div>
      ) : (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> {sentence}
        </p>
      )}
      {k && <p className="mt-1 text-sm text-text">{sentence}</p>}
      {k && c.stressBase !== undefined && c.stressWithIdea !== undefined && (
        <p className="mt-2 text-xs text-muted">{fill(T.stress.detail, { without: fmtAbout(c.stressBase), with: fmtAbout(c.stressWithIdea) })}</p>
      )}
      <p className="mt-2 text-xs text-muted">
        {T.stress.method}{" "}
        <Link href="/explore" className="link text-text-2">
          {T.stress.open}
        </Link>
      </p>
    </motion.aside>
  );
}

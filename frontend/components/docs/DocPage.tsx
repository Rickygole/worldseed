"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { goToScene, setViewportPadding } from "@/lib/ui/mapDirector";
import { clearRoute, setHeldEncoding } from "@/lib/ui/story";
import NoticeLine from "../DisclaimerBanner";

/**
 * A document page (/about, /methodology) over the persistent map: the map stays mounted and drifts quietly
 * behind a dim scrim; the document scrolls in a readable column (about 68 characters).
 */
export default function DocPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  const reduced = !!useReducedMotion();
  useEffect(() => {
    clearRoute();
    void setHeldEncoding(false);
    void goToScene("intro");
    // The map attribution stays visible above the document, bottom right.
    const root = document.documentElement;
    setViewportPadding({ left: 0, right: 0, top: 56, bottom: 0 });
    const phone = window.matchMedia("(max-width: 767px)").matches;
    root.style.setProperty("--ws-attrib-bottom", phone ? "34px" : "10px");
    root.style.setProperty("--ws-attrib-right", "16px");
  }, []);

  return (
    // The document leaves a strip at the bottom uncovered: the planning notice and the map attribution stay
    // visible and readable while the document scrolls (two lines on phones, one on wider screens).
    <>
      <div
        className="absolute inset-x-0 bottom-24 top-0 z-20 md:bottom-9 overflow-y-auto overscroll-contain"
        style={{
          background:
            "linear-gradient(90deg, rgb(7 11 18 / 0.96) 0%, rgb(7 11 18 / 0.92) 55%, rgb(7 11 18 / 0.7) 100%)",
        }}
      >
        <motion.article
          className="mx-auto max-w-[720px] px-6 pb-24 pt-24 md:px-10"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
          }}
        >
          {/* "/" continues at the visitor's last scene (or shows the intro to a new visitor). */}
          <Link
            href="/"
            className="link inline-flex items-center gap-2 text-sm text-text-2"
          >
            <ArrowLeft size={14} aria-hidden /> Back to the story
          </Link>
          <h1 className="display mt-6 text-2xl font-medium text-text md:text-4xl">
            {title}
          </h1>
          <p className="mt-4 max-w-[60ch] text-lg text-text-2">{lead}</p>
          <div className="mt-10">{children}</div>
        </motion.article>
      </div>
      <div className="pointer-events-auto absolute bottom-0 left-0 z-20 flex h-8 items-center px-6">
        <NoticeLine compact />
      </div>
    </>
  );
}

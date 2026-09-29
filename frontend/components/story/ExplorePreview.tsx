"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Columns2, Command, ListOrdered, Newspaper, Truck } from "lucide-react";
import { useApp } from "@/lib/store";
import { EXPLORE_TILES, fill, type ExploreTileId } from "@/lib/ui/storyCopy";

const ICON: Record<ExploreTileId, typeof Truck> = { freight: Truck, exhaustive: ListOrdered, compare: Columns2, command: Command, closures: Newspaper };

/** Scene 6: a glanceable preview of what Expert mode offers; each tile opens that tool at /explore. */
export default function ExplorePreview() {
  const trips = useApp((s) => s.trips?.summary.hazmat_truck?.crossHarborTrips);
  const reduced = !!useReducedMotion();
  return (
    <nav aria-label="What expert mode offers">
      <p className="mb-3 text-2xs uppercase tracking-[0.1em] text-muted">In expert mode</p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {EXPLORE_TILES.map((t, i) => {
          const Icon = ICON[t.id];
          const hint = trips === undefined ? t.hint.replace("{{trips}} trips", "Trips") : fill(t.hint, { trips: String(trips) });
          return (
            <motion.li
              key={t.id}
              className={i === EXPLORE_TILES.length - 1 ? "sm:col-span-2" : ""}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1], delay: 0.25 + 0.05 * i } }}
            >
              <Link href={`/explore?open=${t.id}`} className="card group flex h-full items-start gap-3 p-3 transition-colors duration-150 hover:bg-[rgb(148_163_184/0.12)]">
                <Icon size={16} className="mt-0.5 shrink-0 text-text-2 group-hover:text-text" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2 text-sm font-medium leading-5 text-text">
                    {t.title}
                    <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-muted group-hover:text-text" aria-hidden />
                  </span>
                  <span className="mt-0.5 block text-xs leading-4 text-muted">{hint}</span>
                </span>
              </Link>
            </motion.li>
          );
        })}
      </ul>
    </nav>
  );
}

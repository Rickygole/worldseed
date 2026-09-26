"use client";

import { useRef } from "react";
import { GripVertical, X } from "lucide-react";
import { useSearch } from "@/lib/ui/search";

/**
 * Split-screen swipe handle for Compare. Left of the line: the world on screen; right: the same world with
 * the option. Drag, or use the arrow keys (Home/End for the edges). Escape closes.
 */
export default function CompareSlider() {
  const compare = useSearch((s) => s.compare);
  const setSplit = useSearch((s) => s.setSplit);
  const close = useSearch((s) => s.setCompare);
  const ref = useRef<HTMLDivElement>(null);
  if (!compare) return null;
  const pct = compare.split * 100;

  const fromPointer = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (box) setSplit((clientX - box.left) / box.width);
  };

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-[5]">
      <div className="absolute inset-y-0 w-px bg-text/80" style={{ left: `${pct}%` }} aria-hidden />
      <div className="absolute top-[152px] flex -translate-x-full pr-3" style={{ left: `${pct}%` }}>
        <span className="panel px-2 py-1 text-xs">Now</span>
      </div>
      <div className="absolute top-[152px] flex pl-3" style={{ left: `${pct}%` }}>
        <span className="panel px-2 py-1 text-xs" style={{ color: "var(--color-future)" }}>
          With {compare.bundleId} {compare.status === "loading" ? "(computing...)" : compare.status === "error" ? "(failed)" : ""}
        </span>
      </div>
      <button
        role="slider"
        aria-label={`Compare split: now on the left, with ${compare.bundleId} on the right`}
        aria-valuemin={5}
        aria-valuemax={95}
        aria-valuenow={Math.round(pct)}
        className="panel pointer-events-auto absolute top-1/2 flex h-12 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center"
        style={{ left: `${pct}%` }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          fromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) fromPointer(e.clientX);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          if (e.key === "ArrowLeft") setSplit(compare.split - step);
          else if (e.key === "ArrowRight") setSplit(compare.split + step);
          else if (e.key === "Home") setSplit(0.05);
          else if (e.key === "End") setSplit(0.95);
          else if (e.key === "Escape") void close(null);
          else return;
          e.preventDefault();
        }}
      >
        <GripVertical size={14} aria-hidden />
      </button>
      <button className="panel pointer-events-auto absolute right-[392px] top-[152px] btn-icon" aria-label="Close compare" onClick={() => void close(null)}>
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

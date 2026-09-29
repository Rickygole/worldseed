"use client";

import { ArrowLeft, LayoutPanelLeft } from "lucide-react";
import { useApp } from "@/lib/store";
import { fill, TOGGLE } from "@/lib/ui/storyCopy";
import { setUiMode } from "@/lib/ui/modes";
import { stepIndex } from "@/lib/ui/story";

/**
 * The quiet switch between the guided story and Expert mode (E). One small ghost button: "Expert mode" in the
 * story, "Back to the story" in Expert mode. Expert mode never opens by itself.
 */
export default function ModeToggle({ compact = false }: { compact?: boolean }) {
  const mode = useApp((s) => s.mode);
  const scene = useApp((s) => s.scene);
  const story = mode === "story";
  const label = story ? TOGGLE.expert : TOGGLE.back;
  const tip = story ? TOGGLE.tipStory : fill(TOGGLE.tipExpert, { scene: String((stepIndex(scene) ?? 0) + 1) });
  return (
    <button
      type="button"
      className="btn btn-ghost h-9 rounded-full px-3 text-sm"
      title={`${tip} (E)`}
      aria-label={compact ? label : undefined}
      onClick={() => void setUiMode(story ? "expert" : "story")}
    >
      {story ? <LayoutPanelLeft size={16} aria-hidden /> : <ArrowLeft size={16} aria-hidden />}
      {!compact && label}
    </button>
  );
}

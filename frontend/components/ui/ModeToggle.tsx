"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, LayoutPanelLeft } from "lucide-react";
import { useApp } from "@/lib/store";
import { fill, TOGGLE } from "@/lib/ui/storyCopy";
import { routeOf, storyHome } from "@/lib/ui/routes";
import { stepIndex } from "@/lib/ui/story";

/**
 * The quiet link between the guided story and Expert mode (E): "/explore" from the story and the documents,
 * "Back to the story" (the last scene visited, or the start) from Expert mode. Expert mode never opens by itself.
 */
export default function ModeToggle({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const scene = useApp((s) => s.scene);
  const expert = routeOf(pathname).kind === "explore";
  const [home, setHome] = useState("/");
  useEffect(() => {
    // Session storage is read after mount (the server render has no session).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHome(storyHome());
  }, [pathname, scene]);
  const label = expert ? TOGGLE.back : TOGGLE.expert;
  const tip = expert ? fill(TOGGLE.tipExpert, { scene: String((stepIndex(scene) ?? 0) + 1) }) : TOGGLE.tipStory;
  return (
    <Link href={expert ? home : "/explore"} className="btn btn-ghost h-9 rounded-full px-3 text-sm" title={`${tip} (E)`} aria-label={compact ? label : undefined}>
      {expert ? <ArrowLeft size={16} aria-hidden /> : <LayoutPanelLeft size={16} aria-hidden />}
      {!compact && label}
    </Link>
  );
}

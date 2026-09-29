"use client";

import { useEffect, useRef } from "react";
import { useApp } from "@/lib/store";
import { navigate } from "@/lib/ui/nav";
import { markStarted, pathForScene, sceneForSlug } from "@/lib/ui/routes";
import { ensureSceneWorld, goScene, useStory } from "@/lib/ui/story";
import { STEPS } from "@/lib/ui/storyCopy";
import StoryLayer from "./StoryLayer";

/**
 * /story/<slug>: one scene over the persistent map. Entering the page enters the scene (camera, lens, world).
 * A deep link or a refresh lands here before the snapshot has loaded: when it is ready, the world the scene needs
 * is rebuilt idempotently (the bridge removed for scenes 2 to 6). State that cannot be rebuilt from the URL (a
 * finished search, an applied idea, a revealed map view) starts over in that scene, with correct numbers.
 */
export default function StoryPage({ slug }: { slug: string }) {
  const scene = sceneForSlug(slug);
  const ready = useApp((s) => s.status === "ready");
  const wasReady = useRef(ready);

  useEffect(() => {
    if (!scene) {
      useStory.setState({ routeNote: "Continuing from the start" });
      navigate(pathForScene("crossing"), { replace: true });
      return;
    }
    markStarted();
    void goScene(scene);
  }, [scene]);

  // The snapshot finished loading after this page was entered (deep link, refresh): make the world right once.
  useEffect(() => {
    if (ready && !wasReady.current && scene) void ensureSceneWorld(scene);
    wasReady.current = ready;
  }, [ready, scene]);

  // The "Continuing from the start" note fades after a few seconds.
  const note = useStory((s) => s.routeNote);
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => useStory.setState({ routeNote: null }), 4000);
    return () => window.clearTimeout(t);
  }, [note]);

  if (!scene) return null;
  return (
    <>
      <h1 className="sr-only">Guided story: {STEPS[scene]}</h1>
      <StoryLayer scene={scene} />
    </>
  );
}


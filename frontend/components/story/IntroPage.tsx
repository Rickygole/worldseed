"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { navigate } from "@/lib/ui/nav";
import { hasStarted, lastScene, pathForScene } from "@/lib/ui/routes";
import { goScene } from "@/lib/ui/story";
import StoryLayer from "./StoryLayer";

/** /: the intro (scene 0). A visitor who already started continues at their scene; `/?intro=1` always shows it. */
export default function IntroPage() {
  const params = useSearchParams();
  const force = params.get("intro") === "1";
  const [show, setShow] = useState(false);

  useEffect(() => {
    const last = lastScene();
    if (!force && hasStarted() && last) {
      navigate(pathForScene(last), { replace: true });
      return;
    }
    // Session storage decides, so the intro shows only after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(true);
    void goScene("intro");
  }, [force]);

  return (
    <>
      <h1 className="sr-only">WorldSeed: the Key Bridge region, a planning simulation</h1>
      {show && <StoryLayer scene="intro" />}
    </>
  );
}

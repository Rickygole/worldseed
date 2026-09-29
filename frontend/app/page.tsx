import { Suspense } from "react";
import IntroPage from "@/components/story/IntroPage";

export default function Home() {
  return (
    <Suspense>
      <IntroPage />
    </Suspense>
  );
}

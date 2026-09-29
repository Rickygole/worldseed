import type { Metadata } from "next";
import DocPage from "@/components/docs/DocPage";
import MethodologyContent from "@/components/docs/MethodologyContent";

export const metadata: Metadata = { title: "Methodology - WorldSeed" };

export default function Page() {
  return (
    <DocPage title="How far can you trust these numbers?" lead="WorldSeed is a fast, simple model. We tested how its answers change when its assumptions change. Here is what we found.">
      <MethodologyContent />
    </DocPage>
  );
}

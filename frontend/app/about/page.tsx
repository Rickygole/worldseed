import type { Metadata } from "next";
import DocPage from "@/components/docs/DocPage";
import AboutContent from "@/components/AboutDialog";

export const metadata: Metadata = { title: "About WorldSeed" };

export default function Page() {
  return (
    <DocPage title="About WorldSeed" lead="What this tool is, what it is not, where its data comes from, and how it treats your data.">
      <AboutContent />
    </DocPage>
  );
}

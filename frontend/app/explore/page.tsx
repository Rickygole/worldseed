import type { Metadata } from "next";
import ExplorePage from "@/components/expert/ExplorePage";

export const metadata: Metadata = { title: "Expert mode - WorldSeed" };

export default function Page() {
  return <ExplorePage />;
}

import type { Metadata } from "next";
import StoryPage from "@/components/story/StoryPage";
import { sceneForSlug, STORY_SLUGS } from "@/lib/ui/routes";
import { STEPS } from "@/lib/ui/storyCopy";

/** One static page per scene; any other slug is a 404 (see app/not-found.tsx). */
export const dynamicParams = false;

export function generateStaticParams() {
  return STORY_SLUGS.map((scene) => ({ scene }));
}

export async function generateMetadata({ params }: { params: Promise<{ scene: string }> }): Promise<Metadata> {
  const id = sceneForSlug((await params).scene);
  return { title: id ? `${STEPS[id]} - WorldSeed guided story` : "WorldSeed" };
}

export default async function Page({ params }: { params: Promise<{ scene: string }> }) {
  return <StoryPage slug={(await params).scene} />;
}

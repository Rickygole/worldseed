import Link from "next/link";

export default function NotFound() {
  return (
    <div className="absolute inset-x-0 bottom-9 top-0 z-20 flex items-center justify-center bg-bg/80 px-6">
      <div className="max-w-md text-center">
        <h1 className="display text-2xl font-medium text-text">This page does not exist.</h1>
        <p className="mt-3 text-text-2">The story has six scenes. Continue from the start.</p>
        <Link href="/story/crossing" className="btn btn-light mt-8 h-12 rounded-full px-6 text-base">
          Continue from the start
        </Link>
      </div>
    </div>
  );
}

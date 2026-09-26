import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the dev-only overlay badge so it never covers the metrics ribbon.
  devIndicators: false,
  // The AI routes read the catalog with fs (lib/server/catalogLoader.ts). public/ is served by the
  // CDN and is not part of a serverless function unless it is traced in, so list the two files the
  // routes need. Verified against the routes' .nft.json after `npm run build` (see test/ai/catalog.test.ts).
  outputFileTracingIncludes: {
    "/api/**": ["./public/snapshot/candidates.json", "./public/snapshot/gazetteer.json"],
  },
};

export default nextConfig;

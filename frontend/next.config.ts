import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the dev-only overlay badge so it never covers the metrics ribbon.
  devIndicators: false,
};

export default nextConfig;

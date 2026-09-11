import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The development badge overlaps the bottom controls of the navigation rail.
  devIndicators: false,
  // Check every application module and generated route type; test runners validate their own suites.
  typescript: { tsconfigPath: "tsconfig.build.json" },
};

export default nextConfig;

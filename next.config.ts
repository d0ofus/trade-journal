import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Check every application module and generated route type; test runners validate their own suites.
  typescript: { tsconfigPath: "tsconfig.build.json" },
};

export default nextConfig;

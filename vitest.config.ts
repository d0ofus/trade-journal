import path from "node:path";
import {
  assertTestDatabaseSafety,
  loadDotEnvWithoutOverride,
} from "./src/lib/test-database-safety";

loadDotEnvWithoutOverride();
assertTestDatabaseSafety(process.env);

const config = {
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
};

export default config;

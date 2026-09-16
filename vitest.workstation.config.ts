import path from "node:path";
import { defineConfig } from "vitest/config";

// An explicit allowlist of suites with fully mocked Prisma and HTTP, without env loading.
// Database-backed suites still use vitest.config.ts and its isolated-database preflight.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/workstation/split-adjustment.test.ts", "src/lib/server/workstation-stock-splits.test.ts", "src/lib/server/workstation-split-candles.test.ts", "src/lib/server/market-candles.test.ts", "src/lib/server/workstation-candles.test.ts", "src/app/api/market/candles/route.test.ts", "src/app/api/workstation/candles/route.test.ts"],
    testTimeout: 15000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});

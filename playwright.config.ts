import { defineConfig, devices } from "@playwright/test";
import {
  assertLoopbackBaseUrl,
  assertTestDatabaseSafety,
  loadDotEnvWithoutOverride,
} from "./src/lib/test-database-safety";

loadDotEnvWithoutOverride();

const e2ePort = process.env.PLAYWRIGHT_PORT ?? "3100";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${e2ePort}`;

assertTestDatabaseSafety(process.env);
assertLoopbackBaseUrl(baseURL);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  workers: 1,
  expect: {
    timeout: 15_000,
  },
  use: {
    acceptDownloads: true,
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run start -- -p ${e2ePort}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      E2E_DEMO_ONLY_WRITES: "1",
      NEXTAUTH_URL: baseURL,
      PORT: e2ePort,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

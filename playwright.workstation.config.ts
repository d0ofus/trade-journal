import { defineConfig } from "@playwright/test";

// Mock preview only: no seed, migrations, database configuration, or authentication changes.
export default defineConfig({
  testDir: "./tests/workstation-preview",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  outputDir: "test-results/workstation-preview",
  use: {
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 1920, height: 1080 },
    browserName: "chromium",
    // Native scrollbars affect ResizeObserver measurements; Chromium normally hides them.
    launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});

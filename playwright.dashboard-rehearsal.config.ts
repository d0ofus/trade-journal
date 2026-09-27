import { defineConfig } from "@playwright/test";
if (process.env.DASHBOARD_REHEARSAL !== "1") throw new Error("Run only against the restored local rehearsal server on port 3102");
export default defineConfig({ testDir: "./tests/dashboard-rehearsal", workers: 1, timeout: 60_000, expect: { timeout: 15_000 }, outputDir: "test-results/dashboard-rehearsal", use: { baseURL: "http://127.0.0.1:3102", browserName: "chromium", viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure", trace: "retain-on-failure" } });

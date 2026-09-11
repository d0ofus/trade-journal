import { defineConfig } from "@playwright/test";
import { assertTestDatabaseSafety } from "./src/lib/test-database-safety";

const target = assertTestDatabaseSafety(process.env);
if (target.databaseUrl.host !== "127.0.0.1:55439" || target.databaseUrl.database !== "trades_workstation_auth_test") throw new Error("Authenticated workstation tests require the disposable local phase-two database.");

export default defineConfig({
  testDir: "./tests/workstation-auth",
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results/workstation-auth",
  use: { baseURL: "http://127.0.0.1:3101", browserName: "chromium", viewport: { width: 1920, height: 1080 }, screenshot: "only-on-failure", trace: "retain-on-failure" },
});

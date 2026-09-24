import { defineConfig } from "@playwright/test";
import { assertTestDatabaseSafety } from "./src/lib/test-database-safety";

const target = assertTestDatabaseSafety(process.env);
// Windows may reserve port 55439; 15439 is the explicit alternate test-only port.
if (!["127.0.0.1:55439", "127.0.0.1:15439"].includes(target.databaseUrl.host) || !["trades_workstation_auth_test", "trade_journal_notion_test", "trade_storage_health_browser_test"].includes(target.databaseUrl.database)) throw new Error("Authenticated workstation tests require a dedicated disposable local database.");

export default defineConfig({
  testDir: "./tests/workstation-auth",
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results/workstation-auth",
  use: { baseURL: "http://127.0.0.1:3101", browserName: "chromium", viewport: { width: 1920, height: 1080 }, screenshot: "only-on-failure", trace: "retain-on-failure" },
});

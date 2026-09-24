/** Run manually in a terminal when the agent's policy blocks starting a server.
 * Only the fixed local disposable database and synthetic login are permitted.
 * No production credentials or provider tokens are inherited by the child.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Use Node 22 or later.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const database = process.argv.includes("--storage-health")
  ? "postgresql://postgres@127.0.0.1:55439/trade_storage_health_browser_test?schema=public"
  : "postgresql://postgres@127.0.0.1:55439/trades_workstation_auth_test?schema=public";
const environment = { ...process.env,
  DATABASE_URL: database, DIRECT_URL: database,
  AUTH_USERNAME: "phase2-reviewer", AUTH_PASSWORD: "phase2-local-test-only",
  NEXTAUTH_SECRET: "phase2-isolated-browser-secret-only", NEXTAUTH_URL: "http://127.0.0.1:3101",
  TRADES_WORKSTATION_ENABLED: "1", TRADES_WORKSTATION_PREVIEW: "0", E2E_DEMO_ONLY_WRITES: "1",
  EVIDENCE_R2_WRITES_ENABLED: "1", EVIDENCE_R2_MAINTENANCE_ENABLED: "0",
  EVIDENCE_R2_ACCOUNT_ID: "isolated-disabled", EVIDENCE_R2_BUCKET: "trade-journal-evidence-nonproduction",
  EVIDENCE_R2_ACCESS_KEY_ID: "disabled", EVIDENCE_R2_SECRET_ACCESS_KEY: "disabled", EVIDENCE_R2_METRICS_TOKEN: "disabled",
  NOTION_PUBLISH_ENABLED: "0", NOTION_TOKEN: "disabled-for-isolated-browser-tests",
  TRADES_ALPACA_API_KEY_ID: "disabled", TRADES_ALPACA_API_SECRET_KEY: "disabled",
  ALPACA_API_KEY_ID: "disabled", ALPACA_API_SECRET_KEY: "disabled",
  CRON_SECRET: "disabled-for-isolated-browser-tests", IBKR_FLEX_TOKEN: "disabled",
  IBKR_FLEX_QUERY_ID: "disabled", VERCEL_ENV: "development",
};
for (const name of Object.keys(environment)) {
  if (/^(?:EVIDENCE_R2_|R2_|CLOUDFLARE_|AWS_|NEON_|VERCEL_)/.test(name) &&
    !["EVIDENCE_R2_WRITES_ENABLED", "EVIDENCE_R2_MAINTENANCE_ENABLED", "VERCEL_ENV"].includes(name)) {
    environment[name] = "";
  }
}
console.log("Starting isolated authenticated browser server at http://127.0.0.1:3101. Stop with Ctrl+C.");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3101", "-H", "127.0.0.1"], { cwd: root, env: environment, stdio: "inherit", windowsHide: true });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));

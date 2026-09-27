import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Only an isolated application copy, local test database, and loopback listener are allowed.
const legacy = process.argv.includes("--legacy-rehearsal");
const rehearsal = legacy || process.argv.includes("--report-rehearsal");
const port = legacy ? "3103" : rehearsal ? "3102" : "3101";
const directory = path.resolve(".vercel/dashboard-auth");
if (!existsSync(path.join(directory, ".next/BUILD_ID")) || existsSync(path.join(directory, ".env.local"))) throw new Error("Prepare an isolated build without environment files");
const database = process.env.DATABASE_URL;
if (!database) throw new Error("Set the isolated local DATABASE_URL");
const target = new URL(database);
if (target.hostname !== "127.0.0.1" || target.port !== "15439" || target.pathname !== (rehearsal ? "/dashboard_rehearsal_test" : "/trades_workstation_auth_test")) throw new Error("Unexpected validation database target");
if (rehearsal && !process.env.REPORTING_ACCOUNT_CODE) throw new Error("Set the reporting account for the restored rehearsal database");
const env = Object.fromEntries(["SystemRoot", "SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP", "USERPROFILE"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(env, {
  DATABASE_URL: database, DIRECT_URL: database, ALLOW_TEST_DATABASE_MUTATIONS: "1",
  TRADES_WORKSTATION_ENABLED: legacy ? "0" : "1", TRADES_CHART_PROVIDER: "legacy", E2E_DEMO_ONLY_WRITES: "1",
  REPORTING_ACCOUNT_CODE: rehearsal ? process.env.REPORTING_ACCOUNT_CODE : "DEMO-WORKSTATION", AUTH_USERNAME: "phase2-reviewer", AUTH_PASSWORD: "phase2-local-test-only",
  NEXTAUTH_SECRET: "isolated-dashboard-validation-secret", NEXTAUTH_URL: `http://127.0.0.1:${port}`,
  NOTION_TOKEN: "", EVIDENCE_R2_WRITES_ENABLED: "0", NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production",
});
const child = spawn(process.execPath, ["--import", pathToFileURL(path.resolve("scripts/workstation-test-network.mjs")).href, path.resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", port], { cwd: directory, env, windowsHide: true, stdio: "inherit" });
child.on("exit", code => { process.exitCode = code ?? 1; });

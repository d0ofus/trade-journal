#!/usr/bin/env node
// Authenticated, resumable runner. No direct database access or credentials on the command line.
import { setTimeout as wait } from "node:timers/promises";
import { preparationContinuation } from "./workstation-preparation-progress.mjs";
const args = new Set(process.argv.slice(2));
const base = process.env.WORKSTATION_ADMIN_URL;
const token = process.env.WORKSTATION_ADMIN_TOKEN;
if (!base || !token) throw new Error("Set WORKSTATION_ADMIN_URL and WORKSTATION_ADMIN_TOKEN (the application's CRON_SECRET).");
const url = new URL("/api/workstation/market-data", base);
if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Use HTTPS for remote administration.");
if (url.username || url.password) throw new Error("Do not put credentials in the URL.");
async function call(action) {
  const response = await fetch(url, { method: action ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(290_000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(action ? { body: JSON.stringify({ action, ...(action === "plan" && args.has("--recheck") ? { recheck: true } : {}) }) } : {}) });
  if (!response.ok) throw new Error(`Administration request failed (HTTP ${response.status}). Queued progress is preserved.`);
  const result = await response.json();
  console.log(JSON.stringify({ enabled: result.enabled, preparation: result.preparation, usage: result.usage, counts: result.counts, result: result.result }));
  return result;
}
let status = await call();
if ((args.has("--queue") || args.has("--run") || args.has("--retry") || args.has("--pilot")) && !args.has("--usage-checked")) throw new Error("Check Neon project-level Usage first, then supply --usage-checked. SQL measurements cannot see other branches or monthly allowances.");
if (args.has("--pilot")) {
  for (let batch = 0; batch < 30; batch++) {
    status = await call("pilot");
    if (!status.result?.processed && !status.result?.advanced && !status.result?.nextAvailableAt && !status.result?.retryAfterMs) break;
    const continuation = preparationContinuation(status); if (continuation.stop) break;
    if (continuation.waitMs) await wait(continuation.waitMs);
  }
}
if (args.has("--queue")) status = await call("plan");
if (args.has("--retry")) status = await call("retry");
if (args.has("--run")) {
  const maximum = Number(process.env.WORKSTATION_ADMIN_MAX_BATCHES ?? "30");
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) throw new Error("WORKSTATION_ADMIN_MAX_BATCHES must be 1–100.");
  for (let batch = 0; batch < maximum && status.preparation && (status.counts.pending || status.counts.running); batch++) {
    status = await call("run");
    const continuation = preparationContinuation(status);
    if (continuation.stop) break;
    if (continuation.waitMs && (status.counts.pending || status.counts.running)) await wait(continuation.waitMs);
  }
  if (status.counts.pending || status.counts.running) { console.log("Preparation is incomplete; resume the runner to continue its durable queue."); process.exitCode = 2; }
}

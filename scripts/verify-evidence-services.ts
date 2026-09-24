/** Read-only provider probes. Credentials/URLs and journal contents are never logged. */
import { parseR2AccountMetrics } from "../src/lib/server/evidence-usage";
import { NOTION_DATA_SOURCE_ID } from "../src/lib/workstation/template-layout";

async function main() {
  if (process.env.NOTION_TOKEN) {
    const headers = { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, "Notion-Version": "2025-09-03" };
    const response = await fetch("https://api.notion.com/v1/users/me", { headers, signal: AbortSignal.timeout(15_000) });
    const identity = await response.json();
    console.log(JSON.stringify({ service: "notion-identity", status: response.status, fileAllowance: identity.bot?.workspace_limits?.max_file_upload_size_in_bytes ?? null }));
    const schema = await fetch(`https://api.notion.com/v1/data_sources/${NOTION_DATA_SOURCE_ID}`, { headers, signal: AbortSignal.timeout(15_000) });
    const data = await schema.json();
    console.log(JSON.stringify({ service: "notion-data-source", status: schema.status, properties: Object.keys(data.properties ?? {}).length }));
  } else console.log(JSON.stringify({ service: "notion", available: false, reason: "Missing server token" }));
  const token = process.env.EVIDENCE_R2_METRICS_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  if (token && process.env.EVIDENCE_R2_ACCOUNT_ID) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.EVIDENCE_R2_ACCOUNT_ID}/r2/metrics`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    const metrics = parseR2AccountMetrics(body.result);
    console.log(JSON.stringify({ service: "r2-account-metrics", status: response.status, measuredAt: new Date().toISOString(), metrics }));
    if (!response.ok || !metrics) process.exitCode = 1;
  }
}
main().catch(() => { console.error("Read-only service verification failed; credentials were not logged."); process.exitCode = 1; });

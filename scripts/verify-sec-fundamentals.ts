import { extractFundamentalFacts, parseFundamentalQuarters } from "../src/lib/server/sec-fundamentals-parser";
import { loadEnvConfig } from "@next/env";

// Read-only, two public SEC requests. Does not open a database or populate caches.
async function main() {
  if (!process.argv.includes("--live")) { console.log("Use --live for a read-only SEC connectivity and parser check (BE)."); return; }
  loadEnvConfig(process.cwd());
  const headers = { "User-Agent": process.env.SEC_USER_AGENT?.trim() || "TradeJournal/1.0 (https://github.com/d0ofus/trade-journal)", Accept: "application/json" };
  async function read(url: string) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`SEC returned HTTP ${response.status}`);
    return response.json();
  }
  const directory = await read("https://www.sec.gov/files/company_tickers.json") as Record<string, { ticker: string; cik_str: number }>;
  const issuer = Object.values(directory).find(row => row.ticker === "BE");
  if (!issuer) throw new Error("BE was not found in the SEC directory.");
  await new Promise(resolve => setTimeout(resolve, 600));
  const facts = extractFundamentalFacts(await read(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(issuer.cik_str).padStart(10, "0")}.json`));
  const current = parseFundamentalQuarters(facts, null), historical = parseFundamentalQuarters(facts, "2025-05-01");
  if (!current.length || !historical.length) throw new Error("Expected quarterly history was unavailable.");
  console.log(JSON.stringify({ symbol: "BE", currentQuarters: current.length, latestPeriod: current.at(-1)?.periodEnd, historicalQuarters: historical.length, historicalLastPeriod: historical.at(-1)?.periodEnd, historicalSourcesPrecedeCutoff: historical.every(q => [q.revenue, q.netIncome].every(m => !m || m.sources.every(s => s.filed < "2025-05-01"))) }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "SEC verification failed"); process.exitCode = 1; });

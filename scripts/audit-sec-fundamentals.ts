import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractFundamentalFacts, fundamentalCurrency, parseFundamentalQuarters } from "../src/lib/server/sec-fundamentals-parser";
import { hasCompleteFundamentalCoverage, needsFundamentalFilingCheck, loadFundamentalFilings } from "../src/lib/server/sec-fundamentals-filings";
import { shareEligibility } from "../src/lib/workstation/share-eligibility";

// Public SEC reads only. Local artifacts speed resumable verification; no app cache or journal writes.
async function main() {
  if (!process.argv.includes("--live")) { console.log("Use --live [--symbols=TSEM,MNDY,STM,WPM,SAP,TSM,AAPL,BE] [--cutoff=2026-01-13] [--journal]. No database or cache writes."); return; }
  loadEnvConfig(process.cwd());
  const directory = path.resolve("artifacts/sec-fundamentals"); await mkdir(directory, { recursive: true });
  const cutoff = process.argv.find(a => a.startsWith("--cutoff="))?.slice(9) ?? null;
  const reportName = process.argv.find(a => a.startsWith("--report="))?.slice(9);
  if (reportName && !/^[a-zA-Z0-9_-]{1,80}$/.test(reportName)) throw new Error("Expected a simple --report=name");
  if (cutoff && !/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) throw new Error("Expected --cutoff=YYYY-MM-DD");
  let symbols = (process.argv.find(a => a.startsWith("--symbols="))?.slice(10) ?? "TSEM,MNDY,STM,WPM,SAP,TSM,AAPL,BE").split(",");
  if (process.argv.includes("--journal")) {
    const { PrismaClient } = await import("@prisma/client"); const client = new PrismaClient();
    try {
      // PostgreSQL itself rejects writes in this transaction, including accidental ones.
      symbols = await client.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const rows = await tx.closedTrade.findMany({ distinct: ["symbol"], where: { instrument: { assetType: { in: ["STOCK", "OTHER"] } } }, select: { symbol: true, instrument: { select: { assetType: true } } } });
        return rows.filter(r => shareEligibility({ symbol: r.symbol, assetType: r.instrument.assetType })).map(r => r.symbol);
      });
    } finally { await client.$disconnect(); }
  }
  let nextRequest = 0, networkRequests = 0;
  async function request(url: string, signal: AbortSignal, json: boolean): Promise<unknown> {
    const key = createHash("sha256").update(url).digest("hex"), filename = path.join(directory, `${key}.${json ? "json" : "html"}`);
    const decode = (bytes: string) => {
      if (!json && Buffer.byteLength(bytes) > 8_000_000) throw Object.assign(new Error("SEC document exceeds the supported size."), { status: 413 });
      return json ? JSON.parse(bytes) : bytes;
    };
    let cached: string | undefined;
    try { cached = await readFile(filename, "utf8"); } catch {}
    if (cached !== undefined) return decode(cached);
    const delay = nextRequest - Date.now(); if (delay > 0) await new Promise(r => setTimeout(r, delay));
    signal.throwIfAborted(); nextRequest = Date.now() + 550;
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), headers: { "User-Agent": process.env.SEC_USER_AGENT?.trim() || "TradeJournal/1.0 (https://github.com/d0ofus/trade-journal)", Accept: json ? "application/json" : "text/html,application/xml" } });
    networkRequests++; if (!response.ok) throw Object.assign(new Error(`SEC HTTP ${response.status}: ${url}`), { status: response.status });
    const text = await response.text(); await writeFile(filename, text); return decode(text);
  }
  const json = (url: string, signal: AbortSignal) => request(url, signal, true);
  const text = async (url: string, signal: AbortSignal) => await request(url, signal, false) as string;
  const tickers = Object.values(await json("https://www.sec.gov/files/company_tickers.json", AbortSignal.timeout(20000)) as Record<string, { ticker: string; cik_str: number }>);
  const report: unknown[] = [];
  for (const symbol of [...new Set(symbols)].sort()) {
    const issuer = tickers.find(t => t.ticker === symbol.replaceAll(".", "-"));
    if (!issuer) { const row = { symbol, reason: "unknown-ticker" }; report.push(row); if (!process.argv.includes("--quiet")) console.log(JSON.stringify(row)); continue; }
    try {
      const cik = String(issuer.cik_str).padStart(10, "0"), signal = AbortSignal.timeout(105000);
      let raw: unknown;
      try { raw = await json(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, signal); }
      catch (error) { if (error && typeof error === "object" && "status" in error && error.status === 404) raw = { facts: {} }; else throw error; }
      const initial = extractFundamentalFacts(raw);
      const source = process.argv.includes("--facts-only") || !needsFundamentalFilingCheck(initial, cutoff) ? null : await loadFundamentalFilings(cik, initial, cutoff, signal, { json, text, cached: async (key, age, read) => {
        const filename = path.join(directory, `${createHash("sha256").update(key).digest("hex")}.parsed.json`);
        try { const entry = JSON.parse(await readFile(filename, "utf8")); if (!process.argv.includes("--reparse") && Date.now() - Date.parse(entry.fetchedAt) < age) return entry; } catch {}
        const entry = { value: await read(signal), fetchedAt: new Date().toISOString(), stale: false }; await writeFile(filename, JSON.stringify(entry)); return entry;
      } });
      const facts = source?.facts ?? initial, currency = fundamentalCurrency(facts, cutoff), quarters = parseFundamentalQuarters(facts, cutoff, currency), latest = quarters.at(-1);
      const historicalSafe = quarters.every(q => !cutoff || q.periodEnd < cutoff && [q.revenue, q.netIncome].every(m => !m || m.sources.every(s => s.filed < cutoff)));
      if (!historicalSafe) throw new Error("Historical cutoff violation");
      const row = { symbol, currency, quarters: quarters.length, latest: latest ? { period: latest.periodEnd, revenue: latest.revenue?.value, netIncome: latest.netIncome?.value, incomeBasis: latest.netIncome?.incomeBasis } : null, complete: hasCompleteFundamentalCoverage(facts, cutoff), reason: process.argv.includes("--facts-only") && !hasCompleteFundamentalCoverage(facts, cutoff) ? "filing-fallback-pending" : source?.incomplete ? "retrieval-incomplete" : quarters.length ? hasCompleteFundamentalCoverage(facts, cutoff) ? "ready" : "partial-coverage" : source?.unsupported || source?.ambiguous ? "unsupported-format" : "no-quarterly-data", scanned: source?.scanned ?? 0, historicalSafe };
      const diagnostics = source ? { financialStatementsFound: source.financial, ambiguousStatements: source.ambiguous, unsupportedDocuments: source.unsupported, ...(source.retrievalError ? { retrievalError: source.retrievalError } : {}) } : {};
      Object.assign(row, diagnostics);
      report.push(row); if (!process.argv.includes("--quiet")) console.log(JSON.stringify(row));
      await writeFile(path.join(directory, `${symbol.replace(/[^A-Z0-9-]/g, "_")}-${cutoff ?? "latest"}-normalized.json`), JSON.stringify({ facts, cutoff, currency, quarters, audit: row }, null, 2));
    } catch (error) { const row = { symbol, reason: "retrieval-failed", error: error instanceof Error ? error.message : String(error) }; report.push(row); if (!process.argv.includes("--quiet")) console.log(JSON.stringify(row)); }
  }
  await writeFile(path.join(directory, `${reportName ?? `audit${cutoff ? `-${cutoff}` : ""}${process.argv.includes("--journal") ? "-journal" : ""}${process.argv.includes("--facts-only") ? "-facts" : ""}`}.json`), JSON.stringify({ cutoff, networkRequests, report }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "SEC audit failed"); process.exitCode = 1; });

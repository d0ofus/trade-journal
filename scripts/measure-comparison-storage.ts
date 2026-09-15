import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { prisma } from "../src/lib/prisma";
import { assertTestDatabaseSafety } from "../src/lib/test-database-safety";
import { notionProperties, chartSections, emptyNotionReview, type PropertyKey } from "../src/lib/workstation/notion-template";
import { richHtml } from "../src/lib/workstation/rich-text";
import { notionJournalPatch } from "../src/lib/server/notion-review-storage";
import { emptyDocument } from "../src/lib/workstation/types";
import { encodeCandles } from "../src/lib/server/workstation-cache-codec";
import { usEquitiesTradingSession } from "../src/lib/server/market-session-calendar";
import { unavailableMetrics } from "../src/lib/workstation/market-metrics";

const target = assertTestDatabaseSafety(process.env).databaseUrl;
if (target.host !== "127.0.0.1:55439" || target.database !== "trades_storage_comparison_test") throw new Error("Use the dedicated disposable storage database.");

async function main() {
  const zip = unzipSync(readFileSync(process.argv[2]));
  const markdown = strFromU8(Object.entries(zip).find(([name]) => name.endsWith(".md"))![1]);
  const images = Object.entries(zip).filter(([name]) => name.endsWith(".png"));
  const properties = markdown.slice(0, markdown.indexOf("## "));
  const doc = emptyDocument(), notion = doc.review.notion = emptyNotionReview();
  const propertyRows = [...properties.matchAll(/^([^\n:]+): ([\s\S]*?)(?=\n[^\n:]+: |$)/gm)];
  for (const [, label, raw] of propertyRows) {
    const p = notionProperties.find(p => p.label === label); if (!p) continue;
    const value = raw.replace(/\s*\(https:\/\/[^)]+\)/g, "").trim();
    if (p.key === "takeaways") doc.review.takeaway = richHtml(value);
    else if (!["date", "formula"].includes(p.kind)) notion.properties[p.key as PropertyKey] = p.kind === "checkbox" ? value === "Yes" : p.kind === "number" ? Number(value) : p.kind === "relation" || p.kind === "multi" ? value.split(", ") : value;
  }
  const blocks = markdown.split(/^#{1,2} (.+)$/m);
  for (let i = 1; i < blocks.length; i += 2) {
    const title = blocks[i].replace(/\*\*/g, "").trim(), body = blocks[i + 1] ?? "";
    const section = chartSections.find(([, label]) => label === title)?.[0];
    const ids = images.flatMap(([name], index) => body.includes(name.split("/").at(-1)!) ? [`evidence-${index}`] : []);
    const text = body.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
    if (section) notion.sections[section] = { html: richHtml(text), evidenceIds: ids };
    else if (title === "Setup Analysis") notion.analysis.fundamentals = richHtml(text);
    else if (title === "Takeaways" && text) doc.review.takeaway = richHtml(text);
  }
  const textBytes = Buffer.byteLength(JSON.stringify(doc));
  doc.evidence = images.map(([name, bytes], index) => ({ id: `evidence-${index}`, name: name.split("/").at(-1)!, image: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`, time: 1, revision: 0, timeframe: "5m" }));
  const template = notionJournalPatch(notion).templateData;
  const before = await prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_total_relation_size('"JournalEntry"')::bigint AS bytes`;
  await prisma.journalEntry.createMany({ data: Array.from({ length: 1000 }, (_, i) => ({ id: `STORAGE-REVIEW-${i}`, symbol: "STORAGE_TEST", ideaDate: new Date("2026-06-04"), direction: "LONG", templateData: template!, lessonLearned: doc.review.takeaway })) });
  const after = await prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_total_relation_size('"JournalEntry"')::bigint AS bytes`;
  const metric = unavailableMetrics("STORAGE_TEST", "USD", "Historical shares unavailable", "2026-06-03"), metricBytes = Buffer.byteLength(JSON.stringify(metric));
  const metricBefore = await prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_total_relation_size('"WorkstationMetricCache"')::bigint AS bytes`;
  await prisma.workstationMetricCache.createMany({ data: Array.from({ length: 1000 }, (_, i) => ({ key: `STORAGE-METRIC-${i}`, symbol: `STORAGE_TEST_${i}`, sessionDate: "2026-06-03", provider: "fixture", version: 1, payload: metric, bytes: metricBytes, expiresAt: new Date("2027-01-01") })) });
  const metricAfter = await prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_total_relation_size('"WorkstationMetricCache"')::bigint AS bytes`;
  let benchmarkBytes = 0, barCount = 0;
  const byInterval: Record<string, number> = {};
  for (const step of [300, 600, 900, 3600, 86400, 604800]) {
    const rows: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
    for (let day = Date.parse("2025-01-01") / 1000; day < Date.parse("2026-01-01") / 1000; day += 86400) {
      const d = new Date(day * 1000), session = usEquitiesTradingSession({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
      if (!session || step === 604800 && d.getUTCDay() !== 1) continue;
      const open = session.open - 5.5 * 3600;
      for (let time = step < 86400 ? open : session.open; time < session.close + 4 * 3600; time += step) {
        const price = 500 + Math.sin(time / 86400) * 30 + Math.cos(time / 991) * 2;
        rows.push({ time, open: price, high: price + 1.37, low: price - 1.73, close: price + .51, volume: Math.floor(10000 + Math.abs(Math.sin(time)) * 100000) });
        if (step >= 86400) break;
      }
    }
    // Intraday chunks are daily; coarse chunks are yearly, matching persistent encoding.
    const chunks = new Map<number, typeof rows>();
    for (const row of rows) { const key = step < 86400 ? Math.floor(row.time / 86400) : 0; const chunk = chunks.get(key) ?? []; chunk.push(row); chunks.set(key, chunk); }
    const bytes = [...chunks.values()].reduce((n, bars) => n + encodeCandles(bars).payload.length, 0) * 2;
    benchmarkBytes += bytes; barCount += rows.length * 2; byInterval[String(step)] = bytes;
  }
  const report = { reviewTextBytes: textBytes, templateJsonBytes: Buffer.byteLength(JSON.stringify(template)), reviewWithImagesBytes: Buffer.byteLength(JSON.stringify(doc)), imageCount: images.length, imageBytes: images.reduce((n, [, bytes]) => n + bytes.length, 0), journal1000RowsTableAndIndexGrowth: Number(after[0].bytes - before[0].bytes), metricPayloadBytes: metricBytes, metrics1000RowsTableAndIndexGrowth: Number(metricAfter[0].bytes - metricBefore[0].bytes), syntheticYearBothBenchmarks: { bytes: benchmarkBytes, bars: barCount, byIntervalSeconds: byInterval } };
  mkdirSync("artifacts/comparison", { recursive: true }); writeFileSync("artifacts/comparison/storage.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
main().finally(async () => { await prisma.journalEntry.deleteMany({ where: { symbol: "STORAGE_TEST" } }); await prisma.workstationMetricCache.deleteMany({ where: { symbol: { startsWith: "STORAGE_TEST" } } }); await prisma.$disconnect(); });

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma";
import { assertTestDatabaseSafety } from "../src/lib/test-database-safety";
import { parseCsvWithMapping } from "../src/lib/import/ibkr-parser";
import { parseFlexStatementCsv } from "../src/lib/import/ibkr-flex";
import { importParsedFile } from "../src/lib/server/import-service";
import { refreshMaterializedClosedTrades } from "../src/lib/server/closed-trades-materialized";
import { refreshMaterializedExecutionAnalytics } from "../src/lib/server/execution-analytics-materialized";

async function snapshot() {
  const executions = await prisma.execution.findMany({ where: { account: { ibkrAccount: "DEMO-IMPORT" } }, include: { instrument: true, analytics: true }, orderBy: [{ executedAt: "asc" }, { orderId: "asc" }] });
  const groups = await prisma.closedTrade.findMany({ where: { account: { ibkrAccount: "DEMO-IMPORT" } }, orderBy: [{ closeTime: "asc" }, { symbol: "asc" }] });
  const positions = await prisma.position.findMany({ where: { account: { ibkrAccount: "DEMO-IMPORT" } }, include: { instrument: true }, orderBy: { instrument: { symbol: "asc" } } });
  return {
    executions: executions.map(e => ({ symbol: e.instrument.symbol, time: e.executedAt.toISOString(), side: e.side, quantity: e.quantity, price: e.price, commission: e.commission, fees: e.fees, currency: e.currency, orderId: e.orderId, analytics: e.analytics ? { pnl: e.analytics.realizedPnl, gross: e.analytics.grossRealizedPnl, cumulative: e.analytics.cumulativePnl, matchedQuantity: e.analytics.matchedQuantity, avgHoldTimeMs: e.analytics.avgHoldTimeMs } : null })),
    closedTrades: groups.map(g => ({ symbol: g.symbol, direction: g.direction, open: g.openTime.toISOString(), close: g.closeTime.toISOString(), quantity: g.totalQuantity, opening: g.openingQuantity, closing: g.closingQuantity, entry: g.avgEntryPrice, exit: g.avgExitPrice, gross: g.grossRealizedPnl, pnl: g.realizedPnl, commission: g.totalCommission, stale: g.isStale })),
    positions: positions.map(p => ({ symbol: p.instrument.symbol, quantity: p.quantity, cost: p.avgCost, unrealizedPnl: p.unrealizedPnl, currency: p.currency })),
  };
}
async function main() {
  const target = assertTestDatabaseSafety(process.env);
  assert.equal(target.databaseUrl.host, "127.0.0.1:55439");
  assert.ok(["trades_workstation_test", "trades_baseline_test"].includes(target.databaseUrl.database));
  const timezone = await prisma.$queryRaw<{ TimeZone: string }[]>`SHOW TIMEZONE`;
  assert.equal(timezone[0].TimeZone, "UTC", "Run fixture materialization with UTC database sessions");
  assert.equal(await prisma.execution.count({ where: { account: { ibkrAccount: "DEMO-IMPORT" } } }), 0, "Use a fresh fixture account");
  const executionCsv = await readFile("fixtures/sample-ibkr-executions.csv", "utf8");
  const positionCsv = await readFile("fixtures/sample-ibkr-positions.csv", "utf8");
  const flexCsv = await readFile("fixtures/sample-ibkr-flex.csv", "utf8");
  const flex = parseFlexStatementCsv(flexCsv);
  const inputs = [
    { filename: "sample-ibkr-executions.csv", fileType: "executions", rawContent: executionCsv, parsed: parseCsvWithMapping("executions", executionCsv) },
    { filename: "sample-ibkr-positions.csv", fileType: "positions", rawContent: positionCsv, parsed: parseCsvWithMapping("positions", positionCsv) },
    { filename: "sample-ibkr-flex.csv", fileType: "flex-trades", rawContent: flexCsv, parsed: flex.trades },
    { filename: "sample-ibkr-flex.csv", fileType: "flex-positions", rawContent: flexCsv, parsed: flex.positions },
  ];
  for (const input of inputs) assert.deepEqual(input.parsed.rowErrors, []);
  const first = [];
  for (const input of inputs) { const r = await importParsedFile(input); first.push({ imported: r.rowsImported, skipped: r.rowsSkipped }); }
  await refreshMaterializedClosedTrades(); await refreshMaterializedExecutionAnalytics();
  const before = await snapshot();
  assert.equal(before.executions.length, 7);
  assert.equal(before.closedTrades.length, 3);
  assert.ok(before.closedTrades.some(g => g.direction === "SHORT"));
  assert.ok(before.executions.some(e => e.fees > 0 && e.commission > 0));
  assert.equal(before.executions[0].time, "2026-06-17T09:35:00.000Z");
  assert.equal(before.closedTrades[0].open, before.executions[0].time);
  let reviewedKey: string | undefined;
  let reviewJson: string | undefined;
  if (process.argv.includes("--workstation")) {
    const { readWorkstationDocument, saveWorkstationDocument } = await import("../src/lib/server/trade-workstation");
    reviewedKey = (await prisma.closedTrade.findFirstOrThrow({ where: { account: { ibkrAccount: "DEMO-IMPORT" } } })).groupKey;
    const doc = await readWorkstationDocument(reviewedKey);
    await saveWorkstationDocument(reviewedKey, { ...doc, review: { ...doc.review, takeaway: "Preserve this review across ingestion" } }, doc.revision);
    reviewJson = (await prisma.closedTradeNote.findUniqueOrThrow({ where: { groupKey: reviewedKey } })).workstationJson!;
  }
  const repeated = [];
  for (const input of inputs) { const r = await importParsedFile(input); repeated.push({ imported: r.rowsImported, skipped: r.rowsSkipped }); }
  await refreshMaterializedClosedTrades(); await refreshMaterializedExecutionAnalytics();
  assert.deepEqual(await snapshot(), before, "Reimport must preserve counts, fees, positions and P&L");
  if (reviewedKey) {
    assert.equal((await prisma.closedTradeNote.findUniqueOrThrow({ where: { groupKey: reviewedKey } })).workstationJson, reviewJson);
    assert.equal(await prisma.journalLink.count({ where: { targetId: reviewedKey, linkType: "REVIEW_SOURCE" } }), 1);
  }
  await writeFile(process.argv[2], JSON.stringify({ first, repeated, ...before }, null, 2));
  console.log(`Verified fixture ingestion and idempotency: ${before.executions.length} executions, ${before.closedTrades.length} closed trades, ${before.positions.length} positions.${reviewedKey ? " Workstation review survived both refreshes." : ""}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

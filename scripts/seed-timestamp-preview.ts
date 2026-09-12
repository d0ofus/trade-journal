import { createHash } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { assertTestDatabaseSafety } from "../src/lib/test-database-safety";
import { timingFills, timingDemoTrade } from "../src/lib/workstation/timing-demo";
import { interpretBrokerTimestamp } from "../src/lib/workstation/timestamp-interpretation";
// Explicitly synthetic, repeatable Settings preview. This script cannot target a remote database.
async function main() {
  assertTestDatabaseSafety(process.env);
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/trades_workstation_auth_test") throw new Error("Use the isolated workstation preview database.");
  const id = "DEMO-TIMESTAMP-PREVIEW", accountCode = "DEMO-WORKSTATION", trade = timingDemoTrade(false);
  if (await prisma.importBatch.findUnique({ where: { id } })) { console.log("Synthetic timestamp preview already exists."); return; }
  const content = "AccountId,Symbol,DateTime,Buy/Sell,Quantity,TradePrice,IBExecID\n" + timingFills.map(([raw, side, quantity, price], i) => `${accountCode},MU,${raw},${side},${quantity},${price},demo-fill-${i}`).join("\n");
  const sha = (value: string) => createHash("sha256").update(value).digest("hex"), sourceHash = sha(content), storageKey = `timestamp-preview/${sourceHash}`;
  await prisma.$transaction(async tx => {
    const account = await tx.account.upsert({ where: { ibkrAccount: accountCode }, create: { ibkrAccount: accountCode, name: "Synthetic workstation review", baseCurrency: "USD" }, update: {} });
    await tx.instrument.create({ data: { id, symbol: "MU", exchange: "NASDAQ", assetType: "STOCK", currency: "USD" } });
    await tx.importArtifact.create({ data: { storageKey, rawSha256: sourceHash, rawBytes: Buffer.byteLength(content), content } });
    await tx.importBatch.create({ data: { id, filename: "DEMO-timestamp-review.csv", fileType: "flex-trades", status: "SUCCEEDED", accountId: account.id, sourceSection: "trades", rawSha256: sourceHash, rawStorageKey: storageKey, parserVersion: "demo-naive-utc-v1" } });
    for (const [index, [raw, side, quantity, price]] of timingFills.entries()) await tx.execution.create({ data: { id: `${id}-${index}`, dedupeKey: sha(["ibkr-execution-v2", accountCode, "ibexecid", `demo-fill-${index}`].join("|")), accountId: account.id, instrumentId: id, importBatchId: id, executedAt: new Date(interpretBrokerTimestamp(raw).stored! * 1000), side, quantity, price, currency: "USD" } });
    await tx.closedTrade.create({ data: { groupKey: id, accountId: account.id, instrumentId: id, symbol: "MU", direction: "LONG", openTime: new Date(trade.openTime * 1000), closeTime: new Date(trade.closeTime * 1000), tradeDate: new Date("2026-09-10"), totalQuantity: 18, avgEntryPrice: trade.entry, avgExitPrice: trade.exit, grossRealizedPnl: trade.pnl, openingQuantity: 0, closingQuantity: 0, realizedPnl: trade.pnl, totalCommission: 0 } });
    await tx.closedTradeExecution.createMany({ data: trade.executions.map((e, index) => ({ closedTradeGroupKey: id, executionId: `${id}-${index}`, executedAt: new Date(e.time * 1000), side: e.side, quantity: e.quantity, price: e.price, commission: 0, fees: 0, sortOrder: index })) });
  });
  console.log("Seeded 8 synthetic executions and one reviewable batch. No interpretation applied.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

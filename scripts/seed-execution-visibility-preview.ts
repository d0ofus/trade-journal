import { rawImportArchiveIdentity } from "../src/lib/import/raw-archive";
import { createHash } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { assertTestDatabaseSafety } from "../src/lib/test-database-safety";
const timingFills = [
 ["20260813;093005", "BUY",20,225.56], ["20260813;093005", "BUY",14,225.56], ["20260813;093005", "BUY",20,225.56],
 ["20260813;100701", "BUY",46,226.22], ["20260813;113318", "SELL",46,224.075],
 ["20260818;093005", "SELL",5,219.97], ["20260818;093006", "SELL",49,220.0075],
] as const;
const executions = timingFills.map(([raw, side, quantity, price]) => ({ time: interpretBrokerTimestamp(raw).stored!, side, quantity, price }));
const trade = { executions, openTime: executions[0].time, closeTime: executions.at(-1)!.time, entry: 225.8636, exit: 221.876625, pnl: -398.6975 };
import { interpretBrokerTimestamp } from "../src/lib/workstation/timestamp-interpretation";
// Explicitly synthetic, repeatable Settings preview. This script cannot target a remote database.
async function main() {
  assertTestDatabaseSafety(process.env);
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/trades_workstation_auth_test") throw new Error("Use the isolated workstation preview database.");
  const id = "DEMO-NVDA-TIMING-V2", accountCode = "DEMO-WORKSTATION";
  if (await prisma.importBatch.findUnique({ where: { id } })) { console.log("Synthetic timestamp preview already exists."); return; }
  const content = "AccountId,Symbol,DateTime,Buy/Sell,Quantity,TradePrice,IBExecID\n" + timingFills.map(([raw, side, quantity, price], i) => `${accountCode},NVDA,${raw},${side},${quantity},${price},nvda-demo-fill-${i}`).join("\n");
  const sha = (value: string) => createHash("sha256").update(value).digest("hex"), sourceHash = sha(content), storageKey = rawImportArchiveIdentity(content).rawStorageKey;
  await prisma.$transaction(async tx => {
    const account = await tx.account.upsert({ where: { ibkrAccount: accountCode }, create: { ibkrAccount: accountCode, name: "Synthetic workstation review", baseCurrency: "USD" }, update: {} });
    const instrument = await tx.instrument.upsert({ where: { symbol_exchange_assetType: { symbol: "NVDA", exchange: "NASDAQ", assetType: "STOCK" } }, create: { id, symbol: "NVDA", exchange: "NASDAQ", assetType: "STOCK", currency: "USD" }, update: {} });
    await tx.importArtifact.create({ data: { storageKey, rawSha256: sourceHash, rawBytes: Buffer.byteLength(content), content } });
    await tx.importBatch.create({ data: { id, filename: "DEMO-timestamp-review.csv", fileType: "flex-trades", status: "SUCCEEDED", accountId: account.id, sourceSection: "trades", rawSha256: sourceHash, rawStorageKey: storageKey, parserVersion: "2026-06-25-workstation-uplift" } });
    for (const [index, [raw, side, quantity, price]] of timingFills.entries()) await tx.execution.create({ data: { id: `${id}-${index}`, dedupeKey: sha(["ibkr-execution-v2", accountCode, "ibexecid", `nvda-demo-fill-${index}`].join("|")), accountId: account.id, instrumentId: instrument.id, importBatchId: id, executedAt: new Date(interpretBrokerTimestamp(raw).stored! * 1000), side, quantity, price, currency: "USD" } });
    await tx.closedTrade.create({ data: { groupKey: id, accountId: account.id, instrumentId: instrument.id, symbol: "NVDA", direction: "LONG", openTime: new Date(trade.openTime * 1000), closeTime: new Date(trade.closeTime * 1000), tradeDate: new Date("2026-08-18"), totalQuantity: 100, avgEntryPrice: trade.entry, avgExitPrice: trade.exit, grossRealizedPnl: trade.pnl, openingQuantity: 0, closingQuantity: 0, realizedPnl: trade.pnl, totalCommission: 0 } });
    await tx.closedTradeExecution.createMany({ data: trade.executions.map((e, index) => ({ closedTradeGroupKey: id, executionId: `${id}-${index}`, executedAt: new Date(e.time * 1000), side: e.side, quantity: e.quantity, price: e.price, commission: 0, fees: 0, sortOrder: index })) });
  });
  console.log("Seeded 7 synthetic executions and one reviewable batch. No interpretation applied.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

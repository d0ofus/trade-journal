import { prisma } from "../src/lib/prisma";
import { assertTestDatabaseSafety } from "../src/lib/test-database-safety";
async function main() {
  assertTestDatabaseSafety(process.env);
  const target = new URL(process.env.DATABASE_URL!);
  if (target.hostname !== "127.0.0.1" || target.port !== "15439" || target.pathname !== "/trade_journal_notion_test") throw new Error("Use only the dedicated local Notion validation database.");
  const groupKey = "DEMO-NOTION-VALIDATION";
  if (await prisma.closedTrade.findUnique({ where: { groupKey } })) return;
  const account = await prisma.account.upsert({ where: { ibkrAccount: "DEMO-WORKSTATION" }, create: { ibkrAccount: "DEMO-WORKSTATION", name: "Synthetic Notion validation", baseCurrency: "USD" }, update: {} });
  const instrument = await prisma.instrument.create({ data: { symbol: "NTST", exchange: "DEMO-NOTION", currency: "USD", assetType: "STOCK" } });
  const open = new Date("2026-09-10T14:00:00Z"), close = new Date("2026-09-10T15:00:00Z");
  await prisma.closedTrade.create({ data: { groupKey, accountId: account.id, instrumentId: instrument.id, symbol: "NTST", direction: "LONG", openTime: open, closeTime: close, tradeDate: new Date("2026-09-10"), totalQuantity: 10, avgEntryPrice: 100, avgExitPrice: 110, grossRealizedPnl: 100, openingQuantity: 10, closingQuantity: 10, realizedPnl: 100, totalCommission: 0 } });
  for (const [index, side, time, price] of [[0, "BUY", open, 100], [1, "SELL", close, 110]] as const) {
    const execution = await prisma.execution.create({ data: { dedupeKey: `${groupKey}-${index}`, accountId: account.id, instrumentId: instrument.id, executedAt: time, side, quantity: 10, price, currency: "USD" } });
    await prisma.closedTradeExecution.create({ data: { closedTradeGroupKey: groupKey, executionId: execution.id, executedAt: time, side, quantity: 10, price, commission: 0, fees: 0, sortOrder: index } });
  }
  await prisma.closedTradeNote.create({ data: { groupKey, content: "Synthetic legacy note to preserve", mistake: "Synthetic legacy improvement to preserve", lesson: "Synthetic shared takeaway" } });
  console.log("Seeded one synthetic Notion validation trade. No external services used.");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Seed failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());

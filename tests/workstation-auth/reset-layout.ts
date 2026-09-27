import { prisma } from "../../src/lib/prisma";
import { assertTestDatabaseSafety } from "../../src/lib/test-database-safety";

// Saved server views intentionally override browser preferences. Isolate each test's layout.
export async function resetSyntheticLayouts() {
  assertTestDatabaseSafety(process.env);
  const trades = await prisma.closedTrade.findMany({ where: { account: { ibkrAccount: "DEMO-WORKSTATION" } }, select: { groupKey: true } });
  await prisma.workstationTradeView.deleteMany({ where: { groupKey: { in: trades.map(t => t.groupKey) } } });
}

export async function notionFixtureKey() {
  assertTestDatabaseSafety(process.env);
  const trade = await prisma.closedTrade.findFirstOrThrow({ where: { symbol: "NTST", isStale: false, account: { ibkrAccount: "DEMO-WORKSTATION" } } });
  await prisma.closedTradeNote.upsert({ where: { groupKey: trade.groupKey }, update: {}, create: { groupKey: trade.groupKey, content: "Synthetic legacy note to preserve", mistake: "Synthetic legacy improvement to preserve", lesson: "Synthetic shared takeaway" } });
  return trade.groupKey;
}

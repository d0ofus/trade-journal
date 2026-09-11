import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { assertTestDatabaseSafety } from "../src/lib/test-database-safety";

async function main() {
  const target = assertTestDatabaseSafety(process.env);
  if (target.databaseUrl.host !== "127.0.0.1:55439" || target.databaseUrl.database !== "trades_workstation_test") throw new Error("Migration fixture requires the disposable phase-two database.");
  const db = new PrismaClient();
  const snapshotPath = process.argv[3];
  assert.ok(snapshotPath, "Provide a snapshot file path outside the repository");
  try {
    if (process.argv[2] === "before") {
      const account = await db.account.create({ data: { id: "phase2-migration-account", ibkrAccount: "PHASE2-MIGRATION", name: "Migration fixture", baseCurrency: "USD" } });
      const instrument = await db.instrument.create({ data: { id: "phase2-migration-instrument", symbol: "MIGTEST", assetType: "STOCK", exchange: "NASDAQ", currency: "USD" } });
      await db.closedTrade.create({ data: { groupKey: "phase2-migration-trade", accountId: account.id, instrumentId: instrument.id, symbol: "MIGTEST", direction: "LONG", openTime: new Date("2026-06-19T14:00:00Z"), closeTime: new Date("2026-06-19T15:00:00Z"), tradeDate: new Date("2026-06-19"), totalQuantity: 10, avgEntryPrice: 100, avgExitPrice: 110, grossRealizedPnl: 100, openingQuantity: 10, closingQuantity: 10, realizedPnl: 98, totalCommission: 2 } });
      // The client contains the new columns, so insert/read only legacy SQL fields before migration.
      await db.$executeRaw`INSERT INTO "ClosedTradeNote" ("id","groupKey","content","setup","updatedAt") VALUES ('phase2-migration-note','phase2-migration-trade','Historical note — preserved','Legacy setup','2026-06-20T12:00:00Z')`;
      const rows = await db.$queryRaw`SELECT * FROM "ClosedTradeNote" WHERE "groupKey" = 'phase2-migration-trade'`;
      await writeFile(snapshotPath, JSON.stringify(rows), "utf8");
      console.log("Legacy review fixture recorded before the additive migration.");
    } else if (process.argv[2] === "after") {
      const rows = await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "ClosedTradeNote" WHERE "groupKey" = 'phase2-migration-trade'`;
      assert.equal(rows[0].workstationVersion, 0); assert.equal(rows[0].workstationJson, null);
      delete rows[0].workstationVersion; delete rows[0].workstationJson;
      assert.deepEqual(JSON.parse(JSON.stringify(rows)), JSON.parse(await readFile(snapshotPath, "utf8")));
      console.log("Additive migration preserved every legacy review field and timestamp; new columns have safe defaults.");
    } else throw new Error("Choose before or after");
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Migration check failed"); process.exitCode = 1; });

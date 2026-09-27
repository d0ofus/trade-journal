import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadReviewStatuses } from "./review-statuses";
import { POST } from "@/app/api/workstation/review-statuses/route";

const auth = vi.hoisted(() => ({ active: true }));
vi.mock("next-auth", () => ({ getServerSession: async () => auth.active ? { user: { name: "test" } } : null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
const prefix = `status-test-${crypto.randomUUID()}`, keys = Array.from({ length: 8 }, (_, i) => `${prefix}-${i}`);
let accountId: string, instrumentId: string;
beforeAll(async () => {
  vi.stubEnv("TRADES_WORKSTATION_ENABLED", "1");
  accountId = (await prisma.account.create({ data: { ibkrAccount: prefix, name: prefix, baseCurrency: "USD" } })).id;
  instrumentId = (await prisma.instrument.create({ data: { symbol: "STATUS", exchange: prefix, assetType: "STOCK", currency: "USD" } })).id;
  for (const groupKey of keys) await prisma.closedTrade.create({ data: { groupKey, accountId, instrumentId, symbol: "STATUS", direction: "LONG", openTime: new Date("2026-01-01"), closeTime: new Date("2026-01-02"), tradeDate: new Date("2026-01-02"), totalQuantity: 1, avgEntryPrice: 1, avgExitPrice: 2, grossRealizedPnl: 1, realizedPnl: 1, totalCommission: 0, openingQuantity: 0, closingQuantity: 0 } });
  const documents = [null, JSON.stringify({ review: { status: "In progress" } }), JSON.stringify({ review: { status: "Reviewed" }, evidence: [{ image: "private payload" }] }), "invalid json", '{"review":{}}', '{"review":{"status":"unknown"}}', '{"review":{"status":null}}', '{"review":42}'];
  for (let i = 1; i < keys.length; i++) await prisma.closedTradeNote.create({ data: { groupKey: keys[i], content: "private note", workstationVersion: i, workstationJson: documents[i] } });
});
afterAll(async () => { await prisma.closedTradeNote.deleteMany({ where: { groupKey: { in: keys } } }); await prisma.closedTrade.deleteMany({ where: { groupKey: { in: keys } } }); if (instrumentId) await prisma.instrument.delete({ where: { id: instrumentId } }); if (accountId) await prisma.account.delete({ where: { id: accountId } }); vi.unstubAllEnvs(); });
it("projects all states without private payloads or writes, including malformed legacy data", async () => {
  const before = await prisma.closedTradeNote.findMany({ where: { groupKey: { in: keys } }, orderBy: { groupKey: "asc" } });
  const rows = await loadReviewStatuses([...keys, keys[0], "does-not-exist"]);
  expect(rows).toHaveLength(8);
  const byKey = new Map(rows.map(row => [row.groupKey, row]));
  expect(keys.map(key => byKey.get(key)?.status)).toEqual(["Not reviewed", "In progress", "Reviewed", null, "Not reviewed", null, null, null]);
  expect(Object.keys(rows[0]).sort()).toEqual(["groupKey", "revision", "status", "updatedAt"]);
  expect(await prisma.closedTradeNote.findMany({ where: { groupKey: { in: keys } }, orderBy: { groupKey: "asc" } })).toEqual(before);
});
it("authenticates and bounds read-only batches", async () => {
  const request = (groupKeys: string[]) => new NextRequest("http://localhost/api/workstation/review-statuses", { method: "POST", body: JSON.stringify({ groupKeys }) });
  auth.active = false; expect((await POST(request(keys))).status).toBe(401); auth.active = true;
  expect((await POST(request(Array(501).fill(keys[0])))).status).toBe(400);
  const response = await POST(request(keys)); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store"); expect((await response.json()).statuses).toHaveLength(8);
});

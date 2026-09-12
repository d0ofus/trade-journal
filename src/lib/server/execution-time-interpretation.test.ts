import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { timingFills } from "@/lib/workstation/timing-demo";
import { interpretBrokerTimestamp } from "@/lib/workstation/timestamp-interpretation";
import { applyTimeInterpretation, confirmBatchTimestamps, inspectBatchTimestamps, revokeBatchTimestamps } from "./execution-time-interpretation";
import { listWorkstationTrades, readWorkstationDocument } from "./trade-workstation";
import { GET, PATCH } from "@/app/api/workstation/timestamp-interpretations/route";
const auth = vi.hoisted(() => ({ allowed: true }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.allowed ? { user: { name: "test" } } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const fixtures: { account: string; instrument: string; storageKey: string }[] = [];
async function fixture() {
  const suffix = randomUUID(), code = `TIME-TEST-${suffix}`;
  const account = await prisma.account.create({ data: { ibkrAccount: code, name: "Isolated timestamp test", baseCurrency: "USD" } });
  const instrument = await prisma.instrument.create({ data: { symbol: "MU", exchange: code, assetType: "STOCK", currency: "USD" } });
  const content = "AccountId,Symbol,DateTime,Buy/Sell,Quantity,TradePrice,IBExecID\n" + timingFills.map(([raw, side, quantity, price], i) => `${code},MU,${raw},${side},${quantity},${price},fill-${i}`).join("\n");
  const sourceHash = hash(content), storageKey = `timestamp-test/${suffix}`;
  fixtures.push({ account: account.id, instrument: instrument.id, storageKey });
  await prisma.importArtifact.create({ data: { storageKey, rawSha256: sourceHash, rawBytes: Buffer.byteLength(content), content } });
  const batch = await prisma.importBatch.create({ data: { filename: `timestamp-test-${suffix}.csv`, fileType: "flex-trades", accountId: account.id, status: "SUCCEEDED", parserVersion: "test-naive-utc-v1", sourceSection: "trades", rawSha256: sourceHash, rawStorageKey: storageKey } });
  for (const [i, [raw, side, quantity, price]] of timingFills.entries()) await prisma.execution.create({ data: { id: `${suffix}-${i}`, dedupeKey: hash(["ibkr-execution-v2", code, "ibexecid", `fill-${i}`].join("|")), accountId: account.id, instrumentId: instrument.id, importBatchId: batch.id, executedAt: new Date(interpretBrokerTimestamp(raw).stored! * 1000), side, quantity, price, currency: "USD" } });
  const fills = await prisma.execution.findMany({ where: { importBatchId: batch.id }, orderBy: { executedAt: "asc" } });
  const groupKey = `timing-test-${suffix}`;
  await prisma.closedTrade.create({ data: { groupKey, accountId: account.id, instrumentId: instrument.id, symbol: "MU", direction: "LONG", openTime: fills[0].executedAt, closeTime: fills.at(-1)!.executedAt, tradeDate: new Date("2026-09-10"), totalQuantity: 18, avgEntryPrice: 993.89, avgExitPrice: 994.7, grossRealizedPnl: 7.21, openingQuantity: 0, closingQuantity: 0, realizedPnl: 7.21, totalCommission: 0 } });
  await prisma.closedTradeExecution.createMany({ data: fills.map((e, sortOrder) => ({ closedTradeGroupKey: groupKey, executionId: e.id, executedAt: e.executedAt, side: e.side, quantity: e.quantity, price: e.price, commission: 0, fees: 0, sortOrder })) });
  await prisma.closedTradeNote.create({ data: { groupKey, content: "Existing review remains untouched", workstationJson: JSON.stringify({
    drawings: [{ id: "original-ray", tool: "ray", points: [{ time: fills[0].executedAt.getTime() / 1000, price: 978.5 }], text: "Keep this anchor", color: "#a5b4fc", width: 1, dashed: false, locked: true, hidden: false, panel: null, createdAt: 1 }],
    evidence: [{ id: "old-chart", name: "Earlier chart", image: "data:image/png;base64,aGVsbG8=", time: 1, revision: 0, timeframe: "5m" }],
  }) } });
  return { code, batch, groupKey, sourceHash, fills };
}
afterEach(async () => { auth.allowed = true; vi.unstubAllEnvs(); for (const f of fixtures.splice(0)) { const groups = await prisma.closedTrade.findMany({ where: { accountId: f.account }, select: { groupKey: true } }); await prisma.closedTradeNote.deleteMany({ where: { groupKey: { in: groups.map(g => g.groupKey) } } }); await prisma.importBatch.deleteMany({ where: { accountId: f.account } }); await prisma.account.delete({ where: { id: f.account } }); await prisma.instrument.delete({ where: { id: f.instrument } }); await prisma.importArtifact.delete({ where: { storageKey: f.storageKey } }); } });
describe("isolated, reversible execution-time interpretation", () => {
  it("interprets a fill allocated across trade cycles without changing the allocated quantity", async () => {
    const f = await fixture(), report = await inspectBatchTimestamps(f.batch.id);
    await prisma.closedTradeExecution.updateMany({ where: { closedTradeGroupKey: f.groupKey, executionId: f.fills[4].id }, data: { quantity: 2 } });
    await confirmBatchTimestamps(f.batch.id, { timezone: report.timezone, fingerprint: report.fingerprint, expectedRevision: 0 });
    const execution = (await listWorkstationTrades({ account: f.code }))[0].executions[4];
    expect(execution).toMatchObject({ quantity: 2, time: Date.parse("2026-09-08T19:09:25Z") / 1000, provenance: { interpretationStatus: "applied" } });
    expect((await prisma.execution.findUniqueOrThrow({ where: { id: f.fills[4].id } })).quantity).toBe(6);
  });
  it("serializes confirmation against rollback so only one revision wins", async () => {
    const f = await fixture(), report = await inspectBatchTimestamps(f.batch.id);
    await confirmBatchTimestamps(f.batch.id, { timezone: report.timezone, fingerprint: report.fingerprint, expectedRevision: 0 });
    const writes = await Promise.allSettled([confirmBatchTimestamps(f.batch.id, { timezone: report.timezone, fingerprint: report.fingerprint, expectedRevision: 1 }), revokeBatchTimestamps(f.batch.id, 1)]);
    expect(writes.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.executionTimeInterpretation.findUniqueOrThrow({ where: { importBatchId: f.batch.id } })).revision).toBe(2);
  });
  it("confirms a batch without changing source rows, group IDs or reviews, and rolls back", async () => {
    const f = await fixture(), before = await listWorkstationTrades({ account: f.code }), doc = await readWorkstationDocument(f.groupKey);
    const originalGroup = await prisma.closedTrade.findUniqueOrThrow({ where: { groupKey: f.groupKey } });
    expect(doc.drawings).toHaveLength(1); expect(doc.evidence).toHaveLength(1);
    const report = await inspectBatchTimestamps(f.batch.id);
    expect(report.rows.filter(r => r.interpretedTime !== null)).toHaveLength(8);
    await confirmBatchTimestamps(f.batch.id, { timezone: report.timezone, fingerprint: report.fingerprint, expectedRevision: 0 });
    const after = await listWorkstationTrades({ account: f.code });
    expect(after[0].id).toBe(before[0].id); expect(after[0].pnl).toBe(before[0].pnl);
    expect(after[0].executions[4].time).toBe(Date.parse("2026-09-08T19:09:25Z") / 1000);
    expect(after[0].openTime - before[0].openTime).toBe(14400);
    expect(await prisma.execution.findMany({ where: { importBatchId: f.batch.id }, orderBy: { executedAt: "asc" } })).toEqual(f.fills);
    expect(await readWorkstationDocument(f.groupKey)).toEqual(doc);
    expect(await prisma.closedTrade.findUniqueOrThrow({ where: { groupKey: f.groupKey } })).toEqual(originalGroup);
    await expect(confirmBatchTimestamps(f.batch.id, { timezone: report.timezone, fingerprint: report.fingerprint, expectedRevision: 0 })).rejects.toThrow("changed");
    await confirmBatchTimestamps(f.batch.id, { timezone: report.timezone, fingerprint: report.fingerprint, expectedRevision: 1 });
    expect((await listWorkstationTrades({ account: f.code }))[0].executions[4].time).toBe(after[0].executions[4].time);
    await revokeBatchTimestamps(f.batch.id, 2);
    expect((await listWorkstationTrades({ account: f.code }))[0].executions).toEqual(before[0].executions);
    await expect(revokeBatchTimestamps(f.batch.id, 2)).rejects.toThrow("changed");
  });
  it("rejects stale source previews and stale stored timestamps", async () => {
    const f = await fixture(), report = await inspectBatchTimestamps(f.batch.id);
    await prisma.execution.update({ where: { id: f.fills[0].id }, data: { price: 980 } });
    await expect(confirmBatchTimestamps(f.batch.id, { timezone: report.timezone, fingerprint: report.fingerprint, expectedRevision: 0 })).rejects.toThrow("changed");
    await prisma.execution.update({ where: { id: f.fills[0].id }, data: { price: f.fills[0].price } });
    await confirmBatchTimestamps(f.batch.id, { timezone: report.timezone, fingerprint: report.fingerprint, expectedRevision: 0 });
    const overlay = await prisma.executionTimeInterpretation.findUniqueOrThrow({ where: { importBatchId: f.batch.id } });
    const original = { id: f.fills[4].id, time: f.fills[4].executedAt.getTime() / 1000 + 1, side: "SELL" as const, quantity: 6, price: 1008.71, commission: 0, fees: 0, provenance: { timezoneStatus: "unverified" as const, timezone: null, source: "test" } };
    expect(applyTimeInterpretation(original, { ...f.batch, rawArtifact: { rawSha256: f.sourceHash }, timeInterpretation: overlay }).provenance?.interpretationStatus).toBe("stale");
    await prisma.importBatch.update({ where: { id: f.batch.id }, data: { rawSha256: "changed" } });
    expect((await listWorkstationTrades({ account: f.code }))[0].executions[4].provenance?.interpretationStatus).toBe("stale");
  });
  it("requires authentication and an explicitly reviewed batch fingerprint", async () => {
    vi.stubEnv("TRADES_WORKSTATION_ENABLED", "1"); auth.allowed = false;
    expect((await GET(new NextRequest("http://localhost/api/workstation/timestamp-interpretations"))).status).toBe(401);
    auth.allowed = true;
    expect((await PATCH(new NextRequest("http://localhost/api/workstation/timestamp-interpretations", { method: "PATCH", body: JSON.stringify({ batchId: "unknown", action: "confirm", expectedRevision: 0 }) }))).status).toBe(400);
    expect((await PATCH(new NextRequest("http://localhost/api/workstation/timestamp-interpretations", { method: "PATCH", headers: { Origin: "https://foreign.example" }, body: "{}" }))).status).toBe(403);
    expect((await PATCH(new NextRequest("http://localhost/api/workstation/timestamp-interpretations", { method: "PATCH", headers: { Origin: "http://127.0.0.1:3101", Host: "127.0.0.1:3101" }, body: "{}" }))).status).toBe(400);
  });
});

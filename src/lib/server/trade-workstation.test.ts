import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { listWorkstationTrades, readWorkstationDocument, saveWorkstationDocument, WorkstationError } from "./trade-workstation";
import { createJournalEntryFromClosedTrade, JournalStaleWriteError, updateJournalEntry } from "./journal";
import { emptyDocument } from "@/lib/workstation/types";
import { REVIEW_PACKAGE_MAX_BYTES } from "@/lib/workstation/payload";
import { GET, PATCH } from "@/app/api/closed-trades/[groupKey]/workstation/route";
import { POST as legacySave } from "@/app/api/notes/closed-trade/route";

const auth = vi.hoisted(() => ({ session: true }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session ? { user: { name: "isolated test" } } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const fixtures: { groupKey: string; accountId: string; instrumentId: string }[] = [];
async function fixture(legacy = true) {
  const groupKey = `ws-test-${crypto.randomUUID()}`;
  const account = await prisma.account.create({ data: { ibkrAccount: groupKey, name: groupKey, baseCurrency: "USD" } });
  const instrument = await prisma.instrument.create({ data: { symbol: "WSTEST", exchange: groupKey, assetType: "STOCK", currency: "USD" } });
  fixtures.push({ groupKey, accountId: account.id, instrumentId: instrument.id });
  await prisma.closedTrade.create({ data: { groupKey, accountId: account.id, instrumentId: instrument.id, symbol: "WSTEST", direction: "LONG", openTime: new Date("2024-09-10T14:30:00Z"), closeTime: new Date("2024-09-10T15:30:00Z"), tradeDate: new Date("2024-09-10"), totalQuantity: 10, avgEntryPrice: 100, avgExitPrice: 110, grossRealizedPnl: 100, openingQuantity: 10, closingQuantity: 10, realizedPnl: 98, totalCommission: 2 } });
  if (legacy) {
    await prisma.closedTradeNote.create({ data: { groupKey, setup: "Original setup", content: "Original note — 保留", followUp: "Follow up", lesson: "Original lesson" } });
    await prisma.closedTradeAnnotation.createMany({ data: [
      { id: `${groupKey}-ray`, closedTradeGroupKey: groupKey, symbol: "WSTEST", type: "ray", price: 101, pointsJson: "[]", text: "Legacy ray" },
      { id: `${groupKey}-unsupported`, closedTradeGroupKey: groupKey, symbol: "WSTEST", type: "custom-legacy-tool", pointsJson: "[]", text: "Keep unsupported drawing" },
    ] });
  }
  return groupKey;
}
function request(groupKey: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/closed-trades/${groupKey}/workstation`, body === undefined ? {} : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function params(groupKey: string) { return { params: Promise.resolve({ groupKey }) }; }

beforeEach(() => { auth.session = true; vi.stubEnv("TRADES_WORKSTATION_ENABLED", "1"); vi.stubEnv("E2E_DEMO_ONLY_WRITES", "0"); });
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const f of fixtures.splice(0)) {
    await prisma.journalEntry.deleteMany({ where: { links: { some: { targetType: "CLOSED_TRADE", targetId: f.groupKey } } } });
    await prisma.closedTradeNote.deleteMany({ where: { groupKey: f.groupKey } });
    await prisma.closedTrade.deleteMany({ where: { groupKey: f.groupKey } });
    await prisma.instrument.delete({ where: { id: f.instrumentId } });
    await prisma.account.delete({ where: { id: f.accountId } });
  }
});

describe("workstation persistence against isolated PostgreSQL", () => {
  it.each([
    { direction: "LONG", totalQuantity: 10, openingQuantity: 0, closingQuantity: 0 },
    { direction: "LONG", totalQuantity: 30, openingQuantity: 100, closingQuantity: 100 },
    { direction: "SHORT", totalQuantity: 120, openingQuantity: -120, closingQuantity: 0 },
  ])("displays the $direction cycle's $totalQuantity shares independently of its account-position baseline", async values => {
    const key = await fixture(false);
    await prisma.closedTrade.update({ where: { groupKey: key }, data: values });
    const trades = await listWorkstationTrades({ account: key });
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ quantity: values.totalQuantity, openQuantity: 0, direction: values.direction, pnl: 98, fees: 2 });
  });

  it("adopts legacy content without losing journal-only fields, outcomes, or unsupported annotations", async () => {
    const key = await fixture();
    const bridge = await createJournalEntryFromClosedTrade(key, { expectedReviewUpdatedAt: (await readWorkstationDocument(key)).noteUpdatedAt });
    await prisma.journalEntry.update({ where: { id: bridge.entry.id }, data: { riskPlan: "Keep sizing plan", marketContext: "Keep context", outcomeNotes: "Computed outcome reason", outcomeCalculationJson: '{"mfeR":2}', mfeR: 2 } });
    const before = await readWorkstationDocument(key);
    expect(before.review.notes).toBe("Original note — 保留");
    expect(before.drawings).toHaveLength(1);
    const originalAnnotations = await prisma.closedTradeAnnotation.findMany({ where: { closedTradeGroupKey: key } });
    const saved = await saveWorkstationDocument(key, { ...before, legacy: "forged", review: { ...before.review, setup: "New setup", execution: "New execution", takeaway: "New takeaway", notes: "New formatted notes" } }, 0);
    const reloaded = await readWorkstationDocument(key);
    expect(reloaded).toEqual(JSON.parse(JSON.stringify(saved)));
    expect(reloaded.legacy).toEqual(JSON.parse(JSON.stringify(before.legacy)));
    expect(reloaded.journalEntryId).toBe(bridge.entry.id);
    expect(await prisma.journalEntry.findUnique({ where: { id: bridge.entry.id } })).toMatchObject({ setup: "New setup", trigger: "New execution", lessonLearned: "New takeaway", riskPlan: "Keep sizing plan", marketContext: "Keep context", outcomeNotes: "Computed outcome reason", outcomeCalculationJson: '{"mfeR":2}', mfeR: 2 });
    expect(await prisma.closedTradeAnnotation.findMany({ where: { closedTradeGroupKey: key } })).toEqual(originalAnnotations);
  });

  it("allows exactly one simultaneous first save and creates exactly one canonical journal", async () => {
    const key = await fixture(false);
    const doc = await readWorkstationDocument(key);
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => saveWorkstationDocument(key, { ...doc, review: { ...doc.review, setup: `Writer ${i}` } }, 0)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results) if (result.status === "rejected") expect(result.reason).toBeInstanceOf(WorkstationError);
    expect(await prisma.journalLink.count({ where: { targetId: key, linkType: "REVIEW_SOURCE" } })).toBe(1);
    expect((await readWorkstationDocument(key)).revision).toBe(1);
  });

  it("rejects a stale note token and a concurrent journal/outcome edit without partial writes", async () => {
    const key = await fixture();
    const bridge = await createJournalEntryFromClosedTrade(key, { expectedReviewUpdatedAt: (await readWorkstationDocument(key)).noteUpdatedAt });
    const doc = await readWorkstationDocument(key);
    await prisma.closedTradeNote.update({ where: { groupKey: key }, data: { content: "Legacy edit", updatedAt: new Date(Date.parse(doc.noteUpdatedAt!) + 1000) } });
    await expect(saveWorkstationDocument(key, doc, 0)).rejects.toMatchObject({ status: 409 });
    const current = await readWorkstationDocument(key);
    await prisma.journalEntry.update({ where: { id: bridge.entry.id }, data: { outcomeNotes: "New result", updatedAt: new Date(Date.parse(current.journalUpdatedAt!) + 1000) } });
    await expect(saveWorkstationDocument(key, { ...current, review: { ...current.review, setup: "Should not persist" } }, 0)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.closedTradeNote.findUnique({ where: { groupKey: key } })).toMatchObject({ content: "Legacy edit", setup: "Original setup", workstationVersion: 0 });
    expect(await prisma.journalEntry.findUnique({ where: { id: bridge.entry.id } })).toMatchObject({ outcomeNotes: "New result" });
  });

  it("rejects stale-trade writes even with fresh review tokens", async () => {
    const key = await fixture();
    const doc = await readWorkstationDocument(key);
    await prisma.closedTrade.update({ where: { groupKey: key }, data: { isStale: true } });
    await expect(saveWorkstationDocument(key, doc, 0)).rejects.toMatchObject({ status: 409 });
    expect((await readWorkstationDocument(key)).revision).toBe(0);
  });

  it("protects migrated reviews from both legacy editors, including flag-off rollback", async () => {
    const key = await fixture();
    const saved = await saveWorkstationDocument(key, await readWorkstationDocument(key), 0);
    for (const flag of ["1", "0"]) {
      vi.stubEnv("TRADES_WORKSTATION_ENABLED", flag);
      await expect(updateJournalEntry(saved.journalEntryId!, { expectedUpdatedAt: saved.journalUpdatedAt!, thesis: "Legacy overwrite" })).rejects.toBeInstanceOf(JournalStaleWriteError);
      const response = await legacySave(new NextRequest("http://localhost/api/notes/closed-trade", { method: "POST", body: JSON.stringify({ groupKey: key, content: "Legacy overwrite", updatedAt: saved.noteUpdatedAt }) }));
      expect(response.status).toBe(409);
    }
    expect((await readWorkstationDocument(key)).review.notes).toBe("Original note — 保留");
  });

  it("keeps standalone historical journal entries editable", async () => {
    const entry = await prisma.journalEntry.create({ data: { symbol: "STANDALONE", riskPlan: "Original risk plan" } });
    try {
      const updated = await updateJournalEntry(entry.id, { expectedUpdatedAt: entry.updatedAt.toISOString(), thesis: "Independent review" });
      expect(updated.thesis).toBe("Independent review");
      expect(updated.riskPlan).toBe("Original risk plan");
    } finally { await prisma.journalEntry.delete({ where: { id: entry.id } }); }
  });

  it("requires authentication and the feature flag for both review methods", async () => {
    auth.session = false;
    expect((await GET(request("missing"), params("missing"))).status).toBe(401);
    expect((await PATCH(request("missing", {}), params("missing"))).status).toBe(401);
    auth.session = true;
    vi.stubEnv("TRADES_WORKSTATION_ENABLED", "0");
    expect((await GET(request("missing"), params("missing"))).status).toBe(404);
    expect((await PATCH(request("missing", {}), params("missing"))).status).toBe(404);
  });

  it("validates API payloads and returns 409 to a second tab after a successful save", async () => {
    const key = await fixture(false);
    const doc = emptyDocument();
    expect((await PATCH(request(key, { expectedRevision: 0, document: { ...doc, schema: 99 } }), params(key))).status).toBe(400);
    const first = await PATCH(request(key, { expectedRevision: 0, document: doc }), params(key));
    expect(first.status).toBe(200);
    expect((await PATCH(request(key, { expectedRevision: 0, document: doc }), params(key))).status).toBe(409);
    const read = await GET(request(key), params(key));
    expect(read.headers.get("Cache-Control")).toBe("no-store");
    expect((await read.json()).revision).toBe(1);
  });

  it("rejects an oversized UTF-8 package before changing the saved review", async () => {
    const key = await fixture(false);
    const doc = emptyDocument();
    const response = await PATCH(request(key, { expectedRevision: 0, document: { ...doc, legacy: "界".repeat(Math.ceil(REVIEW_PACKAGE_MAX_BYTES / 3)) } }), params(key));
    expect(response.status).toBe(413);
    await expect(saveWorkstationDocument(key, { ...doc, evidence: [{ id: "oversized", name: "Oversized chart", image: `data:image/png;base64,${"A".repeat(REVIEW_PACKAGE_MAX_BYTES)}`, time: 1, revision: 0, timeframe: "5m" }] }, 0)).rejects.toMatchObject({ status: 413 });
    expect((await readWorkstationDocument(key)).revision).toBe(0);
    expect(await prisma.journalLink.count({ where: { targetId: key } })).toBe(0);
  });
});

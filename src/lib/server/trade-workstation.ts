import { readNotionReview, notionJournalPatch, saveNotionRelations } from "./notion-review-storage";
import { executedTradeReviewDefaults } from "@/lib/workstation/notion-template";
import { escapeHtml } from "@/lib/workstation/rich-text";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Drawing, Trade, TradeDocument, emptyDocument } from "@/lib/workstation/types";
import { lockClosedTradeForReview } from "./closed-trade-review-lock";
import { buildClosedTradeWhere, TradeFilters } from "./closed-trade-filters";
import { jsonBytes, REVIEW_PACKAGE_MAX_BYTES, REVIEW_PACKAGE_TOO_LARGE } from "@/lib/workstation/payload";
import { applyAccountTimePolicy } from "./execution-time-policy";
import { newestTradesFirst } from "@/lib/workstation/trade-order";
type Reader = Prisma.TransactionClient;
export class WorkstationError extends Error { constructor(message: string, public status = 409) { super(message); } }

export async function listWorkstationTrades(filters: TradeFilters = {}, selectedId?: string | null, includeSelectedOutsideFilters = false, onlySelected = false): Promise<Trade[]> {
  // Read existing materialized trades only. This path never runs ingestion or materialization.
  const where = buildClosedTradeWhere(filters);
  const groups = await prisma.closedTrade.findMany({ where: selectedId && onlySelected ? { ...where, groupKey: selectedId } : selectedId && includeSelectedOutsideFilters ? { OR: [{ groupKey: selectedId }, where] } : where, include: { account: { select: { ibkrAccount: true } }, instrument: { select: { currency: true, assetType: true } }, executions: { orderBy: { sortOrder: "asc" }, include: { execution: { select: { executedAt: true, importBatch: { select: { id: true, parserVersion: true, sourceSection: true, rawSha256: true, rawArtifact: { select: { rawSha256: true } } } } } } } } }, orderBy: [{ isStale: "asc" }, { closeTime: "desc" }, { groupKey: "asc" }] });
  const batchIds = [...new Set(groups.flatMap(g => g.executions.flatMap(e => e.execution.importBatch ? [e.execution.importBatch.id] : [])))];
  const interpretations = batchIds.length ? await prisma.executionTimeInterpretation.findMany({ where: { importBatchId: { in: batchIds } } }) : [];
  const policies = await prisma.accountExecutionTimePolicy.findMany({ where: { accountId: { in: [...new Set(groups.map(g => g.accountId))] }, active: true } });
  const applications = policies.length ? await prisma.executionTimePolicyApplication.findMany({ where: { policyId: { in: policies.map(p => p.id) }, importBatchId: { in: batchIds } }, orderBy: { createdAt: "desc" } }) : [];
  const policyByAccount = new Map(policies.map(p => [p.accountId, p]));
  const applicationByBatch = new Map<string, (typeof applications)[number]>();
  for (const app of applications) if (policies.some(p => p.id === app.policyId && p.revision === app.policyRevision) && !applicationByBatch.has(`${app.policyId}:${app.importBatchId}`)) applicationByBatch.set(`${app.policyId}:${app.importBatchId}`, app);
  const byBatch = new Map(interpretations.map(row => [row.importBatchId, row]));
  // openingQuantity/closingQuantity are signed account-position baselines, not trade size.
  // Materialized ClosedTrade rows represent completed cycles, even when a separate carry position remains.
  return newestTradesFirst(groups.map(g => {
    const executions = g.executions.map(e => applyAccountTimePolicy({ id: e.executionId, time: e.executedAt.getTime() / 1000, side: e.side === "BUY" ? "BUY" : "SELL", quantity: e.quantity, price: e.price, commission: e.commission, fees: e.fees, provenance: { timezoneStatus: "unverified", timezone: null, source: e.execution.importBatch?.sourceSection === "trades" ? "Imported broker execution" : "Stored execution", parserVersion: e.execution.importBatch?.parserVersion ?? null } }, e.execution.executedAt.getTime() === e.executedAt.getTime() && e.execution.importBatch ? { ...e.execution.importBatch, timeInterpretation: byBatch.get(e.execution.importBatch.id) ?? null } : null, policyByAccount.get(g.accountId), applicationByBatch.get(`${policyByAccount.get(g.accountId)?.id}:${e.execution.importBatch?.id}`)));
    const boundary = (time: Date) => { const index = g.executions.findIndex(e => e.executedAt.getTime() === time.getTime()); return index >= 0 ? executions[index].time : time.getTime() / 1000; };
    return { id: g.groupKey, assetType: g.instrument.assetType, symbol: g.symbol, name: g.symbol, account: g.account.ibkrAccount, currency: g.instrument.currency ?? "", direction: g.direction === "SHORT" ? "SHORT" as const : "LONG" as const, openTime: boundary(g.openTime), closeTime: boundary(g.closeTime), brokerTradeDate: g.tradeDate.toISOString().slice(0, 10), timeInterpretationVersion: createHash("sha256").update(executions.map(e => `${e.id}:${e.time}:${e.provenance?.interpretationStatus ?? "original"}:${e.provenance?.interpretationVersion ?? "0"}`).join("|")).digest("hex"), entry: g.avgEntryPrice, exit: g.avgExitPrice, pnl: g.realizedPnl, fees: g.totalCommission, quantity: g.totalQuantity, openQuantity: 0, stale: g.isStale, executions };
  }));
}
export async function readWorkstationDocument(groupKey: string, db: Reader = prisma): Promise<TradeDocument> {
  const [trade, note, link] = await Promise.all([db.closedTrade.findUnique({ where: { groupKey }, include: { tags: { include: { tag: true } }, annotations: true } }), db.closedTradeNote.findUnique({ where: { groupKey } }), db.journalLink.findFirst({ where: { linkType: "REVIEW_SOURCE", targetType: "CLOSED_TRADE", targetId: groupKey }, include: { journalEntry: { include: { notionRelations: { include: { relationTag: true } } } } }, orderBy: { createdAt: "asc" } })]);
  if (!trade) throw new WorkstationError("Trade not found", 404);
  const doc: TradeDocument = note?.workstationJson ? { ...emptyDocument(), ...JSON.parse(note.workstationJson) } : emptyDocument();
  doc.revision = note?.workstationVersion ?? 0; doc.updatedAt = note?.updatedAt.toISOString() ?? null; doc.noteUpdatedAt = doc.updatedAt; doc.journalEntryId = link?.journalEntryId ?? null; doc.journalUpdatedAt = link?.journalEntry.updatedAt.toISOString() ?? null;
  doc.review = { ...doc.review, setup: note?.setup ?? "", execution: note?.entryReview ?? "", takeaway: note?.lesson ?? "", notes: note?.content ?? "", thesis: note?.thesis ?? "", exit: note?.exitReview ?? "", mistake: note?.mistake ?? "", followUp: note?.followUp ?? "", tags: trade.tags.map(t => t.tag.name) };
  doc.review.notion = executedTradeReviewDefaults(readNotionReview(link?.journalEntry));
  // Template presence is the format version: old plain text is never interpreted as markup.
  if (!link?.journalEntry.templateData && doc.review.takeaway) doc.review.takeaway = `<p>${escapeHtml(doc.review.takeaway).replace(/\r?\n/g, "<br>")}</p>`;
  if (!note?.workstationJson) {
    // Existing annotations remain authoritative until a workstation save. Preserve originals too.
    const map: Record<string, Drawing["tool"]> = { horizontal: "horizontal", "horizontal-line": "horizontal", ray: "ray", trend: "trend", "trend-line": "trend", text: "text", "price-note": "price-note", entry: "entry", exit: "exit", stop: "stop", target: "target" };
    doc.drawings = trade.annotations.flatMap(a => { const tool = map[a.type]; if (!tool) return []; try { const points = JSON.parse(a.pointsJson) as Drawing["points"]; if (!points.length && a.price !== null) points.push({ time: trade.openTime.getTime() / 1000, price: a.price }); if (!points.length) return []; const style = JSON.parse(a.styleJson); return [{ id: a.id, tool, points, text: a.text ?? "", color: /^#[a-f0-9]{6}$/i.test(style.color) ? style.color : "#a5b4fc", width: 1.5, dashed: false, locked: false, hidden: false, panel: a.scope === "TRADE" ? a.panelId === "panel-1" ? "chart-1" : a.panelId : null, createdAt: a.createdAt.getTime() / 1000 }]; } catch { return []; } });
    if (link || trade.annotations.length) doc.legacy = { journal: link?.journalEntry ? { ...link.journalEntry, templateData: undefined } : null, annotations: trade.annotations };
  }
  return doc;
}
export async function saveWorkstationDocument(groupKey: string, incoming: TradeDocument, expectedRevision: number): Promise<TradeDocument> {
  return prisma.$transaction(async tx => {
    const trade = await lockClosedTradeForReview(tx, groupKey); if (!trade) throw new WorkstationError("Trade not found", 404); if (trade.isStale) throw new WorkstationError("Cannot edit a stale trade");
    const previous = await readWorkstationDocument(groupKey, tx);
    if (previous.revision !== expectedRevision || (incoming.noteUpdatedAt ?? null) !== (previous.noteUpdatedAt ?? null) || (incoming.journalUpdatedAt ?? null) !== (previous.journalUpdatedAt ?? null)) throw new WorkstationError("This review changed in another tab. Reload the saved review; your local draft is preserved.");
    const r = incoming.review, next: TradeDocument = { ...incoming, revision: expectedRevision + 1, legacy: previous.legacy };
    if (jsonBytes(next) + 2048 > REVIEW_PACKAGE_MAX_BYTES) throw new WorkstationError(REVIEW_PACKAGE_TOO_LARGE, 413);
    const noteData = { content: r.notes, setup: r.setup, entryReview: r.execution, lesson: r.takeaway, thesis: r.thesis, exitReview: r.exit, mistake: r.mistake, followUp: r.followUp, workstationVersion: next.revision, workstationJson: JSON.stringify({ ...next, review: { ...next.review, notion: undefined } }), updatedAt: new Date(Math.max(Date.now(), previous.noteUpdatedAt ? Date.parse(previous.noteUpdatedAt) + 1 : 0)) };
    const note = await tx.closedTradeNote.upsert({ where: { groupKey }, create: { groupKey, ...noteData }, update: noteData });
    await tx.closedTradeTag.deleteMany({ where: { closedTradeGroupKey: groupKey } });
    for (const name of [...new Set(r.tags.map(t => t.trim().toLowerCase()).filter(Boolean))]) { const tag = await tx.tag.upsert({ where: { name }, create: { name }, update: {} }); await tx.closedTradeTag.create({ data: { closedTradeGroupKey: groupKey, tagId: tag.id } }); }
    let journalEntryId = previous.journalEntryId;
    if (!journalEntryId) {
      const group = await tx.closedTrade.findUniqueOrThrow({ where: { groupKey } });
      const entry = await tx.journalEntry.create({ data: { symbol: group.symbol, direction: group.direction === "SHORT" ? "SHORT" : "LONG", tradeTitle: `${group.symbol} closed trade review`, ideaDate: group.openTime, entryEndAt: group.closeTime } });
      journalEntryId = entry.id;
      await tx.journalLink.create({ data: { journalEntryId, linkType: "REVIEW_SOURCE", targetType: "CLOSED_TRADE", targetId: groupKey, label: "Shared trade review" } });
    }
    // Preserve outcome calculations and journal-only fields. Claim the linked journal version atomically:
    // a concurrent legacy edit or outcome calculation must roll back this entire review save.
    const journalUpdatedAt = new Date(Math.max(Date.now(), previous.journalUpdatedAt ? Date.parse(previous.journalUpdatedAt) + 1 : 0));
    const claimed = await tx.journalEntry.updateMany({
      where: { id: journalEntryId, ...(previous.journalUpdatedAt ? { updatedAt: new Date(previous.journalUpdatedAt) } : {}) },
      data: { ...(r.notion ? notionJournalPatch(r.notion) : {}), setup: r.setup, thesis: r.thesis, trigger: r.execution, idealExecutionPlan: r.exit, missedReason: r.mistake, lessonLearned: r.takeaway, updatedAt: journalUpdatedAt },
    });
    if (claimed.count !== 1) throw new WorkstationError("The linked journal changed while saving. Reload the saved review; your local draft is preserved.");
    if (r.notion) await saveNotionRelations(tx, journalEntryId, r.notion);
    return { ...next, updatedAt: note.updatedAt.toISOString(), noteUpdatedAt: note.updatedAt.toISOString(), journalEntryId, journalUpdatedAt: journalUpdatedAt.toISOString() };
  }, { maxWait: 10000, timeout: 20000 });
}

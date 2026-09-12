import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { interpretBrokerTimestamp, TIME_INTERPRETATION_VERSION } from "@/lib/workstation/timestamp-interpretation";
import type { Execution } from "@/lib/workstation/types";

export class TimestampInterpretationError extends Error { constructor(message: string, public status = 409) { super(message); } }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalize = (key: string) => key.trim().toLowerCase().replace(/[\s_-]/g, "");
const read = (row: Record<string, string>, ...keys: string[]) => keys.map(k => row[normalize(k)]).find(v => v?.trim())?.trim() ?? "";
type SourceExecution = { id: string; dedupeKey: string; executedAt: Date; quantity: number; price: number; side: string; account: { ibkrAccount: string }; instrument: { symbol: string } };
export type InterpretationRow = { executionId: string; symbol: string; side: string; quantity: number; price: number; storedTime: number; brokerWallTime: string; interpretedTime: number | null; status: string };
/** Parse the archived report independently; importing it again is neither needed nor permitted here. */
export function inspectTimestampRows(content: string, executions: SourceExecution[], timezone: string): InterpretationRow[] {
  const records = parse(content, { bom: true, relax_column_count: true, skip_empty_lines: true }) as string[][];
  const rawRows: Record<string, string>[] = [];
  let headers: string[] = [], coded = false;
  for (const record of records) {
    const code = record[0] === "HEADER" || record[0] === "DATA";
    const cells = code ? record.slice(2) : record;
    const keys = cells.map(normalize);
    if (keys.some(k => ["datetime", "date/time", "tradetime"].includes(k)) && keys.some(k => ["symbol", "ticker"].includes(k)) && keys.some(k => ["quantity", "qty", "shares"].includes(k))) {
      headers = keys; coded = code; continue;
    }
    if (record[0] === "HEADER" || (coded && record[1] !== "TRNT")) continue;
    if (headers.length && cells.length === headers.length) rawRows.push(Object.fromEntries(headers.map((k, i) => [k, cells[i]])));
  }
  const candidatesByFill = new Map<string, { row: Record<string, string>; identity: string | null }[]>();
  const fillKey = (account: string, symbol: string, side: string, quantity: number, price: number, time: number | null) => JSON.stringify([account, symbol, side, quantity, price, time]);
  for (const row of rawRows) {
    const account = read(row, "account", "accountid", "ibkraccount", "acct", "clientaccountid") || "DEFAULT";
    const side = read(row, "side", "buy/sell", "action").toUpperCase();
    const stamp = interpretBrokerTimestamp(read(row, "datetime", "date/time", "tradetime"), timezone);
    const identity = [["ibexecid", read(row, "ibexecid", "execid")], ["tradeid", read(row, "tradeid")], ["transactionid", read(row, "transactionid")], ["extexecid", read(row, "extexecid", "externalexecutionid")]].find(([, value]) => value);
    const key = fillKey(account, read(row, "symbol", "ticker"), side === "B" ? "BUY" : side === "S" ? "SELL" : side, Math.abs(Number(read(row, "quantity", "qty", "shares", "filled"))), Number(read(row, "price", "tradeprice", "avgprice")), stamp.stored);
    const group = candidatesByFill.get(key) ?? [];
    group.push({ row, identity: identity ? hash(["ibkr-execution-v2", account, ...identity].join("|")) : null });
    candidatesByFill.set(key, group);
  }
  return executions.map(e => {
    const base = { executionId: e.id, symbol: e.instrument.symbol, side: e.side, quantity: e.quantity, price: e.price, storedTime: e.executedAt.getTime() / 1000 };
    const candidates = (candidatesByFill.get(fillKey(e.account.ibkrAccount, e.instrument.symbol, e.side, e.quantity, e.price, base.storedTime)) ?? []).filter(candidate => !candidate.identity || candidate.identity === e.dedupeKey);
    if (candidates.length !== 1) return { ...base, brokerWallTime: "", interpretedTime: null, status: candidates.length ? "ambiguous source row" : "source row not verified" };
    const stamp = interpretBrokerTimestamp(read(candidates[0].row, "datetime", "date/time", "tradetime"), timezone);
    return { ...base, brokerWallTime: stamp.raw, interpretedTime: stamp.utc, status: stamp.status };
  });
}
const batchInclude = { rawArtifact: true, timeInterpretation: true, executions: { take: 20001, orderBy: { id: "asc" as const }, include: { account: { select: { ibkrAccount: true } }, instrument: { select: { symbol: true } } } } };
export async function inspectBatchTimestamps(id: string, timezone = "America/New_York", db: Prisma.TransactionClient = prisma) {
  if (!["America/New_York", "UTC"].includes(timezone)) throw new TimestampInterpretationError("Unsupported source timezone.", 400);
  const batch = await db.importBatch.findUnique({ where: { id }, include: batchInclude });
  if (!batch) throw new TimestampInterpretationError("Import batch not found.", 404);
  const content = batch.rawArtifact?.content;
  if (!content || !batch.executions.length) throw new TimestampInterpretationError("This batch has no archived execution source to verify.", 422);
  if (Buffer.byteLength(content) > 16 * 1024 * 1024 || batch.executions.length > 20000) throw new TimestampInterpretationError("This batch exceeds the interactive audit limit.", 422);
  const sourceHash = hash(content);
  if (sourceHash !== batch.rawSha256 || sourceHash !== batch.rawArtifact?.rawSha256) throw new TimestampInterpretationError("The archived report fingerprint does not match this batch.", 409);
  const rows = inspectTimestampRows(content, batch.executions, timezone);
  const fingerprint = hash(JSON.stringify({ sourceHash, parserVersion: batch.parserVersion, timezone, normalizerVersion: TIME_INTERPRETATION_VERSION, rows }));
  return { batchId: id, filename: batch.filename, timezone, sourceHash, parserVersion: batch.parserVersion, fingerprint, revision: batch.timeInterpretation?.revision ?? 0, active: batch.timeInterpretation?.active ?? false, rows };
}
export async function confirmBatchTimestamps(id: string, input: { timezone: string; fingerprint: string; expectedRevision: number }) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`time-interpretation:${id}`}, 0))::text`);
    const inspected = await inspectBatchTimestamps(id, input.timezone, tx);
    if (inspected.revision !== input.expectedRevision || inspected.fingerprint !== input.fingerprint) throw new TimestampInterpretationError("This batch changed. Preview it again before confirming.");
    if (!inspected.rows.some(r => r.interpretedTime !== null)) throw new TimestampInterpretationError("No execution timestamps could be verified.", 422);
    const data = { timezone: input.timezone, basis: "user-confirmed", normalizerVersion: TIME_INTERPRETATION_VERSION, revision: inspected.revision + 1, active: true, sourceHash: inspected.sourceHash, parserVersion: inspected.parserVersion, fingerprint: inspected.fingerprint, rowsJson: JSON.stringify(inspected.rows), confirmedAt: new Date() };
    return tx.executionTimeInterpretation.upsert({ where: { importBatchId: id }, create: { importBatchId: id, ...data }, update: data, select: { revision: true, active: true } });
  }, { timeout: 30000 });
}
export async function revokeBatchTimestamps(id: string, expectedRevision: number) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`time-interpretation:${id}`}, 0))::text`);
    const result = await tx.executionTimeInterpretation.updateMany({ where: { importBatchId: id, revision: expectedRevision }, data: { active: false, revision: { increment: 1 } } });
    if (!result.count) throw new TimestampInterpretationError("This interpretation changed. Reload before disabling it.");
  });
}
type Overlay = { active: boolean; normalizerVersion: number; revision: number; timezone: string; basis: string; sourceHash: string; parserVersion: string | null; rowsJson: string };
const parsedOverlays = new WeakMap<Overlay, Map<string, InterpretationRow>>();
export function applyTimeInterpretation(execution: Execution, batch: { rawSha256: string | null; parserVersion: string | null; rawArtifact: { rawSha256: string } | null; timeInterpretation: Overlay | null } | null): Execution {
  const overlay = batch?.timeInterpretation;
  if (!overlay?.active) return execution;
  const stale = () => ({ ...execution, provenance: { ...execution.provenance!, timezoneStatus: "unverified" as const, interpretationStatus: "stale" as const, interpretationVersion: String(overlay.revision) } });
  if (overlay.normalizerVersion !== TIME_INTERPRETATION_VERSION || overlay.sourceHash !== batch?.rawSha256 || overlay.sourceHash !== batch.rawArtifact?.rawSha256 || overlay.parserVersion !== batch.parserVersion) return stale();
  let rows = parsedOverlays.get(overlay);
  if (!rows) { try { const parsed = JSON.parse(overlay.rowsJson); if (!Array.isArray(parsed)) return stale(); rows = new Map(parsed.map((r: InterpretationRow) => [r.executionId, r])); parsedOverlays.set(overlay, rows); } catch { return stale(); } }
  const row = rows.get(execution.id);
  if (!row || row.interpretedTime === null) return { ...execution, provenance: { ...execution.provenance!, interpretationStatus: "unresolved", brokerWallTime: row?.brokerWallTime } };
  const computed = interpretBrokerTimestamp(row.brokerWallTime, overlay.timezone);
  // A reversal can allocate part of one broker fill to each trade; its rendered
  // quantity may therefore differ from the full source row audited at confirmation.
  if (row.storedTime !== execution.time || row.price !== execution.price || row.side !== execution.side || computed.utc !== row.interpretedTime || computed.stored !== row.storedTime) return stale();
  return { ...execution, time: row.interpretedTime, provenance: { ...execution.provenance!, timezoneStatus: "verified", timezone: computed.status === "explicit" ? "Explicit offset" : overlay.timezone, storedTime: execution.time, brokerWallTime: row.brokerWallTime, confirmationBasis: overlay.basis, interpretationStatus: "applied", interpretationVersion: String(overlay.revision) } };
}

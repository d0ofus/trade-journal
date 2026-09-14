import { createHash } from "node:crypto";
import { Prisma, type AccountExecutionTimePolicy, type ExecutionTimePolicyApplication } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { interpretBrokerTimestamp, TIME_INTERPRETATION_VERSION } from "@/lib/workstation/timestamp-interpretation";
import { timePolicyMode, type TimePolicyMode } from "@/lib/workstation/execution-time-provenance";
import type { Execution } from "@/lib/workstation/types";
import { applyTimeInterpretation, inspectTimestampRows, TimestampInterpretationError } from "./execution-time-interpretation";

export const TIME_POLICY_SOURCE = "IBKR_EXECUTIONS";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Reader = Prisma.TransactionClient;
const include = { rawArtifact: true, timeInterpretation: true, executions: { orderBy: { id: "asc" as const }, include: { account: { select: { ibkrAccount: true } }, instrument: { select: { symbol: true } } } } };
type Batch = Prisma.ImportBatchGetPayload<{ include: typeof include }>;
function inspect(policy: Pick<AccountExecutionTimePolicy, "accountId" | "timezone"> & { basis?: string }, batch: Batch) {
  const executions = batch.executions.filter(e => e.accountId === policy.accountId), content = batch.rawArtifact?.content;
  const confirmed = timePolicyMode(policy.basis) === "confirmed-flex-new-york";
  const supportedParser = batch.parserVersion === "2026-06-25-workstation-uplift";
  const conflict = (batch.rawSha256 && batch.rawArtifact?.rawSha256 && batch.rawSha256 !== batch.rawArtifact.rawSha256)
    || (content && [batch.rawSha256, batch.rawArtifact?.rawSha256].some(value => value && hash(content) !== value));
  const fallback = confirmed && (!content || !batch.rawSha256 || !supportedParser);
  let reason: string | null = null;
  if (batch.timeInterpretation) reason = "Report-specific interpretation or disabled exception takes precedence.";
  else if (!["flex-trades", "executions"].includes(batch.fileType) || (!supportedParser && !confirmed)) reason = "Unsupported report format or parser version; individual confirmation is required.";
  else if (conflict) reason = "Archived source fingerprint conflicts with the imported report.";
  else if (!fallback && (!content || !batch.rawSha256)) reason = "Archived source is missing.";
  else if ((content && Buffer.byteLength(content) > 16 * 1024 * 1024) || executions.length > 20000) reason = "Report exceeds the bounded interpretation limit.";
  let rows: ReturnType<typeof inspectTimestampRows> = [];
  if (!reason) { try {
    if (content) rows = inspectTimestampRows(content, executions, policy.timezone);
    else rows = executions.map(e => {
      const stamp = interpretBrokerTimestamp(e.executedAt.toISOString().slice(0, 19), policy.timezone);
      return { executionId: e.id, symbol: e.instrument.symbol, side: e.side, quantity: e.quantity, price: e.price, storedTime: e.executedAt.getTime() / 1000, brokerWallTime: "", interpretedTime: stamp.utc, status: stamp.utc === null ? stamp.status : "confirmed-stored-clock" };
    });
    if (fallback && content) rows = rows.map(r => ({ ...r, status: r.interpretedTime === null ? r.status : "confirmed-source-time" }));
    if (rows.some(r => r.interpretedTime === null)) reason = `Unresolved execution times: ${[...new Set(rows.filter(r => r.interpretedTime === null).map(r => r.status))].join(", ")}.`;
  } catch { reason = "Archived report could not be interpreted."; } }
  const sourceHash = batch.rawSha256 ?? batch.rawArtifact?.rawSha256 ?? "", fingerprint = hash(JSON.stringify({ sourceHash, artifactHash: batch.rawArtifact?.rawSha256, parserVersion: batch.parserVersion, timezone: policy.timezone, mode: timePolicyMode(policy.basis), accountId: policy.accountId, version: TIME_INTERPRETATION_VERSION, override: batch.timeInterpretation?.revision, executions: executions.map(e => [e.id, e.dedupeKey, e.executedAt.toISOString(), e.price, e.quantity, e.side]), rows }));
  return { batchId: batch.id, filename: batch.filename, sourceHash, parserVersion: batch.parserVersion, fingerprint, status: batch.timeInterpretation ? "exception" : reason ? "unresolved" : fallback ? "user-confirmed" : "ready", reason, rows, eligible: rows.filter(r => r.interpretedTime !== null).length, total: executions.length };
}
async function reports(accountId: string, db: Reader) {
  const result = await db.importBatch.findMany({ where: { executions: { some: { accountId } } }, include, orderBy: [{ importedAt: "desc" }, { id: "desc" }], take: 5001 });
  if (result.length > 5000) throw new TimestampInterpretationError("Account exceeds the bounded report scan; contact support before applying a policy.");
  return result;
}
export async function previewAccountTimePolicy(accountId: string, db: Reader = prisma, mode?: TimePolicyMode) {
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) throw new TimestampInterpretationError("Account not found.", 404);
  const existing = await db.accountExecutionTimePolicy.findUnique({ where: { accountId_source: { accountId, source: TIME_POLICY_SOURCE } } });
  const selectedMode = mode ?? timePolicyMode(existing?.basis);
  const rows = (await reports(accountId, db)).map(b => inspect({ accountId, timezone: "America/New_York", basis: selectedMode }, b));
  return { accountId, account: account.ibkrAccount, timezone: "America/New_York", mode: selectedMode, revision: existing?.revision ?? 0, active: existing?.active ?? false, fingerprint: hash(JSON.stringify([selectedMode, rows.map(r => r.fingerprint)])), reports: rows.map(r => ({ batchId: r.batchId, filename: r.filename, status: r.status, reason: r.reason, eligible: r.eligible, total: r.total })), eligible: rows.reduce((n, r) => n + r.eligible, 0), total: rows.reduce((n, r) => n + r.total, 0) };
}
export async function saveAccountTimePolicy(accountId: string, expectedRevision: number, active: boolean, fingerprint?: string, mode?: TimePolicyMode) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`account-time-policy:${accountId}`},0))::text`);
    const preview = await previewAccountTimePolicy(accountId, tx, mode);
    if (preview.revision !== expectedRevision || (active && preview.fingerprint !== fingerprint)) throw new TimestampInterpretationError("Reports or policy changed. Preview this account again.");
    const data = { active, revision: expectedRevision + 1, timezone: "America/New_York", normalizerVersion: TIME_INTERPRETATION_VERSION, basis: preview.mode === "confirmed-flex-new-york" ? preview.mode : "user-confirmed", confirmedAt: new Date() };
    return tx.accountExecutionTimePolicy.upsert({ where: { accountId_source: { accountId, source: TIME_POLICY_SOURCE } }, create: { accountId, source: TIME_POLICY_SOURCE, ...data }, update: data });
  }, { timeout: 45000 });
}
/** Durable application rows are the resumable work ledger. Repeated runs are idempotent. */
export async function prepareAccountTimePolicies(limit = 50, accountId?: string, batchIds?: readonly string[]) {
  const policies = await prisma.accountExecutionTimePolicy.findMany({ where: { active: true, ...(accountId ? { accountId } : {}) } });
  let prepared = 0, pending = 0;
  for (const policy of policies) {
    if (policy.normalizerVersion !== TIME_INTERPRETATION_VERSION) continue;
    const inspected = (await reports(policy.accountId, prisma)).filter(b => !batchIds || batchIds.includes(b.id)).map(b => inspect(policy, b));
    const applications = inspected.map(r => ({ key: hash(`${policy.id}:${policy.revision}:${r.batchId}:${r.fingerprint}`), policyId: policy.id, policyRevision: policy.revision, importBatchId: r.batchId, sourceHash: r.sourceHash, parserVersion: r.parserVersion, fingerprint: r.fingerprint, status: r.status, reason: r.reason, rowsJson: JSON.stringify(r.rows) }));
    const existing = new Set((await prisma.executionTimePolicyApplication.findMany({ where: { policyId: policy.id, policyRevision: policy.revision }, select: { key: true } })).map(r => r.key));
    const missing = applications.filter(r => !existing.has(r.key)), batch = missing.slice(0, Math.max(0, limit - prepared));
    if (batch.length) prepared += (await prisma.executionTimePolicyApplication.createMany({ data: batch, skipDuplicates: true })).count;
    pending += missing.length - batch.length;
  }
  return { prepared, pending };
}
export async function accountTimePolicyStatus() {
  const [accounts, policies] = await Promise.all([
    prisma.account.findMany({ where: { executions: { some: {} } }, select: { id: true, ibkrAccount: true }, orderBy: { ibkrAccount: "asc" } }),
    prisma.accountExecutionTimePolicy.findMany({ include: { applications: { select: { policyRevision: true, status: true, importBatchId: true, createdAt: true }, orderBy: { createdAt: "desc" } } } }),
  ]);
  const counts = await Promise.all(accounts.map(a => prisma.importBatch.count({ where: { executions: { some: { accountId: a.id } } } })));
  return accounts.map((a, index) => { const p = policies.find(p => p.accountId === a.id); const latest = [...new Map((p?.applications.filter(r => r.policyRevision === p.revision) ?? []).slice().reverse().map(r => [r.importBatchId, r])).values()]; return { ...a, policy: p ? { id: p.id, active: p.active, revision: p.revision, timezone: p.timezone, mode: timePolicyMode(p.basis), pending: Math.max(0, counts[index] - latest.length), ready: latest.filter(r => r.status === "ready").length, confirmed: latest.filter(r => r.status === "user-confirmed").length, unresolved: latest.filter(r => r.status === "unresolved").length, exceptions: latest.filter(r => r.status === "exception").length } : null }; });
}
type Source = Parameters<typeof applyTimeInterpretation>[1];
export function applyAccountTimePolicy(execution: Execution, source: Source, policy?: AccountExecutionTimePolicy, application?: ExecutionTimePolicyApplication): Execution {
  // A disabled report is an explicit exception, never an invitation to apply the default.
  if (source?.timeInterpretation || !policy?.active) return applyTimeInterpretation(execution, source);
  const unresolved = (status: "pending" | "stale" | "unresolved", reason?: string) => ({ ...execution, provenance: { ...execution.provenance!, interpretationStatus: status, interpretationReason: reason, interpretationVersion: `policy:${policy.id}:${policy.revision}`, confirmationBasis: "user-confirmed account default" } });
  if (policy.normalizerVersion !== TIME_INTERPRETATION_VERSION) return unresolved("stale");
  if (!application || application.policyRevision !== policy.revision) return unresolved("pending");
  if (["exception", "unresolved"].includes(application.status) || !source) return unresolved("unresolved", application.reason ?? undefined);
  if (application.status === "user-confirmed") {
    if (timePolicyMode(policy.basis) !== "confirmed-flex-new-york" || application.policyId !== policy.id || application.sourceHash !== (source.rawSha256 ?? source.rawArtifact?.rawSha256 ?? "") || application.parserVersion !== source.parserVersion
      || (source.rawArtifact && source.rawArtifact.rawSha256 !== application.sourceHash)) return unresolved("stale", "The confirmed source metadata changed; prepare this report again.");
    try {
      const rows = JSON.parse(application.rowsJson) as ReturnType<typeof inspectTimestampRows>;
      const row = rows.find(r => r.executionId === execution.id);
      if (!row || row.interpretedTime === null) return unresolved("unresolved", row?.status ?? "No confirmed execution time.");
      const raw = row.status === "confirmed-stored-clock" ? new Date(row.storedTime * 1000).toISOString().slice(0, 19) : row.brokerWallTime;
      const computed = interpretBrokerTimestamp(raw, policy.timezone);
      if (row.storedTime !== execution.time || row.price !== execution.price || row.side !== execution.side || computed.stored !== row.storedTime || computed.utc !== row.interpretedTime) return unresolved("stale", "The execution changed since its timezone confirmation.");
      return { ...execution, time: row.interpretedTime, provenance: { ...execution.provenance!, timezoneStatus: "user-confirmed", timezone: computed.status === "explicit" ? "Explicit offset" : policy.timezone, storedTime: execution.time, ...(row.brokerWallTime ? { brokerWallTime: row.brokerWallTime } : {}), confirmationBasis: "User-confirmed Flex New York clock times", interpretationStatus: "applied", interpretationVersion: `policy:${policy.id}:${policy.revision}:${application.fingerprint}` } };
    } catch { return unresolved("unresolved", "The saved timezone confirmation could not be read."); }
  }
  const interpreted = applyTimeInterpretation(execution, { ...source, timeInterpretation: { active: true, normalizerVersion: policy.normalizerVersion, revision: policy.revision, timezone: policy.timezone, basis: "user-confirmed account default", sourceHash: application.sourceHash, parserVersion: application.parserVersion, rowsJson: application.rowsJson } });
  return { ...interpreted, provenance: { ...interpreted.provenance!, interpretationVersion: `policy:${policy.id}:${policy.revision}:${application.fingerprint}` } };
}

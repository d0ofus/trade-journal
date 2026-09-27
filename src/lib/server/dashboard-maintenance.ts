/* eslint-disable @typescript-eslint/no-explicit-any */
// Operator-only maintenance. Never imported by a page, API route or ingestion read path.
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { parseFlexStatementCsv } from "@/lib/import/ibkr-flex";
import { parseCsvWithMapping } from "@/lib/import/ibkr-parser";
import { accountingMetadata, ACCOUNTING_VERSION } from "@/lib/stats/accounting";
import { buildOpeningPositionMap } from "@/lib/stats/opening-positions";
import { computeClosedTradeGroups } from "@/lib/stats/closed-trades";
import { assertPreservedTradeAllocations } from "./closed-trades-materialized";
import { getClosedTradesSourceSnapshot, writeMaterializationWatermark } from "./materialization-watermarks";

type Data = Record<string, any[]>;
const models = Prisma.dmmf.datamodel.models;
const primaryKeys = new Map(models.map(m => [m.name, m.primaryKey?.fields ?? m.fields.filter(f => f.isId).map(f => f.name)]));
const ignoredCaches = new Set(["WorkstationCandleChunk", "WorkstationCandleCoverage", "WorkstationCandleJob", "WorkstationCandleLease", "WorkstationMetricCache", "NotionRequestGate", "EvidenceBackupSession"]);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const SYNTHETIC_ACCOUNTS = ["DEMO-WORKSTATION", "TEST-FLEX-PARTIAL-1782695450150", "TEST-FLEX-PARTIAL-1783297079388", "TEST-FLEX-PARTIAL-1784087619029", "TEST-FLEX-PARTIAL-1784088128406", "ROUTE-ATOMIC-1784087613556", "ROUTE-ATOMIC-1784088124953"];
const primaryKey = (model: string) => {
  return primaryKeys.get(model)!;
};
const identity = (model: string, row: any) => Object.fromEntries(primaryKey(model).map(k => [k, row[k]]));
const rowKey = (model: string, row: any) => JSON.stringify(identity(model, row));
export async function loadMaintenanceData(tx: Prisma.TransactionClient): Promise<Data> {
  const data: Data = {};
  for (const model of models.filter(m => !ignoredCaches.has(m.name))) data[model.name] = await tx.$queryRawUnsafe(`SELECT * FROM "${model.name}"`);
  return data;
}

export function buildSyntheticDeletionManifest(data: Data) {
  const deleted = new Map<string, Set<string>>();
  const isDeleted = (model: string, row: any) => deleted.get(model)?.has(rowKey(model, row)) ?? false;
  const add = (model: string, test: (row: any) => boolean) => {
    const set = deleted.get(model) ?? new Set<string>(); let changed = false;
    for (const row of data[model] ?? []) if (test(row) && !set.has(rowKey(model, row))) { set.add(rowKey(model, row)); changed = true; }
    deleted.set(model, set); return changed;
  };
  const syntheticIds = new Set(data.Account.filter(a => SYNTHETIC_ACCOUNTS.includes(a.ibkrAccount)).map(a => a.id));
  const groups = new Set(data.ClosedTrade.filter(t => syntheticIds.has(t.accountId)).map(t => t.groupKey));
  add("Account", r => syntheticIds.has(r.id));
  for (const model of ["ImportBatch", "AccountExecutionTimePolicy"]) add(model, r => syntheticIds.has(r.accountId));
  for (const model of ["ClosedTradeNote", "WorkstationTradeView", "NotionPublication"]) add(model, r => groups.has(r.groupKey));
  add("EvidenceUploadSession", r => groups.has(r.tradeId));
  add("EvidenceAssetReference", r => r.kind === "review" && groups.has(r.key));
  add("JournalEntry", r => {
    const links = data.JournalLink.filter(l => l.journalEntryId === r.id);
    const candidate = ["demo-journal-a", "demo-journal-b"].includes(r.id) || links.some(l => l.targetType === "CLOSED_TRADE" && groups.has(l.targetId));
    return candidate && !links.some(l => l.targetType === "CLOSED_TRADE" && l.targetId && !groups.has(l.targetId)) && !data.JournalReview.some(review => review.id !== "demo-weekly-review" && [review.bestIdeaEntryId, review.worstMissEntryId].includes(r.id));
  });
  add("JournalLink", r => r.targetType === "CLOSED_TRADE" && groups.has(r.targetId));
  add("JournalReview", r => r.id === "demo-weekly-review");
  add("JournalSavedView", r => r.id === "demo-saved-view");
  add("JournalPlaybook", r => r.id === "demo-playbook-opening-drive" && !data.JournalEntry.some(j => j.playbookId === r.id && !isDeleted("JournalEntry", j)) && !data.JournalPlaybookExample.some(e => e.playbookId === r.id && data.JournalEntry.some(j => j.id === e.journalEntryId && !isDeleted("JournalEntry", j))));
  add("MarketCandle", r => r.source === "demo" || String(r.id).startsWith("demo-candle-"));
  // Explicit ownership, then cascade/restrict descendants. SetNull relationships are retained unless owned.
  const cascade = () => {
    let changed: boolean;
    do { changed = false;
      for (const model of models.filter(m => data[m.name])) for (const relation of model.fields.filter(f => f.kind === "object" && f.relationFromFields?.length && f.relationOnDelete !== "SetNull")) {
        if (!deleted.get(relation.type)?.size) continue;
        const parents = (data[relation.type] ?? []).filter(parent => isDeleted(relation.type, parent));
        changed = add(model.name, row => parents.some(parent => relation.relationFromFields!.every((field, i) => row[field] != null && row[field] === parent[relation.relationToFields![i]]))) || changed;
      }
    } while (changed);
  };
  cascade();
  // Orphan synthetic source archives are included; an archive used by any genuine batch is retained.
  const genuineCodes = data.Account.filter(a => !syntheticIds.has(a.id)).map(a => a.ibkrAccount);
  add("ImportArtifact", r => SYNTHETIC_ACCOUNTS.some(code => r.content.includes(code)) && !genuineCodes.some(code => r.content.includes(code)) && !data.ImportBatch.some(b => b.rawStorageKey === r.storageKey && !isDeleted("ImportBatch", b)));
  for (const model of ["Instrument", "Tag", "JournalNotionRelationTag"]) {
    add(model, row => {
      const candidates = model === "Instrument" ? ["demo-inst-a", "demo-inst-b", "demo-inst-c"].includes(row.id) || data.Position.some(p => p.instrumentId === row.id && syntheticIds.has(p.accountId))
        : model === "Tag" ? ["demo-momentum", "demo-good-scaleout", "demo-late-entry"].includes(row.name) : row.kind === "ACCOUNT" && row.normalizedName === "demo-workstation";
      if (!candidates) return false;
      return !models.some(child => child.fields.some(rel => rel.kind === "object" && rel.type === model && rel.relationFromFields?.length && (data[child.name] ?? []).some(r => !isDeleted(child.name, r) && rel.relationFromFields!.every((field, i) => r[field] === row[rel.relationToFields![i]]))));
    });
  }
  // Assets are disposable only when exclusively owned by deleted reviews; backup pins are retained.
  add("EvidenceAsset", a => data.EvidenceAssetReference.some(r => r.assetId === a.id && isDeleted("EvidenceAssetReference", r)) && !data.EvidenceAssetReference.some(r => r.assetId === a.id && !isDeleted("EvidenceAssetReference", r)) && !data.EvidenceUploadSession.some(r => r.assetId === a.id && !isDeleted("EvidenceUploadSession", r)));
  cascade();
  return Object.fromEntries([...deleted].filter(([, keys]) => keys.size).map(([model]) => [model, data[model].filter(r => isDeleted(model, r)).map(r => identity(model, r))]));
}

export function planAccountingRepair(data: Data, reportingAccount = process.env.REPORTING_ACCOUNT_CODE) {
  if (!reportingAccount) throw new Error("Accounting repair requires REPORTING_ACCOUNT_CODE");
  const accounts = new Map(data.Account.map(a => [a.id, a])), instruments = new Map(data.Instrument.map(i => [i.id, i]));
  const genuineCodes = new Set(data.Account.filter(a => !SYNTHETIC_ACCOUNTS.includes(a.ibkrAccount)).map(a => a.ibkrAccount));
  const scope = data.Execution.filter(e => accounts.get(e.accountId)?.ibkrAccount === reportingAccount);
  const archived = new Map<string, any>(); const contracts = new Map<string, Set<string>>(); const coverage: string[] = [];
  for (const artifact of data.ImportArtifact) {
    let executions: any[] = [], positions: any[] = [];
    try { const parsed = parseFlexStatementCsv(artifact.content); executions = parsed.trades.executions; positions = parsed.positions.positions; }
    catch { try { executions = parseCsvWithMapping("executions", artifact.content).executions; positions = parseCsvWithMapping("positions", artifact.content).positions; } catch { continue; } }
    for (const r of [...executions, ...positions]) if (genuineCodes.has(r.account) && r.brokerContractId) {
      const key = `${r.symbol}:${r.currency}`, ids = contracts.get(key) ?? new Set<string>(); ids.add(r.brokerContractId); contracts.set(key, ids);
    }
    for (const r of executions) if (r.account === reportingAccount && r.sourceExecutionId) {
      const key = createHash("sha256").update(["ibkr-execution-v2", r.account, r.sourceExecutionIdKind ?? "execution", r.sourceExecutionId].join("|")).digest("hex");
      const prior = archived.get(key);
      if (prior && ["quantity", "price", "side", "transactionTax", "contractMultiplier"].some(f => prior[f] !== r[f])) throw new Error("Conflicting archived accounting evidence");
      archived.set(key, { ...r, source: artifact.rawSha256 });
    }
  }
  const executionUpdates = scope.flatMap(e => {
    const instrument = instruments.get(e.instrumentId)!, raw = archived.get(e.dedupeKey);
    if (raw && (raw.symbol !== instrument.symbol || raw.side !== e.side || raw.quantity !== e.quantity || raw.price !== e.price || raw.executedAt.getTime() !== new Date(e.executedAt).getTime())) throw new Error("Archived fill identity mismatch");
    if (raw) coverage.push(e.id);
    const meta = accountingMetadata({ symbol: instrument.symbol, assetType: raw?.assetType ?? instrument.assetType, contractMultiplier: raw?.contractMultiplier ?? e.contractMultiplier });
    if (raw?.contractMultiplier != null) meta.multiplierSource = `broker-archive:${raw.source}`;
    else if (e.multiplierSource) meta.multiplierSource = e.multiplierSource;
    const ids = contracts.get(`${instrument.symbol}:${instrument.currency}`);
    const fields = { ...meta, brokerContractId: raw?.brokerContractId ?? e.brokerContractId ?? (ids?.size === 1 ? [...ids][0] : null), transactionTax: raw?.transactionTax ?? e.transactionTax ?? 0,
      commission: raw?.commission ?? e.commission,
      fees: raw?.fees ?? (raw?.transactionTax > 0 && e.fees === raw.transactionTax && !(e.transactionTax > 0) ? 0 : e.fees) };
    return Object.entries(fields).some(([k, v]) => e[k] !== v) ? [{ id: e.id, fields, evidence: raw?.source ?? meta.multiplierSource }] : [];
  });
  const updates = new Map(executionUpdates.map(u => [u.id, u.fields]));
  const rows = scope.map(e => ({ ...e, ...updates.get(e.id), executedAt: new Date(e.executedAt), instrument: instruments.get(e.instrumentId)! }));
  const snapshots = data.PositionSnapshot.map(s => ({ ...s, date: new Date(s.date), instrument: instruments.get(s.instrumentId)! }));
  const groups = computeClosedTradeGroups(rows.map(e => ({ ...e, accountCode: accounts.get(e.accountId)!.ibkrAccount, symbol: e.instrument.symbol, assetType: e.instrument.assetType, exchange: e.instrument.exchange })), buildOpeningPositionMap(rows, snapshots));
  const existing = data.ClosedTrade.filter(t => accounts.get(t.accountId)?.ibkrAccount === reportingAccount);
  const keys = new Set(existing.map(t => t.groupKey));
  const links = data.ClosedTradeExecution.filter(e => keys.has(e.closedTradeGroupKey)).map(e => ({ ...e, executedAt: new Date(e.executedAt) }));
  assertPreservedTradeAllocations(existing, links, groups);
  const groupUpdates = groups.filter(g => { const old = existing.find(t => t.groupKey === g.groupKey)!; return ["grossRealizedPnl", "realizedPnl", "totalCommission", "openingQuantity", "closingQuantity"].some(k => Math.abs(old[k] - (g as any)[k]) > 1e-9); });
  const instrumentUpdates = data.Instrument.flatMap(i => { const ids = contracts.get(`${i.symbol}:${i.currency}`); return !i.brokerContractId && ids?.size === 1 ? [{ id: i.id, brokerContractId: [...ids][0] }] : []; });
  return { executionUpdates, instrumentUpdates, groups, groupUpdates, coveredExecutions: coverage.length };
}

function preservedFingerprint(data: Data, deletion: ReturnType<typeof buildSyntheticDeletionManifest>) {
  const permitted: Record<string, string[]> = { Execution: ["commission", "fees", "transactionTax", "contractMultiplier", "multiplierSource", "effectiveAssetType", "brokerContractId", "updatedAt"], Instrument: ["brokerContractId"], ClosedTrade: ["grossRealizedPnl", "realizedPnl", "totalCommission", "openingQuantity", "closingQuantity", "updatedAt"], ClosedTradeExecution: ["commission", "fees"] };
  const removed = new Map(Object.entries(deletion).map(([model, keys]) => [model, new Set(keys.map(key => JSON.stringify(key)))]));
  return hash(Object.fromEntries(Object.entries(data).filter(([model]) => !["MaterializationWatermark", "ExecutionAnalytics"].includes(model)).sort().map(([model, rows]) => [model, rows.filter(r => !removed.get(model)?.has(rowKey(model, r))).map(r => Object.fromEntries(Object.entries(r).filter(([key]) => !(permitted[model] ?? []).includes(key)).sort())).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))])));
}

export async function runDashboardMaintenance(db: PrismaClient, options: { apply?: boolean; expectedManifestHash?: string } = {}) {
  return db.$transaction(async tx => {
    if (options.apply) await tx.$executeRawUnsafe('LOCK TABLE "Account", "Execution", "Position", "PositionSnapshot", "ClosedTrade", "ClosedTradeExecution", "ClosedTradeNote", "JournalEntry", "WorkstationTradeView", "ImportBatch" IN SHARE ROW EXCLUSIVE MODE');
    else await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const before = await loadMaintenanceData(tx), deletion = buildSyntheticDeletionManifest(before), repair = planAccountingRepair(before);
    const manifest = { version: ACCOUNTING_VERSION, deletion, executionUpdates: repair.executionUpdates, instrumentUpdates: repair.instrumentUpdates, groupUpdates: repair.groupUpdates.map(g => ({ groupKey: g.groupKey, gross: g.grossRealizedPnl, net: g.realizedPnl, costs: g.totalCommission, openingQuantity: g.openingQuantity, closingQuantity: g.closingQuantity })) };
    const manifestHash = hash(manifest), preservationHash = preservedFingerprint(before, deletion);
    if (options.apply && options.expectedManifestHash !== manifestHash) throw new Error("Maintenance manifest changed; rehearse the new manifest before applying");
    if (options.apply) {
      // Delete children first using the actual FK graph. Every row has an exact primary-key predicate.
      const pending = new Set(Object.keys(deletion));
      while (pending.size) {
        const leaves = [...pending].filter(parent => ![...pending].some(child => child !== parent && models.find(m => m.name === child)!.fields.some(f => f.kind === "object" && f.type === parent && f.relationFromFields?.length)));
        if (!leaves.length) throw new Error("Unresolved cleanup dependency cycle");
        for (const model of leaves) { const delegate = model[0].toLowerCase() + model.slice(1); for (let i = 0; i < deletion[model].length; i += 400) await (tx as any)[delegate].deleteMany({ where: { OR: deletion[model].slice(i, i + 400) } }); pending.delete(model); }
      }
      for (let offset = 0; offset < repair.executionUpdates.length; offset += 300) {
        const values = repair.executionUpdates.slice(offset, offset + 300).map(({ id, fields: f }) => Prisma.sql`(${id}, ${f.commission}::float8, ${f.fees}::float8, ${f.transactionTax}::float8, ${f.contractMultiplier}::float8, ${f.multiplierSource}, ${f.effectiveAssetType}, ${f.brokerContractId})`);
        await tx.$executeRaw(Prisma.sql`UPDATE "Execution" e SET "commission"=v.commission, "fees"=v.fees, "transactionTax"=v.tax, "contractMultiplier"=v.multiplier, "multiplierSource"=v.source, "effectiveAssetType"=v.class, "brokerContractId"=v.contract, "updatedAt"=NOW() FROM (VALUES ${Prisma.join(values)}) AS v(id,commission,fees,tax,multiplier,source,class,contract) WHERE e.id=v.id`);
      }
      if (repair.instrumentUpdates.length) await tx.$executeRaw(Prisma.sql`UPDATE "Instrument" i SET "brokerContractId"=v.contract FROM (VALUES ${Prisma.join(repair.instrumentUpdates.map(u => Prisma.sql`(${u.id},${u.brokerContractId})`))}) AS v(id,contract) WHERE i.id=v.id`);
      if (repair.groupUpdates.length) await tx.$executeRaw(Prisma.sql`UPDATE "ClosedTrade" t SET "grossRealizedPnl"=v.gross,"realizedPnl"=v.net,"totalCommission"=v.cost,"openingQuantity"=v.opening,"closingQuantity"=v.closing,"updatedAt"=NOW() FROM (VALUES ${Prisma.join(repair.groupUpdates.map(g => Prisma.sql`(${g.groupKey},${g.grossRealizedPnl}::float8,${g.realizedPnl}::float8,${g.totalCommission}::float8,${g.openingQuantity}::float8,${g.closingQuantity}::float8)`))}) AS v(key,gross,net,cost,opening,closing) WHERE t."groupKey"=v.key`);
      const changedGroups = new Set(repair.groupUpdates.map(g => g.groupKey));
      const allocations = repair.groups.filter(g => changedGroups.has(g.groupKey)).flatMap(g => g.executions.map(e => Prisma.sql`(${g.groupKey}, ${e.id}, ${e.commission}::float8, ${e.fees}::float8)`));
      for (let i = 0; i < allocations.length; i += 400) await tx.$executeRaw(Prisma.sql`UPDATE "ClosedTradeExecution" e SET "commission"=v.commission,"fees"=v.fees FROM (VALUES ${Prisma.join(allocations.slice(i, i + 400))}) AS v(groupkey,id,commission,fees) WHERE e."closedTradeGroupKey"=v.groupkey AND e."executionId"=v.id`);
      if (Object.keys(deletion).length || repair.executionUpdates.length || repair.instrumentUpdates.length || repair.groupUpdates.length) await writeMaterializationWatermark(tx, "closed-trades", await getClosedTradesSourceSnapshot(tx));
      const after = await loadMaintenanceData(tx);
      if (preservedFingerprint(after, {}) !== preservationHash) throw new Error("Genuine content preservation check failed; transaction rolled back");
    }
    return { manifest, manifestHash, preservationHash, coveredExecutions: repair.coveredExecutions, genuineTradeCount: repair.groups.length, applied: !!options.apply };
  }, { timeout: 240_000, maxWait: 30_000, isolationLevel: "Serializable" });
}

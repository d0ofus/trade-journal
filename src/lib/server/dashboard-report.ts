import { prisma } from "@/lib/prisma";
import { listWorkstationTrades } from "@/lib/server/trade-workstation";
import { aggregateDashboardData } from "@/lib/stats/dashboard-aggregation";
import { accountingMetadata } from "@/lib/stats/accounting";
import { utcDateBoundary } from "@/lib/server/utc-date-range";

export const REPORTING_ACCOUNT = process.env.REPORTING_ACCOUNT_CODE ?? "";
export class DashboardAccountingPending extends Error {}
export async function loadReportingAccounts() {
  const accounts = await prisma.account.findMany({ select: { ibkrAccount: true } });
  return accounts.filter(a => /^U\d+$/.test(a.ibkrAccount)).map(a => ({ code: a.ibkrAccount, inScope: a.ibkrAccount === REPORTING_ACCOUNT }));
}
export async function loadDashboardReport(filters: { from?: string; to?: string; account?: string } = {}) {
  // Other genuine accounts remain intact, outside the configured reporting scope.
  const account = filters.account ?? REPORTING_ACCOUNT;
  if (!account) throw new Error("Configure REPORTING_ACCOUNT_CODE before enabling dashboard reporting");
  if (account !== REPORTING_ACCOUNT) throw new Error("Account is outside the current reporting scope");
  if (await prisma.execution.count({ where: { account: { ibkrAccount: account }, contractMultiplier: null } })) {
    throw new DashboardAccountingPending("Accounting reconciliation is in progress. Performance figures will appear when the verified repair completes.");
  }
  const [trades, accounts, lastSuccess, lastAttempt] = await Promise.all([
    listWorkstationTrades({ account }),
    loadReportingAccounts(),
    prisma.importBatch.findFirst({ where: { account: { ibkrAccount: account }, status: { in: ["SUCCEEDED", "MATERIALIZED"] } }, orderBy: { importedAt: "desc" }, select: { importedAt: true, filename: true } }),
    prisma.importBatch.findFirst({ orderBy: { importedAt: "desc" }, select: { importedAt: true, status: true } }),
  ]);
  const data = aggregateDashboardData({
    rangeStart: filters.from ? utcDateBoundary(filters.from, "start") : undefined,
    rangeEnd: filters.to ? utcDateBoundary(filters.to, "end") : undefined,
    closedTrades: trades.map(t => ({
      groupKey: t.id, openTime: new Date(t.openTime * 1000), closeTime: new Date(t.closeTime * 1000),
      tradeDate: new Date(t.closeTime * 1000), realizedPnl: t.pnl, grossRealizedPnl: t.pnl + t.fees,
      totalCommission: t.fees, totalQuantity: t.quantity, symbol: t.symbol, direction: t.direction,
      assetType: accountingMetadata({ symbol: t.symbol, assetType: t.assetType }).effectiveAssetType,
      openingTimeKnown: t.executions.some(e => e.side === (t.direction === "SHORT" ? "SELL" : "BUY")) && t.executions.every(e => e.provenance?.timezoneStatus !== "unverified"),
    })),
  });
  return { ...data, account, accounts, freshness: { lastSuccess: lastSuccess?.importedAt.toISOString() ?? null, lastAttempt: lastAttempt?.importedAt.toISOString() ?? null, lastStatus: lastAttempt?.status ?? null, latestClose: trades.length ? new Date(Math.max(...trades.map(t => t.closeTime)) * 1000).toISOString() : null } };
}

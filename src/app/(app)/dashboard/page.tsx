import { Suspense } from "react";
import Link from "next/link";
import { DashboardDetails } from "@/components/dashboard-details";
import { DashboardCharts } from "@/components/dashboard-charts";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { resolveDashboardRange } from "@/lib/server/dashboard-date-range";
import { REPORTING_ACCOUNT, loadReportingAccounts, DashboardAccountingPending } from "@/lib/server/dashboard-report";
import { getDashboardData } from "@/lib/server/queries";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatDuration(ms: number | null) {
  if (ms == null) return "Unavailable";
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatVolume(value: number | null) {
  if (value == null) return "Unavailable";
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatProfitFactor(value: number | null, lossCount: number) {
  if (value == null) return lossCount === 0 ? "Unavailable (no losses)" : "Unavailable";
  if (lossCount === 0) return "No losses";
  if (!Number.isFinite(value)) return "No losses";
  return value.toFixed(2);
}

function formatLargestPair(gain: number, loss: number, winCount: number, lossCount: number) {
  const gainLabel = winCount > 0 ? formatCurrency(gain) : "No wins";
  const lossLabel = lossCount > 0 ? formatCurrency(loss) : "No losses";
  return `${gainLabel} / ${lossLabel}`;
}

function formatAveragePair(avgWin: number, avgLoss: number, winCount: number, lossCount: number) {
  const winLabel = winCount > 0 ? formatCurrency(avgWin) : "No wins";
  const lossLabel = lossCount > 0 ? formatCurrency(avgLoss) : "No losses";
  return `${winLabel} / ${lossLabel}`;
}

export default async function DashboardPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const accounts = await loadReportingAccounts();
  const range = resolveDashboardRange(searchParams);
  const rangeKey = `${range.preset}:${range.from ?? "none"}:${range.to ?? "none"}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Performance Overview"
        title="Completed-trade performance"
        description={`${REPORTING_ACCOUNT} · ${range.label} · closing dates in America/New_York`}
        actions={
          <div className="rounded-2xl border border-white/12 bg-white/10 px-4 py-3 text-right shadow-inner shadow-white/10 backdrop-blur">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/65">Range</p>
            <p className="mt-1 text-lg font-semibold text-white">{range.label}</p>
          </div>
        }
      />

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200/80 pb-4">
          <CardTitle className="text-base">Date Range</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard?preset=all" className={buttonVariants({ size: "sm", variant: range.preset === "all" ? "default" : "outline" })}>
              All Time
            </Link>
            <Link href="/dashboard?preset=ytd" className={buttonVariants({ size: "sm", variant: range.preset === "ytd" ? "default" : "outline" })}>
              YTD
            </Link>
            <Link href="/dashboard?preset=3m" className={buttonVariants({ size: "sm", variant: range.preset === "3m" ? "default" : "outline" })}>
              Past 3 Months
            </Link>
            <Link href="/dashboard?preset=6m" className={buttonVariants({ size: "sm", variant: range.preset === "6m" ? "default" : "outline" })}>
              Past 6 Months
            </Link>
          </div>
          <form key={rangeKey} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" method="get">
            <input name="preset" type="hidden" value="custom" />
            <label className="space-y-1.5 text-sm">Account<select name="account" aria-label="Reporting account" className="block w-full rounded border p-2" defaultValue={REPORTING_ACCOUNT}>{accounts.map(account => <option key={account.code} value={account.code} disabled={!account.inScope}>{account.code}{account.inScope ? "" : " (outside reporting scope)"}</option>)}</select></label>
            <label className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">From</p>
              <Input name="from" type="date" defaultValue={range.from ?? ""} />
            </label>
            <label className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">To</p>
              <Input name="to" type="date" defaultValue={range.to ?? ""} />
            </label>
            <Button size="sm" type="submit" className="md:self-end">
              Apply
            </Button>
          </form>
        </CardContent>
      </Card>

      <Suspense key={rangeKey} fallback={<DashboardContentFallback />}>
        <DashboardContent from={range.from} to={range.to} />
      </Suspense>
    </div>
  );
}

async function DashboardContent({ from, to }: { from?: string; to?: string }) {
  let data;
  try { data = await getDashboardData({ from, to }); }
  catch (error) {
    if (error instanceof DashboardAccountingPending) return <p role="status" className="rounded-xl border bg-white p-5 text-slate-700">{error.message}</p>;
    throw error;
  }
  const money = (n: number | null) => n == null ? "Unavailable" : formatCurrency(n);
  const pct = (n: number | null) => n == null ? "Unavailable" : formatPercent(n);
  const drilldown = `/trades?${new URLSearchParams({ account: data.account, reportingTimezone: "America/New_York", ...(from ? { from } : {}), ...(to ? { to } : {}) })}`;
  const cards = [
    { id: "gross-range", label: "Gross P&L · range", value: money(data.cards.gross) },
    { id: "net-range", label: "Net P&L · range", value: money(data.cards.realized) },
    { id: "total-trades", label: "Total Trades", value: data.cards.totalTrades.toLocaleString() },
    {
      id: "largest-gain-loss",
      label: "Largest Gain / Largest Loss",
      value: formatLargestPair(data.cards.largestGain, data.cards.largestLoss, data.cards.winCount, data.cards.lossCount),
    },
    { id: "avg-winning-hold", label: "Avg Hold Time (Winning Trades)", value: formatDuration(data.cards.avgWinHoldMs) },
    { id: "avg-losing-hold", label: "Avg Hold Time (Losing Trades)", value: formatDuration(data.cards.avgLossHoldMs) },
    { id: "avg-daily-volume", label: "Average quantity closed / active closing day", value: `${formatVolume(data.cards.avgDailyShares)} shares · ${formatVolume(data.cards.avgDailyContracts)} contracts` },
    { id: "realized-day", label: "Realized PnL (Day)", value: formatCurrency(data.cards.realizedDay) },
    { id: "realized-week", label: "Realized PnL (Week)", value: formatCurrency(data.cards.realizedWeek) },
    { id: "realized-month", label: "Realized PnL (Month)", value: formatCurrency(data.cards.realizedMonth) },
    { id: "win-rate", label: "Win Rate", value: pct(data.cards.winRate) },
    {
      id: "profit-factor",
      label: "Profit Factor",
      value: formatProfitFactor(data.cards.profitFactor, data.cards.lossCount),
    },
    {
      id: "avg-win-loss",
      label: "Avg Win / Avg Loss",
      value: formatAveragePair(data.cards.avgWin, data.cards.avgLoss, data.cards.winCount, data.cards.lossCount),
    },
    { id: "expectancy", label: "Expectancy", value: money(data.cards.expectancy) },
    { id: "max-drawdown", label: "Max Drawdown", value: formatCurrency(data.cards.maxDrawdown) },
    { id: "commissions", label: "Completed-trade costs", value: formatCurrency(data.cards.commissions) },
    { id: "payoff", label: "Payoff ratio", value: data.cards.payoffRatio?.toFixed(2) ?? "Unavailable" },
    { id: "streaks", label: "Longest winning / losing streak", value: `${data.cards.maxWinStreak} / ${data.cards.maxLossStreak}` },
    { id: "consistency", label: "Profitable closing days", value: `${data.cards.profitableDays}/${data.cohort.activeDays} · ${pct(data.cards.dailyConsistency)}` },
    { id: "recovery", label: "Longest drawdown duration", value: `${formatDuration(data.cards.maxRecoveryMs)}${data.cards.currentRecoveryMs != null ? " · currently underwater" : ""}` },
    { id: "cost-drag", label: "Cost drag / average cost per trade", value: `${pct(data.cards.costDrag)} / ${money(data.cards.costPerTrade)}` },
    { id: "concentration", label: "Top 5 share of positive net P&L", value: pct(data.cards.topFiveProfitShare) },
    { id: "best-day", label: "Best closing day", value: data.cards.bestDay ? `${data.cards.bestDay.label} · ${money(data.cards.bestDay.pnl)}` : "Unavailable" },
    { id: "worst-day", label: "Worst closing day", value: data.cards.worstDay ? `${data.cards.worstDay.label} · ${money(data.cards.worstDay.pnl)}` : "Unavailable" },
  ];

  return (
    <>
      <div className="rounded-xl border bg-white p-4 text-sm text-slate-600">
        <p>{data.account} · {data.cohort.from ?? "No closing dates"} through {data.cohort.to} · America/New_York · {data.cohort.count} completed trades · {data.cards.winCount} wins / {data.cards.lossCount} losses / {data.cards.flatCount} breakeven. <Link className="underline" href={drilldown}>Review matching trades</Link></p>
        <p>Last successful account import: {data.freshness.lastSuccess ?? "Unavailable"}. Latest import attempt: {data.freshness.lastAttempt ?? "Unavailable"} ({data.freshness.lastStatus ?? "unknown"}). Latest completed close: {data.freshness.latestClose ?? "Unavailable"}.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label} className="overflow-hidden" data-testid={`dashboard-card-${card.id}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{card.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tracking-tight text-slate-950">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <DashboardCharts {...data.charts} drilldown={drilldown} />
      <DashboardDetails data={data} />
    </>
  );
}

function DashboardContentFallback() {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-[24px] border border-slate-200/80 bg-white/85" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-[24px] border border-slate-200/80 bg-white/85" />
        <div className="h-72 animate-pulse rounded-[24px] border border-slate-200/80 bg-white/85" />
      </div>
    </>
  );
}

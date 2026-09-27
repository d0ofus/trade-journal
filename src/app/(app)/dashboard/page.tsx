import { Suspense } from "react";
import Link from "next/link";
import { DashboardDefinitions, DashboardBreakdowns } from "@/components/dashboard-details";
import { DashboardCharts } from "@/components/dashboard-charts";
import { DashboardEntryHeatmap } from "@/components/dashboard-entry-heatmap";
import { DashboardWorkspace, DashboardTabs, DashboardPanel, DashboardActiveCharts, DashboardPresetLink, DashboardTabInput } from "@/components/dashboard-workspace";
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
  const tab = searchParams.tab === "timing" || searchParams.tab === "breakdowns" ? searchParams.tab : "performance";
  return <DashboardWorkspace initialTab={tab}>
    <header className="dashboard-heading"><div><span className="dashboard-eyebrow">Performance overview</span><h1>Completed-trade performance</h1><p>{REPORTING_ACCOUNT} · Closing dates in America/New_York</p></div><span className="dashboard-period">{range.label}</span></header>
    <div className="dashboard-toolbar">
      <nav className="dashboard-presets" aria-label="Reporting date presets">{[["all", "All Time"], ["ytd", "YTD"], ["3m", "Past 3 Months"], ["6m", "Past 6 Months"]].map(([preset, label]) => <DashboardPresetLink key={preset} preset={preset} active={range.preset === preset}>{label}</DashboardPresetLink>)}</nav>
      <form key={rangeKey} className="dashboard-filters" method="get">
        <input name="preset" type="hidden" value="custom" /><DashboardTabInput />
        <label>Account<select name="account" aria-label="Reporting account" defaultValue={REPORTING_ACCOUNT}>{accounts.map(account => <option key={account.code} value={account.code} disabled={!account.inScope}>{account.code}{account.inScope ? "" : " (outside reporting scope)"}</option>)}</select></label>
        <label>From<input name="from" type="date" defaultValue={range.from ?? ""} /></label>
        <label>To<input name="to" type="date" defaultValue={range.to ?? ""} /></label>
        <button className="dashboard-apply" type="submit">Apply</button>
      </form>
    </div>
    <Suspense key={rangeKey} fallback={<DashboardContentFallback />}><DashboardContent from={range.from} to={range.to} /></Suspense>
  </DashboardWorkspace>;
}

async function DashboardContent({ from, to }: { from?: string; to?: string }) {
  let data;
  try { data = await getDashboardData({ from, to }); }
  catch (error) {
    if (error instanceof DashboardAccountingPending) return <p role="status" className="dashboard-empty">{error.message}</p>;
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
  const overview = ["net-range", "gross-range", "total-trades", "win-rate", "profit-factor", "max-drawdown"];
  const groups = {
    outcomes: ["largest-gain-loss", "avg-win-loss", "expectancy", "payoff"],
    costs: ["commissions", "cost-drag", "concentration"],
    consistency: ["realized-day", "realized-week", "realized-month", "streaks", "consistency", "recovery", "best-day", "worst-day"],
    activity: ["avg-winning-hold", "avg-losing-hold", "avg-daily-volume"],
  };
  const metrics = (ids: string[], primary = false) => <div className={`dashboard-metrics${primary ? " dashboard-overview" : ""}`}>{ids.map(id => {
    const card = cards.find(card => card.id === id)!;
    const value = id === "net-range" ? data.cards.realized : id === "gross-range" ? data.cards.gross : null;
    return <article key={id} className="dashboard-metric" data-testid={`dashboard-card-${id}`}><h3>{card.label}</h3><p data-sign={value == null || value === 0 ? undefined : value > 0 ? "positive" : "negative"}>{card.value}</p></article>;
  })}</div>;
  return <>
    <div className="dashboard-cohort">
      <p>{data.account} · {data.cohort.from ?? "No closing dates"} through {data.cohort.to} · America/New_York · {data.cohort.count} completed trades · {data.cards.winCount} wins / {data.cards.lossCount} losses / {data.cards.flatCount} breakeven.</p>
      <Link href={drilldown}>Review matching trades ↗</Link>
      <p className="dashboard-freshness">Last successful account import: {data.freshness.lastSuccess ?? "Unavailable"}. Latest import attempt: {data.freshness.lastAttempt ?? "Unavailable"} ({data.freshness.lastStatus ?? "unknown"}). Latest completed close: {data.freshness.latestClose ?? "Unavailable"}.</p>
    </div>
    {metrics(overview, true)}
    <DashboardTabs />
    <DashboardPanel tab="performance">
      <DashboardActiveCharts><DashboardCharts {...data.charts} /></DashboardActiveCharts>
      {(["outcomes", "costs", "consistency"] as const).map(group => <section key={group}><h2 className="dashboard-section-title">{group}</h2>{metrics(groups[group])}</section>)}
    </DashboardPanel>
    <DashboardPanel tab="timing"><DashboardEntryHeatmap rows={data.charts.entryHeatmap} drilldown={drilldown} /></DashboardPanel>
    <DashboardPanel tab="breakdowns">{metrics(groups.activity)}<DashboardBreakdowns data={data} /></DashboardPanel>
    <DashboardDefinitions data={data} />
  </>;
}
function DashboardContentFallback() {
  return <div className="dashboard-loading" role="status" aria-label="Loading dashboard"><div className="dashboard-metrics dashboard-overview">{Array.from({ length: 6 }, (_, i) => <div key={i} className="dashboard-metric" />)}</div><div className="dashboard-empty">Loading completed-trade performance…</div></div>;
}

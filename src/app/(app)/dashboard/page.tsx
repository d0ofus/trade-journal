import { Suspense } from "react";
import Link from "next/link";
import { DashboardCharts } from "@/components/dashboard-charts";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { resolveDashboardRange } from "@/lib/server/dashboard-date-range";
import { getDashboardData } from "@/lib/server/queries";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatVolume(value: number) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatProfitFactor(value: number, lossCount: number) {
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
  const range = resolveDashboardRange(searchParams);
  const rangeKey = `${range.preset}:${range.from ?? "none"}:${range.to ?? "none"}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Performance Overview"
        title="Trading analytics, framed like a premium desk platform."
        description={`Live review surface for ${range.label.toLowerCase()} performance, capital efficiency, and execution quality.`}
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
          <form key={rangeKey} className="grid gap-3 md:grid-cols-[minmax(0,220px)_minmax(0,220px)_auto]" method="get">
            <input name="preset" type="hidden" value="custom" />
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
  const data = await getDashboardData({ from, to });
  const cards = [
    { id: "total-trades", label: "Total Trades", value: data.cards.totalTrades.toLocaleString() },
    {
      id: "largest-gain-loss",
      label: "Largest Gain / Largest Loss",
      value: formatLargestPair(data.cards.largestGain, data.cards.largestLoss, data.cards.winCount, data.cards.lossCount),
    },
    { id: "avg-winning-hold", label: "Avg Hold Time (Winning Trades)", value: formatDuration(data.cards.avgWinHoldMs) },
    { id: "avg-losing-hold", label: "Avg Hold Time (Losing Trades)", value: formatDuration(data.cards.avgLossHoldMs) },
    { id: "avg-daily-volume", label: "Avg Daily Traded Volume", value: formatVolume(data.cards.avgDailyVolume) },
    { id: "realized-day", label: "Realized PnL (Day)", value: formatCurrency(data.cards.realizedDay) },
    { id: "realized-week", label: "Realized PnL (Week)", value: formatCurrency(data.cards.realizedWeek) },
    { id: "realized-month", label: "Realized PnL (Month)", value: formatCurrency(data.cards.realizedMonth) },
    { id: "win-rate", label: "Win Rate", value: formatPercent(data.cards.winRate) },
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
    { id: "expectancy", label: "Expectancy", value: formatCurrency(data.cards.expectancy) },
    { id: "max-drawdown", label: "Max Drawdown", value: formatCurrency(data.cards.maxDrawdown) },
    { id: "commissions", label: "Commissions", value: formatCurrency(data.cards.commissions) },
  ];

  return (
    <>
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

      <DashboardCharts {...data.charts} />
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

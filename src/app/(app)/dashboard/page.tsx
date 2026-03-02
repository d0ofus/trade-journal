import Link from "next/link";
import { format, startOfYear, subMonths } from "date-fns";
import { DashboardCharts } from "@/components/dashboard-charts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { getDashboardData } from "@/lib/server/queries";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type DashboardPreset = "all" | "ytd" | "3m" | "6m" | "custom";

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

function parseDateParam(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : value;
}

function resolveRange(searchParams: Record<string, string | string[] | undefined>) {
  const today = new Date();
  const todayIso = format(today, "yyyy-MM-dd");
  const fromInput = parseDateParam(typeof searchParams.from === "string" ? searchParams.from : undefined);
  const toInput = parseDateParam(typeof searchParams.to === "string" ? searchParams.to : undefined);
  const presetInput = typeof searchParams.preset === "string" ? searchParams.preset : undefined;

  let preset: DashboardPreset = "all";
  if (presetInput === "ytd" || presetInput === "3m" || presetInput === "6m" || presetInput === "custom" || presetInput === "all") {
    preset = presetInput;
  } else if (fromInput || toInput) {
    preset = "custom";
  }

  if (preset === "ytd") {
    return {
      preset,
      from: format(startOfYear(today), "yyyy-MM-dd"),
      to: todayIso,
      label: "Year-To-Date",
    };
  }
  if (preset === "3m") {
    return {
      preset,
      from: format(subMonths(today, 3), "yyyy-MM-dd"),
      to: todayIso,
      label: "Past 3 Months",
    };
  }
  if (preset === "6m") {
    return {
      preset,
      from: format(subMonths(today, 6), "yyyy-MM-dd"),
      to: todayIso,
      label: "Past 6 Months",
    };
  }
  if (preset === "custom") {
    return {
      preset,
      from: fromInput,
      to: toInput,
      label: "Custom Range",
    };
  }
  return {
    preset: "all" as const,
    from: undefined,
    to: undefined,
    label: "All Time",
  };
}

export default async function DashboardPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const range = resolveRange(searchParams);
  const data = await getDashboardData({ from: range.from, to: range.to });

  const cards = [
    { label: "Total Trades", value: data.cards.totalTrades.toLocaleString() },
    {
      label: "Largest Gain / Largest Loss",
      value: `${formatCurrency(data.cards.largestGain)} / ${formatCurrency(data.cards.largestLoss)}`,
    },
    { label: "Avg Hold Time (Winning Trades)", value: formatDuration(data.cards.avgWinHoldMs) },
    { label: "Avg Hold Time (Losing Trades)", value: formatDuration(data.cards.avgLossHoldMs) },
    { label: "Avg Daily Traded Volume", value: formatVolume(data.cards.avgDailyVolume) },
    { label: "Realized PnL (Day)", value: formatCurrency(data.cards.realizedDay) },
    { label: "Realized PnL (Week)", value: formatCurrency(data.cards.realizedWeek) },
    { label: "Realized PnL (Month)", value: formatCurrency(data.cards.realizedMonth) },
    { label: "Win Rate", value: formatPercent(data.cards.winRate) },
    {
      label: "Profit Factor",
      value: Number.isFinite(data.cards.profitFactor) ? data.cards.profitFactor.toFixed(2) : "Infinity",
    },
    { label: "Avg Win / Avg Loss", value: `${formatCurrency(data.cards.avgWin)} / ${formatCurrency(data.cards.avgLoss)}` },
    { label: "Expectancy", value: formatCurrency(data.cards.expectancy) },
    { label: "Max Drawdown", value: formatCurrency(data.cards.maxDrawdown) },
    { label: "Commissions", value: formatCurrency(data.cards.commissions) },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Dashboard</h2>
          <p className="text-sm text-slate-600">Performance overview for: {range.label}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Date Range</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
          <form className="flex flex-wrap items-end gap-3" method="get">
            <input name="preset" type="hidden" value="custom" />
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">From</p>
              <Input name="from" type="date" defaultValue={range.preset === "custom" ? range.from : undefined} />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">To</p>
              <Input name="to" type="date" defaultValue={range.preset === "custom" ? range.to : undefined} />
            </div>
            <Button size="sm" type="submit">
              Apply
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">{card.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-slate-900">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <DashboardCharts {...data.charts} />
    </div>
  );
}

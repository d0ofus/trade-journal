import { DashboardCharts } from "@/components/dashboard-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { getDashboardData } from "@/lib/server/queries";

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

export default async function DashboardPage() {
  const data = await getDashboardData();

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
          <p className="text-sm text-slate-600">Performance overview from imported executions and snapshots.</p>
        </div>
      </div>

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

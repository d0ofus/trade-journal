import { DashboardCharts } from "@/components/dashboard-charts";
import { SampleDataButton } from "@/components/sample-data-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { getDashboardData } from "@/lib/server/queries";

export default async function DashboardPage() {
  const data = await getDashboardData();

  const cards = [
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
        <SampleDataButton />
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

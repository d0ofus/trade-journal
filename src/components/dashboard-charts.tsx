"use client";

import type { DashboardAggregation } from "@/lib/stats/dashboard-aggregation";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDashboardAxisDate } from "@/lib/stats/dashboard-chart-format";

function formatTwoDecimals(value: number | string | undefined) {
  if (typeof value === "undefined") return "";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : value;
}
const axisStyle = { fontSize: 11, fill: "var(--dash-muted)" };
type Chart = { title: string; rows: object[]; x: string; value: string; color: string; line?: boolean; count?: boolean; histogram?: boolean; testId?: string; endpoints?: number[] };

export function DashboardCharts(data: DashboardAggregation["charts"]) {
  const charts: Chart[] = [
    { title: "Cumulative Net P&L", rows: data.equityCurve, x: "at", value: "equity", color: "var(--ws-accent)", line: true, testId: "dashboard-chart-net-cumulative-pnl", endpoints: data.equityCurve.map(r => r.equity) },
    { title: "Gross Cumulative P&L", rows: data.grossCumulativePnl, x: "date", value: "pnl", color: "var(--dash-cyan)", line: true, testId: "dashboard-chart-gross-cumulative-pnl", endpoints: data.grossCumulativePnl.map(r => r.pnl) },
    { title: "Net Daily P&L", rows: data.dailyPnl, x: "date", value: "pnl", color: "var(--dash-blue)" },
    { title: "Gross Daily P&L", rows: data.grossDailyPnl, x: "date", value: "pnl", color: "var(--ws-green)" },
    { title: "Dollar drawdown", rows: data.drawdown, x: "at", value: "drawdown", color: "var(--ws-red)", line: true },
    { title: "Rolling 20-trade net P&L", rows: data.rolling, x: "at", value: "pnl", color: "var(--ws-accent)", line: true },
    { title: "Total Trades", rows: data.dailyTradeCounts, x: "date", value: "trades", color: "var(--dash-cyan)", count: true },
    { title: "Net P&L per trade distribution", rows: data.histogram, x: "range", value: "count", color: "var(--dash-amber)", histogram: true },
  ];
  return <div className="dashboard-charts">{charts.map(chart => {
    const endpoints = chart.endpoints?.filter(Number.isFinite);
    const ChartComponent = chart.line ? LineChart : BarChart;
    return <section className="dashboard-panel" key={chart.title} data-testid={chart.testId} data-chart-title={chart.title} data-point-count={chart.endpoints ? chart.rows.length : undefined} data-first-value={endpoints?.[0]?.toFixed(2)} data-last-value={endpoints?.at(-1)?.toFixed(2)}>
      <h2>{chart.title}</h2><div className="dashboard-chart-body">
        {!chart.rows.length ? <div className="dashboard-empty">No trades in range</div> : <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 1, height: 1 }}>
          <ChartComponent data={chart.rows} margin={{ left: 0, right: 10, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--ws-border)" vertical={false} />
            <XAxis dataKey={chart.x} tickFormatter={chart.histogram ? undefined : formatDashboardAxisDate} tick={axisStyle} axisLine={false} tickLine={false} minTickGap={20} />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} allowDecimals={!chart.count} width={62} />
            <Tooltip formatter={chart.count || chart.histogram ? undefined : formatTwoDecimals} />
            {chart.line ? <Line type="linear" dataKey={chart.value} stroke={chart.color} strokeWidth={2} dot={false} /> : <Bar dataKey={chart.value} fill={chart.color} radius={[3, 3, 0, 0]} />}
          </ChartComponent>
        </ResponsiveContainer>}
      </div>
    </section>;
  })}</div>;
}

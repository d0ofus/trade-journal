"use client";

import { format } from "date-fns";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DashboardChartsProps = {
  dailyPnl: { date: string; pnl: number }[];
  grossDailyPnl: { date: string; pnl: number }[];
  grossCumulativePnl: { date: string; pnl: number }[];
  dailyTradeCounts: { date: string; trades: number }[];
  equityCurve: { at: string; equity: number }[];
  histogram: { range: string; count: number }[];
  scatter: { time: string; symbol: string; price: number; side: string }[];
};

type ChartSummary = {
  firstValue?: number;
  lastValue?: number;
  pointCount: number;
};

function formatAxisDate(value: string) {
  if (!value) return value;
  const normalized = value.includes(" ") ? value.replace(" ", "T") : `${value}T00:00:00`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, "MMM d");
}

function formatTwoDecimals(value: number | string | undefined) {
  if (typeof value === "undefined") return "";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return value;
  return numeric.toFixed(2);
}

function formatDataValue(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : undefined;
}

function summarizeChart<T>(rows: T[], pickValue: (row: T) => number): ChartSummary {
  const values = rows.map(pickValue).filter((value) => Number.isFinite(value));
  return {
    firstValue: values[0],
    lastValue: values.at(-1),
    pointCount: rows.length,
  };
}

const chartGrid = { stroke: "rgba(148, 163, 184, 0.22)", vertical: false };
const axisStyle = { fontSize: 12, fill: "#64748b" };

function ChartContainer({ children }: { children: ReactNode }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 1, height: 1 }}>
      {children}
    </ResponsiveContainer>
  );
}

function ChartFrame({
  children,
  empty,
  summary,
  testId,
  title,
}: {
  children: ReactNode;
  empty: boolean;
  summary?: ChartSummary;
  testId?: string;
  title: string;
}) {
  return (
    <Card
      className="overflow-hidden"
      data-first-value={formatDataValue(summary?.firstValue)}
      data-last-value={formatDataValue(summary?.lastValue)}
      data-point-count={summary?.pointCount}
      data-testid={testId}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative h-64">
          {empty ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm font-medium text-slate-500">
              No trades in range
            </div>
          ) : (
            children
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardCharts({
  dailyPnl,
  grossDailyPnl,
  grossCumulativePnl,
  dailyTradeCounts,
  equityCurve,
  histogram,
  scatter,
}: DashboardChartsProps) {
  const grossCumulativeSummary = summarizeChart(grossCumulativePnl, (row) => row.pnl);
  const netCumulativeSummary = summarizeChart(equityCurve, (row) => row.equity);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame title="Gross Daily P&L" empty={grossDailyPnl.length === 0}>
              <ChartContainer>
                <BarChart data={grossDailyPnl}>
                  <CartesianGrid stroke={chartGrid.stroke} vertical={chartGrid.vertical} />
                  <XAxis dataKey="date" tickFormatter={formatAxisDate} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip formatter={formatTwoDecimals} />
                  <Bar dataKey="pnl" fill="#0f766e" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ChartContainer>
        </ChartFrame>

        <ChartFrame
          title="Gross Cumulative P&L"
          empty={grossCumulativePnl.length === 0}
          summary={grossCumulativeSummary}
          testId="dashboard-chart-gross-cumulative-pnl"
        >
              <ChartContainer>
                <LineChart data={grossCumulativePnl}>
                  <CartesianGrid stroke={chartGrid.stroke} vertical={chartGrid.vertical} />
                  <XAxis dataKey="date" tickFormatter={formatAxisDate} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip formatter={formatTwoDecimals} />
                  <Line type="monotone" dataKey="pnl" stroke="#0891b2" strokeWidth={3} dot={false} />
                </LineChart>
              </ChartContainer>
        </ChartFrame>

        <div className="lg:col-span-2">
          <ChartFrame title="Total Trades" empty={dailyTradeCounts.length === 0}>
              <ChartContainer>
                <BarChart data={dailyTradeCounts}>
                  <CartesianGrid stroke={chartGrid.stroke} vertical={chartGrid.vertical} />
                  <XAxis dataKey="date" tickFormatter={formatAxisDate} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="trades" fill="#334155" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ChartContainer>
          </ChartFrame>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Cumulative Net P&L"
          empty={equityCurve.length === 0}
          summary={netCumulativeSummary}
          testId="dashboard-chart-net-cumulative-pnl"
        >
              <ChartContainer>
                <LineChart data={equityCurve}>
                  <CartesianGrid stroke={chartGrid.stroke} vertical={chartGrid.vertical} />
                  <XAxis dataKey="at" tickFormatter={formatAxisDate} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip formatter={formatTwoDecimals} />
                  <Line type="monotone" dataKey="equity" stroke="#0f172a" strokeWidth={3} dot={false} />
                </LineChart>
              </ChartContainer>
        </ChartFrame>

        <ChartFrame title="Net Daily P&L" empty={dailyPnl.length === 0}>
              <ChartContainer>
                <BarChart data={dailyPnl}>
                  <CartesianGrid stroke={chartGrid.stroke} vertical={chartGrid.vertical} />
                  <XAxis dataKey="date" tickFormatter={formatAxisDate} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip formatter={formatTwoDecimals} />
                  <Bar dataKey="pnl" fill="#2563eb" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ChartContainer>
        </ChartFrame>

        <ChartFrame title="Execution Prices" empty={scatter.length === 0}>
              <ChartContainer>
                <ScatterChart>
                  <CartesianGrid stroke={chartGrid.stroke} />
                  <XAxis dataKey="time" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis dataKey="price" tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={formatTwoDecimals} />
                  <Scatter data={scatter} fill="#16a34a" />
                </ScatterChart>
              </ChartContainer>
        </ChartFrame>

        <ChartFrame title="Return Distribution" empty={histogram.length === 0}>
              <ChartContainer>
                <BarChart data={histogram}>
                  <CartesianGrid stroke={chartGrid.stroke} vertical={chartGrid.vertical} />
                  <XAxis dataKey="range" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#ea580c" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ChartContainer>
        </ChartFrame>
      </div>
    </div>
  );
}

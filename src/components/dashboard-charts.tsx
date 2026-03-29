"use client";

import { format } from "date-fns";
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

const chartGrid = { stroke: "rgba(148, 163, 184, 0.22)", vertical: false };
const axisStyle = { fontSize: 12, fill: "#64748b" };

export function DashboardCharts({
  dailyPnl,
  grossDailyPnl,
  grossCumulativePnl,
  dailyTradeCounts,
  equityCurve,
  histogram,
  scatter,
}: DashboardChartsProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Gross Daily P&amp;L</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={grossDailyPnl}>
                  <CartesianGrid stroke={chartGrid.stroke} vertical={chartGrid.vertical} />
                  <XAxis dataKey="date" tickFormatter={formatAxisDate} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip formatter={formatTwoDecimals} />
                  <Bar dataKey="pnl" fill="#0f766e" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Gross Cumulative P&amp;L</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={grossCumulativePnl}>
                  <CartesianGrid stroke={chartGrid.stroke} vertical={chartGrid.vertical} />
                  <XAxis dataKey="date" tickFormatter={formatAxisDate} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip formatter={formatTwoDecimals} />
                  <Line type="monotone" dataKey="pnl" stroke="#0891b2" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Total Trades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyTradeCounts}>
                  <CartesianGrid stroke={chartGrid.stroke} vertical={chartGrid.vertical} />
                  <XAxis dataKey="date" tickFormatter={formatAxisDate} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="trades" fill="#334155" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Equity Curve</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityCurve}>
                  <CartesianGrid stroke={chartGrid.stroke} vertical={chartGrid.vertical} />
                  <XAxis dataKey="at" tickFormatter={formatAxisDate} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip formatter={formatTwoDecimals} />
                  <Line type="monotone" dataKey="equity" stroke="#0f172a" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Net Daily P&amp;L</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyPnl}>
                  <CartesianGrid stroke={chartGrid.stroke} vertical={chartGrid.vertical} />
                  <XAxis dataKey="date" tickFormatter={formatAxisDate} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip formatter={formatTwoDecimals} />
                  <Bar dataKey="pnl" fill="#2563eb" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Execution Prices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid stroke={chartGrid.stroke} />
                  <XAxis dataKey="time" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis dataKey="price" tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={formatTwoDecimals} />
                  <Scatter data={scatter} fill="#16a34a" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Return Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histogram}>
                  <CartesianGrid stroke={chartGrid.stroke} vertical={chartGrid.vertical} />
                  <XAxis dataKey="range" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#ea580c" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

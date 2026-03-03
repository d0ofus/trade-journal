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
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">Gross Daily P&amp;L</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grossDailyPnl}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={formatAxisDate} />
                <YAxis />
                <Tooltip formatter={formatTwoDecimals} />
                <Bar dataKey="pnl" fill="#0ea5e9" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">Gross Cumulative P&amp;L</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={grossCumulativePnl}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={formatAxisDate} />
                <YAxis />
                <Tooltip formatter={formatTwoDecimals} />
                <Line type="monotone" dataKey="pnl" stroke="#0284c7" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <p className="mb-2 text-sm font-semibold text-slate-700">Total Trades</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyTradeCounts}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={formatAxisDate} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="trades" fill="#475569" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-slate-700">Equity Curve</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={equityCurve}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="at" tickFormatter={formatAxisDate} />
              <YAxis />
              <Tooltip formatter={formatTwoDecimals} />
              <Line type="monotone" dataKey="equity" stroke="#0f172a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-slate-700">Net Daily P&amp;L</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyPnl}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={formatAxisDate} />
              <YAxis />
              <Tooltip formatter={formatTwoDecimals} />
              <Bar dataKey="pnl" fill="#1d4ed8" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-slate-700">Execution Prices (Intra-day)</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
              <CartesianGrid />
              <XAxis dataKey="time" />
              <YAxis dataKey="price" />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={formatTwoDecimals} />
              <Scatter data={scatter} fill="#16a34a" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-slate-700">Return Distribution</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histogram}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="range" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#ea580c" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
    </div>
  );
}

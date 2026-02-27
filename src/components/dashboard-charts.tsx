"use client";

import { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";

type DashboardChartsProps = {
  dailyPnl: { date: string; pnl: number }[];
  grossDailyPnl: { date: string; pnl: number }[];
  grossCumulativePnl: { date: string; pnl: number }[];
  dailyTradeCounts: { date: string; trades: number }[];
  equityCurve: { at: string; equity: number }[];
  histogram: { range: string; count: number }[];
  scatter: { time: string; symbol: string; price: number; side: string }[];
};

type WindowDays = 30 | 60 | 90;

function filterByDays<T extends { date: string }>(rows: T[], days: WindowDays) {
  if (rows.length === 0) return rows;
  const anchor = new Date(`${rows[rows.length - 1].date}T00:00:00.000Z`);
  const cutoff = new Date(anchor);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  return rows.filter((row) => new Date(`${row.date}T00:00:00.000Z`) >= cutoff);
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
  const [windowDays, setWindowDays] = useState<WindowDays>(90);

  const filteredGrossDaily = useMemo(() => filterByDays(grossDailyPnl, windowDays), [grossDailyPnl, windowDays]);
  const filteredGrossCumulative = useMemo(() => filterByDays(grossCumulativePnl, windowDays), [grossCumulativePnl, windowDays]);
  const filteredTradeCounts = useMemo(() => filterByDays(dailyTradeCounts, windowDays), [dailyTradeCounts, windowDays]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">Gross Metrics Window</p>
          <div className="flex items-center gap-2">
            {[30, 60, 90].map((days) => (
              <Button
                key={days}
                size="sm"
                variant={windowDays === days ? "default" : "outline"}
                onClick={() => setWindowDays(days as WindowDays)}
              >
                {days}D
              </Button>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500">Applies to gross daily P&amp;L, gross cumulative P&amp;L, and total trades.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">Gross Daily P&amp;L</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={filteredGrossDaily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="pnl" fill="#0ea5e9" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">Gross Cumulative P&amp;L</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={filteredGrossCumulative}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="pnl" stroke="#0284c7" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <p className="mb-2 text-sm font-semibold text-slate-700">Total Trades</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={filteredTradeCounts}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
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
              <XAxis dataKey="at" hide />
              <YAxis />
              <Tooltip />
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
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
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
              <Tooltip cursor={{ strokeDasharray: "3 3" }} />
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

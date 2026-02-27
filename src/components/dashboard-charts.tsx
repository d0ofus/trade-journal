"use client";

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
  equityCurve: { at: string; equity: number }[];
  histogram: { range: string; count: number }[];
  scatter: { time: string; symbol: string; price: number; side: string }[];
};

export function DashboardCharts({ dailyPnl, equityCurve, histogram, scatter }: DashboardChartsProps) {
  return (
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
        <p className="mb-2 text-sm font-semibold text-slate-700">Daily PnL</p>
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
  );
}

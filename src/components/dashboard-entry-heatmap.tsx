"use client";
import { useState, type CSSProperties } from "react";
import Link from "next/link";
import type { DashboardAggregation } from "@/lib/stats/dashboard-aggregation";

export function DashboardEntryHeatmap({ rows, drilldown }: { rows: DashboardAggregation["charts"]["entryHeatmap"]; drilldown: string }) {
  const [metric, setMetric] = useState<"count" | "pnl" | "expectancy" | "winRate">("pnl");
  const max = Math.max(1, ...rows.map(r => Math.abs(r[metric] ?? 0)));
  const byKey = new Map(rows.map(r => [r.key, r]));
  const days = [1, 2, 3, 4, 5, 6, 0].filter(day => day < 6 && day > 0 || rows.some(r => r.weekday === day));
  const slots = [...new Set(rows.map(r => r.slot))].sort((a, b) => a - b);
  return <section className="dashboard-panel dashboard-heatmap">
    <div className="dashboard-heatmap-head"><h2 className="font-semibold">Completed-trade entry time · New York</h2>
      <select aria-label="Entry heatmap metric" className="rounded border p-2 text-sm" value={metric} onChange={e => setMetric(e.target.value as typeof metric)}>
        <option value="pnl">Net P&L</option><option value="count">Trade count</option><option value="expectancy">Expectancy</option><option value="winRate">Win rate</option>
      </select></div>
    <p className="dashboard-muted">First entry, in 30-minute buckets. Each cell opens its completed trades. Unknown opening times are excluded.</p>
    {!rows.length ? <p>No known entry times in range.</p> : <div className="dashboard-table-scroll"><table className="w-full text-center text-xs"><thead><tr><th className="p-2">Entry</th>{days.map(day => <th key={day}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]}</th>)}</tr></thead>
      <tbody>{slots.map(slot => <tr key={slot}><th className="p-2 font-normal">{String(Math.floor(slot / 2)).padStart(2, "0")}:{slot % 2 ? "30" : "00"}</th>{days.map(day => {
        const row = byKey.get(`${day}:${slot}`), value = row?.[metric];
        return <td key={day} className="p-0.5">{row && value != null ? <Link className="dashboard-heatmap-cell" style={{ "--cell-color": value < 0 ? "var(--ws-red)" : "var(--ws-green)", "--cell-strength": `${8 + 25 * Math.abs(value) / max}%` } as CSSProperties} href={`${drilldown}&entryWeekday=${day}&entrySlot=${slot}`} title={`${row.count} trades · Net $${row.pnl.toFixed(2)} · Expectancy $${row.expectancy?.toFixed(2)} · Wins ${row.winRate?.toFixed(1)}%`}>
          {metric === "count" ? value : metric === "winRate" ? `${value.toFixed(1)}%` : `$${value.toFixed(2)}`}<span className="block text-[10px]">n={row.count}</span>
        </Link> : <span className="dashboard-muted">—</span>}</td>;
      })}</tr>)}</tbody></table></div>}
  </section>;
}

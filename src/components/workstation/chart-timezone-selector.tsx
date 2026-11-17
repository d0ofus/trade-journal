"use client";
import type { ChartTimezone, ChartTimezoneMode } from "@/lib/workstation/chart-timezone";
export function ChartTimezoneSelector({ value, onChange, disabled = false, label = "Chart timezone" }: { value: ChartTimezone; onChange: (mode: ChartTimezoneMode) => void; disabled?: boolean; label?: string }) {
  return <label className="ws-chart-timezone"><span>{label}</span><select aria-label={label} value={value.mode} disabled={disabled} onChange={e => onChange(e.target.value as ChartTimezoneMode)}><option value="exchange">Exchange</option><option value="system">System</option><option value="utc">UTC</option></select><small title={value.label}>{value.label}</small></label>;
}

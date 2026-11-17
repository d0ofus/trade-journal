"use client";
import { useEffect, useMemo, useState } from "react";
import { chartTimeFormatters, resolveChartTimezone, restoreChartTimezone, type ChartTimezone } from "@/lib/workstation/chart-timezone";
import type { CandleSession, Interval } from "@/lib/workstation/types";

export function applyChartTimezone(chart: { applyOptions: (options: ReturnType<typeof chartTimeFormatters>) => void }, timezone: ChartTimezone, interval: Interval, session?: CandleSession) {
  const start = performance.now();
  chart.applyOptions(chartTimeFormatters(timezone, interval, session));
  window.dispatchEvent(new CustomEvent("workstation-timezone-updated", { detail: { duration: performance.now() - start } }));
}

/** Device discovery is independent of market data and only active in System mode. */
export function useSystemTimezone(value: unknown) {
  const mode = restoreChartTimezone(value), [zone, setZone] = useState<string>();
  useEffect(() => {
    if (mode !== "system") return;
    const update = () => { try { setZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { setZone(undefined); } };
    const visible = () => { if (document.visibilityState === "visible") update(); };
    update(); window.addEventListener("focus", update); document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", visible); };
  }, [mode]);
  return zone;
}
export function useChartTimezone(value: unknown, session: CandleSession | undefined, system: string | undefined): ChartTimezone {
  const mode = restoreChartTimezone(value), zone = session?.timezone, calendar = session?.calendar;
  return useMemo(() => resolveChartTimezone(mode, zone && calendar ? { timezone: zone, calendar } : undefined, system), [mode, zone, calendar, system]);
}

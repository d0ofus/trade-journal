"use client";
import { metricIdentity, legacyShareDescription } from "@/lib/workstation/share-eligibility";
import { useEffect, useState } from "react";
import type { Trade, WorkstationAdapter } from "@/lib/workstation/types";
import { formatMetric, unavailableMetrics, type MarketMetrics } from "@/lib/workstation/market-metrics";

export function useMarketMetrics(adapter: WorkstationAdapter, trade: Trade | undefined) {
  const [result, setResult] = useState<{ key: string; value: MarketMetrics } | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const key = trade ? metricIdentity(trade) : "";
  useEffect(() => {
    if (!trade || !adapter.metrics) return;
    const controller = new AbortController(); setError("");
    void adapter.metrics(trade, controller.signal).then(value => { if (!controller.signal.aborted) setResult({ key, value }); }).catch(() => { if (!controller.signal.aborted) setError("Pre-trade metrics unavailable"); });
    return () => controller.abort();
    // Trade time interpretation, rather than chart session or viewport, fixes these daily values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, key, retry]);
  return { value: result?.key === key ? result.value : undefined, error, retry: () => setRetry(n => n + 1) };
}

export function MarketMetricsStrip({ value, error, retry }: ReturnType<typeof useMarketMetrics>) {
  if (error) return <div className="ws-market-metrics" role="status">{error} <button onClick={retry}>Retry</button></div>;
  const display = value ?? unavailableMetrics("", "USD", "Loading pre-trade metrics");
  return <div className="ws-market-metrics" aria-label="Pre-trade metrics">
    <span className="ws-metric-date">{value ? value.asOf ? `As of ${value.asOf}` : "Pre-trade metrics" : "Loading pre-trade metrics…"}</span>
    {([["ADR% · 14", display.adr, "percent"], ["ATR% · 14", display.atr, "percent"], ["Avg dollar volume · 20", display.dollarVolume, "money"], ["Market cap · estimated", display.marketCap, "money"]] as const).map(([name, metric, kind]) => <span key={name} title={(display.eligibilityBasis === "legacy-shares" ? `${legacyShareDescription}. ` : "") + (metric.reason ?? (name.startsWith("ATR") && display.atrSessions < 250 ? `Wilder ATR initialized with ${display.atrSessions} available sessions` : name.startsWith("Market") ? `Estimated from SEC shares dated ${display.sharesDate}, filed ${display.sharesFiled}; same-session filings excluded; adjusted for intervening splits` : display.provider))}><small>{name}</small><b>{value ? formatMetric(metric, kind, display.currency) : "—"}</b></span>)}
    {value?.sharesSource && <a href={value.sharesSource} target="_blank" rel="noreferrer" title={`SEC shares observation ${value.sharesDate}`}>Shares source · {value.sharesDate}</a>}
  </div>;
}

/** Metric completion updates this strip, not the chart workspace's React tree. */
export function TradeMarketMetrics({ adapter, trade, onValue }: { adapter: WorkstationAdapter; trade: Trade; onValue: (key: string, value: MarketMetrics | undefined) => void }) {
  const result = useMarketMetrics(adapter, trade), key = metricIdentity(trade);
  useEffect(() => onValue(key, result.value), [key, result.value, onValue]);
  return <MarketMetricsStrip {...result} />;
}

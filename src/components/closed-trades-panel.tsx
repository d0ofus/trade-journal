"use client";

import { useMemo, useState, useTransition } from "react";
import { BenchmarkComparisonChart } from "@/components/benchmark-comparison-chart";
import { CandlestickWithMarkers } from "@/components/candlestick-with-markers";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  alignExecutionToBarTime,
  inferExecutionOffsetSeconds,
  inferBarIntervalSeconds,
  type AlignmentCandle,
  type ExecutionAlignmentInput,
} from "@/lib/charts/execution-marker-alignment";
import { computeRelativeStrengthMetrics, type RelativeStrengthMetrics } from "@/lib/charts/relative-strength";
import { cn, formatCurrency, formatSignedNotional } from "@/lib/utils";

type ClosedTrade = {
  groupKey: string;
  accountId: string;
  accountCode: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  openTime: string;
  closeTime: string;
  avgEntryPrice: number;
  avgExitPrice: number;
  tradeDate: string;
  realizedPnl: number;
  totalCommission: number;
  openingQuantity: number;
  closingQuantity: number;
  executions: Array<{
    id: string;
    executedAt: string;
    side: "BUY" | "SELL";
    quantity: number;
    price: number;
    commission: number;
    fees: number;
  }>;
  dayNote: string;
  tradeNote: string;
};

type Candle = AlignmentCandle;
type ChartInterval = "5m" | "1h" | "1d";
type BenchmarkSymbol = "SPY" | "QQQ" | "IWM";
type ComparisonCandles = {
  ticker: Candle[];
  benchmark: Candle[];
  compareError: string | null;
};

const CHART_INTERVALS: Array<{ value: ChartInterval; label: string }> = [
  { value: "5m", label: "5 minute" },
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
];

const BENCHMARK_SYMBOLS: BenchmarkSymbol[] = ["SPY", "QQQ", "IWM"];

const INTERVAL_SECONDS: Record<ChartInterval, number> = {
  "5m": 5 * 60,
  "1h": 60 * 60,
  "1d": 24 * 60 * 60,
};

const STATIC_CONTEXT_BARS: Record<ChartInterval, { before: number; after: number }> = {
  "5m": { before: 288, after: 288 },
  "1h": { before: 168, after: 168 },
  "1d": { before: 120, after: 120 },
};

function toAlignmentInputs(
  executions: ClosedTrade["executions"],
): ExecutionAlignmentInput[] {
  return executions.map((execution) => ({
    executedAt: execution.executedAt,
    price: execution.price,
  }));
}

function formatExecutionDateTime(executedAt: string) {
  return new Date(executedAt).toISOString().replace("T", " ").slice(0, 16);
}

function monthKeyFromTradeDate(tradeDate: string) {
  return tradeDate.slice(0, 7);
}

function formatMonthLabel(tradeDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${tradeDate}T00:00:00.000Z`));
}

function sideBadgeVariant(side: "BUY" | "SELL") {
  return side === "BUY" ? "success" : "danger";
}

function sideRowClassName(side: "BUY" | "SELL") {
  return side === "BUY"
    ? "border-l-4 border-l-emerald-500 bg-emerald-50/40 hover:bg-emerald-50/70"
    : "border-l-4 border-l-red-500 bg-red-50/40 hover:bg-red-50/70";
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function metricTone(value: number | null) {
  if (value === null) return "text-slate-500";
  if (value > 0) return "text-emerald-600";
  if (value < 0) return "text-red-600";
  return "text-slate-700";
}

function executionTimestampsWithinLoadedRange(executions: ClosedTrade["executions"], candles: Candle[]) {
  if (executions.length === 0 || candles.length === 0) return true;

  const intervalSeconds = inferBarIntervalSeconds(candles);
  const firstStart = candles[0].time;
  const lastEnd = candles[candles.length - 1].time + intervalSeconds;

  return executions.every((execution) => {
    const executedAtSeconds = Math.floor(new Date(execution.executedAt).getTime() / 1000);
    return executedAtSeconds >= firstStart && executedAtSeconds < lastEnd;
  });
}

export function ClosedTradesPanel({ closedTrades }: { closedTrades: ClosedTrade[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [candlesByKey, setCandlesByKey] = useState<Record<string, Candle[]>>({});
  const [comparisonCandlesByKey, setComparisonCandlesByKey] = useState<Record<string, ComparisonCandles>>({});
  const [staticCandlesByKey, setStaticCandlesByKey] = useState<Record<string, Candle[]>>({});
  const [intervalByKey, setIntervalByKey] = useState<Record<string, ChartInterval>>({});
  const [benchmarkByKey, setBenchmarkByKey] = useState<Record<string, BenchmarkSymbol>>({});
  const [tradeNotes, setTradeNotes] = useState<Record<string, string>>(
    Object.fromEntries(closedTrades.map((trade) => [trade.groupKey, trade.tradeNote])),
  );
  const [status, setStatus] = useState<Record<string, string>>({});
  const [chartStatus, setChartStatus] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const groupedByDate = useMemo(() => {
    const map = new Map<string, ClosedTrade[]>();
    for (const row of closedTrades) {
      const list = map.get(row.tradeDate) ?? [];
      list.push(row);
      map.set(row.tradeDate, list);
    }
    const sortedEntries = [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

    return sortedEntries
      .map(([date, rows], index) => {
        const currentMonthKey = monthKeyFromTradeDate(date);
        const previousDate = sortedEntries[index - 1]?.[0];
        const startsNewMonth = !previousDate || currentMonthKey !== monthKeyFromTradeDate(previousDate);

        return {
          date,
          rows,
          monthLabel: formatMonthLabel(date),
          startsNewMonth,
        };
      });
  }, [closedTrades]);

  async function ensureMarketCandles(trade: ClosedTrade, interval: ChartInterval, benchmark: BenchmarkSymbol) {
    const cacheKey = `${trade.groupKey}:${interval}`;
    const comparisonCacheKey = `${trade.groupKey}:${interval}:${benchmark}`;
    if (candlesByKey[cacheKey] && comparisonCandlesByKey[comparisonCacheKey]) return;

    const url = new URL("/api/market/candles", window.location.origin);
    url.searchParams.set("symbol", trade.symbol);
    url.searchParams.set("timeframe", interval);
    url.searchParams.set("compare", benchmark);
    let limit = 1200;
    if (trade.executions.length > 0) {
      const intervalSeconds = INTERVAL_SECONDS[interval];
      const contextBars = STATIC_CONTEXT_BARS[interval];
      const execTimes = trade.executions.map((execution) => Math.floor(new Date(execution.executedAt).getTime() / 1000));
      const minExec = Math.min(...execTimes);
      const maxExec = Math.max(...execTimes);
      const from = minExec - contextBars.before * intervalSeconds;
      const to = maxExec + contextBars.after * intervalSeconds;
      const spanBars = Math.max(1, Math.ceil((to - from) / intervalSeconds));
      limit = Math.min(5000, Math.max(300, spanBars + 20));
      url.searchParams.set("from", String(from));
      url.searchParams.set("to", String(to));
    }
    url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString());
    if (!res.ok) {
      setChartStatus((prev) => ({ ...prev, [`${trade.groupKey}:${interval}`]: `Unable to load ${interval} market candles.` }));
      return;
    }
    const data = await res.json();
    const tickerCandles = (data.candles ?? []) as Candle[];
    const benchmarkCandles = (data.compare?.candles ?? []) as Candle[];
    setCandlesByKey((prev) => ({ ...prev, [cacheKey]: tickerCandles }));
    setComparisonCandlesByKey((prev) => ({
      ...prev,
      [comparisonCacheKey]: {
        ticker: tickerCandles,
        benchmark: benchmarkCandles,
        compareError: data.compareError ?? (benchmarkCandles.length > 0 ? null : `Unable to load ${benchmark} comparison candles.`),
      },
    }));
  }

  async function ensureStaticCandles(trade: ClosedTrade, interval: ChartInterval) {
    const cacheKey = `${trade.groupKey}:static:${interval}`;
    if (staticCandlesByKey[cacheKey]) return;

    const url = new URL("/api/market/candles", window.location.origin);
    url.searchParams.set("symbol", trade.symbol);
    url.searchParams.set("timeframe", interval);
    const intervalSeconds = INTERVAL_SECONDS[interval];
    const contextBars = STATIC_CONTEXT_BARS[interval];
    let limit = 1200;

    if (trade.executions.length > 0) {
      const execTimes = trade.executions.map((execution) => Math.floor(new Date(execution.executedAt).getTime() / 1000));
      const minExec = Math.min(...execTimes);
      const maxExec = Math.max(...execTimes);
      const from = minExec - contextBars.before * intervalSeconds;
      const to = maxExec + contextBars.after * intervalSeconds;
      const spanBars = Math.max(1, Math.ceil((to - from) / intervalSeconds));
      limit = Math.min(5000, Math.max(300, spanBars + 20));
      url.searchParams.set("from", String(from));
      url.searchParams.set("to", String(to));
    }
    url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString());
    if (!res.ok) {
      setChartStatus((prev) => ({
        ...prev,
        [cacheKey]: `Unable to load static ${interval} fallback candles from free data sources.`,
      }));
      return;
    }

    const data = await res.json();
    const candles = (data.candles ?? []) as Candle[];
    if (candles.length === 0) {
      setStaticCandlesByKey((prev) => ({ ...prev, [cacheKey]: [] }));
      return;
    }

    setStaticCandlesByKey((prev) => ({ ...prev, [cacheKey]: candles }));
  }

  function saveTradeNote(trade: ClosedTrade) {
    const content = tradeNotes[trade.groupKey] ?? "";
    startTransition(async () => {
      const res = await fetch("/api/notes/closed-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupKey: trade.groupKey, content }),
      });
      setStatus((prev) => ({ ...prev, [trade.groupKey]: res.ok ? "Saved notes." : "Failed to save trade note." }));
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold tracking-tight text-slate-950">Closed Trades</h3>
          <p className="text-sm text-slate-500">Expand any trade to inspect executions, market context, and review notes.</p>
        </div>
      </div>
      {groupedByDate.length === 0 && <p className="text-sm text-slate-500">No closed trades found in filter range.</p>}

      {groupedByDate.map(({ date, rows, monthLabel, startsNewMonth }) => (
        <div key={date} className="space-y-3">
          {startsNewMonth && (
            <div className="sticky top-0 z-10 flex items-center gap-3 bg-[#f7f9fc]/95 px-1 py-2 backdrop-blur">
              <div className="h-px flex-1 bg-slate-300/80" />
              <p className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-700 shadow-sm">
                {monthLabel}
              </p>
              <div className="h-px flex-1 bg-slate-300/80" />
            </div>
          )}
          <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] shadow-[0_18px_40px_-30px_rgba(15,23,42,0.28)]">
            <div className="border-b border-sky-100 bg-[linear-gradient(90deg,rgba(14,165,233,0.14),rgba(8,145,178,0.05))] px-5 py-3 text-sm font-semibold text-sky-950">
              {date}
            </div>
            <div className="divide-y divide-slate-200">
              {rows.map((trade) => {
              const open = expanded === trade.groupKey;
              const interval = intervalByKey[trade.groupKey] ?? "1d";
              const benchmark = benchmarkByKey[trade.groupKey] ?? "SPY";
              const executionRows = open ? [...trade.executions].sort((a, b) => (a.executedAt < b.executedAt ? 1 : -1)) : [];
              const allCandles = open ? candlesByKey[`${trade.groupKey}:${interval}`] ?? [] : [];
              const comparisonCandles = open ? comparisonCandlesByKey[`${trade.groupKey}:${interval}:${benchmark}`] : undefined;
              const benchmarkCandles = comparisonCandles?.benchmark ?? [];
              const relativeMetrics: RelativeStrengthMetrics | null = open
                ? computeRelativeStrengthMetrics({
                    avgEntryPrice: trade.avgEntryPrice,
                    avgExitPrice: trade.avgExitPrice,
                    direction: trade.direction,
                    openTime: trade.openTime,
                    closeTime: trade.closeTime,
                    benchmarkCandles,
                  })
                : null;
              const staticFallbackCandles = open ? staticCandlesByKey[`${trade.groupKey}:static:${interval}`] ?? [] : [];
              const alignmentInputs = open ? toAlignmentInputs(trade.executions) : [];
              const alignmentOffsetSeconds = open ? inferExecutionOffsetSeconds(alignmentInputs, allCandles) : 0;
              const staticAlignmentOffsetSeconds = open
                ? inferExecutionOffsetSeconds(alignmentInputs, staticFallbackCandles)
                : 0;
              const executionsInLoadedRange = open ? executionTimestampsWithinLoadedRange(trade.executions, allCandles) : true;
              const markersInRange = open
                ? trade.executions.flatMap((exec) => {
                    const markerTime = alignExecutionToBarTime(exec.executedAt, allCandles, alignmentOffsetSeconds);
                    if (markerTime === null) return [];

                    const isBuy = exec.side === "BUY";
                    const color = isBuy ? "#16a34a" : "#dc2626";
                    const circleColor = isBuy ? "#0284c7" : "#ea580c";
                    const arrowPosition: "belowBar" | "aboveBar" = isBuy ? "belowBar" : "aboveBar";
                    const arrowShape: "arrowUp" | "arrowDown" = isBuy ? "arrowUp" : "arrowDown";
                    return [
                      {
                        time: markerTime,
                        position: "atPriceMiddle" as const,
                        color: circleColor,
                        shape: "circle" as const,
                        text: "",
                        price: exec.price,
                      },
                      {
                        time: markerTime,
                        position: arrowPosition,
                        color,
                        shape: arrowShape,
                        text: `${isBuy ? "B" : "S"} ${exec.quantity} @ ${exec.price.toFixed(2)}`,
                        price: exec.price,
                      },
                    ];
                  })
                : [];
              const staticMarkersInRange = open
                ? trade.executions.flatMap((exec) => {
                    const markerTime = alignExecutionToBarTime(
                      exec.executedAt,
                      staticFallbackCandles,
                      staticAlignmentOffsetSeconds,
                    );
                    if (markerTime === null) return [];

                    const isBuy = exec.side === "BUY";
                    const color = isBuy ? "#16a34a" : "#dc2626";
                    const circleColor = isBuy ? "#0284c7" : "#ea580c";
                    const arrowPosition: "belowBar" | "aboveBar" = isBuy ? "belowBar" : "aboveBar";
                    const arrowShape: "arrowUp" | "arrowDown" = isBuy ? "arrowUp" : "arrowDown";
                    return [
                      {
                        time: markerTime,
                        position: "atPriceMiddle" as const,
                        color: circleColor,
                        shape: "circle" as const,
                        text: "",
                        price: exec.price,
                      },
                      {
                        time: markerTime,
                        position: arrowPosition,
                        color,
                        shape: arrowShape,
                        text: `${isBuy ? "B" : "S"} ${exec.quantity} @ ${exec.price.toFixed(2)}`,
                        price: exec.price,
                      },
                    ];
                  })
                : [];
              const executionsInStaticLoadedRange = open
                ? executionTimestampsWithinLoadedRange(trade.executions, staticFallbackCandles)
                : true;

                return (
                  <div key={trade.groupKey} className="p-5">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-4 rounded-[24px] border border-slate-200/80 bg-white/70 px-4 py-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] hover:border-slate-300"
                      onClick={async () => {
                        const next = open ? null : trade.groupKey;
                        setExpanded(next);
                        if (!open) {
                          await Promise.all([ensureMarketCandles(trade, interval, benchmark), ensureStaticCandles(trade, interval)]);
                        }
                      }}
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-lg font-semibold tracking-tight text-slate-950">{trade.symbol}</p>
                          <Badge variant={trade.realizedPnl >= 0 ? "success" : "danger"}>{trade.realizedPnl >= 0 ? "Winner" : "Loser"}</Badge>
                        </div>
                        <p className="text-sm text-slate-500">
                          {trade.executions.length} executions | Opened {trade.openingQuantity} | Closed {trade.closingQuantity}
                        </p>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                          Commissions {formatCurrency(trade.totalCommission)} | Account {trade.accountCode}
                        </p>
                      </div>
                      <p className={trade.realizedPnl >= 0 ? "text-2xl font-semibold tracking-tight text-emerald-600" : "text-2xl font-semibold tracking-tight text-red-600"}>
                        {formatCurrency(trade.realizedPnl)}
                      </p>
                    </button>

                    {open && (
                      <div className="mt-5 space-y-5">
                        <details className="rounded-[24px] border border-slate-200/80 bg-white/80">
                          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-700">
                            Execution Details ({trade.executions.length})
                          </summary>
                          <div className="border-t border-slate-200/80 bg-white p-3">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Date</TableHead>
                                  <TableHead>Account</TableHead>
                                  <TableHead>Symbol</TableHead>
                                  <TableHead>Side</TableHead>
                                  <TableHead>Qty</TableHead>
                                  <TableHead>Price</TableHead>
                                  <TableHead>Notional</TableHead>
                                  <TableHead>Commission</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {executionRows.map((execution) => (
                                  <TableRow key={execution.id} className={sideRowClassName(execution.side)}>
                                    <TableCell>{formatExecutionDateTime(execution.executedAt)}</TableCell>
                                    <TableCell>{trade.accountCode}</TableCell>
                                    <TableCell>{trade.symbol}</TableCell>
                                    <TableCell>
                                      <Badge variant={sideBadgeVariant(execution.side)} className="min-w-16 justify-center">
                                        {execution.side}
                                      </Badge>
                                    </TableCell>
                                    <TableCell>{execution.quantity}</TableCell>
                                    <TableCell>{execution.price.toFixed(2)}</TableCell>
                                    <TableCell
                                      className={cn(
                                        "font-medium",
                                        execution.side === "BUY" ? "text-emerald-700" : "text-red-700",
                                      )}
                                    >
                                      {formatSignedNotional(execution.quantity, execution.price, execution.side)}
                                    </TableCell>
                                    <TableCell>{formatCurrency(execution.commission)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </details>

                        <div className="flex flex-wrap items-center gap-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Timeframe</span>
                            {CHART_INTERVALS.map((option) => (
                              <Button
                                key={option.value}
                                size="sm"
                                variant={interval === option.value ? "default" : "outline"}
                                onClick={async () => {
                                  setIntervalByKey((prev) => ({ ...prev, [trade.groupKey]: option.value }));
                                  await Promise.all([
                                    ensureMarketCandles(trade, option.value, benchmark),
                                    ensureStaticCandles(trade, option.value),
                                  ]);
                                }}
                              >
                                {option.label}
                              </Button>
                            ))}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Compare</span>
                            {BENCHMARK_SYMBOLS.map((option) => (
                              <Button
                                key={option}
                                size="sm"
                                variant={benchmark === option ? "default" : "outline"}
                                onClick={async () => {
                                  setBenchmarkByKey((prev) => ({ ...prev, [trade.groupKey]: option }));
                                  await ensureMarketCandles(trade, interval, option);
                                }}
                              >
                                {option}
                              </Button>
                            ))}
                          </div>
                        </div>
                        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.95fr)]">
                          <div className="space-y-4">
                            <BenchmarkComparisonChart
                              tickerSymbol={trade.symbol}
                              benchmarkSymbol={benchmark}
                              tickerCandles={comparisonCandles?.ticker ?? allCandles}
                              benchmarkCandles={benchmarkCandles}
                              height={220}
                            />
                            {comparisonCandles?.compareError && (
                              <p className="text-xs text-slate-500">{comparisonCandles.compareError}</p>
                            )}
                            <CandlestickWithMarkers
                              candles={allCandles}
                              markers={markersInRange}
                              height={620}
                              annotationStorageKey={`${trade.groupKey}:${interval}`}
                            />
                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-slate-700">Static Fallback ({interval}, Free Data)</p>
                              <CandlestickWithMarkers candles={staticFallbackCandles} markers={staticMarkersInRange} height={360} readOnly />
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="rounded-[24px] border border-slate-200/80 bg-white/85 p-5">
                              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Trade Summary</p>
                              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                                <div>
                                  <p className="text-xs text-slate-500">Date</p>
                                  <p className="text-sm font-medium text-slate-800">{trade.tradeDate}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-500">Account</p>
                                  <p className="text-sm font-medium text-slate-800">{trade.accountCode}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-500">Realized P&amp;L</p>
                                  <p className={trade.realizedPnl >= 0 ? "text-sm font-semibold text-emerald-600" : "text-sm font-semibold text-red-600"}>
                                    {formatCurrency(trade.realizedPnl)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-500">Commission</p>
                                  <p className="text-sm font-medium text-slate-800">{formatCurrency(trade.totalCommission)}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-500">Direction</p>
                                  <p className="text-sm font-medium text-slate-800">{trade.direction}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-500">Entry / Exit</p>
                                  <p className="text-sm font-medium text-slate-800">
                                    {trade.avgEntryPrice.toFixed(2)} / {trade.avgExitPrice.toFixed(2)}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-5 rounded-[20px] border border-slate-200/80 bg-slate-50/70 p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                  Relative Strength vs {benchmark}
                                </p>
                                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                                  <div>
                                    <p className="text-xs text-slate-500">{trade.symbol} move</p>
                                    <p className={cn("text-sm font-semibold", metricTone(relativeMetrics?.tickerMovePct ?? null))}>
                                      {formatPercent(relativeMetrics?.tickerMovePct ?? null)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-slate-500">{benchmark} move</p>
                                    <p className={cn("text-sm font-semibold", metricTone(relativeMetrics?.benchmarkMovePct ?? null))}>
                                      {formatPercent(relativeMetrics?.benchmarkMovePct ?? null)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-slate-500">Spread</p>
                                    <p className={cn("text-sm font-semibold", metricTone(relativeMetrics?.relativeSpreadPct ?? null))}>
                                      {formatPercent(relativeMetrics?.relativeSpreadPct ?? null)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-slate-500">Direction-adjusted</p>
                                    <p
                                      className={cn(
                                        "text-sm font-semibold",
                                        metricTone(relativeMetrics?.directionAdjustedSpreadPct ?? null),
                                      )}
                                    >
                                      {formatPercent(relativeMetrics?.directionAdjustedSpreadPct ?? null)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="rounded-[24px] border border-slate-200/80 bg-white/85 p-5">
                              <p className="mb-2 text-sm font-semibold text-slate-900">Notes</p>
                              <p className="mb-3 text-sm text-slate-500">Capture setup quality, decision clarity, and what to repeat.</p>
                              <RichTextEditor
                                value={tradeNotes[trade.groupKey] ?? ""}
                                onChange={(value) => setTradeNotes((prev) => ({ ...prev, [trade.groupKey]: value }))}
                                placeholder="Add setup quality, entry/exit rationale, and improvements."
                              />
                              <Button
                                size="sm"
                                className="mt-3"
                                disabled={pending}
                                onClick={() => saveTradeNote(trade)}
                              >
                                Save Notes
                              </Button>
                              {status[trade.groupKey] && <p className="mt-3 text-xs text-slate-600">{status[trade.groupKey]}</p>}
                            </div>
                          </div>
                        </div>
                        {!executionsInLoadedRange && (
                          <p className="text-xs text-slate-500">
                            Some execution markers are outside the currently loaded {interval} candle range.
                          </p>
                        )}
                        {!executionsInStaticLoadedRange && (
                          <p className="text-xs text-slate-500">
                            Some execution markers are outside the static daily fallback candle range.
                          </p>
                        )}
                        {chartStatus[`${trade.groupKey}:${interval}`] && (
                          <p className="text-xs text-slate-500">{chartStatus[`${trade.groupKey}:${interval}`]}</p>
                        )}
                        {chartStatus[`${trade.groupKey}:static:${interval}`] && (
                          <p className="text-xs text-slate-500">{chartStatus[`${trade.groupKey}:static:${interval}`]}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

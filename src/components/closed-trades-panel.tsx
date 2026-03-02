"use client";

import { useMemo, useState, useTransition } from "react";
import { CandlestickWithMarkers } from "@/components/candlestick-with-markers";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

type ClosedTrade = {
  groupKey: string;
  accountId: string;
  accountCode: string;
  symbol: string;
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

type Candle = { time: number; open: number; high: number; low: number; close: number };
type ChartInterval = "5m" | "1h" | "1d";

const CHART_INTERVALS: Array<{ value: ChartInterval; label: string }> = [
  { value: "5m", label: "5 minute" },
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
];

function inferBarIntervalSeconds(candles: Candle[]) {
  let interval = Number.POSITIVE_INFINITY;
  for (let i = 1; i < candles.length; i += 1) {
    const delta = candles[i].time - candles[i - 1].time;
    if (delta > 0 && delta < interval) {
      interval = delta;
    }
  }
  return Number.isFinite(interval) ? interval : 24 * 60 * 60;
}

function alignExecutionToBarTime(executedAt: string, candles: Candle[], offsetSeconds = 0) {
  if (candles.length === 0) return null;

  const targetTs = Math.floor(new Date(executedAt).getTime() / 1000) + offsetSeconds;
  const interval = inferBarIntervalSeconds(candles);
  const first = candles[0].time - interval;
  const last = candles[candles.length - 1].time + interval;

  if (targetTs < first || targetTs > last) {
    return null;
  }

  let left = 0;
  let right = candles.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const barTime = candles[mid].time;
    if (barTime === targetTs) return barTime;
    if (barTime < targetTs) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  const prevIdx = Math.max(0, right);
  const nextIdx = Math.min(candles.length - 1, left);

  const prev = candles[prevIdx];
  // Open-anchored bars: [bar, bar + interval)
  if (targetTs >= prev.time && targetTs < prev.time + interval) {
    return prev.time;
  }

  // Close-anchored bars: (bar - interval, bar]
  if (targetTs > prev.time - interval && targetTs <= prev.time) {
    return prev.time;
  }

  const next = candles[nextIdx];
  if (targetTs >= next.time && targetTs < next.time + interval) {
    return next.time;
  }
  if (targetTs > next.time - interval && targetTs <= next.time) {
    return next.time;
  }
  return null;
}

function inferExecutionOffsetSeconds(executedAtValues: string[], candles: Candle[]) {
  if (executedAtValues.length === 0 || candles.length === 0) return 0;

  const candidates: number[] = [];
  for (let seconds = -14 * 3600; seconds <= 14 * 3600; seconds += 30 * 60) {
    candidates.push(seconds);
  }

  let bestOffset = 0;
  let bestHits = -1;

  for (const candidate of candidates) {
    let hits = 0;
    for (const executedAt of executedAtValues) {
      if (alignExecutionToBarTime(executedAt, candles, candidate) !== null) {
        hits += 1;
      }
    }
    if (hits > bestHits || (hits === bestHits && Math.abs(candidate) < Math.abs(bestOffset))) {
      bestHits = hits;
      bestOffset = candidate;
    }
  }

  return bestOffset;
}

export function ClosedTradesPanel({ closedTrades }: { closedTrades: ClosedTrade[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [candlesByKey, setCandlesByKey] = useState<Record<string, Candle[]>>({});
  const [intervalByKey, setIntervalByKey] = useState<Record<string, ChartInterval>>({});
  const [tradeNotes, setTradeNotes] = useState<Record<string, string>>(
    Object.fromEntries(closedTrades.map((trade) => [trade.groupKey, trade.tradeNote])),
  );
  const [status, setStatus] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const groupedByDate = useMemo(() => {
    const map = new Map<string, ClosedTrade[]>();
    for (const row of closedTrades) {
      const list = map.get(row.tradeDate) ?? [];
      list.push(row);
      map.set(row.tradeDate, list);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [closedTrades]);

  async function ensureCandles(trade: ClosedTrade, interval: ChartInterval) {
    const cacheKey = `${trade.groupKey}:${interval}`;
    if (candlesByKey[cacheKey]) return;

    const url = new URL("/api/market/candles", window.location.origin);
    url.searchParams.set("symbol", trade.symbol);
    url.searchParams.set("timeframe", interval);
    url.searchParams.set("limit", "1200");
    if (interval === "5m" && trade.executions.length > 0) {
      const execTimes = trade.executions.map((execution) => Math.floor(new Date(execution.executedAt).getTime() / 1000));
      const minExec = Math.min(...execTimes);
      const maxExec = Math.max(...execTimes);
      const padding = 2 * 24 * 60 * 60;
      url.searchParams.set("from", String(minExec - padding));
      url.searchParams.set("to", String(maxExec + padding));
    }

    const res = await fetch(url.toString());
    if (!res.ok) {
      setStatus((prev) => ({ ...prev, [trade.groupKey]: `Unable to load ${interval} market candles.` }));
      return;
    }
    const data = await res.json();
    setCandlesByKey((prev) => ({ ...prev, [cacheKey]: data.candles ?? [] }));
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
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Closed Trades</h3>
      {groupedByDate.length === 0 && <p className="text-sm text-slate-500">No closed trades found in filter range.</p>}

      {groupedByDate.map(([date, rows]) => (
        <div key={date} className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold">{date}</div>
          <div className="divide-y divide-slate-200">
            {rows.map((trade) => {
              const open = expanded === trade.groupKey;
              const interval = intervalByKey[trade.groupKey] ?? "1d";
              const allCandles = candlesByKey[`${trade.groupKey}:${interval}`] ?? [];
              const alignmentOffsetSeconds = interval === "1d" ? 0 : inferExecutionOffsetSeconds(trade.executions.map((exec) => exec.executedAt), allCandles);
              const matchedExecutions = trade.executions.filter(
                (exec) => alignExecutionToBarTime(exec.executedAt, allCandles, alignmentOffsetSeconds) !== null,
              ).length;
              const markersInRange = trade.executions.flatMap((exec) => {
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
                    position: "inBar" as const,
                    color: circleColor,
                    shape: "circle" as const,
                    text: "",
                  },
                  {
                    time: markerTime,
                    position: arrowPosition,
                    color,
                    shape: arrowShape,
                    text: `${isBuy ? "B" : "S"} ${exec.quantity} @ ${exec.price.toFixed(2)}`,
                  },
                ];
              });

              return (
                <div key={trade.groupKey} className="p-4">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left"
                    onClick={async () => {
                      const next = open ? null : trade.groupKey;
                      setExpanded(next);
                      if (!open) {
                        await ensureCandles(trade, interval);
                      }
                    }}
                  >
                    <div>
                      <p className="font-medium">
                        {trade.accountCode} - {trade.symbol}
                      </p>
                      <p className="text-xs text-slate-500">
                        {trade.executions.length} executions | Commissions {formatCurrency(trade.totalCommission)}
                      </p>
                    </div>
                    <p className={trade.realizedPnl >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-600"}>
                      {formatCurrency(trade.realizedPnl)}
                    </p>
                  </button>

                  {open && (
                    <div className="mt-4 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {CHART_INTERVALS.map((option) => (
                          <Button
                            key={option.value}
                            size="sm"
                            variant={interval === option.value ? "default" : "outline"}
                            onClick={async () => {
                              setIntervalByKey((prev) => ({ ...prev, [trade.groupKey]: option.value }));
                              await ensureCandles(trade, option.value);
                            }}
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                      <CandlestickWithMarkers
                        candles={allCandles}
                        markers={markersInRange}
                        height={620}
                        annotationStorageKey={`${trade.groupKey}:${interval}`}
                      />
                      {matchedExecutions < trade.executions.length && (
                        <p className="text-xs text-slate-500">
                          Some execution markers are outside the currently loaded {interval} candle range.
                        </p>
                      )}

                      <div>
                        <p className="mb-2 text-sm font-medium">Notes</p>
                        <RichTextEditor
                          value={tradeNotes[trade.groupKey] ?? ""}
                          onChange={(value) => setTradeNotes((prev) => ({ ...prev, [trade.groupKey]: value }))}
                          placeholder="Add setup quality, entry/exit rationale, and improvements."
                        />
                        <Button
                          size="sm"
                          className="mt-2"
                          disabled={pending}
                          onClick={() => saveTradeNote(trade)}
                        >
                          Save Notes
                        </Button>
                      </div>

                      {status[trade.groupKey] && <p className="text-xs text-slate-600">{status[trade.groupKey]}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

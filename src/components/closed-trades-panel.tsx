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

function alignExecutionToBarTime(executedAt: string, candles: Candle[]) {
  if (candles.length === 0) return Math.floor(new Date(executedAt).getTime() / 1000);

  const targetTs = Math.floor(new Date(executedAt).getTime() / 1000);
  let fallback = candles[0].time;
  for (const candle of candles) {
    if (candle.time <= targetTs) {
      fallback = candle.time;
      continue;
    }
    break;
  }
  return fallback;
}

export function ClosedTradesPanel({ closedTrades }: { closedTrades: ClosedTrade[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [candlesByKey, setCandlesByKey] = useState<Record<string, Candle[]>>({});
  const [intervalByKey, setIntervalByKey] = useState<Record<string, ChartInterval>>({});
  const [dayNotes, setDayNotes] = useState<Record<string, string>>(
    Object.fromEntries(closedTrades.map((trade) => [`${trade.accountId}:${trade.tradeDate}`, trade.dayNote])),
  );
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
    const res = await fetch(
      `/api/market/candles?symbol=${encodeURIComponent(trade.symbol)}&timeframe=${interval}&limit=1200`,
    );
    if (!res.ok) {
      setStatus((prev) => ({ ...prev, [trade.groupKey]: `Unable to load ${interval} market candles.` }));
      return;
    }
    const data = await res.json();
    setCandlesByKey((prev) => ({ ...prev, [cacheKey]: data.candles ?? [] }));
  }

  function saveDayNote(trade: ClosedTrade) {
    const key = `${trade.accountId}:${trade.tradeDate}`;
    const content = dayNotes[key] ?? "";
    startTransition(async () => {
      const res = await fetch("/api/notes/day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: trade.accountId,
          date: trade.tradeDate,
          content,
        }),
      });
      setStatus((prev) => ({ ...prev, [trade.groupKey]: res.ok ? "Saved notes." : "Failed to save day note." }));
    });
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
              const markers = trade.executions.map((exec) => ({
                time: alignExecutionToBarTime(exec.executedAt, allCandles),
                position: exec.side === "BUY" ? "belowBar" : "aboveBar",
                color: exec.side === "BUY" ? "#16a34a" : "#dc2626",
                shape: exec.side === "BUY" ? "arrowUp" : "arrowDown",
                text: `${exec.side} ${exec.quantity} @ ${exec.price.toFixed(2)}`,
              })) as Array<{ time: number; position: "aboveBar" | "belowBar"; color: string; shape: "arrowUp" | "arrowDown"; text: string }>;

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
                      <CandlestickWithMarkers candles={allCandles} markers={markers} height={620} />

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <p className="mb-2 text-sm font-medium">Day Note</p>
                          <RichTextEditor
                            value={dayNotes[`${trade.accountId}:${trade.tradeDate}`] ?? ""}
                            onChange={(value) =>
                              setDayNotes((prev) => ({ ...prev, [`${trade.accountId}:${trade.tradeDate}`]: value }))
                            }
                            placeholder="Add market context, psychology notes, and rule adherence for this day."
                          />
                          <Button
                            size="sm"
                            className="mt-2"
                            disabled={pending}
                            onClick={() => saveDayNote(trade)}
                          >
                            Save Day Note
                          </Button>
                        </div>
                        <div>
                          <p className="mb-2 text-sm font-medium">Closed Trade Note</p>
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
                            Save Trade Note
                          </Button>
                        </div>
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

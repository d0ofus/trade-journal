"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState, useTransition } from "react";
import { Clock3, Save } from "lucide-react";
import { ClosedTradeChartWorkspace } from "@/components/closed-trade-chart-workspace";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";

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
  priceReturnPct: number | null;
  largestExecutionQuantity: number;
  largestExecutionNotional: number;
  notionalReturnPct: number | null;
  equityReturnPct: number | null;
  equityBaseline: number | null;
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

function formatDateLabel(tradeDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${tradeDate}T00:00:00.000Z`));
}

function formatTimeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatQuantity(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(value);
}

function formatOptionalCurrency(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return formatCurrency(value);
}

function formatHoldTime(openTime: string, closeTime: string) {
  const diffMs = Math.max(0, new Date(closeTime).getTime() - new Date(openTime).getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function metricTone(value: number | null) {
  if (value === null) return "text-slate-500";
  if (value > 0) return "text-emerald-600";
  if (value < 0) return "text-red-600";
  return "text-slate-700";
}

function sideBadgeVariant(side: "BUY" | "SELL") {
  return side === "BUY" ? "success" : "danger";
}

export function ClosedTradesPanel({ closedTrades }: { closedTrades: ClosedTrade[] }) {
  const sortedTrades = useMemo(
    () => [...closedTrades].sort((left, right) => right.closeTime.localeCompare(left.closeTime) || left.groupKey.localeCompare(right.groupKey)),
    [closedTrades],
  );
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(() => sortedTrades[0]?.groupKey ?? null);
  const [tradeNotes, setTradeNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (sortedTrades.length === 0) {
      setSelectedGroupKey(null);
      return;
    }
    if (!sortedTrades.some((trade) => trade.groupKey === selectedGroupKey)) {
      setSelectedGroupKey(sortedTrades[0].groupKey);
    }
  }, [selectedGroupKey, sortedTrades]);

  const selectedTrade = useMemo(
    () => sortedTrades.find((trade) => trade.groupKey === selectedGroupKey) ?? sortedTrades[0] ?? null,
    [selectedGroupKey, sortedTrades],
  );

  function saveTradeNote(trade: ClosedTrade) {
    const content = tradeNotes[trade.groupKey] ?? trade.tradeNote ?? "";
    startTransition(async () => {
      const res = await fetch("/api/notes/closed-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupKey: trade.groupKey, content }),
      });
      setStatus((prev) => ({ ...prev, [trade.groupKey]: res.ok ? "Saved." : "Save failed." }));
    });
  }

  if (sortedTrades.length === 0 || !selectedTrade) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold text-slate-900">No closed trades found.</p>
        <p className="mt-1 text-sm text-slate-500">Adjust the filters to review a different date range or symbol.</p>
      </section>
    );
  }

  const selectedNoteValue = tradeNotes[selectedTrade.groupKey] ?? selectedTrade.tradeNote ?? "";

  return (
    <section className="grid overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm xl:h-[calc(100vh-11.5rem)] xl:min-h-[720px] xl:grid-cols-[320px_minmax(0,1fr)_310px]">
      <aside className="min-h-0 border-b border-slate-200 bg-white xl:border-b-0 xl:border-r">
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Closed Trades</p>
            <p className="text-sm font-semibold text-slate-950">{sortedTrades.length.toLocaleString()} entries</p>
          </div>
          <span className="text-xs text-slate-500">Newest</span>
        </div>
        <div className="max-h-[460px] overflow-y-auto xl:h-[calc(100%-3.5rem)] xl:max-h-none">
          {sortedTrades.map((trade) => {
            const selected = trade.groupKey === selectedTrade.groupKey;
            const profitable = trade.realizedPnl >= 0;
            return (
              <button
                key={trade.groupKey}
                type="button"
                className={cn(
                  "block w-full border-b border-slate-200 border-l-4 px-3 py-3 text-left",
                  selected ? "border-l-teal-500 bg-cyan-50/80" : "border-l-transparent bg-white hover:bg-slate-50",
                )}
                onClick={() => setSelectedGroupKey(trade.groupKey)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-base font-semibold tracking-tight text-slate-950">{trade.symbol}</p>
                      <Badge variant={trade.direction === "LONG" ? "success" : "danger"} className="px-2 py-0.5 tracking-normal">
                        {trade.direction}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{formatDateLabel(trade.tradeDate)}</p>
                  </div>
                  <p className={cn("shrink-0 text-sm font-semibold", profitable ? "text-emerald-600" : "text-red-600")}>
                    {formatCurrency(trade.realizedPnl)}
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <Metric label="Entry / Exit" value={`${trade.avgEntryPrice.toFixed(2)} / ${trade.avgExitPrice.toFixed(2)}`} />
                  <Metric label="Executions" value={trade.executions.length.toString()} />
                  <Metric label="Return" value={formatPercent(trade.priceReturnPct)} valueClassName={metricTone(trade.priceReturnPct)} />
                  <Metric label="Result" value={profitable ? "Winner" : "Loser"} valueClassName={profitable ? "text-emerald-600" : "text-red-600"} />
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="min-w-0 overflow-auto bg-white">
        <ClosedTradeChartWorkspace trade={selectedTrade} />
      </main>

      <TradeInspector
        noteValue={selectedNoteValue}
        onNoteChange={(value) => setTradeNotes((prev) => ({ ...prev, [selectedTrade.groupKey]: value }))}
        onSave={() => saveTradeNote(selectedTrade)}
        pending={pending}
        status={status[selectedTrade.groupKey]}
        trade={selectedTrade}
      />
    </section>
  );
}

function Metric({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-slate-500">{label}</p>
      <p className={cn("truncate font-medium text-slate-900", valueClassName)}>{value}</p>
    </div>
  );
}

function SummaryItem({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 text-sm">
      <p className="text-slate-500">{label}</p>
      <p className={cn("text-right font-medium text-slate-900", valueClassName)}>{value}</p>
    </div>
  );
}

function TradeInspector({
  noteValue,
  onNoteChange,
  onSave,
  pending,
  status,
  trade,
}: {
  noteValue: string;
  onNoteChange: (value: string) => void;
  onSave: () => void;
  pending: boolean;
  status?: string;
  trade: ClosedTrade;
}) {
  const executionRows = [...trade.executions].sort((left, right) => left.executedAt.localeCompare(right.executedAt));

  return (
    <aside className="min-h-0 overflow-y-auto border-t border-slate-200 bg-white xl:border-l xl:border-t-0">
      <section className="border-b border-slate-200 p-4">
        <p className="text-xs font-semibold uppercase text-slate-500">Trade Summary</p>
        <div className="mt-3">
          <SummaryItem label="Symbol" value={trade.symbol} />
          <SummaryItem label="Direction" value={trade.direction} valueClassName={trade.direction === "LONG" ? "text-emerald-600" : "text-red-600"} />
          <SummaryItem label="Date" value={formatDateLabel(trade.tradeDate)} />
          <SummaryItem
            label="Realized P&L"
            value={formatCurrency(trade.realizedPnl)}
            valueClassName={trade.realizedPnl >= 0 ? "text-emerald-600" : "text-red-600"}
          />
          <SummaryItem label="Return" value={formatPercent(trade.priceReturnPct)} valueClassName={metricTone(trade.priceReturnPct)} />
          <SummaryItem label="Entry / Exit" value={`${trade.avgEntryPrice.toFixed(2)} / ${trade.avgExitPrice.toFixed(2)}`} />
          <SummaryItem label="Trade Time" value={`${formatTimeLabel(trade.openTime)} - ${formatTimeLabel(trade.closeTime)}`} />
          <SummaryItem label="Hold Time" value={formatHoldTime(trade.openTime, trade.closeTime)} />
          <SummaryItem label="Executions" value={trade.executions.length.toString()} />
          <SummaryItem label="Largest Size" value={formatQuantity(trade.largestExecutionQuantity)} />
          <SummaryItem label="Largest Notional" value={formatOptionalCurrency(trade.largestExecutionNotional)} />
          <SummaryItem label="Commission" value={formatCurrency(trade.totalCommission)} />
          <SummaryItem label="P&L / Equity" value={formatPercent(trade.equityReturnPct)} valueClassName={metricTone(trade.equityReturnPct)} />
        </div>
      </section>

      <section className="border-b border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Executions</p>
          <Clock3 className="h-4 w-4 text-slate-400" />
        </div>
        <div className="mt-3 space-y-3">
          {executionRows.map((execution) => (
            <div key={execution.id} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-3 text-sm">
              <span
                className={cn(
                  "mt-1.5 h-2.5 w-2.5 rounded-full",
                  execution.side === "BUY" ? "bg-emerald-500" : "bg-red-500",
                )}
              />
              <div className="min-w-0">
                <p className="font-medium text-slate-900">
                  {formatTimeLabel(execution.executedAt)} <span className="text-slate-400">|</span> {execution.side}
                </p>
                <p className="text-xs text-slate-500">Qty: {formatQuantity(execution.quantity)}</p>
              </div>
              <div className="text-right">
                <Badge variant={sideBadgeVariant(execution.side)} className="justify-center px-2 py-0.5 tracking-normal">
                  {execution.side}
                </Badge>
                <p className="mt-1 text-sm font-semibold text-slate-950">{execution.price.toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Notes</p>
          <Button type="button" size="sm" className="h-8 gap-2 rounded-lg" disabled={pending} onClick={onSave}>
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
        </div>
        <RichTextEditor value={noteValue} onChange={onNoteChange} placeholder="Setup, entry, exit, mistake, lesson..." />
        {status && <p className="mt-3 text-xs text-slate-500">{status}</p>}
      </section>
    </aside>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { ClosedTradeChartWorkspace } from "@/components/closed-trade-chart-workspace";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

function metricTone(value: number | null) {
  if (value === null) return "text-slate-500";
  if (value > 0) return "text-emerald-600";
  if (value < 0) return "text-red-600";
  return "text-slate-700";
}

export function ClosedTradesPanel({ closedTrades }: { closedTrades: ClosedTrade[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
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
    const sortedEntries = [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

    return sortedEntries.map(([date, rows], index) => {
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
          <p className="text-sm text-slate-500">Review every closed trade with durable drawings, multi-chart layouts, and post-close bars.</p>
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
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
              {date}
            </div>
            <div className="divide-y divide-slate-200">
              {rows.map((trade) => {
                const open = expanded === trade.groupKey;
                const executionRows = open ? [...trade.executions].sort((a, b) => (a.executedAt < b.executedAt ? 1 : -1)) : [];

                return (
                  <div key={trade.groupKey} className="p-4">
                    <button
                      type="button"
                      className="grid w-full gap-3 rounded-lg border border-slate-200 bg-white px-4 py-4 text-left hover:border-slate-300 md:grid-cols-[minmax(0,1fr)_auto]"
                      onClick={() => setExpanded(open ? null : trade.groupKey)}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-lg font-semibold tracking-tight text-slate-950">{trade.symbol}</p>
                          <Badge variant={trade.direction === "LONG" ? "success" : "danger"}>{trade.direction}</Badge>
                          <Badge variant={trade.realizedPnl >= 0 ? "success" : "danger"}>{trade.realizedPnl >= 0 ? "Winner" : "Loser"}</Badge>
                        </div>
                        <div className="mt-2 grid gap-2 text-sm text-slate-500 sm:grid-cols-2 xl:grid-cols-4">
                          <span>{trade.executions.length} executions</span>
                          <span>Opened {formatQuantity(trade.openingQuantity)}</span>
                          <span>Closed {formatQuantity(trade.closingQuantity)}</span>
                          <span>Account {trade.accountCode}</span>
                        </div>
                      </div>
                      <div className="text-left md:text-right">
                        <p className={trade.realizedPnl >= 0 ? "text-2xl font-semibold tracking-tight text-emerald-600" : "text-2xl font-semibold tracking-tight text-red-600"}>
                          {formatCurrency(trade.realizedPnl)}
                        </p>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                          {trade.avgEntryPrice.toFixed(2)} / {trade.avgExitPrice.toFixed(2)}
                        </p>
                      </div>
                    </button>

                    {open && (
                      <div className="mt-4 space-y-4">
                        <details className="rounded-lg border border-slate-200 bg-white">
                          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">
                            Execution Details ({trade.executions.length})
                          </summary>
                          <div className="overflow-x-auto border-t border-slate-200 bg-white p-3">
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

                        <ClosedTradeChartWorkspace trade={trade} />

                        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                          <div className="rounded-lg border border-slate-200 bg-white p-5">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Trade Summary</p>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <SummaryItem label="Date" value={trade.tradeDate} />
                              <SummaryItem label="Account" value={trade.accountCode} />
                              <SummaryItem label="Realized P&L" value={formatCurrency(trade.realizedPnl)} valueClassName={trade.realizedPnl >= 0 ? "text-emerald-600" : "text-red-600"} />
                              <SummaryItem label="Trade Return" value={formatPercent(trade.priceReturnPct)} valueClassName={metricTone(trade.priceReturnPct)} />
                              <SummaryItem label="Commission" value={formatCurrency(trade.totalCommission)} />
                              <SummaryItem label="Direction" value={trade.direction} />
                              <SummaryItem label="Entry / Exit" value={`${trade.avgEntryPrice.toFixed(2)} / ${trade.avgExitPrice.toFixed(2)}`} />
                              <SummaryItem label="Largest Size" value={formatQuantity(trade.largestExecutionQuantity)} />
                              <SummaryItem label="Largest Notional" value={formatOptionalCurrency(trade.largestExecutionNotional)} />
                              <SummaryItem label="P&L / Peak Notional" value={formatPercent(trade.notionalReturnPct)} valueClassName={metricTone(trade.notionalReturnPct)} />
                              <SummaryItem label="P&L / Equity" value={formatPercent(trade.equityReturnPct)} valueClassName={metricTone(trade.equityReturnPct)} />
                              <SummaryItem label="Equity Baseline" value={formatOptionalCurrency(trade.equityBaseline)} />
                            </div>
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-white p-5">
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

function SummaryItem({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cn("text-sm font-medium text-slate-800", valueClassName)}>{value}</p>
    </div>
  );
}

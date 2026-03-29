import { Suspense } from "react";
import Link from "next/link";
import { ArrowDownToLine, CandlestickChart } from "lucide-react";
import { ClosedTradesPanel } from "@/components/closed-trades-panel";
import { TradesFilters } from "@/components/trades-filters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getClosedTrades, getTrades } from "@/lib/server/queries";
import { cn, formatCurrency, formatSignedNotional } from "@/lib/utils";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function sideBadgeVariant(side: "BUY" | "SELL") {
  return side === "BUY" ? "success" : "danger";
}

function sideRowClassName(side: "BUY" | "SELL") {
  return side === "BUY"
    ? "border-l-4 border-l-emerald-500 bg-emerald-50/40 hover:bg-emerald-50/70"
    : "border-l-4 border-l-red-500 bg-red-50/40 hover:bg-red-50/70";
}

export default async function TradesPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const page = Math.max(1, Number(typeof searchParams.page === "string" ? searchParams.page : "1") || 1);
  const filters = {
    from: typeof searchParams.from === "string" ? searchParams.from : undefined,
    to: typeof searchParams.to === "string" ? searchParams.to : undefined,
    symbol: typeof searchParams.symbol === "string" ? searchParams.symbol : undefined,
    side: typeof searchParams.side === "string" ? searchParams.side : undefined,
    tag: typeof searchParams.tag === "string" ? searchParams.tag : undefined,
    strategy: typeof searchParams.strategy === "string" ? searchParams.strategy : undefined,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Execution Ledger"
        title="Review every filled order and every closed idea."
        description="Filter by symbol, strategy, side, and date ranges without changing the underlying ingestion or PnL logic."
        actions={
          <>
            <Link className="rounded-2xl border border-white/14 bg-white/10 px-4 py-3 text-sm font-medium text-white backdrop-blur hover:bg-white/16" href="#closed-trades-section">
              <CandlestickChart className="mr-2 inline h-4 w-4" />
              Closed Trades
            </Link>
            <Link className="rounded-2xl border border-white/14 bg-white/10 px-4 py-3 text-sm font-medium text-white backdrop-blur hover:bg-white/16" href="#trades-list-section">
              <ArrowDownToLine className="mr-2 inline h-4 w-4" />
              Trades List
            </Link>
          </>
        }
      />

      <TradesFilters filters={filters} />

      <div id="closed-trades-section">
        <Suspense fallback={<ClosedTradesFallback />}>
          <ClosedTradesSection filters={filters} />
        </Suspense>
      </div>

      <Suspense fallback={<TradesTableFallback />}>
        <TradesTableSection filters={filters} page={page} />
      </Suspense>
    </div>
  );
}

async function ClosedTradesSection({
  filters,
}: {
  filters: {
    from?: string;
    to?: string;
    symbol?: string;
    side?: string;
    tag?: string;
    strategy?: string;
  };
}) {
  const closedTrades = await getClosedTrades(filters);
  return <ClosedTradesPanel closedTrades={closedTrades} />;
}

async function TradesTableSection({
  filters,
  page,
}: {
  filters: {
    from?: string;
    to?: string;
    symbol?: string;
    side?: string;
    tag?: string;
    strategy?: string;
  };
  page: number;
}) {
  const trades = await getTrades({ ...filters, page, pageSize: 50 });
  const tradeRows = trades.rows as Array<
    (typeof trades.rows)[number] & {
      account?: { ibkrAccount: string };
      instrument?: { symbol: string };
    }
  >;
  const baseParams = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) baseParams.set(key, value);
  });

  const pageHref = (target: number) => {
    const params = new URLSearchParams(baseParams.toString());
    params.set("page", String(target));
    return `/trades?${params.toString()}`;
  };

  const pageNumbers: number[] = [];
  const pageWindow = 2;
  const startPage = Math.max(1, trades.page - pageWindow);
  const endPage = Math.min(trades.totalPages, trades.page + pageWindow);
  for (let current = startPage; current <= endPage; current += 1) {
    pageNumbers.push(current);
  }

  return (
    <Card id="trades-list-section" className="overflow-hidden">
      <CardContent className="pt-6">
        <div className="mb-4 flex justify-end">
          <Link className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white" href="#closed-trades-section">
            Back To Closed Trades
          </Link>
        </div>
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
              <TableHead>Fees</TableHead>
              <TableHead>Total Cost</TableHead>
              <TableHead>Realized</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tradeRows.map((trade) => (
              <TableRow key={trade.id} className={sideRowClassName(trade.side)}>
                <TableCell>{trade.executedAt.toISOString().replace("T", " ").slice(0, 16)}</TableCell>
                <TableCell>{trade.account?.ibkrAccount ?? trade.accountId}</TableCell>
                <TableCell>{trade.instrument?.symbol ?? trade.instrumentId}</TableCell>
                <TableCell>
                  <Badge variant={sideBadgeVariant(trade.side)} className="min-w-16 justify-center">
                    {trade.side}
                  </Badge>
                </TableCell>
                <TableCell>{trade.quantity}</TableCell>
                <TableCell>{trade.price.toFixed(2)}</TableCell>
                <TableCell className={cn("font-medium", trade.side === "BUY" ? "text-emerald-700" : "text-red-700")}>
                  {formatSignedNotional(trade.quantity, trade.price, trade.side)}
                </TableCell>
                <TableCell>{formatCurrency(trade.commission)}</TableCell>
                <TableCell>{formatCurrency(trade.fees)}</TableCell>
                <TableCell>{formatCurrency(trade.commissionTotal)}</TableCell>
                <TableCell className={trade.realizedPnl >= 0 ? "text-emerald-600" : "text-red-600"}>
                  {formatCurrency(trade.realizedPnl)}
                </TableCell>
                <TableCell>
                  <Link className="font-medium text-sky-700 hover:text-sky-800 hover:underline" href={`/trade/${trade.id}`}>
                    Open
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-5 flex flex-col gap-3 text-sm text-slate-600 lg:flex-row lg:items-center lg:justify-between">
          <p>
            Page {trades.page} of {trades.totalPages} | {trades.total} trades
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {trades.page > 1 ? (
              <Link className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 font-medium hover:bg-white" href={pageHref(1)}>
                Go to first
              </Link>
            ) : (
              <span className="rounded-2xl border border-slate-200 px-3 py-2 text-slate-400">Go to first</span>
            )}
            {trades.page > 1 ? (
              <Link className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 font-medium hover:bg-white" href={pageHref(trades.page - 1)}>
                Previous
              </Link>
            ) : (
              <span className="rounded-2xl border border-slate-200 px-3 py-2 text-slate-400">Previous</span>
            )}
            {startPage > 1 && <span className="px-1 text-slate-400">...</span>}
            {pageNumbers.map((pageNumber) =>
              pageNumber === trades.page ? (
                <span key={pageNumber} className="rounded-2xl border border-slate-900 bg-slate-900 px-3 py-2 font-semibold text-white">
                  {pageNumber}
                </span>
              ) : (
                <Link
                  key={pageNumber}
                  className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 font-medium hover:bg-white"
                  href={pageHref(pageNumber)}
                >
                  {pageNumber}
                </Link>
              ),
            )}
            {endPage < trades.totalPages && <span className="px-1 text-slate-400">...</span>}
            {trades.page < trades.totalPages ? (
              <Link className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 font-medium hover:bg-white" href={pageHref(trades.page + 1)}>
                Next
              </Link>
            ) : (
              <span className="rounded-2xl border border-slate-200 px-3 py-2 text-slate-400">Next</span>
            )}
            {trades.page < trades.totalPages ? (
              <Link className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 font-medium hover:bg-white" href={pageHref(trades.totalPages)}>
                Go to last
              </Link>
            ) : (
              <span className="rounded-2xl border border-slate-200 px-3 py-2 text-slate-400">Go to last</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ClosedTradesFallback() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Closed Trades</h3>
      <div className="h-40 animate-pulse rounded-[24px] border border-slate-200/80 bg-white/85" />
      <div className="h-40 animate-pulse rounded-[24px] border border-slate-200/80 bg-white/85" />
    </div>
  );
}

function TradesTableFallback() {
  return (
    <Card id="trades-list-section">
      <CardContent className="space-y-4 pt-6">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-200" />
        <div className="h-96 animate-pulse rounded-[24px] border border-slate-200/80 bg-white/85" />
      </CardContent>
    </Card>
  );
}

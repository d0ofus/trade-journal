import Link from "next/link";
import { ClosedTradesPanel } from "@/components/closed-trades-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getClosedTrades, getTrades } from "@/lib/server/queries";
import { formatCurrency } from "@/lib/utils";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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

  const trades = await getTrades({ ...filters, page, pageSize: 50 });
  const closedTrades = await getClosedTrades(filters);

  const baseParams = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) baseParams.set(key, value);
  });

  const pageHref = (target: number) => {
    const params = new URLSearchParams(baseParams.toString());
    params.set("page", String(target));
    return `/trades?${params.toString()}`;
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Trades</h2>
      <div className="flex flex-wrap gap-2">
        <Link className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50" href="#closed-trades-section">
          Closed Trades
        </Link>
        <Link className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50" href="#trades-list-section">
          Trades List
        </Link>
      </div>

      <div id="closed-trades-section">
        <ClosedTradesPanel closedTrades={closedTrades} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-6" method="get">
            <Input name="from" type="date" defaultValue={filters.from} />
            <Input name="to" type="date" defaultValue={filters.to} />
            <Input name="symbol" placeholder="Symbol" defaultValue={filters.symbol} />
            <Select name="side" defaultValue={filters.side ?? ""}>
              <option value="">All sides</option>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </Select>
            <Input name="tag" placeholder="Tag" defaultValue={filters.tag} />
            <Input name="strategy" placeholder="Strategy" defaultValue={filters.strategy} />
            <button type="submit" className="hidden" aria-hidden />
          </form>
        </CardContent>
      </Card>

      <Card id="trades-list-section">
        <CardContent className="pt-6">
          <div className="mb-4 flex justify-end">
            <Link className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50" href="#closed-trades-section">
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
                <TableHead>Commission</TableHead>
                <TableHead>Fees</TableHead>
                <TableHead>Total Cost</TableHead>
                <TableHead>Realized</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.rows.map((trade) => (
                <TableRow key={trade.id}>
                  <TableCell>{trade.executedAt.toISOString().replace("T", " ").slice(0, 16)}</TableCell>
                  <TableCell>{trade.account.ibkrAccount}</TableCell>
                  <TableCell>{trade.instrument.symbol}</TableCell>
                  <TableCell>{trade.side}</TableCell>
                  <TableCell>{trade.quantity}</TableCell>
                  <TableCell>{trade.price.toFixed(2)}</TableCell>
                  <TableCell>{formatCurrency(trade.commission)}</TableCell>
                  <TableCell>{formatCurrency(trade.fees)}</TableCell>
                  <TableCell>{formatCurrency(trade.commissionTotal)}</TableCell>
                  <TableCell className={trade.realizedPnl >= 0 ? "text-emerald-600" : "text-red-600"}>
                    {formatCurrency(trade.realizedPnl)}
                  </TableCell>
                  <TableCell>
                    <Link className="text-blue-600 hover:underline" href={`/trade/${trade.id}`}>
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <p>
              Page {trades.page} of {trades.totalPages} | {trades.total} trades
            </p>
            <div className="flex items-center gap-2">
              {trades.page > 1 ? (
                <Link className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50" href={pageHref(trades.page - 1)}>
                  Previous
                </Link>
              ) : (
                <span className="rounded border border-slate-200 px-3 py-1 text-slate-400">Previous</span>
              )}
              {trades.page < trades.totalPages ? (
                <Link className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50" href={pageHref(trades.page + 1)}>
                  Next
                </Link>
              ) : (
                <span className="rounded border border-slate-200 px-3 py-1 text-slate-400">Next</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

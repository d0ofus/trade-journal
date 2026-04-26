import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOpenPositionAccounts, getPositions } from "@/lib/server/queries";
import { formatCurrency } from "@/lib/utils";

const DEFAULT_ACCOUNT_CODE = "U10263280";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function resolveActiveAccount(
  requestedAccount: string | undefined,
  accountFilters: Array<{ accountCode: string; count: number }>,
) {
  if (accountFilters.length === 0) return "all";
  if (requestedAccount === "all") return "all";
  if (requestedAccount && accountFilters.some((account) => account.accountCode === requestedAccount)) {
    return requestedAccount;
  }
  if (accountFilters.some((account) => account.accountCode === DEFAULT_ACCOUNT_CODE)) {
    return DEFAULT_ACCOUNT_CODE;
  }
  return accountFilters[0].accountCode;
}

export default async function PositionsPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const requestedAccount = typeof searchParams.account === "string" ? searchParams.account : undefined;
  const accountFilters = await getOpenPositionAccounts();
  const activeAccount = resolveActiveAccount(requestedAccount, accountFilters);
  const isAllAccounts = activeAccount === "all";
  const positions = await getPositions(isAllAccounts ? undefined : activeAccount);
  const openPositionCount = accountFilters.reduce((total, account) => total + account.count, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Live Exposure"
        title="Monitor open positions with cleaner risk visibility."
        description="The position table is unchanged in behavior, but now reads like a portfolio product instead of a raw admin screen."
      />
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200/80">
          <CardTitle className="text-base">Open Positions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap gap-2" aria-label="Open position account filters">
            <Link
              href="/positions?account=all"
              aria-current={isAllAccounts ? "page" : undefined}
              className={buttonVariants({ size: "sm", variant: isAllAccounts ? "default" : "outline" })}
            >
              All ({openPositionCount})
            </Link>
            {accountFilters.map((account) => {
              const isActive = activeAccount === account.accountCode;
              return (
                <Link
                  key={account.accountCode}
                  href={`/positions?account=${encodeURIComponent(account.accountCode)}`}
                  aria-current={isActive ? "page" : undefined}
                  className={buttonVariants({ size: "sm", variant: isActive ? "default" : "outline" })}
                >
                  {account.accountCode} ({account.count})
                </Link>
              );
            })}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Avg Cost</TableHead>
                <TableHead>Unrealized PnL</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                    No open positions found.
                  </TableCell>
                </TableRow>
              ) : (
                positions.map((position) => {
                  const note = position.instrument.symbolNotes.find((symbolNote) => symbolNote.accountId === position.accountId);
                  return (
                    <TableRow key={position.id}>
                      <TableCell>{position.account.ibkrAccount}</TableCell>
                      <TableCell>{position.instrument.symbol}</TableCell>
                      <TableCell>{position.quantity}</TableCell>
                      <TableCell>{position.avgCost.toFixed(2)}</TableCell>
                      <TableCell className={(position.unrealizedPnl ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}>
                        {formatCurrency(position.unrealizedPnl ?? 0)}
                      </TableCell>
                      <TableCell>{note?.thesis ?? "-"}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

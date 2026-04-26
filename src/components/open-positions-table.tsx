"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";

type OpenPosition = {
  id: string;
  accountId: string;
  quantity: number;
  avgCost: number;
  unrealizedPnl: number | null;
  account: {
    ibkrAccount: string;
  };
  instrument: {
    symbol: string;
    symbolNotes: Array<{
      accountId: string;
      thesis: string;
    }>;
  };
};

type AccountFilter = {
  accountCode: string;
  count: number;
};

function buildAccountFilters(positions: OpenPosition[]) {
  const accountCounts = new Map<string, AccountFilter>();
  for (const position of positions) {
    const accountCode = position.account.ibkrAccount;
    const existing = accountCounts.get(accountCode);
    if (existing) {
      existing.count += 1;
    } else {
      accountCounts.set(accountCode, { accountCode, count: 1 });
    }
  }

  return [...accountCounts.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

function resolveActiveAccount(
  requestedAccount: string | undefined,
  accountFilters: AccountFilter[],
  defaultAccountCode: string,
) {
  if (accountFilters.length === 0) return "all";
  if (requestedAccount === "all") return "all";
  if (requestedAccount && accountFilters.some((account) => account.accountCode === requestedAccount)) {
    return requestedAccount;
  }
  if (accountFilters.some((account) => account.accountCode === defaultAccountCode)) {
    return defaultAccountCode;
  }
  return accountFilters[0].accountCode;
}

function accountUrl(accountCode: string) {
  if (accountCode === "all") return "/positions?account=all";
  return `/positions?account=${encodeURIComponent(accountCode)}`;
}

export function OpenPositionsTable({
  positions,
  initialAccount,
  defaultAccountCode,
}: {
  positions: OpenPosition[];
  initialAccount?: string;
  defaultAccountCode: string;
}) {
  const accountFilters = useMemo(() => buildAccountFilters(positions), [positions]);
  const [activeAccount, setActiveAccount] = useState(() =>
    resolveActiveAccount(initialAccount, accountFilters, defaultAccountCode),
  );
  const isAllAccounts = activeAccount === "all";
  const filteredPositions = useMemo(
    () =>
      isAllAccounts
        ? positions
        : positions.filter((position) => position.account.ibkrAccount === activeAccount),
    [activeAccount, isAllAccounts, positions],
  );

  function selectAccount(accountCode: string) {
    const nextAccount = resolveActiveAccount(accountCode, accountFilters, defaultAccountCode);
    setActiveAccount(nextAccount);
    window.history.replaceState(null, "", accountUrl(nextAccount));
  }

  return (
    <>
      <div className="flex flex-wrap gap-2" aria-label="Open position account filters">
        <Button
          type="button"
          size="sm"
          variant={isAllAccounts ? "default" : "outline"}
          aria-pressed={isAllAccounts}
          onClick={() => selectAccount("all")}
        >
          All ({positions.length})
        </Button>
        {accountFilters.map((account) => {
          const isActive = activeAccount === account.accountCode;
          return (
            <Button
              key={account.accountCode}
              type="button"
              size="sm"
              variant={isActive ? "default" : "outline"}
              aria-pressed={isActive}
              onClick={() => selectAccount(account.accountCode)}
            >
              {account.accountCode} ({account.count})
            </Button>
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
          {filteredPositions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                No open positions found.
              </TableCell>
            </TableRow>
          ) : (
            filteredPositions.map((position) => {
              const note = position.instrument.symbolNotes.find(
                (symbolNote) => symbolNote.accountId === position.accountId,
              );
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
    </>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPositions } from "@/lib/server/queries";
import { formatCurrency } from "@/lib/utils";

export default async function PositionsPage() {
  const positions = await getPositions();

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
        <CardContent className="pt-6">
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
              {positions.map((position) => {
                const note = position.instrument.symbolNotes[0];
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
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPositions } from "@/lib/server/queries";
import { formatCurrency } from "@/lib/utils";

export default async function PositionsPage() {
  const positions = await getPositions();

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Positions</h2>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open Positions</CardTitle>
        </CardHeader>
        <CardContent>
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

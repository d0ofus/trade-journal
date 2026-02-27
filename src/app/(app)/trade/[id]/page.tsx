import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTradeDetail } from "@/lib/server/queries";
import { formatCurrency } from "@/lib/utils";

export default async function TradeDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const detail = await getTradeDetail(params.id);

  if (!detail) {
    notFound();
  }

  const { execution, relatedExecutions, pnl } = detail;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Trade Detail</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {execution.instrument.symbol} {execution.side} {execution.quantity} @ {execution.price.toFixed(2)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Date: {execution.executedAt.toISOString().replace("T", " ").slice(0, 16)}</p>
          <p>Account: {execution.account.ibkrAccount}</p>
          <p>Commission + Fees: {formatCurrency(execution.commission + execution.fees)}</p>
          <p>Realized PnL: {formatCurrency(pnl?.realizedPnl ?? 0)}</p>
          <div className="space-x-1">
            {execution.tags.map((tag) => (
              <Badge key={tag.tagId} variant="outline">
                {tag.tag.name}
              </Badge>
            ))}
          </div>
          <p>Note: {execution.tradeNote?.content ?? "No note."}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Related Executions (Same Symbol + Account)</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {relatedExecutions.map((item) => (
              <li key={item.id}>
                {item.executedAt.toISOString().replace("T", " ").slice(0, 16)} | {item.side} {item.quantity} @
                {" "}
                {item.price.toFixed(2)}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

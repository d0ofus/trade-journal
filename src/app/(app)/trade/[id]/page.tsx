import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getTradeDetail } from "@/lib/server/queries";
import { formatCurrency } from "@/lib/utils";

export default async function TradeDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const detail = await getTradeDetail(params.id);

  if (!detail) {
    notFound();
  }

  const { execution, relatedExecutions, pnl } = detail as typeof detail & {
    execution: {
      instrument?: { symbol: string };
      account?: { ibkrAccount: string };
      tags?: Array<{ tagId: string; tag: { name: string } }>;
      tradeNote?: { content: string | null };
    } & typeof detail.execution;
  };
  const symbol = execution.instrument?.symbol ?? "Trade";
  const accountCode = execution.account?.ibkrAccount ?? execution.accountId;
  const tags = execution.tags ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Trade Detail"
        title={`${symbol} ${execution.side} ${execution.quantity} @ ${execution.price.toFixed(2)}`}
        description="Execution facts, related fills, and tags remain driven by the same trade detail query."
      />

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200/80">
          <CardTitle className="text-base">Execution Snapshot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-6 text-sm">
          <p>Date: {execution.executedAt.toISOString().replace("T", " ").slice(0, 16)}</p>
          <p>Account: {accountCode}</p>
          <p>Commission + Fees: {formatCurrency(execution.commission + execution.fees)}</p>
          <p>Realized PnL: {formatCurrency(pnl?.realizedPnl ?? 0)}</p>
          <div className="space-x-1">
            {tags.map((tag) => (
              <Badge key={tag.tagId} variant="outline">
                {tag.tag.name}
              </Badge>
            ))}
          </div>
          <p>Note: {execution.tradeNote?.content ?? "No note."}</p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200/80">
          <CardTitle className="text-base">Related Executions (Same Symbol + Account)</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <ul className="space-y-2 text-sm text-slate-700">
            {relatedExecutions.map((item) => (
              <li key={item.id} className="rounded-[18px] border border-slate-200/80 bg-white/80 px-4 py-3">
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

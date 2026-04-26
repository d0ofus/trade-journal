import { OpenPositionsTable } from "@/components/open-positions-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getPositions } from "@/lib/server/queries";

const DEFAULT_ACCOUNT_CODE = "U10263280";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PositionsPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const requestedAccount = typeof searchParams.account === "string" ? searchParams.account : undefined;
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
        <CardContent className="space-y-4 pt-6">
          <OpenPositionsTable
            positions={positions}
            initialAccount={requestedAccount}
            defaultAccountCode={DEFAULT_ACCOUNT_CODE}
          />
        </CardContent>
      </Card>
    </div>
  );
}

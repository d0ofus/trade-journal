import { StorageMonitor } from "@/components/storage-monitor";
import { MarketDataSettings } from "@/components/workstation/market-data-settings";
import { WorkstationShortcutSettings } from "@/components/workstation/shortcut-settings";
import { TimestampInterpretationSettings } from "@/components/workstation/timestamp-settings";
import { FlexRunButton } from "@/components/flex-run-button";
import { ImportHistoryList } from "@/components/import-history-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getSettingsData } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SettingsPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const historyCursor = typeof searchParams.historyCursor === "string" ? searchParams.historyCursor : null;
  const { accounts, importHistory } = await getSettingsData({
    historyCursor,
  });
  const olderHistoryHref = importHistory.pageInfo.nextCursor
    ? `/settings?historyCursor=${encodeURIComponent(importHistory.pageInfo.nextCursor)}`
    : null;
  const flexConfigured = Boolean(process.env.IBKR_FLEX_TOKEN && process.env.IBKR_FLEX_QUERY_ID);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Configuration and import controls in one polished workspace."
        description="Account references, Flex automation, and import history remain backed by the same data sources and routes."
      />

      {process.env.TRADES_WORKSTATION_ENABLED === "1" && <Card id="workstation-shortcuts">
        <CardHeader><CardTitle>Workstation · Keyboard shortcuts</CardTitle></CardHeader>
        <CardContent><WorkstationShortcutSettings /></CardContent>
      </Card>}
      {process.env.TRADES_WORKSTATION_ENABLED === "1" && <Card id="timestamp-interpretation"><CardHeader><CardTitle>Trade data · Timestamp interpretation</CardTitle></CardHeader><CardContent><TimestampInterpretationSettings /></CardContent></Card>}
      {process.env.TRADES_WORKSTATION_ENABLED === "1" && <Card id="market-data"><CardHeader><CardTitle>Trade data · Market data</CardTitle></CardHeader><CardContent><MarketDataSettings /></CardContent></Card>}
      <StorageMonitor />
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200/80">
          <CardTitle className="text-base">Accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-6 text-sm">
          {accounts.length === 0 && <p className="text-slate-500">No accounts imported yet.</p>}
          {accounts.map((account) => (
            <div key={account.id} className="rounded-[20px] border border-slate-200/80 bg-white/80 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
              <p className="font-medium text-slate-900">{account.name}</p>
              <p className="text-slate-600">{account.ibkrAccount}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200/80">
          <CardTitle className="text-base">IBKR Flex Auto Import</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-6 text-sm">
          <p className="text-slate-700">
            Status: {flexConfigured ? "Configured" : "Missing IBKR_FLEX_TOKEN / IBKR_FLEX_QUERY_ID env vars"}
          </p>
          <p className="text-slate-600">
            Scheduled endpoint: <code>/api/cron/flex-import</code> (protect with <code>CRON_SECRET</code>).
          </p>
          <FlexRunButton />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200/80">
          <CardTitle className="text-base">Import History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-6 text-sm">
          <ImportHistoryList
            page={importHistory}
            olderHref={olderHistoryHref}
            newestHref={historyCursor ? "/settings" : null}
          />
        </CardContent>
      </Card>
    </div>
  );
}

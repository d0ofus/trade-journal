import { format } from "date-fns";
import { FlexRunButton } from "@/components/flex-run-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSettingsData } from "@/lib/server/queries";

export default async function SettingsPage() {
  const { accounts, batches } = await getSettingsData();
  const flexConfigured = Boolean(process.env.IBKR_FLEX_TOKEN && process.env.IBKR_FLEX_QUERY_ID);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Settings</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {accounts.length === 0 && <p className="text-slate-500">No accounts imported yet.</p>}
          {accounts.map((account) => (
            <div key={account.id} className="rounded border border-slate-200 px-3 py-2">
              <p className="font-medium">{account.name}</p>
              <p className="text-slate-600">{account.ibkrAccount}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">IBKR Flex Auto Import</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-slate-700">
            Status: {flexConfigured ? "Configured" : "Missing IBKR_FLEX_TOKEN / IBKR_FLEX_QUERY_ID env vars"}
          </p>
          <p className="text-slate-600">
            Scheduled endpoint: <code>/api/cron/flex-import</code> (protect with <code>CRON_SECRET</code>).
          </p>
          <FlexRunButton />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {batches.length === 0 && <p className="text-slate-500">No imports yet.</p>}
          {batches.map((batch) => (
            <div key={batch.id} className="rounded border border-slate-200 px-3 py-2">
              <p className="font-medium">{batch.filename}</p>
              <p className="text-slate-600">
                {batch.fileType} | seen {batch.rowsSeen}, imported {batch.rowsImported}, skipped {batch.rowsSkipped}
              </p>
              <p className="text-xs text-slate-500">{format(batch.importedAt, "EEE, MMM d, yyyy h:mm:ss a")}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

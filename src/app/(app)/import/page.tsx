import { ImportUploader } from "@/components/import-uploader";
import { ImportHistoryList } from "@/components/import-history-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getSettingsData } from "@/lib/server/queries";

export default async function ImportPage() {
  const { batches } = await getSettingsData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Data Pipeline"
        title="Import IBKR files through a polished review workflow."
        description="Preview mappings, validate structure, and commit imports with the exact same backend processing you already trust."
      />
      <ImportUploader />
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200/80">
          <CardTitle className="text-base">Recent Import History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-6 text-sm">
          <ImportHistoryList
            batches={batches.map((batch) => ({
              id: batch.id,
              filename: batch.filename,
              fileType: batch.fileType,
              rowsSeen: batch.rowsSeen,
              rowsImported: batch.rowsImported,
              rowsSkipped: batch.rowsSkipped,
              status: batch.status,
              errorMessage: batch.errorMessage ?? undefined,
              rawSha256: batch.rawSha256 ?? undefined,
              rawBytes: batch.rawBytes ?? undefined,
              rawStorageKey: batch.rawStorageKey ?? undefined,
              parserVersion: batch.parserVersion ?? undefined,
              positionSnapshotMode: batch.positionSnapshotMode ?? undefined,
              importedAt: batch.importedAt.toISOString(),
              notes: batch.notes ?? undefined,
              rowErrorCount: batch._count.rowErrors,
              rowErrors: batch.rowErrors,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

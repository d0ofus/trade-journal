import { ImportUploader } from "@/components/import-uploader";
import { ImportHistoryList } from "@/components/import-history-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getImportHistoryPage } from "@/lib/server/import-history-query";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ImportPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const historyCursor = typeof searchParams.historyCursor === "string" ? searchParams.historyCursor : null;
  const importHistory = await getImportHistoryPage({ cursor: historyCursor });
  const olderHref = importHistory.pageInfo.nextCursor
    ? `/import?historyCursor=${encodeURIComponent(importHistory.pageInfo.nextCursor)}`
    : null;

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
          <ImportHistoryList page={importHistory} olderHref={olderHref} newestHref={historyCursor ? "/import" : null} />
        </CardContent>
      </Card>
    </div>
  );
}

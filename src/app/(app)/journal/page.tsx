import { Suspense } from "react";
import { JournalWorkspace } from "@/components/journal-workspace";
import { PageHeader } from "@/components/ui/page-header";
import {
  getJournalEntry,
  getJournalAnalytics,
  listJournalEntries,
  listJournalPlaybooks,
  listJournalReviews,
  listJournalTags,
} from "@/lib/server/journal";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function JournalPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const entryId = typeof searchParams.entryId === "string" ? searchParams.entryId : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Trade-Idea Journal"
        title="Review ideas before they become executions."
        description="Capture non-executed setups, macro context, peer behavior, chart screenshots, and lessons for your playbook."
      />
      <Suspense key={entryId ?? "journal"} fallback={<div className="h-96 animate-pulse rounded-[28px] border border-slate-200/80 bg-white/85" />}>
        <JournalPageContent entryId={entryId} />
      </Suspense>
    </div>
  );
}

async function JournalPageContent({ entryId }: { entryId: string | null }) {
  const initialNowIso = new Date().toISOString();
  const [entries, tags, playbooks, analytics, reviews, selectedEntry] = await Promise.all([
    listJournalEntries({ limit: 100 }),
    listJournalTags(),
    listJournalPlaybooks({ includeArchived: true }),
    getJournalAnalytics(),
    listJournalReviews(),
    entryId ? getJournalEntry(entryId) : Promise.resolve(null),
  ]);
  const initialEntries = selectedEntry && !entries.some((entry) => entry.id === selectedEntry.id) ? [selectedEntry, ...entries] : entries;
  return (
    <JournalWorkspace
      initialAnalytics={analytics}
      initialEntries={initialEntries}
      initialPlaybooks={playbooks}
      initialReviews={reviews}
      initialSelectedEntryId={selectedEntry?.id ?? null}
      initialTags={tags}
      initialNowIso={initialNowIso}
    />
  );
}

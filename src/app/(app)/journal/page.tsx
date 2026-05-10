import { Suspense } from "react";
import { JournalWorkspace } from "@/components/journal-workspace";
import { PageHeader } from "@/components/ui/page-header";
import {
  getJournalAnalytics,
  listJournalEntries,
  listJournalPlaybooks,
  listJournalReviews,
  listJournalTags,
} from "@/lib/server/journal";

export default function JournalPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Trade-Idea Journal"
        title="Review ideas before they become executions."
        description="Capture non-executed setups, macro context, peer behavior, chart screenshots, and lessons for your playbook."
      />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[28px] border border-slate-200/80 bg-white/85" />}>
        <JournalPageContent />
      </Suspense>
    </div>
  );
}

async function JournalPageContent() {
  const [entries, tags, playbooks, analytics, reviews] = await Promise.all([
    listJournalEntries({ limit: 100 }),
    listJournalTags(),
    listJournalPlaybooks({ includeArchived: true }),
    getJournalAnalytics(),
    listJournalReviews(),
  ]);
  return (
    <JournalWorkspace
      initialAnalytics={analytics}
      initialEntries={entries}
      initialPlaybooks={playbooks}
      initialReviews={reviews}
      initialTags={tags}
    />
  );
}

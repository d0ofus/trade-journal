// Shared, serializable publication state. No credentials or Notion write logic.
export const NOTION_PRESENTATION_VERSION = 4;
export type TemplateWait = { startedAt: number; attempt: number; timedOut?: boolean; missing?: string[] };
export const TEMPLATE_WAIT_MS = 120_000;
export const templateCheckDelay = (attempt: number) => [2000, 4000, 8000, 10000][Math.min(Math.max(attempt, 0), 3)];
export const templateWaitExpired = (wait: TemplateWait, now = Date.now()) => now >= wait.startedAt + TEMPLATE_WAIT_MS;
export const templateRetryAt = (wait: TemplateWait, now = Date.now()) => new Date(Math.min(now + templateCheckDelay(wait.attempt), wait.startedAt + TEMPLATE_WAIT_MS));
export const templateTimeoutMessage = "Notion has not finished applying the expected template within two minutes, or its structure differs from the preview. Check the linked page, template and workspace block limit, then Resume/check progress. The same page will be checked; the template will not be reapplied.";

export type PublicationContext = { savedRevision: number; savedNoteUpdatedAt?: string | null; savedJournalUpdatedAt?: string | null; lastPublishedRevision: number | null; pageUrl: string | null; activeJobId: string | null; presentationVersion?: number };
export type PublicationReviewCompletion = { sourceRevision: number } & (
  { outcome: "superseded" } |
  { outcome: "updated" | "already-reviewed"; revision: number; noteUpdatedAt: string | null; journalUpdatedAt: string | null; previousNoteUpdatedAt: string | null; previousJournalUpdatedAt: string | null }
);
export type CompletedPublication = { state: string; revision: number; presentationVersion?: number; reviewCompletion?: PublicationReviewCompletion };
export const publicationCoveredRevision = (job: CompletedPublication) => job.state === "succeeded" && job.reviewCompletion && job.reviewCompletion.outcome !== "superseded" ? job.reviewCompletion.revision : job.revision;
export const notionPageUrl = (id?: string | null) => id && /^[0-9a-f-]{36}$/.test(id) ? new URL(`/${id.replace(/-/g, "")}`, "https://www.notion.so").href : null;
export const unfinishedPublication = (job: { state: string } | null) => !!job && !["preview", "succeeded"].includes(job.state);
export function publicationContentChanged(job: CompletedPublication | null, saved: PublicationContext) {
  if (!job) return true;
  if (unfinishedPublication(job)) return false;
  if (publicationCoveredRevision(job) !== saved.savedRevision) return true;
  const completion = job.state === "succeeded" ? job.reviewCompletion : undefined;
  return !!completion && (completion.outcome === "superseded" || completion.noteUpdatedAt !== saved.savedNoteUpdatedAt || completion.journalUpdatedAt !== saved.savedJournalUpdatedAt);
}

export const publicationFormatChanged = (job: CompletedPublication, saved: PublicationContext) =>
  (job.presentationVersion ?? 1) !== (saved.presentationVersion ?? (saved.pageUrl ? job.presentationVersion ?? 1 : NOTION_PRESENTATION_VERSION));
export const needsPublicationPreview = (job: CompletedPublication | null, saved: PublicationContext) =>
  publicationContentChanged(job, saved) || !!job && !unfinishedPublication(job) && publicationFormatChanged(job, saved);

export function waitForPublicationRetry(retryAt: string | Date | null, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("Publication continuation cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, Math.max(0, retryAt ? new Date(retryAt).getTime() - Date.now() : 0));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

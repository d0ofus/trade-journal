// Shared, serializable publication state. No credentials or Notion write logic.
export type TemplateWait = { startedAt: number; attempt: number; timedOut?: boolean; missing?: string[] };
export const TEMPLATE_WAIT_MS = 120_000;
export const templateCheckDelay = (attempt: number) => [2000, 4000, 8000, 10000][Math.min(Math.max(attempt, 0), 3)];
export const templateWaitExpired = (wait: TemplateWait, now = Date.now()) => now >= wait.startedAt + TEMPLATE_WAIT_MS;
export const templateRetryAt = (wait: TemplateWait, now = Date.now()) => new Date(Math.min(now + templateCheckDelay(wait.attempt), wait.startedAt + TEMPLATE_WAIT_MS));
export const templateTimeoutMessage = "Notion has not finished applying the expected template within two minutes, or its structure differs from the preview. Check the linked page, template and workspace block limit, then Resume/check progress. The same page will be checked; the template will not be reapplied.";

export type PublicationContext = { savedRevision: number; lastPublishedRevision: number | null; pageUrl: string | null; activeJobId: string | null };
export const notionPageUrl = (id?: string | null) => id && /^[0-9a-f-]{36}$/.test(id) ? new URL(`/${id.replace(/-/g, "")}`, "https://www.notion.so").href : null;
export const unfinishedPublication = (job: { state: string } | null) => !!job && !["preview", "succeeded"].includes(job.state);
export const needsPublicationPreview = (job: { state: string; revision: number } | null, savedRevision: number) => !job || !unfinishedPublication(job) && job.revision !== savedRevision;

export function waitForPublicationRetry(retryAt: string | Date | null, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("Publication continuation cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, Math.max(0, retryAt ? new Date(retryAt).getTime() - Date.now() : 0));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

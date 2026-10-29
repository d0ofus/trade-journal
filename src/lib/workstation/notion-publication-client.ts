import type { publicationStatus } from "@/lib/server/notion-publication-plan";
import { needsPublicationPreview, unfinishedPublication, waitForPublicationRetry, type PublicationContext } from "./notion-publication-state";

export type PublicationStatus = ReturnType<typeof publicationStatus>;
export type PublicationResult = { job: PublicationStatus | null; publication: PublicationContext; enabled: boolean };
type Observer = (result: PublicationResult) => void;
type Action = "preview" | "publish" | "resume";
class PublicationRequestError extends Error {
  constructor(message: string, public status: number, public retryAt?: string, public reason?: string) { super(message); }
}
async function request(groupKey: string, signal: AbortSignal, observe: Observer, body?: Record<string, unknown>): Promise<PublicationResult> {
  const response = await fetch(`/api/workstation/notion/publications${body ? "" : `?groupKey=${encodeURIComponent(groupKey)}`}`, {
    signal, cache: "no-store", ...body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, groupKey }) } : {},
  });
  const result = await response.json();
  if (!response.ok) throw new PublicationRequestError(result.error || "Notion request failed.", response.status, result.retryAt, result.reason);
  signal.throwIfAborted();
  observe(result);
  return result;
}
export async function openPublication(groupKey: string, signal: AbortSignal, observe: Observer, refreshPreview = false) {
  const result = await request(groupKey, signal, observe);
  // A saved revision alone cannot establish that Notion still matches it.
  // Opening always prepares a read-only preview; confirmation checks the page.
  void refreshPreview;
  // Inspect unfinished jobs without resuming their writes. Only a new explicit
  // confirmation (or Resume) can start server-side publishing work.
  if (!unfinishedPublication(result.job)) return request(groupKey, signal, observe, { action: "preview", revision: result.publication.savedRevision });
  return result;
}
export async function continuePublication(groupKey: string, action: Action, current: PublicationResult, signal: AbortSignal, observe: Observer, overwrite?: string) {
  let failures = 0;
  async function next(body?: Record<string, unknown>): Promise<PublicationResult> {
    while (true) {
      try { const value = await request(groupKey, signal, observe, body); failures = 0; return value; }
      catch (error) {
        if (signal.aborted || error instanceof PublicationRequestError && ![429, 500, 502, 503, 504].includes(error.status)) throw error;
        const busy = error instanceof PublicationRequestError && error.reason === "busy";
        const budget = error instanceof PublicationRequestError && error.reason === "budget";
        if (!busy && !budget && ++failures >= 5) throw error;
        await waitForPublicationRetry(error instanceof PublicationRequestError && error.retryAt || new Date(Date.now() + Math.min(30_000, 1000 * 2 ** failures)), signal);
        // A lost POST response must be inspected, not blindly repeated.
        // Busy responses are known not to have started the submitted step.
        if (!(error instanceof PublicationRequestError && error.status === 429)) body = undefined;
      }
    }
  }
  let result = await next({ action, ...action === "preview" ? { revision: current.publication.savedRevision } : { id: current.job?.id, ...overwrite ? { overwrite } : {} } });
  if (action === "preview") return result;
  while (result.job && ["ready", "running", "waiting"].includes(result.job.state)) {
    const active = result.job.state === "running" && !!result.job.leaseUntil && new Date(result.job.leaseUntil).getTime() > Date.now();
    await waitForPublicationRetry(active ? new Date(Date.now() + 2000) : result.job.retryAt, signal);
    result = await next(active ? undefined : { action: "resume", id: result.job.id });
  }
  if (result.job?.state === "succeeded" && needsPublicationPreview(result.job, result.publication)) {
    result = await request(groupKey, signal, observe, { action: "preview", revision: result.publication.savedRevision });
  }
  return result;
}

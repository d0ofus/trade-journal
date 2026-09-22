import type { publicationStatus } from "@/lib/server/notion-publication-plan";
import { needsPublicationPreview, unfinishedPublication, waitForPublicationRetry, type PublicationContext } from "./notion-publication-state";

export type PublicationStatus = ReturnType<typeof publicationStatus>;
export type PublicationResult = { job: PublicationStatus | null; publication: PublicationContext; enabled: boolean };
type Observer = (result: PublicationResult) => void;
type Action = "preview" | "publish" | "resume";
async function request(groupKey: string, signal: AbortSignal, observe: Observer, body?: Record<string, unknown>): Promise<PublicationResult> {
  const response = await fetch(`/api/workstation/notion/publications${body ? "" : `?groupKey=${encodeURIComponent(groupKey)}`}`, {
    signal, cache: "no-store", ...body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, groupKey }) } : {},
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Notion request failed.");
  signal.throwIfAborted();
  observe(result);
  return result;
}
export async function openPublication(groupKey: string, signal: AbortSignal, observe: Observer) {
  const result = await request(groupKey, signal, observe);
  // Inspect unfinished jobs without resuming their writes. Only a new explicit
  // confirmation (or Resume) can start server-side publishing work.
  if (!unfinishedPublication(result.job)) return request(groupKey, signal, observe, { action: "preview", revision: result.publication.savedRevision });
  return result;
}
export async function continuePublication(groupKey: string, action: Action, current: PublicationResult, signal: AbortSignal, observe: Observer) {
  let result = await request(groupKey, signal, observe, { action, ...action === "preview" ? { revision: current.publication.savedRevision } : { id: current.job?.id } });
  if (action === "preview") return result;
  while (result.job && ["ready", "waiting"].includes(result.job.state)) {
    await waitForPublicationRetry(result.job.retryAt, signal);
    result = await request(groupKey, signal, observe, { action: "resume", id: result.job.id });
  }
  if (result.job?.state === "succeeded" && needsPublicationPreview(result.job, result.publication.savedRevision)) {
    result = await request(groupKey, signal, observe, { action: "preview", revision: result.publication.savedRevision });
  }
  return result;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { continuePublication, openPublication, type PublicationResult } from "@/lib/workstation/notion-publication-client";
import { unfinishedPublication } from "@/lib/workstation/notion-publication-state";
import { ReviewDialog } from "./review-dialog";
import { EvidenceThumbnail } from "./evidence-preview";

export function NotionPublishDialog({ groupKey, revision, onClose }: { groupKey: string; revision: number; onClose: () => void }) {
  const [result, setResult] = useState<PublicationResult | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    void openPublication(groupKey, controller.signal, setResult)
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to prepare publication."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => { controller.abort(); request.current?.abort(); };
  }, [groupKey]);
  const job = result?.job, enabled = result?.enabled ?? false;
  const savedRevision = Math.max(revision, result?.publication.savedRevision ?? revision);
  const lastPublished = result?.publication.lastPublishedRevision;
  const pageUrl = result?.publication.pageUrl ?? job?.pageUrl;
  const pending = unfinishedPublication(job ?? null), newerEdits = !!job && savedRevision > job.revision;
  const retryAt = job?.retryAt;
  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [retryAt]);
  async function send(action: "preview" | "publish" | "resume") {
    if (busy) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      if (action === "preview" || !result) await openPublication(groupKey, controller.signal, setResult);
      else await continuePublication(groupKey, action, result, controller.signal, setResult);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Notion request failed."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <ReviewDialog title="Publish/update in Notion" onClose={onClose}>
    <p className="ws-help">Review the latest saved preview, then confirm to publish to the linked app-owned Notion page. Changes are not sent automatically. Manually created journals are not modified.</p>
    <p role="status">Saved revision {savedRevision} · Last published: {lastPublished == null ? "Not yet published" : `revision ${lastPublished}`}</p>
    {result && !enabled && <p role="status">Publishing is disabled until Notion permissions and live validation are complete. You can still prepare a preview.</p>}
    {error && <p role="alert">{error}</p>}
    {busy && !job && <p role="status">Preparing latest saved-review preview…</p>}
    {pageUrl && <a href={pageUrl} target="_blank" rel="noreferrer">Open app-owned Notion page</a>}
    {job && <>
      <p role="status">{pending ? "Publishing frozen" : job.state === "preview" ? "Preview" : "Published"} revision {job.revision} · {job.state}{busy && job.phase !== "template_wait" ? " · Working…" : ""}</p>
      {job.phase === "template_wait" && <p role="status">Waiting for Notion to apply the template…{!busy ? " Resume/check progress to continue." : " This page will be checked automatically."}</p>}
      {job.error && <p role="alert">{job.error}</p>}
      {job.phase === "template_timeout" && job.missingSections.length > 0 && <p>Sections not ready: {job.missingSections.join(", ")}</p>}
      {newerEdits && <p role="status">Newer saved edits in revision {savedRevision} are not included in this {pending ? "unfinished publication. Finish or resolve it first; a fresh preview will then be prepared for your confirmation." : "preview. Prepare the latest preview before confirming."}</p>}
      {job.state === "succeeded" && !newerEdits && <p role="status">This saved revision has already been published.</p>}
      {retryAt && new Date(retryAt).getTime() > now && <p>{busy ? "Next check" : "Resume"} after {new Date(retryAt).toLocaleTimeString()}.</p>}
      <h3>Properties</h3><dl className="ws-notion-preview-properties">{job.properties.map(item => <div key={item.name}><dt>{item.name}</dt><dd>{item.value}</dd></div>)}</dl>
      <h3>Section placement</h3>{job.sections.map(section => <details className="ws-template-section" key={section.key}><summary>{section.label}: {section.blocks} text blocks, {section.images} images{section.done ? " · Complete" : ""}</summary>
        {section.html && <div className="ws-notion-preview-text" dangerouslySetInnerHTML={{ __html: section.html }} />}
        {section.imageIds?.map(id => { const asset = job.assets?.find(asset => asset.id === id); return asset ? <figure key={id}>
          {/* Saved, size-validated embedded evidence; never a remote image URL. */}
          <EvidenceThumbnail evidence={{ id: asset.id, image: asset.image, asset: asset.asset, name: asset.caption, time: 0, revision: job.revision, timeframe: "" }} /><figcaption>{asset.caption}</figcaption>
        </figure> : null; })}
      </details>)}
      {job.omitted.length > 0 && <><h3>Kept in the app, not published</h3><ul>{job.omitted.map(item => <li key={item}>{item}</li>)}</ul></>}
      {job.errors.length > 0 && <><h3>Resolve before publishing</h3><ul>{job.errors.map(item => <li key={item}>{item}</li>)}</ul></>}
    </>}
    <div className="ws-export-actions">
      <button disabled={busy || pending} onClick={() => void send("preview")}>Refresh saved-review preview</button>
      {job?.state === "preview" && <button className="ws-primary" disabled={busy || !enabled || !!job.errors.length || job.revision !== savedRevision} onClick={() => void send("publish")}>Confirm {pageUrl ? "update" : "publish"} revision {job.revision}</button>}
      {pending && <button disabled={busy || !enabled || !!retryAt && new Date(retryAt).getTime() > now} onClick={() => void send("resume")}>Resume/check progress</button>}
    </div>
    <p className="ws-help">Closing pauses client-driven continuation; an already submitted server step may finish. Reopen to inspect or resume the same job.</p>
  </ReviewDialog>;
}

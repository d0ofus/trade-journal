"use client";
import { useEffect, useRef, useState } from "react";
import type { publicationStatus } from "@/lib/server/notion-publication-plan";
import { ReviewDialog } from "./review-dialog";
type Status = ReturnType<typeof publicationStatus>;
export function NotionPublishDialog({ groupKey, revision, onClose }: { groupKey: string; revision: number; onClose: () => void }) {
  const [job, setJob] = useState<Status | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [enabled, setEnabled] = useState(false);
  const request = useRef<AbortController | null>(null), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController(); request.current = controller;
    void fetch(`/api/workstation/notion/publications?groupKey=${encodeURIComponent(groupKey)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      if (mounted.current) { setJob(result.job); setEnabled(result.enabled); }
    }).catch(error => { if (!controller.signal.aborted && mounted.current) setError(error.message); });
    return () => { mounted.current = false; controller.abort(); request.current?.abort(); };
  }, [groupKey]);
  async function send(action: "preview" | "publish" | "resume") {
    if (busy) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      let nextAction = action;
      let id = job?.id;
      // Ordinary bounded steps continue only while this dialog is open. Errors,
      // cooldowns and conflicts always require an explicit Resume action.
      do {
        const response = await fetch("/api/workstation/notion/publications", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ action: nextAction, groupKey, ...nextAction === "preview" ? { revision } : { id } }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || "Notion request failed.");
        if (!mounted.current) return;
        setEnabled(result.enabled); setJob(result.job); id = result.job.id;
        if (nextAction === "preview" || !["ready", "waiting"].includes(result.job.state)) break;
        nextAction = "resume";
      } while (mounted.current && !controller.signal.aborted);
    } catch (error) { if (!controller.signal.aborted && mounted.current) setError(error instanceof Error ? error.message : "Notion request failed."); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <ReviewDialog title="Publish/update in Notion" onClose={onClose}>
    <p className="ws-help">Publish one saved revision into an app-owned Notion page. Existing manually created journals are not modified.</p>
    {!enabled && <p role="status">Publishing is disabled until Notion permissions and live validation are complete. You can still prepare a preview.</p>}
    {error && <p role="alert">{error}</p>}
    {job && <>
      <p role="status">Revision {job.revision} · {job.state}{busy ? " · Working…" : ""}</p>
      {job.error && <p role="alert">{job.error}</p>}
      {job.retryAt && <p>Resume after {new Date(job.retryAt).toLocaleString()}.</p>}
      {job.pageUrl && <a href={job.pageUrl} target="_blank" rel="noreferrer">Open app-owned Notion page</a>}
      <h3>Properties</h3><dl className="ws-notion-preview-properties">{job.properties.map(item => <div key={item.name}><dt>{item.name}</dt><dd>{item.value}</dd></div>)}</dl>
      <h3>Section placement</h3>{job.sections.map(section => <details className="ws-template-section" key={section.key}><summary>{section.label}: {section.blocks} text blocks, {section.images} images{section.done ? " · Complete" : ""}</summary>
        {section.html && <div className="ws-notion-preview-text" dangerouslySetInnerHTML={{ __html: section.html }} />}
        {section.imageIds?.map(id => { const asset = job.assets?.find(asset => asset.id === id); return asset ? <figure key={id}>
          {/* Saved, size-validated embedded evidence; never a remote image URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.image} alt={asset.caption} style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain" }} /><figcaption>{asset.caption}</figcaption>
        </figure> : null; })}
      </details>)}
      {job.omitted.length > 0 && <><h3>Kept in the app, not published</h3><ul>{job.omitted.map(item => <li key={item}>{item}</li>)}</ul></>}
      {job.errors.length > 0 && <><h3>Resolve before publishing</h3><ul>{job.errors.map(item => <li key={item}>{item}</li>)}</ul></>}
    </>}
    <div className="ws-export-actions">
      <button disabled={busy || !!job && !["preview", "succeeded"].includes(job.state)} onClick={() => void send("preview")}>Prepare saved-review preview</button>
      {job?.state === "preview" && <button className="ws-primary" disabled={busy || !enabled || !!job.errors.length || job.revision !== revision} onClick={() => void send("publish")}>Confirm publish revision {job.revision}</button>}
      {job && !["preview", "succeeded"].includes(job.state) && <button disabled={busy || !enabled || !!job.retryAt && new Date(job.retryAt).getTime() > Date.now()} onClick={() => void send("resume")}>Resume / check progress</button>}
    </div>
    <p className="ws-help">Closing pauses client-driven continuation; an already submitted server step may finish. Reopen to inspect or resume the same job.</p>
  </ReviewDialog>;
}

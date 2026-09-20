"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { ArrowUpRight, Check, Download, Plus } from "lucide-react";
import { documentSaveStatus, type useTradeDocument } from "./use-trade-document";
import { JournalSection, NotionReviewEditor } from "./notion-review-editor";
import { Review, Trade, TradeDocument, WorkspacePreferences } from "@/lib/workstation/types";
import type { ReviewSectionKey } from "@/lib/workstation/notion-template";
import type { PeerGroupSelection } from "./peer-groups";
import { SectionAttachments } from "./section-attachments";
import type { MarketMetrics } from "@/lib/workstation/market-metrics";
import { richPlain } from "@/lib/workstation/rich-text";
import { plainText } from "@/lib/workstation/export";
import { useJournalLayout } from "./use-template-layout";
import { ReviewDialog } from "./review-dialog";

const FormattedNote = dynamic(() => import("./rich-review-editors").then(m => m.FormattedNote), { ssr: false });
type Props = { onImage: (section: ReviewSectionKey) => void; getMetrics?: () => MarketMetrics | undefined; trade: Trade; document: TradeDocument; onChange: (update: (review: Review) => Review) => void; status: string; error: string; retry: () => void; reload: () => void; onSaveNext: () => void; saveNextShortcut: string; onEvidence: (section?: ReviewSectionKey) => void; onComparePeers: (selection: PeerGroupSelection) => void; onNotionExport: () => void; onNotionPublish?: () => void; preferences: WorkspacePreferences; onPreferences: (update: Partial<WorkspacePreferences>) => void; replay: number | null; mode: "demo" | "application"; notify: (message: string) => void };
export function ReviewEditor(p: Props) {
  const r = p.document.review, [details, setDetails] = useState(false), [tag, setTag] = useState(""), [customName, setCustomName] = useState(""), [templateName, setTemplateName] = useState("");
  const { layout } = useJournalLayout();
  const change = (patch: Partial<Review>) => p.onChange(current => ({ ...current, ...patch }));
  const legacyText = useMemo(() => typeof p.document.legacy === "string" ? plainText(p.document.legacy) : JSON.stringify(p.document.legacy, null, 2), [p.document.legacy]);
  const complete = [r.notion?.analysis.technicalPositive || r.setup, r.notion?.analysis.idealExecution || r.execution, r.takeaway].filter(v => richPlain(v ?? "")).length;
  const addTag = () => { if (!p.trade.stale && tag.trim() && !r.tags.includes(tag.trim())) change({ tags: [...r.tags, tag.trim()].slice(0, 30) }); setTag(""); };
  const archived = [...new Map([...layout.archived, ...r.notion?.layout?.sections ?? [], ...r.notion?.layout?.archived ?? []]
    .filter(section => !layout.sections.some(active => active.key === section.key)).map(section => [section.key, section])).values()];
  return <div className="ws-journal-content">
    {p.replay !== null && <p className="ws-replay-notice" role="note">Replay: you are editing the saved review. Existing notes and evidence may contain hindsight.</p>}
    <div className="ws-journal-intro"><div><span className="ws-eyebrow">TRADE REVIEW</span><h2>Trade journal</h2></div><span className="ws-review-progress">{complete}/3</span></div>
    <div className="ws-review-progress-track"><span style={{ width: `${complete / 3 * 100}%` }} /></div>
    <fieldset disabled={p.trade.stale} className="ws-review-controls">
      <div className="ws-journal-meta"><select aria-label="Review status" value={r.status} onChange={e => change({ status: e.target.value as Review["status"] })}>{["Not reviewed", "In progress", "Reviewed"].map(s => <option key={s}>{s}</option>)}</select><select aria-label="Review template" value={r.template} onChange={e => { const template = e.target.value; const preset = p.preferences.templates[template]; change(preset ? { ...preset, template } : { template }); if (template === "Detailed review") setDetails(true); }}><option>Quick review</option><option>Detailed review</option>{Object.keys(p.preferences.templates).map(name => <option key={name}>{name}</option>)}</select></div>
      <div className="ws-tags-label">Tags <span>Find patterns over time</span></div><div className="ws-tags">{r.tags.map(t => <button title={`Remove ${t}`} key={t} onClick={() => change({ tags: r.tags.filter(v => v !== t) })}>{t}<span>×</span></button>)}<input aria-label="Add review tag" value={tag} placeholder="+ Add tag" list="ws-tag-suggestions" maxLength={60} onChange={e => setTag(e.target.value)} onBlur={addTag} onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }} /><datalist id="ws-tag-suggestions">{["Breakout", "Relative strength", "Scale out", "Patience", "Late entry", "Trend continuation", "Reversal"].map(t => <option key={t}>{t}</option>)}</datalist></div>
    </fieldset>
    <button type="button" className="ws-deeper" onClick={() => setDetails(true)}>Review details <span>Previous fields & archived sections</span></button>
    <NotionReviewEditor {...p} />
    {details && <ReviewDialog title="Review details" onClose={() => setDetails(false)}>
      <p className="ws-help">Previous fields remain saved and editable here. They are not automatically published into unrelated Notion sections.</p>
      <fieldset disabled={p.trade.stale} className="ws-review-controls">
        <label className="ws-field"><span>Setup</span><input value={r.setup} onChange={e => change({ setup: e.target.value })} maxLength={10000} /></label>
        <label className="ws-field"><span>Execution</span><textarea value={r.execution} onChange={e => change({ execution: e.target.value })} rows={4} maxLength={10000} /></label>
        {([["thesis", "Thesis & market context"], ["exit", "Exit review"], ["mistake", "Mistake / improvement"], ["followUp", "Follow up"]] as const).map(([field, label]) => <label className="ws-field" key={field}><span>{label}</span><textarea rows={2} maxLength={10000} value={r[field]} onChange={e => change({ [field]: e.target.value })} /></label>)}
        <FormattedNote value={r.notes} onChange={notes => change({ notes })} />
        {Object.entries(r.custom).map(([name, value]) => <label className="ws-field" key={name}><span>{name}<button aria-label={`Remove field ${name}`} onClick={() => { const custom = { ...r.custom }; delete custom[name]; change({ custom }); }}>×</button></span><input value={value} maxLength={10000} onChange={e => change({ custom: { ...r.custom, [name]: e.target.value } })} /></label>)}
        <div className="ws-inline-add"><input placeholder="Custom field name" aria-label="Custom field name" value={customName} maxLength={60} onChange={e => setCustomName(e.target.value)} /><button aria-label="Add custom field" disabled={!customName.trim()} onClick={() => { change({ custom: { ...r.custom, [customName.trim()]: "" } }); setCustomName(""); }}><Plus size={14} /></button></div>
        <div className="ws-inline-add"><input placeholder="Save as a reusable template" aria-label="Template name" value={templateName} maxLength={60} onChange={e => setTemplateName(e.target.value)} /><button aria-label="Save reusable template" disabled={!templateName.trim()} onClick={() => { p.onPreferences({ templates: { ...p.preferences.templates, [templateName.trim()]: { ...r, status: "Not reviewed" } } }); p.notify("Review template saved on this device."); setTemplateName(""); }}><Check size={14} /></button></div>
        <p className="ws-help">Applying a saved template replaces this review’s fields. Your previous version remains in the local draft until saved.</p>
        <div onClickCapture={event => { if ((event.target as HTMLElement).closest(".ws-evidence-thumbnail")) setDetails(false); }}>
          <SectionAttachments section="previousReview" {...p} readOnly={p.trade.stale} onImage={section => { setDetails(false); p.onImage(section); }} onEvidence={section => { setDetails(false); p.onEvidence(section); }} />
          {archived.length > 0 && <><h3>Archived sections</h3><p className="ws-help">These sections are no longer in the active template. Their notes and Evidence assignments are retained.</p>{archived.map(section => <JournalSection key={section.key} section={section} {...p} onImage={key => { setDetails(false); p.onImage(key); }} onEvidence={key => { setDetails(false); p.onEvidence(key); }} />)}</>}
        </div>
      </fieldset>
      {!!p.document.legacy && <details className="ws-legacy"><summary>Preserved original journal material</summary><pre>{legacyText}</pre></details>}
    </ReviewDialog>}
    <button className="ws-add-evidence" disabled={p.trade.stale} onClick={() => p.onEvidence()}><Plus size={14} /> Attach current chart <span>{p.document.evidence.length} saved</span></button>
    <div className="ws-journal-save"><span className={p.error ? "negative" : "ws-save-status"}><span className="ws-feed-dot" />{p.status}</span>{p.error && <div className="ws-error"><p>{p.error}</p><button onClick={p.retry}>Retry</button><button onClick={p.reload}>Reload saved review</button><button onClick={() => { const blob = new Blob([JSON.stringify(p.document, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `${p.trade.symbol}-recovered-draft.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Export draft</button></div>}
      <button className="ws-primary ws-save-next" onClick={p.onSaveNext}><Check size={14} /> Save & next <kbd>{p.saveNextShortcut === "Unassigned" ? "" : p.saveNextShortcut}</kbd></button>
      {p.mode === "application" && <button className="ws-copy-review" disabled={p.trade.stale} onClick={p.onNotionPublish}>Publish/update in Notion <ArrowUpRight size={13} /></button>}
      <button className="ws-copy-review" onClick={p.onNotionExport}><Download size={13} /> Export review for Notion <ArrowUpRight size={13} /></button>
      <p className="ws-help">One review, shared with your journal.{p.mode === "demo" ? " Demo changes stay on this device." : ""}</p>
    </div>
  </div>;
}

export function ConnectedReviewEditor({ persistence, ...props }: Omit<Props, "document" | "status" | "error"> & { persistence: ReturnType<typeof useTradeDocument> }) {
  const snapshot = useSyncExternalStore(persistence.subscribe, persistence.getSnapshot, () => null);
  if (!snapshot) return null;
  const error = [snapshot.error, snapshot.backupError, persistence.error].filter(Boolean).join(" ");
  return <ReviewEditor {...props} document={snapshot.value} status={documentSaveStatus(snapshot, props.mode)} error={error} />;
}
export function ConnectedSaveStatus({ persistence, mode }: { persistence: ReturnType<typeof useTradeDocument>; mode: string }) {
  const snapshot = useSyncExternalStore(persistence.subscribe, persistence.getSnapshot, () => null);
  return <>{snapshot ? documentSaveStatus(snapshot, mode) : persistence.error || "Loading review"}</>;
}

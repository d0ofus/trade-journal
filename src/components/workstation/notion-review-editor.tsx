"use client";
import { useId, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { chartSections, emptyNotionReview, notionProperties, propertyText, type ReviewSectionKey, type NotionReview, type NotionValue, type PropertyKey } from "@/lib/workstation/notion-template";
import { SectionAttachments } from "./section-attachments";
import { PeerGroups, type PeerGroupSelection } from "./peer-groups";
import { richPlain } from "@/lib/workstation/rich-text";
import type { Review, Trade, TradeDocument } from "@/lib/workstation/types";
import { sectionText, setSectionText, type SectionDefinition } from "@/lib/workstation/template-layout";
import { useJournalLayout } from "./use-template-layout";

const FormattedField = dynamic(() => import("./rich-review-editors").then(m => m.FormattedField), { ssr: false });

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="ws-template-section" onToggle={e => setOpen(e.currentTarget.open)}><summary>{title}</summary>{open && <div>{children}</div>}</details>;
}
function Choices({ label, value, options, multiple, onChange }: { label: string; value: string | string[]; options: readonly string[]; multiple: boolean; onChange: (value: string | string[]) => void }) {
  const id = useId(), [draft, setDraft] = useState("");
  const values = Array.isArray(value) ? value : [];
  const add = () => { const additions = draft.split(",").map(s => s.trim()).filter(Boolean); if (additions.length) onChange([...new Set([...values, ...additions])].slice(0, 80)); setDraft(""); };
  return <div className="ws-template-choices">
    {multiple && values.map(v => <button type="button" key={v} title={`Remove ${v}`} onClick={() => onChange(values.filter(x => x !== v))}>{v} ×</button>)}
    <input aria-label={label} list={id} value={multiple ? draft : typeof value === "string" ? value : value[0] ?? ""} maxLength={multiple ? 2000 : 160} placeholder={multiple ? "Add a choice…" : "Select or type…"} onChange={e => multiple ? setDraft(e.target.value) : onChange(e.target.value)} onBlur={multiple ? add : undefined} onKeyDown={e => { if (multiple && e.key === "Enter") { e.preventDefault(); add(); } }} />
    <datalist id={id}>{[...new Set([...options, ...values])].map(v => <option value={v} key={v} />)}</datalist>
  </div>;
}

export type NotionEditorProps = { trade: Trade; document: TradeDocument; onChange: (update: (review: Review) => Review) => void; onEvidence: (section: ReviewSectionKey) => void; onImage: (section: ReviewSectionKey) => void; onComparePeers: (selection: PeerGroupSelection) => void; mode: "demo" | "application" };
export function JournalSection({ section, ...props }: NotionEditorProps & { section: SectionDefinition }) {
  return <Section title={section.label}><FormattedField label={chartSections.some(([key]) => key === section.key) ? `${section.label} commentary` : section.label} value={sectionText(props.document.review, section.key)} onChange={html => props.onChange(review => setSectionText(review, section.key, html))} />
    {section.key === "peers" && <PeerGroups symbol={props.trade.symbol} savedId={props.document.review.notion?.peerGroupId} mode={props.mode} onSelect={peerGroupId => props.onChange(review => ({ ...review, notion: { ...review.notion ?? emptyNotionReview(), peerGroupId } }))} onCompare={props.onComparePeers} />}
    <SectionAttachments section={section.key} {...props} readOnly={props.trade.stale} />
  </Section>;
}
export function NotionReviewEditor(props: NotionEditorProps) {
  const { trade, document, onChange, onEvidence, onImage } = props;
  const { layout, warning, pending, refresh } = useJournalLayout();
  const review = document.review, notion = review.notion ?? emptyNotionReview();
  const change = (update: (current: NotionReview) => NotionReview) => onChange(current => ({ ...current, notion: update(current.notion ?? emptyNotionReview()) }));
  const property = (key: PropertyKey, value: NotionValue) => change(current => ({ ...current, properties: { ...current.properties, [key]: value } }));
  return <div className="ws-notion-review">
    {props.mode === "application" && <div className="ws-template-sync"><button type="button" onClick={refresh}>Refresh Notion sections</button>{pending && <p role="status">Section changes will appear when you leave the current field.</p>}{warning && <p role="status">{warning}</p>}</div>}
    <Section title="Trade properties">
      <div className="ws-template-properties">{notionProperties.map(p => {
        const value = notion.properties[p.key];
        return <div className="ws-template-property" key={p.key}><label htmlFor={`notion-${p.key}`}>{p.label}</label>
          {p.kind === "date" || p.kind === "formula" ? <output id={`notion-${p.key}`}>{propertyText(p.key, trade, review) || "—"}</output>
          : p.kind === "takeaways" ? <span className="ws-help">{richPlain(review.takeaway) || "Edit the shared Takeaways section below."}</span>
          : p.kind === "checkbox" ? <input id={`notion-${p.key}`} type="checkbox" aria-label={p.label} checked={value === true} onChange={e => property(p.key, e.target.checked)} />
          : p.kind === "number" ? <input id={`notion-${p.key}`} type="number" step="any" aria-label={p.label} value={typeof value === "number" ? value : ""} onChange={e => property(p.key, e.target.value ? Number(e.target.value) : null)} />
          : p.kind === "multi" || p.kind === "relation" || p.kind === "select" ? <Choices label={p.label} options={"options" in p ? p.options : []} multiple={p.kind === "multi" || p.kind === "relation" && !("single" in p)} value={typeof value === "string" || Array.isArray(value) ? value : ""} onChange={v => property(p.key, p.kind === "relation" && typeof v === "string" ? v.trim() ? [v.trim()] : [] : v)} />
          : p.key === "themeBreadthNotes" ? <FormattedField label={p.label} value={typeof value === "string" ? value : ""} onChange={v => property(p.key, v)} />
          : <input id={`notion-${p.key}`} aria-label={p.label} value={typeof value === "string" ? value : ""} maxLength={20000} onChange={e => property(p.key, e.target.value)} />}
          {p.key === "stopLossPercent" && <div className="ws-stop-inputs">{(["plannedEntry", "plannedStop"] as const).map(key => <label key={key}>{key === "plannedEntry" ? "Planned entry" : "Planned stop"}<input type="number" min="0.000001" step="any" aria-label={key === "plannedEntry" ? "Planned entry" : "Planned stop"} value={typeof notion.properties[key] === "number" ? notion.properties[key] : ""} onChange={e => property(key, Number(e.target.value) > 0 ? Number(e.target.value) : null)} /></label>)}</div>}
        </div>;
      })}</div>
      <SectionAttachments section="properties" document={document} onChange={onChange} onEvidence={onEvidence} onImage={onImage} readOnly={trade.stale} />
    </Section>
    {layout.sections.map((section, index) => <div key={section.key}>
      {section.groups.length > 0 && section.groups.join("/") !== layout.sections[index - 1]?.groups.join("/") && <h3>{section.groups.join(" · ")}</h3>}
      <JournalSection {...props} section={section} />
    </div>)}
    {!layout.sections.some(section => section.key === "peers") && <Section title="Review tools"><PeerGroups symbol={trade.symbol} savedId={notion.peerGroupId} mode={props.mode} onSelect={peerGroupId => change(current => ({ ...current, peerGroupId }))} onCompare={props.onComparePeers} /></Section>}
  </div>;
}

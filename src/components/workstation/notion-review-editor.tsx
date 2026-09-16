"use client";
import { useId, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { analysisSections, chartSections, emptyNotionReview, notionProperties, propertyText, type ChartSectionKey, type NotionReview, type NotionValue, type PropertyKey } from "@/lib/workstation/notion-template";
import { richPlain } from "@/lib/workstation/rich-text";
import type { Review, Trade, TradeDocument } from "@/lib/workstation/types";

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

export function NotionReviewEditor({ trade, document, onChange, onEvidence }: { trade: Trade; document: TradeDocument; onChange: (review: Review) => void; onEvidence: (section: ChartSectionKey) => void }) {
  const review = document.review, notion = review.notion ?? emptyNotionReview();
  const change = (next: NotionReview) => onChange({ ...review, notion: next });
  const property = (key: PropertyKey, value: NotionValue) => change({ ...notion, properties: { ...notion.properties, [key]: value } });
  return <div className="ws-notion-review">
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
    </Section>
    {chartSections.map(([key, label]) => {
      const section = notion.sections[key] ?? { html: "", evidenceIds: [] };
      return <Section title={label} key={key}><FormattedField label={`${label} commentary`} value={section.html} onChange={html => change({ ...notion, sections: { ...notion.sections, [key]: { ...section, html } } })} />
        <button type="button" className="ws-add-evidence" onClick={() => onEvidence(key)}>Attach current chart to {label}</button>
        <fieldset className="ws-section-evidence"><legend>Captured charts</legend>{document.evidence.length ? document.evidence.map(e => <label key={e.id}><input type="checkbox" checked={section.evidenceIds.includes(e.id)} onChange={event => change({ ...notion, sections: { ...notion.sections, [key]: { ...section, evidenceIds: event.target.checked ? [...section.evidenceIds, e.id] : section.evidenceIds.filter(id => id !== e.id) } } })} />{e.name}</label>) : <p className="ws-help">Use Attach current chart to capture evidence, then choose it here.</p>}</fieldset>
      </Section>;
    })}
    <h3>Setup Analysis</h3>
    {analysisSections.map(([key, label]) => <Section title={label} key={key}><FormattedField label={label} value={notion.analysis[key] ?? ""} onChange={html => change({ ...notion, analysis: { ...notion.analysis, [key]: html } })} /></Section>)}
    <Section title="Takeaways"><FormattedField label="Takeaways" value={review.takeaway} onChange={takeaway => onChange({ ...review, takeaway })} /></Section>
  </div>;
}

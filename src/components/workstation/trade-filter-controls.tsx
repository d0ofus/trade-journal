"use client";
import { useId } from "react";
import { ChevronDown, ListFilter, RotateCcw } from "lucide-react";
import { filterDateSummary, quickTradeRange, quickTradeRanges, tradeFilterCount, type WorkstationTradeFilters } from "@/lib/workstation/trade-filters";

export function WorkstationFilterControls({ applied, draft, onDraft, expanded, onExpanded, pending, error, onApply, onClear, view, onView, count }: {
  applied: WorkstationTradeFilters; draft: WorkstationTradeFilters; onDraft(value: WorkstationTradeFilters): void;
  expanded: boolean; onExpanded(value: boolean): void; pending: boolean; error: string;
  onApply(value: WorkstationTradeFilters): void; onClear(): void;
  view: string; onView(value: string): void; count: number;
}) {
  const id = useId();
  const active = tradeFilterCount(applied);
  return <>
    <div className="ws-list-filter">
      <button type="button" className={`ws-filter-toggle ${active ? "active" : ""}`} title={expanded ? "Collapse filters" : "Expand filters"} aria-label={expanded ? "Collapse filters" : "Expand filters"} aria-expanded={expanded} aria-controls={id} onClick={() => onExpanded(!expanded)}><ListFilter size={16} />{active > 0 && <b aria-label={`${active} active filters`}>{active}</b>}</button>
      <select aria-label="Review view" value={view} onChange={event => onView(event.target.value)}><option>All trades</option><option>Unexported</option></select><span aria-label="Matching trade count">{count}</span>
    </div>
    <div className="ws-applied-filters"><span title={filterDateSummary(applied)}>{filterDateSummary(applied)}</span>{active > 0 && <button aria-label="Clear all trade filters" title="Clear all filters" disabled={pending} onClick={onClear}><RotateCcw size={12} /></button>}</div>
    <section id={id} className="ws-filter-expansion" hidden={!expanded} aria-label="Trade filters">
      <form data-testid="trade-filters" noValidate onSubmit={event => { event.preventDefault(); onApply(draft); }}>
        <fieldset disabled={pending}>
          <div className="ws-filter-fields">
            <div className="ws-filter-section-title">Trade dates <span>UTC</span></div>
            {(["from", "to"] as const).map(key => <label key={key}><span>{key === "from" ? "From" : "To"}</span><input type="date" name={key} value={draft[key] ?? ""} onChange={event => onDraft({ ...draft, [key]: event.target.value })} /></label>)}
            <div className="ws-filter-ranges"><button type="button" aria-pressed={!applied.from && !applied.to} onClick={() => { const next = { ...draft, from: "", to: "" }; onDraft(next); onApply(next); }}>All time</button>{quickTradeRanges.map(range => { const dates = quickTradeRange(range); return <button type="button" key={range} aria-pressed={applied.from === dates.from && applied.to === dates.to} onClick={() => { const next = { ...draft, ...dates }; onDraft(next); onApply(next); }}>{range}</button>; })}</div>
            <div className="ws-filter-section-title">Refine trades</div>
            <label><span>Symbol</span><input name="symbol" placeholder="All symbols" value={draft.symbol ?? ""} onChange={e => onDraft({ ...draft, symbol: e.target.value })} /></label>
            <label><span>Direction</span><select name="direction" value={draft.direction ?? ""} onChange={e => onDraft({ ...draft, direction: e.target.value })}><option value="">All directions</option><option value="LONG">Long</option><option value="SHORT">Short</option></select></label>
            {([['tag', 'Tag', 'All tags'], ['account', 'Account', 'All accounts'], ['strategy', 'Strategy', 'All setups']] as const).map(([key, label, placeholder]) => <label key={key}><span>{label}</span><input name={key} placeholder={placeholder} value={draft[key] ?? ""} onChange={e => onDraft({ ...draft, [key]: e.target.value })} /></label>)}
            <label className="ws-filter-checkbox"><input name="includeStale" type="checkbox" checked={!!draft.includeStale} onChange={e => onDraft({ ...draft, includeStale: e.target.checked })} /><span>Include stale trades</span></label>
          </div>
          <div className="ws-filter-actions">{error && <p role="alert">{error}</p>}<div><button className="ws-primary" type="submit">{pending ? "Applying…" : "Apply"}<ChevronDown size={12} /></button><button type="button" onClick={onClear}>Clear all</button></div></div>
        </fieldset>
      </form>
    </section>
    {!expanded && error && <p role="alert" className="ws-filter-inline-error">{error}</p>}
  </>;
}

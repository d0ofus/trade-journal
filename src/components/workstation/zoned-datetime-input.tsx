"use client";
import { useImperativeHandle, useState, type Ref } from "react";
import { parseTimezoneInput, timezoneInputValue, type ChartTimezone } from "@/lib/workstation/chart-timezone";
export type ZonedDateTimeHandle = { commit: () => number | null };
export function ZonedDateTimeInput({ value, timezone, onCommit, label, disabled = false, ref, autoFocus = false }: { value: number; timezone: ChartTimezone; onCommit: (time: number) => void; label: string; disabled?: boolean; ref?: Ref<ZonedDateTimeHandle>; autoFocus?: boolean }) {
  const key = `${value}:${timezone.zone}`, [draft, setDraft] = useState<{ key: string; text: string; error?: string } | null>(null);
  const text = draft?.key === key ? draft.text : timezoneInputValue(value, timezone), error = draft?.key === key ? draft.error : undefined;
  const commit = () => {
    const result = parseTimezoneInput(text, timezone);
    if (result.error) { setDraft({ key, text, error: result.error }); return null; }
    setDraft(null); if (result.time !== value) onCommit(result.time!); return result.time!;
  };
  useImperativeHandle(ref, () => ({ commit }));
  return <label className="ws-zoned-datetime"><span>{label} · {timezone.label}</span><input data-autofocus={autoFocus || undefined} aria-label={`${label} ${timezone.label}`} aria-invalid={!!error} type="datetime-local" step={1} disabled={disabled} value={text} onChange={e => setDraft({ key, text: e.target.value })} onBlur={commit} onKeyDown={e => { if (e.key === "Enter" && !e.currentTarget.form) { e.preventDefault(); commit(); } if (e.key === "Escape" && draft?.key === key) { e.preventDefault(); e.stopPropagation(); setDraft(null); } }} />{error && <small role="alert">{error}</small>}</label>;
}

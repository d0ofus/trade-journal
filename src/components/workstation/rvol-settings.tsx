"use client";
import { useState } from "react";
import { restoreRvol, type RvolMode, type RvolSettings as Settings } from "@/lib/workstation/rvol";

export function RvolSettings({ value, disabled, onChange }: { value: Settings | undefined; disabled: boolean; onChange: (settings: Settings) => void }) {
  const settings = restoreRvol(value), [draft, setDraft] = useState<{ saved: number; text: string; error: string } | null>(null);
  const field = draft?.saved === settings.lookback ? draft.text : String(settings.lookback), error = draft?.saved === settings.lookback ? draft.error : "";
  const commit = () => {
    if (!/^\d+$/.test(field) || Number(field) < 1 || Number(field) > 100) { setDraft({ saved: settings.lookback, text: field, error: "Use a whole-number lookback from 1 to 100." }); return; }
    setDraft(null); onChange({ ...settings, lookback: Number(field) });
  };
  return <fieldset className="ws-rvol-settings" disabled={disabled}><legend>Relative volume</legend>
    <label><span>Show RVOL</span><input type="checkbox" aria-label="Show RVOL in workspace" checked={settings.enabled} onChange={e => onChange({ ...settings, enabled: e.target.checked })} /></label>
    <label><span>Calculation</span><select aria-label="RVOL calculation" value={settings.mode} onChange={e => onChange({ ...settings, mode: e.target.value as RvolMode })}><option value="ordinary">Ordinary RVOL</option><option value="cumulative">RVOL at time — cumulative</option><option value="per-bar">RVOL at time — per bar</option></select></label>
    <label><span>Lookback ({settings.mode === "ordinary" ? "candles" : "comparable trading sessions"})</span><input aria-label="RVOL lookback" type="number" min={1} max={100} step={1} value={field} onChange={e => setDraft({ saved: settings.lookback, text: e.target.value, error: "" })} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setDraft(null); }} /></label>
    {error && <p role="alert">{error}</p>}<p>At-time modes use ordinary RVOL on daily and weekly charts. RVOL is independent of raw volume.</p>
  </fieldset>;
}

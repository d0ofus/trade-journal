"use client";
import { useCallback, useEffect, useState } from "react";
import { bindingConflict, commands, defaultShortcuts, keyBinding, restoreShortcuts, shortcutLabel, ShortcutPreferences } from "@/lib/workstation/shortcuts";
import "./shortcut-settings.css";

const eventName = "workstation-shortcuts-changed";
export function useShortcutPreferences(mode: "demo" | "application") {
  const key = `execution-lab:workstation:shortcuts:${mode}:v1`;
  const [value, setValue] = useState(defaultShortcuts);
  const [error, setError] = useState("");
  useEffect(() => {
    const load = () => {
      try { setValue(restoreShortcuts(JSON.parse(localStorage.getItem(key) ?? "null"))); setError(""); }
      catch { setValue(defaultShortcuts()); setError("Shortcuts could not be read from device storage. Defaults are in use."); }
    };
    load();
    const changed = (event: StorageEvent) => { if (event.key === key || event.key === null) load(); };
    window.addEventListener("storage", changed);
    window.addEventListener(eventName, load);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener(eventName, load); };
  }, [key]);
  const save = useCallback((next: ShortcutPreferences) => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); setError(""); window.dispatchEvent(new Event(eventName)); }
    catch { setError("Shortcuts work for this session but could not be saved on this device."); }
  }, [key]);
  return { value, save, error };
}

export function ShortcutSettings({ value, onChange, error = "" }: { value: ShortcutPreferences; onChange: (value: ShortcutPreferences) => void; error?: string }) {
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const assign = (id: string, binding: string | null) => {
    const problem = binding && bindingConflict(id, binding, value);
    if (problem) { setMessage(problem); return; }
    onChange({ ...value, bindings: { ...value.bindings, [id]: binding } });
    setRecording(null); setMessage("Shortcut saved on this device.");
  };
  return <div className="ws-key-settings">
    <p>Workstation → Keyboard shortcuts</p>
    <p>Click a chart or focus it with Tab before using chart shortcuts. Typing in notes and inputs keeps normal editing keys. Changes are saved on this device and shared by the trades and journal views.</p>
    <div className="ws-key-options">
      <label><input type="checkbox" checked={value.enabled} onChange={e => onChange({ ...value, enabled: e.target.checked })} /> Enable keyboard shortcuts</label>
      <label><input type="checkbox" checked={value.singleKeys} onChange={e => onChange({ ...value, singleKeys: e.target.checked })} /> Enable single-letter shortcuts</label>
      <button type="button" onClick={() => { onChange(defaultShortcuts()); setRecording(null); setMessage("Default shortcuts restored."); }}>Reset all shortcuts</button>
    </div>
    <input className="ws-key-search" type="search" aria-label="Search keyboard shortcuts" placeholder="Search actions or keys…" value={query} onChange={e => setQuery(e.target.value)} />
    <p className="ws-key-message" role="status">{error || message || "Select a binding and press your preferred keys. Esc cancels recording; Tab moves to the next control."}</p>
    <div className="ws-key-list">
      {commands.filter(c => `${c.label} ${shortcutLabel(value.bindings[c.id])}`.toLowerCase().includes(query.toLowerCase())).map(command => <div className="ws-key-row" key={command.id}>
        <div><strong>{command.label}</strong><small>{command.scope === "chart" ? "Focused chart" : "Workstation · outside text fields"}</small></div>
        <button type="button" className={`ws-key-binding ${recording === command.id ? "recording" : ""}`} aria-label={`Set shortcut for ${command.label}`} aria-pressed={recording === command.id}
          onClick={() => { setRecording(command.id); setMessage("Press the new shortcut. Esc cancels."); }}
          onBlur={() => setRecording(null)}
          onKeyDown={event => {
            if (recording !== command.id || event.key === "Tab") return;
            event.preventDefault(); event.stopPropagation();
            if (event.key === "Escape") { setRecording(null); setMessage("Recording cancelled."); return; }
            if (event.nativeEvent.isComposing || event.repeat || event.getModifierState("AltGraph")) return;
            const binding = keyBinding(event.nativeEvent); if (binding) assign(command.id, binding);
          }}><kbd>{recording === command.id ? "Press keys…" : shortcutLabel(value.bindings[command.id])}</kbd></button>
        <button type="button" aria-label={`Clear shortcut for ${command.label}`} disabled={!value.bindings[command.id]} onClick={() => assign(command.id, null)}>Clear</button>
        <button type="button" aria-label={`Reset shortcut for ${command.label}`} onClick={() => assign(command.id, command.binding)}>Reset</button>
      </div>)}
    </div>
    <p>Esc cancels the current drawing or closes a dialog. Press it again to restore a fullscreen chart.</p>
  </div>;
}

export function WorkstationShortcutSettings() {
  const shortcuts = useShortcutPreferences("application");
  return <ShortcutSettings value={shortcuts.value} onChange={shortcuts.save} error={shortcuts.error} />;
}

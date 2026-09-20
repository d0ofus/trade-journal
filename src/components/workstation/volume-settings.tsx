import type { WorkspacePreferences } from "@/lib/workstation/types";
import { volumeAppearance, volumeParts } from "@/lib/workstation/volume-style";

export function VolumeSettings({ preferences, onChange }: { preferences: WorkspacePreferences; onChange: (update: Partial<WorkspacePreferences>) => void }) {
  return <fieldset className="ws-volume-settings"><legend>Volume appearance</legend>
    {volumeParts.map(([part, label]) => {
      const style = volumeAppearance(preferences.volumeStyle, part, preferences.theme === "light");
      return <div key={part}>
        <label><span>{label} colour</span><input type="color" aria-label={`${label} colour`} value={style.color} onChange={e => onChange({ volumeStyle: { ...preferences.volumeStyle, [part]: { ...preferences.volumeStyle?.[part], color: e.target.value } } })} /></label>
        <label><span>{label} transparency</span><input type="range" aria-label={`${label} transparency`} min={0} max={100} step={1} value={style.transparency} onChange={e => onChange({ volumeStyle: { ...preferences.volumeStyle, [part]: { ...preferences.volumeStyle?.[part], transparency: Number(e.target.value) } } })} /><output>{Math.round(style.transparency)}%</output></label>
      </div>;
    })}
    <button type="button" onClick={() => onChange({ volumeStyle: {} })}>Reset volume appearance</button>
  </fieldset>;
}

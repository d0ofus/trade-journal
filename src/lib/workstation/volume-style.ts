export const volumeParts = [["up", "Rising volume"], ["down", "Falling volume"], ["average", "Average volume line"]] as const;
export type VolumePart = typeof volumeParts[number][0];
export type VolumeAppearance = Partial<Record<VolumePart, { color?: string; transparency?: number }>>;
export type VolumeContext = "workspace" | "capture" | "peer";

export function restoreVolumeAppearance(value: unknown): VolumeAppearance {
  const result: VolumeAppearance = {};
  if (!value || typeof value !== "object") return result;
  for (const [key] of volumeParts) {
    const item = (value as Record<string, unknown>)[key];
    if (!item || typeof item !== "object") continue;
    const { color, transparency } = item as Record<string, unknown>;
    const style: NonNullable<VolumeAppearance[VolumePart]> = {};
    if (typeof color === "string" && /^#[a-f\d]{6}$/i.test(color)) style.color = color;
    if (typeof transparency === "number" && Number.isFinite(transparency) && transparency >= 0 && transparency <= 100) style.transparency = transparency;
    if (Object.keys(style).length) result[key] = style;
  }
  return result;
}

export function volumeAppearance(style: VolumeAppearance | undefined, part: VolumePart, light: boolean, context: VolumeContext = "workspace") {
  const peer = context === "peer";
  const color = part === "average" ? peer ? "#94a3b8" : light ? "#96691e" : "#d4b477"
    : part === "up" ? peer ? "#34d399" : "#38bfa6" : peer ? "#fb7185" : "#e47886";
  const transparency = part === "average" ? 0 : peer ? 100 * (1 - 85 / 255) : context === "capture" ? 80 : 100 * (1 - 45 / 255);
  return { color: style?.[part]?.color ?? color, transparency: style?.[part]?.transparency ?? transparency };
}

export function volumeColor(style: VolumeAppearance | undefined, part: VolumePart, light: boolean, context: VolumeContext = "workspace") {
  const appearance = volumeAppearance(style, part, light, context);
  const rgb = [1, 3, 5].map(start => Number.parseInt(appearance.color.slice(start, start + 2), 16));
  return `rgba(${rgb.join(",")},${1 - appearance.transparency / 100})`;
}

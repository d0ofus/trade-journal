import type { Tool } from "./types";

export type Command = {
  id: string;
  label: string;
  scope: "chart" | "workstation";
  binding: string | null;
  tool?: Tool;
};
export const commands: Command[] = [
  ...([
    ["cursor", "Select / pan", "V"], ["horizontal", "Horizontal line", "H"],
    ["ray", "Horizontal ray", "R"], ["trend", "Trend line", "T"],
    ["arrow", "Arrow", "A"], ["zone", "Price zone", "B"],
    ["text", "Text note", "N"], ["price-note", "Price note", null],
    ["measure", "Price & time measurement", "M"],
    ["long", "Long risk / reward", "L"], ["short", "Short risk / reward", "S"],
    ["entry", "Planned entry", null], ["stop", "Planned stop", null],
    ["target", "Planned target", null], ["exit", "Planned exit", null],
  ] as [Tool, string, string | null][]).map(([tool, label, binding]) => ({
    id: `tool.${tool}`, label, binding, tool, scope: "chart" as const,
  })),
  { id: "chart.fullscreen", label: "Fullscreen active chart", scope: "chart", binding: "F" },
  { id: "workspace.focus", label: "Focus chart workspace", scope: "chart", binding: "Shift+F" },
  { id: "chart.date", label: "Jump to date", scope: "chart", binding: "G" },
  { id: "drawing.undo", label: "Undo drawing", scope: "chart", binding: "Mod+Z" },
  { id: "drawing.redo", label: "Redo drawing", scope: "chart", binding: "Mod+Shift+Z" },
  { id: "drawing.delete", label: "Delete selected drawing", scope: "chart", binding: "Delete" },
  { id: "review.next", label: "Save & next trade", scope: "workstation", binding: "Mod+Enter" },
  { id: "trade.previous", label: "Previous trade", scope: "workstation", binding: "Alt+ArrowUp" },
  { id: "trade.next", label: "Next trade", scope: "workstation", binding: "Alt+ArrowDown" },
  { id: "shortcuts.help", label: "Keyboard shortcuts", scope: "chart", binding: "?" },
  { id: "chart.beforeTrade", label: "Before Trade", scope: "chart", binding: "Shift+B" },
  { id: "chart.fit", label: "Fit Trade", scope: "chart", binding: "Shift+T" },
  { id: "chart.session", label: "Toggle trading hours", scope: "chart", binding: "Shift+E" },
  { id: "chart.labels", label: "Toggle execution labels", scope: "chart", binding: "Shift+L" },
  { id: "chart.comparison", label: "Toggle index comparison", scope: "chart", binding: "Shift+I" },
];

export type ShortcutPreferences = { version: 1; enabled: boolean; singleKeys: boolean; bindings: Record<string, string | null> };
export const defaultShortcuts = (): ShortcutPreferences => ({ version: 1, enabled: true, singleKeys: true, bindings: Object.fromEntries(commands.map(c => [c.id, c.binding])) });
type KeyEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing">;
export function keyBinding(event: KeyEvent): string | null {
  if (event.isComposing || ["Control", "Meta", "Alt", "Shift", "Dead", "Process", "Unidentified"].includes(event.key)) return null;
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  // '?' already encodes Shift on keyboards where it is needed; respect the produced character.
  return [event.ctrlKey || event.metaKey ? "Mod" : "", event.altKey ? "Alt" : "", event.shiftKey && key !== "?" ? "Shift" : "", key].filter(Boolean).join("+");
}
export function isCharacterBinding(binding: string) { return !binding.includes("Mod+") && !binding.includes("Alt+") && binding.split("+").at(-1)?.length === 1; }
export function bindingProblem(binding: string): string | null {
  if (!/^(Mod\+)?(Alt\+)?(Shift\+)?([A-Z0-9?]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Delete|Enter|F[1-9]|F1[0-2])$/.test(binding)) return "Choose a letter, number, arrow, Delete, Enter or function key. Escape and Tab keep their normal behavior.";
  if (/^(Mod\+(Shift\+)?[LRTNWQPOHJD]|Alt\+(ArrowLeft|ArrowRight|F4)|F(1|5|6|7|10|11|12)|Mod\+Alt\+.*)$/.test(binding)) return "That shortcut is reserved for the browser or operating system. Choose another combination.";
  if (binding === "Enter" || binding === "Shift+Enter") return "Enter is reserved for activating controls. Add Ctrl / Cmd or choose another key.";
  return null;
}
export function bindingConflict(id: string, binding: string, preferences: ShortcutPreferences): string | null {
  const invalid = bindingProblem(binding);
  if (invalid) return invalid;
  const duplicate = commands.find(c => c.id !== id && preferences.bindings[c.id] === binding);
  return duplicate ? `Already assigned to ${duplicate.label}. Clear or change that binding first.` : null;
}
export function restoreShortcuts(value: unknown): ShortcutPreferences {
  const defaults = defaultShortcuts();
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) return defaults;
  const saved = value as Partial<ShortcutPreferences>;
  const used = new Set<string>();
  // New defaults must never take a key already explicitly assigned on this device.
  const savedBindings = new Set(commands.flatMap(command => {
    const binding = saved.bindings?.[command.id];
    return typeof binding === "string" && !bindingProblem(binding) ? [binding] : [];
  }));
  const bindings: Record<string, string | null> = {};
  for (const command of commands) {
    const candidate = saved.bindings?.[command.id] === undefined ? command.binding : saved.bindings[command.id];
    const newDefault = ["chart.beforeTrade", "chart.fit", "chart.session", "chart.comparison", "chart.labels"].includes(command.id);
    const defaultConflict = newDefault && saved.bindings?.[command.id] === undefined && typeof candidate === "string" && savedBindings.has(candidate);
    bindings[command.id] = typeof candidate === "string" && !bindingProblem(candidate) && !used.has(candidate) && !defaultConflict ? candidate : null;
    if (bindings[command.id]) used.add(bindings[command.id]!);
  }
  return { version: 1, enabled: saved.enabled !== false, singleKeys: saved.singleKeys !== false, bindings };
}
export function matchCommand(event: KeyEvent, preferences: ShortcutPreferences, scope: "chart" | "workstation") {
  if (!preferences.enabled) return undefined;
  const binding = keyBinding(event);
  if (!binding || (!preferences.singleKeys && isCharacterBinding(binding))) return undefined;
  return commands.find(c => preferences.bindings[c.id] === binding && (c.scope === "workstation" || scope === "chart"));
}
export function shortcutLabel(binding?: string | null) { return binding?.replace("Mod", "Ctrl / Cmd").replace("ArrowUp", "↑").replace("ArrowDown", "↓").replaceAll("+", " + ") ?? "Unassigned"; }
export function typingTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]');
}

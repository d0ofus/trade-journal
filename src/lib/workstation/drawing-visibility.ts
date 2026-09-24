import type { Drawing } from "./types";

// A session-only snapshot, never a saved document/preference or an undo entry.
// Keep IDs even after deletion so undo cannot reveal an older hidden drawing.
export type TemporaryDrawingVisibility = { tradeId: string; ids: ReadonlySet<string> };
export function hideExistingDrawings(tradeId: string, drawings: readonly Drawing[]): TemporaryDrawingVisibility {
  return { tradeId, ids: new Set(drawings.map(drawing => drawing.id)) };
}
export function hiddenDrawingIdsFor(visibility: TemporaryDrawingVisibility | null, tradeId: string | undefined) {
  return visibility?.tradeId === tradeId ? visibility?.ids : undefined;
}

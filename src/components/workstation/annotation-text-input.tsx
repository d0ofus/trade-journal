"use client";
import { startTransition, useCallback, useSyncExternalStore, type TextareaHTMLAttributes } from "react";
import type { useTradeDocument } from "./use-trade-document";

export type DrawingStore = Pick<ReturnType<typeof useTradeDocument>, "subscribe" | "getSnapshot">;
type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  store: DrawingStore; drawingId: string; peerSymbol?: string; onText: (text: string) => void;
};
/** Text comes directly from the synchronous draft store. Expensive workspace
 * rendering can yield to input without delaying persistence or losing edits. */
export function AnnotationTextInput({ store, drawingId, peerSymbol, onText, ...props }: Props) {
  const getSnapshot = store.getSnapshot;
  const getText = useCallback(() => {
    const doc = getSnapshot()?.value;
    const drawings = peerSymbol ? doc?.comparison?.drawings[peerSymbol] : doc?.drawings;
    return drawings?.find(drawing => drawing.id === drawingId)?.text ?? "";
  }, [getSnapshot, drawingId, peerSymbol]);
  const text = useSyncExternalStore(store.subscribe, getText, () => "");
  return <textarea {...props} value={text} onChange={event => {
    const value = event.target.value;
    startTransition(() => onText(value));
  }} />;
}

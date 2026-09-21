"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Reparent a stable portal host, never a second editor or a second save owner. */
export function JournalPortal({ target, children }: { target: HTMLElement | null; children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  // Client-only external DOM host: preserve SSR hydration and the editor instance.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const element = document.createElement("div"); element.className = "ws-journal-portal"; setHost(element); return () => element.remove(); }, []);
  useLayoutEffect(() => { if (host && target) target.appendChild(host); else host?.remove(); }, [host, target]);
  return host ? createPortal(children, host) : null;
}
export const fullscreenJournalWidth = (width: number, viewport: number) => Math.min(Math.max(270, width), Math.max(270, viewport - 362));
export function FullscreenJournal({ width, onWidth, onClose, slot, small }: { width: number; onWidth: (width: number) => void; onClose: () => void; slot: (node: HTMLDivElement | null) => void; small: boolean }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (small) close.current?.focus({ preventScroll: true }); }, [small]);
  return <aside className={`ws-fullscreen-journal${small ? " ws-fullscreen-journal-mobile" : ""}`} aria-label="Fullscreen trade journal" style={{ width: small ? "100%" : width }}>
    {!small && <div role="separator" tabIndex={0} aria-label="Resize fullscreen journal" aria-orientation="vertical" aria-valuemin={270} aria-valuenow={Math.round(width)} className="ws-journal-resize"
      onKeyDown={e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); onWidth(fullscreenJournalWidth(width + (e.key === "ArrowLeft" ? 20 : -20), window.innerWidth)); } }}
      onPointerDown={e => { e.preventDefault(); drag.current = { x: e.clientX, width }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (drag.current) onWidth(fullscreenJournalWidth(drag.current.width + drag.current.x - e.clientX, window.innerWidth)); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />}
    <header><strong>Journal</strong><button ref={close} type="button" aria-label="Close fullscreen journal" onClick={onClose}>Close</button></header>
    <div ref={slot} className="ws-journal-host-slot" />
  </aside>;
}

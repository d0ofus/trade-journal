"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function ReviewDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!; dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className="ws-modal ws-review-dialog" aria-label={title} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} onKeyDown={event => event.stopPropagation()}>
    <div className="ws-modal-heading"><h2>{title}</h2><button type="button" aria-label={`Close ${title}`} onClick={onClose}><X size={18} /></button></div>
    {children}
  </dialog>;
}

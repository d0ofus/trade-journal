"use client";
import { useEffect, useRef, useState } from "react";
import { importEvidenceImage, type ImportedImage } from "@/lib/workstation/image-import";

export function ImageAttachment({ sectionLabel, onAttach, validate }: { sectionLabel: string; onAttach: (image: ImportedImage) => Promise<void>; validate: (image: ImportedImage) => void }) {
  const [image, setImage] = useState<ImportedImage | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null), mounted = useRef(true), saving = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const prepare = async (file: File, origin: ImportedImage["origin"]) => {
    if (saving.current) return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setImage(null); setError(""); setBusy(true);
    try {
      const next = await importEvidenceImage(file, origin, request.signal);
      if (request.signal.aborted) return;
      validate(next); setImage(next);
    } catch (error) {
      if (!request.signal.aborted && mounted.current) setError(error instanceof Error ? error.message : "Image import failed.");
    } finally { if (!request.signal.aborted && mounted.current) setBusy(false); }
  };
  return <div className="ws-image-import">
    <p>Attach an image to {sectionLabel}. It will also appear in Evidence.</p>
    <label>Choose image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ""; if (file) void prepare(file, "upload");
    }} /></label>
    <div className="ws-image-paste" tabIndex={0} role="group" aria-label="Paste screenshot" onPaste={event => {
      event.preventDefault(); event.stopPropagation();
      if (busy) return;
      const files = [...event.clipboardData.files];
      if (files.length !== 1) { setImage(null); setError("Paste one screenshot at a time, or choose an image file."); return; }
      void prepare(files[0], "clipboard");
    }}>Click here, then paste a screenshot with Ctrl+V or ⌘V.</div>
    <p className="ws-help">PNG, JPEG or WebP · up to 20 MB and 16 megapixels. Lossless PNG originals share a 50 MB review allowance; up to 30 images. Original quality is never reduced automatically.</p>
    {image && <figure>
      {/* Normalized local PNG, not a remote image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.image} alt={`Preview of ${image.name}`} />
      <figcaption>{image.name} · {image.width} × {image.height} px</figcaption>
    </figure>}
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">Preparing or saving image…</p>}
    <button className="ws-primary" disabled={!image || busy} onClick={async () => {
      if (!image || saving.current) return;
      saving.current = true; setBusy(true); setError("");
      try { await onAttach(image); }
      catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "Could not attach image."); }
      finally { saving.current = false; if (mounted.current) setBusy(false); }
    }}>Attach image to {sectionLabel}</button>
  </div>;
}

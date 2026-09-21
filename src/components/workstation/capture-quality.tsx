"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { captureResolution, type CaptureFrame, type CaptureQuality } from "@/lib/workstation/capture-resolution";

export const CaptureQualityContext = createContext<{ quality: CaptureQuality; onChange: (value: CaptureQuality) => void; frame: () => CaptureFrame | null }>({ quality: "high", onChange: () => {}, frame: () => null });
export function CaptureQualityControls({ frame, label = "Capture quality", dimensionsOnly = false }: { frame?: () => CaptureFrame | null; label?: string; dimensionsOnly?: boolean }) {
  const setting = useContext(CaptureQualityContext), getFrame = frame ?? setting.frame;
  const [description, setDescription] = useState("");
  useEffect(() => {
    let raf = 0;
    const update = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      try { const frame = getFrame(); const size = frame && captureResolution(frame, setting.quality, window.devicePixelRatio); setDescription(size ? `Approximately ${size.width} × ${size.height} px · lossless PNG` : "Select a loaded chart to see output dimensions."); }
      catch (error) { setDescription(error instanceof Error ? error.message : "Capture unavailable"); }
    }); };
    const observer = new ResizeObserver(update);
    document.querySelectorAll(".ws-plot,.ws-peer-chart").forEach(node => observer.observe(node));
    update(); window.addEventListener("resize", update);
    return () => { observer.disconnect(); cancelAnimationFrame(raf); window.removeEventListener("resize", update); };
  }, [getFrame, setting.quality]);
  if (dimensionsOnly) return <small className="ws-capture-dimensions" title={description}>{label}: {description.replace("Approximately ", "").replace(" · lossless PNG", "")}</small>;
  return <div className="ws-capture-quality"><label>{label}<select aria-label={label} value={setting.quality} onChange={e => setting.onChange(e.target.value as CaptureQuality)}>
    <option value="high">High quality · 1920 px minimum</option><option value="standard">Standard · native resolution</option>
  </select></label><small role="status">{description}</small></div>;
}

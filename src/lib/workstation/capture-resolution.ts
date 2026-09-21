export type CaptureQuality = "standard" | "high";
export type CaptureFrame = { width: number; height: number };
export const CAPTURE_MAX_PIXELS = 16_000_000;

/** Use the chart's actual backing density. Browser zoom/emulation can make
 * ResizeObserver's device-pixel content box differ from window.devicePixelRatio. */
export function chartBitmapRatio(host: HTMLElement | null, fallback = 1) {
  const canvas = host?.querySelector("canvas");
  return canvas && canvas.clientWidth > 0 && canvas.width > 0 ? canvas.width / canvas.clientWidth : fallback;
}

export function assertCaptureSize(width: number, height: number) {
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error("Wait for the chart to finish sizing before capturing.");
  if (Math.ceil(width) * Math.ceil(height) > CAPTURE_MAX_PIXELS) throw new Error("This capture exceeds 16 megapixels. Choose Standard quality or a smaller chart layout; image quality has not been reduced.");
}
export function captureResolution(frame: CaptureFrame, quality: CaptureQuality, pixelRatio = 1) {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  assertCaptureSize(frame.width, frame.height);
  const scale = quality === "high" ? Math.max(2, ratio, 1920 / frame.width) : ratio;
  const width = Math.ceil(frame.width * scale), height = Math.ceil(frame.height * scale);
  assertCaptureSize(width, height);
  return { width, height, scale };
}
/** Lightweight Charts rounds CSS dimensions to even pixels. Round upwards,
 * then copy its native bitmap 1:1 instead of shrinking a DPR-sized screenshot. */
export function captureRenderFrame(frame: CaptureFrame, scale: number, pixelRatio: number) {
  const width = Math.ceil(frame.width * scale / pixelRatio / 2) * 2;
  const height = Math.ceil(frame.height * scale / pixelRatio / 2) * 2;
  assertCaptureSize(width * pixelRatio, height * pixelRatio);
  return { width, height, x: width / frame.width, y: height / frame.height };
}

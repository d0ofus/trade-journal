import type { Evidence } from "./types";

export type ImportedImage = Pick<Evidence, "id" | "name" | "image"> & { origin: "upload" | "clipboard" };
export function validateImageFile(file: Pick<Blob, "size" | "type">) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG or WebP image.");
  if (!file.size || file.size > 4_000_000) throw new Error("Choose a non-empty image no larger than 4 MB.");
}
export function validateImageDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("This image could not be decoded.");
  if (width * height > 16_000_000) throw new Error("Choose an image no larger than 16 megapixels.");
}
export function validateImageSignature(bytes: Uint8Array, mime: string) {
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!(mime === "image/png" && png || mime === "image/jpeg" && jpeg || mime === "image/webp" && webp)) throw new Error("This file is not a valid PNG, JPEG or WebP image.");
}

/** No external upload: normalize into the existing, size-checked review document. */
export async function importEvidenceImage(file: File, origin: ImportedImage["origin"], signal: AbortSignal): Promise<ImportedImage> {
  validateImageFile(file); signal.throwIfAborted();
  validateImageSignature(new Uint8Array(await file.slice(0, 12).arrayBuffer()), file.type); signal.throwIfAborted();
  const url = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { signal.removeEventListener("abort", abort); image.onload = null; image.onerror = null; };
      const abort = () => { cleanup(); image.src = ""; reject(new DOMException("Image import cancelled", "AbortError")); };
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(new Error("This image is corrupt or could not be decoded.")); };
      signal.addEventListener("abort", abort, { once: true });
      image.src = url;
    });
    signal.throwIfAborted(); validateImageDimensions(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image preview is unavailable in this browser.");
      context.drawImage(image, 0, 0);
      const png = canvas.toDataURL("image/png");
      if (!png.startsWith("data:image/png;base64,")) throw new Error("Could not prepare the image.");
      signal.throwIfAborted();
      return { id: crypto.randomUUID(), origin, image: png, name: (origin === "clipboard" ? `Clipboard screenshot ${new Date().toISOString().replace(/[:.]/g, "-")}.png` : file.name.replace(/\.[^.]+$/, "") + ".png").slice(0, 240) };
    } finally { canvas.width = 0; canvas.height = 0; }
  } finally { URL.revokeObjectURL(url); }
}

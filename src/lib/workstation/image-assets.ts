import type { Evidence } from "./types";

export const IMAGE_MAX_BYTES = 20_000_000;
export const REVIEW_IMAGE_MAX_BYTES = 50_000_000;
export const REVIEW_IMAGE_MAX_COUNT = 30;
export const IMAGE_MAX_PIXELS = 16_000_000;
export const EVIDENCE_PROTOCOL = 2;

/** Durable identifiers only. Signed URLs and downloaded bytes never belong in a review. */
export type ImageAssetReference = {
  id: string;
  storage: "r2" | "demo";
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  mime: "image/png";
};

export function inlineImageBytes(image: string) {
  const value = image.slice(image.indexOf(",") + 1);
  return Math.max(0, Math.floor(value.length * 3 / 4) - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0));
}

export function evidenceUsage(evidence: Pick<Evidence, "id" | "image" | "asset">[]) {
  const originals = new Map<string, number>();
  for (const e of evidence) originals.set(e.asset?.sha256 ?? e.image, e.asset?.bytes ?? inlineImageBytes(e.image));
  const bytes = [...originals.values()].reduce((sum, value) => sum + value, 0);
  return { count: evidence.length, bytes, remainingBytes: Math.max(0, REVIEW_IMAGE_MAX_BYTES - bytes), warning: bytes >= REVIEW_IMAGE_MAX_BYTES * .8 };
}

export function assertEvidenceCapacity(evidence: Pick<Evidence, "id" | "image" | "asset">[]) {
  if (evidence.length > REVIEW_IMAGE_MAX_COUNT) throw new Error("This review already has 30 images. Reuse an image or remove one first.");
  if (new Set(evidence.map(e => e.id)).size !== evidence.length) throw new Error("Evidence identifiers must be unique.");
  for (const e of evidence) {
    if ((e.asset?.bytes ?? inlineImageBytes(e.image)) > IMAGE_MAX_BYTES) throw new Error("This image exceeds 20,000,000 bytes. Choose Standard capture quality or a smaller image; quality has not been reduced.");
    if (e.asset && e.asset.width * e.asset.height > IMAGE_MAX_PIXELS) throw new Error("This image exceeds 16 megapixels.");
  }
  if (evidenceUsage(evidence).bytes > REVIEW_IMAGE_MAX_BYTES) throw new Error("This review exceeds 50,000,000 original image bytes. Download and remove older evidence or use a smaller capture. Quality has not been reduced.");
}

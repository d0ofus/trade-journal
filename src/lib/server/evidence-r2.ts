import { createHash } from "node:crypto";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { IMAGE_MAX_BYTES, IMAGE_MAX_PIXELS } from "@/lib/workstation/image-assets";

export class EvidenceStorageError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export function evidenceWritesEnabled() { return process.env.EVIDENCE_R2_WRITES_ENABLED === "1"; }
export function evidenceStorageConfig() {
  const account = process.env.EVIDENCE_R2_ACCOUNT_ID, bucket = process.env.EVIDENCE_R2_BUCKET;
  const accessKeyId = process.env.EVIDENCE_R2_ACCESS_KEY_ID, secretAccessKey = process.env.EVIDENCE_R2_SECRET_ACCESS_KEY;
  if (!account || !bucket || !accessKeyId || !secretAccessKey) throw new EvidenceStorageError("Private evidence storage is not configured. Your original image has not been reduced or saved inline.", 503);
  if (bucket === "chart-screener-artifacts" || bucket === process.env.R2_BUCKET) throw new EvidenceStorageError("Evidence must use a dedicated Trade Journal bucket.", 503);
  if (process.env.VERCEL_ENV === "production" && !bucket.endsWith("-production")) throw new EvidenceStorageError("Production evidence requires the dedicated production bucket.", 503);
  if (process.env.VERCEL_ENV !== "production" && bucket.endsWith("-production")) throw new EvidenceStorageError("Non-production cannot use the production evidence bucket.", 503);
  return { bucket, account, accessKeyId, secretAccessKey };
}
function storage() {
  const config = evidenceStorageConfig();
  return { bucket: config.bucket, client: new S3Client({ region: "auto", endpoint: `https://${config.account}.r2.cloudflarestorage.com`, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, maxAttempts: 3, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" }) };
}
export async function signEvidencePut(key: string, bytes: number) {
  if (!key.startsWith("pending/")) throw new EvidenceStorageError("Only temporary objects may be uploaded by the browser.", 400);
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > IMAGE_MAX_BYTES) throw new EvidenceStorageError("Invalid upload byte count.", 400);
  const { client, bucket } = storage();
  return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "image/png", ContentLength: bytes, IfNoneMatch: "*" }), { expiresIn: 300, signableHeaders: new Set(["content-type", "content-length", "if-none-match"]) });
}
export async function signEvidenceGet(key: string, download = false, contentType = "image/png") {
  const { client, bucket } = storage();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: contentType, ResponseContentDisposition: download ? "attachment" : "inline", ResponseCacheControl: "private, max-age=240" }), { expiresIn: 300 });
}
export async function readEvidenceObject(key: string, expectedBytes?: number) {
  const { client, bucket } = storage();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(15_000) });
  if (!response.Body || !response.ContentLength || response.ContentLength > IMAGE_MAX_BYTES || expectedBytes !== undefined && response.ContentLength !== expectedBytes) {
    await response.Body?.transformToWebStream().cancel();
    throw new EvidenceStorageError("The uploaded image size does not match or exceeds 20,000,000 bytes.", 413);
  }
  // Never allocate an unbounded object, even if a provider sends an incorrect length.
  const chunks: Uint8Array[] = []; let length = 0;
  const reader = response.Body.transformToWebStream().getReader();
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > IMAGE_MAX_BYTES) throw new EvidenceStorageError("Image exceeds the byte limit.", 413); chunks.push(value); } }
  catch (error) { await reader.cancel(); throw error; }
  if (length !== response.ContentLength) throw new EvidenceStorageError("The image transfer was incomplete. Retry this image.");
  return Buffer.concat(chunks, length);
}
export async function evidenceObjectExists(key: string) {
  const { client, bucket } = storage();
  try { const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(10_000) }); return { bytes: result.ContentLength ?? 0 }; }
  catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null; throw error; }
}
export async function putEvidenceObject(key: string, bytes: Buffer) {
  const { client, bucket } = storage();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: key.endsWith(".png") ? "image/png" : "application/octet-stream", ContentLength: bytes.length, CacheControl: "private, max-age=240", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(15_000) });
}
export async function deleteEvidenceObject(key: string, deadline = Date.now() + 10_000) {
  const { client, bucket } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))) });
}
export async function verifyEvidencePng(bytes: Buffer) {
  if (!bytes.length || bytes.length > IMAGE_MAX_BYTES) throw new EvidenceStorageError("Image exceeds 20,000,000 bytes.", 413);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new EvidenceStorageError("Evidence must be a valid PNG.", 400);
  try {
    const decoder = sharp(bytes, { limitInputPixels: IMAGE_MAX_PIXELS, failOn: "warning", animated: true });
    const metadata = await decoder.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > IMAGE_MAX_PIXELS || (metadata.pages ?? 1) !== 1) throw new Error("Invalid dimensions or animated PNG");
    // Full pixel decoding detects corrupt/truncated data. Originals are never re-encoded.
    await decoder.clone().raw().toBuffer();
    const thumbnail = await decoder.clone().resize({ width: 480, height: 320, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    return { width: metadata.width, height: metadata.height, bytes: bytes.length, thumbnail, sha256: createHash("sha256").update(bytes).digest("hex"), notionHash: createHash("sha256").update(JSON.stringify(bytes.toString("base64"))).digest("hex") };
  } catch { throw new EvidenceStorageError("The PNG is corrupt, animated, or exceeds 16 megapixels.", 400); }
}

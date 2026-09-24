/** Opt-in live protocol check. Only generated images in the dedicated non-production bucket. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { chromium, type Browser } from "@playwright/test";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { evidenceStorageConfig, signEvidencePut, signEvidenceGet, readEvidenceObject, putEvidenceObject, deleteEvidenceObject, evidenceObjectExists, verifyEvidencePng } from "../src/lib/server/evidence-r2";

let stage = "guard", browser: Browser | undefined;
const ownedKeys: string[] = [];
const report = (value: object) => console.log(JSON.stringify(value));
async function main() {
  assert.equal(process.env.ALLOW_LIVE_R2_TEST, "1", "Live non-production validation must be explicitly enabled.");
  assert.notEqual(process.env.VERCEL_ENV, "production");
  const config = evidenceStorageConfig();
  assert.equal(config.bucket, "trade-journal-evidence-nonproduction");
  const id = randomUUID(), pending = `pending/${id}.png`;
  const png = await sharp(randomBytes(1300 * 1200 * 3), { raw: { width: 1300, height: 1200, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  assert(png.length > 4_500_000 && png.length < 5_242_880);
  const hash = createHash("sha256").update(png).digest("hex");
  const original = `originals/${id}/${hash}.png`, thumbnail = `thumbnails/${id}/${hash}.png`;
  const uploadUrl = await signEvidencePut(pending, png.length);
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3101/login");
  stage = "browser-cors-large-put";
  ownedKeys.push(pending);
  const send = () => page.evaluate(async ({ url, base64 }) => {
    const body = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const response = await fetch(url, { method: "PUT", headers: { "Content-Type": "image/png", "If-None-Match": "*" }, body, signal: AbortSignal.timeout(30000) });
    return response.status;
  }, { url: uploadUrl, base64: png.toString("base64") });
  assert.equal(await send(), 200);
  assert.deepEqual(await evidenceObjectExists(pending), { bytes: png.length });
  assert.equal(await send(), 412, "A repeated signed PUT must not overwrite its existing object.");
  report({ check: stage, passed: true, originalBytes: png.length, repeatPut: 412 });

  stage = "signed-length-and-origin";
  const wrongKey = `pending/${randomUUID()}.png`; ownedKeys.push(wrongKey);
  const wrongLengthUrl = await signEvidencePut(wrongKey, png.length);
  const wrong = await fetch(wrongLengthUrl, { method: "PUT", headers: { "Content-Type": "image/png", "If-None-Match": "*" }, body: png.subarray(0, 64), signal: AbortSignal.timeout(15000) });
  assert.equal(wrong.status, 403); await wrong.body?.cancel();
  assert.equal(await evidenceObjectExists(wrongKey), null);
  const otherOrigin = await fetch(uploadUrl, { method: "OPTIONS", headers: { Origin: "https://untrusted.invalid", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type,if-none-match" }, signal: AbortSignal.timeout(15000) });
  assert.notEqual(otherOrigin.headers.get("access-control-allow-origin"), "https://untrusted.invalid");
  await otherOrigin.body?.cancel();
  report({ check: stage, passed: true, wrongLength: 403 });

  stage = "immutable-original-and-thumbnail";
  const verified = await verifyEvidencePng(await readEvidenceObject(pending, png.length));
  assert.equal(verified.sha256, hash);
  for (const [key, bytes] of [[original, png], [thumbnail, verified.thumbnail]] as const) {
    ownedKeys.push(key); await putEvidenceObject(key, bytes);
  }
  await assert.rejects(putEvidenceObject(original, Buffer.from("must not overwrite")), error => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412);
  assert((await readEvidenceObject(original, png.length)).equals(png));
  assert((await readEvidenceObject(thumbnail, verified.thumbnail.length)).equals(verified.thumbnail));
  const readUrl = await signEvidenceGet(original, true);
  const downloaded = await page.evaluate(async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const bytes = await response.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(v => v.toString(16).padStart(2, "0")).join("");
    return { status: response.status, bytes: bytes.byteLength, hash };
  }, readUrl);
  assert.deepEqual(downloaded, { status: 200, bytes: png.length, hash });
  report({ check: stage, passed: true, byteIdentical: true, width: verified.width, height: verified.height, thumbnailBytes: verified.thumbnail.length });

  stage = "private-and-expired-access";
  const unsignedUrl = new URL(readUrl); unsignedUrl.search = "";
  const unsigned = await fetch(unsignedUrl, { signal: AbortSignal.timeout(15000) });
  report({ check: "unsigned-response", status: unsigned.status });
  // The S3 endpoint can reject a missing Authorization mechanism as 400, or deny it as 403.
  assert([400, 403].includes(unsigned.status)); await unsigned.body?.cancel();
  const client = new S3Client({ region: "auto", endpoint: `https://${config.account}.r2.cloudflarestorage.com`, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
  try {
    const expiredUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: original }), { expiresIn: 30, signingDate: new Date(Date.now() - 600000) });
    const expired = await fetch(expiredUrl, { signal: AbortSignal.timeout(15000) });
    report({ check: "expired-response", status: expired.status });
    assert.equal(expired.status, 403); await expired.body?.cancel();
  } finally { client.destroy(); }
  report({ check: stage, passed: true, unsigned: unsigned.status, expired: 403 });
}
main().catch(error => {
  // SDK/browser exceptions can contain signed URLs; never log raw errors or traces.
  report({ check: stage, passed: false, status: (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode, credentialsLogged: false });
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  let removed = 0;
  for (const key of ownedKeys) {
    try { await deleteEvidenceObject(key); assert.equal(await evidenceObjectExists(key), null); removed++; }
    catch { report({ check: "cleanup", passed: false, remainingGeneratedObjects: ownedKeys.length - removed }); process.exitCode = 1; break; }
  }
  report({ check: "cleanup", removedGeneratedObjects: removed, productionChanged: false });
});

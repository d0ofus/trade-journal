import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type StoredScreenshot = {
  key: string;
  url: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
};

let r2Client: S3Client | null = null;

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return r2Client;
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid screenshot data URL.");
  }
  const mimeType = match[1];
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  return {
    mimeType,
    extension,
    buffer: Buffer.from(match[2], "base64"),
  };
}

function publicBaseUrlForR2() {
  return process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? "";
}

export async function storeJournalScreenshot(input: {
  journalEntryId: string;
  chartId: string;
  dataUrl: string;
  width?: number | null;
  height?: number | null;
}): Promise<StoredScreenshot> {
  const parsed = parseDataUrl(input.dataUrl);
  const key = `journal/${input.journalEntryId}/${input.chartId}-${randomUUID()}.${parsed.extension}`;
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET;
  const publicBaseUrl = publicBaseUrlForR2();

  if (client && bucket && publicBaseUrl) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: parsed.buffer,
        ContentType: parsed.mimeType,
        CacheControl: "private, max-age=31536000, immutable",
      }),
    );
    return {
      key,
      url: `${publicBaseUrl}/${key}`,
      mimeType: parsed.mimeType,
      width: input.width,
      height: input.height,
    };
  }

  if (process.env.NODE_ENV === "production") {
    return {
      key: `inline:${key}`,
      url: input.dataUrl,
      mimeType: parsed.mimeType,
      width: input.width,
      height: input.height,
    };
  }

  const localDir = path.join(process.cwd(), "public", "journal-screenshots", input.journalEntryId);
  await mkdir(localDir, { recursive: true });
  const filename = `${input.chartId}-${randomUUID()}.${parsed.extension}`;
  await writeFile(path.join(localDir, filename), parsed.buffer);
  return {
    key: `local:${input.journalEntryId}/${filename}`,
    url: `/journal-screenshots/${input.journalEntryId}/${filename}`,
    mimeType: parsed.mimeType,
    width: input.width,
    height: input.height,
  };
}

import type { BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { prisma } from "../../src/lib/prisma";
import { assertTestDatabaseSafety } from "../../src/lib/test-database-safety";
import { verifyEvidencePng } from "../../src/lib/server/evidence-r2";
import { assetReference } from "../../src/lib/server/evidence-assets";

// Exercise real authenticated review persistence with local object transport only.
export async function mockEvidenceTransport(context: BrowserContext) {
  assertTestDatabaseSafety(process.env);
  const uploads = new Map<string, Buffer>();
  const directory = ".vercel/dashboard-test-evidence";
  await mkdir(directory, { recursive: true });
  await context.route("**/__mock-evidence/*", async route => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (route.request().method() === "PUT") { uploads.set(id, route.request().postDataBuffer()!); return route.fulfill({ status: 200 }); }
    if (!/^[a-z0-9-]+$/i.test(id)) return route.fulfill({ status: 400 });
    return route.fulfill({ contentType: "image/png", body: await readFile(`${directory}/${id}.png`) });
  });
  await context.route("**/api/closed-trades/*/evidence**", async route => {
    const url = new URL(route.request().url()), tradeId = decodeURIComponent(url.pathname.split("/")[3]);
    const trade = await prisma.closedTrade.findFirstOrThrow({ where: { groupKey: tradeId, account: { ibkrAccount: "DEMO-WORKSTATION" } } });
    if (route.request().method() === "GET") return route.fulfill({ json: { url: `${url.origin}/__mock-evidence/${url.searchParams.get("asset")}` } });
    const body = route.request().postDataJSON();
    if (body.action === "create") { const id = randomUUID(); return route.fulfill({ json: { id, url: `${url.origin}/__mock-evidence/${id}`, headers: { "Content-Type": "image/png" } } }); }
    const original = uploads.get(body.id)!;
    const verified = await verifyEvidencePng(original);
    const id = randomUUID();
    const asset = await prisma.evidenceAsset.upsert({ where: { tradeId_sha256: { tradeId: trade.groupKey, sha256: verified.sha256 } }, update: {}, create: { id, tradeId: trade.groupKey, ownerId: "local-user", sha256: verified.sha256, notionHash: verified.notionHash, bytes: verified.bytes, width: verified.width, height: verified.height, thumbnailBytes: verified.thumbnail.length, objectKey: `mock/${id}/original.png`, thumbnailKey: `mock/${id}/thumbnail.png` } });
    await writeFile(`${directory}/${asset.id}.png`, original);
    return route.fulfill({ json: { asset: assetReference(asset) } });
  });
}

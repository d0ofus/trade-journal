import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createEvidenceUpload, evidenceUploadStatus, finalizeEvidenceUpload, cancelEvidenceUpload, assertEvidenceTrade } from "@/lib/server/evidence-assets";
import { EvidenceStorageError, signEvidenceGet } from "@/lib/server/evidence-r2";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ groupKey: string }> };
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), clientKey: z.string().min(1).max(200), bytes: z.number().int().positive() }),
  z.object({ action: z.literal("finalize"), id: z.string().min(1).max(200) }),
  z.object({ action: z.literal("cancel"), id: z.string().min(1).max(200) }),
]);
async function handle(request: NextRequest, context: Context, write: boolean) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.TRADES_WORKSTATION_ENABLED !== "1") return NextResponse.json({ error: "Workstation is not enabled." }, { status: 404 });
  if (write && request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Cross-origin writes are not permitted." }, { status: 403 });
  try {
    const tradeId = (await context.params).groupKey, ownerId = session.user.id;
    let result: unknown;
    if (!write) {
      const id = request.nextUrl.searchParams.get("upload");
      if (id) result = await evidenceUploadStatus(id, tradeId, ownerId);
      else {
        await assertEvidenceTrade(tradeId, prisma, false);
        const asset = await prisma.evidenceAsset.findFirst({ where: { id: request.nextUrl.searchParams.get("asset") ?? "", tradeId, ownerId, state: "ready" } });
        if (!asset) throw new EvidenceStorageError("Image not found.", 404);
        const thumbnail = request.nextUrl.searchParams.get("variant") === "thumbnail";
        result = { url: await signEvidenceGet(thumbnail ? asset.thumbnailKey : asset.objectKey, request.nextUrl.searchParams.get("download") === "1"), expiresAt: Date.now() + 240_000, bytes: thumbnail ? asset.thumbnailBytes : asset.bytes, width: asset.width, height: asset.height };
      }
    } else {
      const body = await request.text();
      if (new TextEncoder().encode(body).length > 4096) throw new EvidenceStorageError("Upload metadata is too large. Image bytes must be sent directly to storage.", 413);
      const action = actions.parse(JSON.parse(body));
      if (action.action === "create") result = await createEvidenceUpload(tradeId, ownerId, action.clientKey, action.bytes);
      else if (action.action === "finalize") result = { state: "ready", asset: await finalizeEvidenceUpload(action.id, tradeId, ownerId) };
      else { await cancelEvidenceUpload(action.id, tradeId, ownerId); result = { state: "cancelled" }; }
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof EvidenceStorageError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503;
    return NextResponse.json({ error: error instanceof EvidenceStorageError ? error.message : status === 400 ? "Invalid upload metadata." : "Private image storage is temporarily unavailable. Retry or check progress; no inline fallback was used." }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
export const GET = (request: NextRequest, context: Context) => handle(request, context, false);
export const POST = (request: NextRequest, context: Context) => handle(request, context, true);

import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionOrBearerSecret } from "@/lib/server/api-auth";
import { loadStorageUsage } from "@/lib/server/storage-usage";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const auth = await requireApiSessionOrBearerSecret(request);
  if (auth) return auth;
  try { return NextResponse.json(await loadStorageUsage(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "Storage measurements are unavailable. Try refreshing shortly." }, { status: 503 }); }
}

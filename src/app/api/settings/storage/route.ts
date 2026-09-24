import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionOrBearerSecret } from "@/lib/server/api-auth";
import { loadStorageUsage } from "@/lib/server/storage-usage";
import { refreshR2AccountUsage } from "@/lib/server/r2-account-metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const auth = await requireApiSessionOrBearerSecret(request);
  if (auth) return auth;
  try { return NextResponse.json(await loadStorageUsage(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "Storage measurements are unavailable. Try refreshing shortly." }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiSessionOrBearerSecret(request);
  if (auth) return auth;
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin && !request.headers.get("authorization")?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Cross-origin metrics refresh is not allowed." }, { status: 403 });
  }
  try { return NextResponse.json(await refreshR2AccountUsage(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "Cloudflare metrics refresh is unavailable. The last valid reading was retained." }, { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
}

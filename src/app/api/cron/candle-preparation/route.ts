import { NextRequest, NextResponse } from "next/server";
import { requireBearerSecret } from "@/lib/server/api-auth";
import { recoverCandlePreparation } from "@/lib/server/workstation-cache-jobs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: NextRequest) {
  const auth = requireBearerSecret(req); if (auth) return auth;
  try { return NextResponse.json({ ok: true, result: await recoverCandlePreparation() ?? { paused: "Preparation disabled." } }); }
  catch { return NextResponse.json({ ok: false, error: "Cache preparation will resume on the next run." }, { status: 503 }); }
}

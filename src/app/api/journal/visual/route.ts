import { NextRequest, NextResponse } from "next/server";
import { listJournalVisual } from "@/lib/server/journal";
import { requireApiSession } from "@/lib/server/api-auth";

export async function GET(req: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const params = req.nextUrl.searchParams;
  const rows = await listJournalVisual({
    q: params.get("q"),
    tag: params.get("tag"),
    category: params.get("category"),
    status: params.get("status"),
    macroSentiment: params.get("macroSentiment"),
    outcomeStatus: params.get("outcomeStatus"),
    marketRegime: params.get("marketRegime"),
    playbookId: params.get("playbookId"),
    symbol: params.get("symbol"),
    purpose: params.get("purpose"),
    timeframe: params.get("timeframe"),
    minFitScore: params.get("minFitScore"),
    minBestExitR: params.get("minBestExitR"),
    from: params.get("from"),
    to: params.get("to"),
  });
  return NextResponse.json({ rows });
}

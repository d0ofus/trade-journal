import { NextRequest, NextResponse } from "next/server";
import { journalEntryPayloadSchema } from "@/lib/journal/schema";
import {
  createJournalEntry,
  listJournalEntries,
  mapJournalPayloadToData,
} from "@/lib/server/journal";

export async function GET(req: NextRequest) {
  const rows = await listJournalEntries({
    q: req.nextUrl.searchParams.get("q"),
    tag: req.nextUrl.searchParams.get("tag"),
    category: req.nextUrl.searchParams.get("category"),
    status: req.nextUrl.searchParams.get("status"),
    macroSentiment: req.nextUrl.searchParams.get("macroSentiment"),
    outcomeStatus: req.nextUrl.searchParams.get("outcomeStatus"),
    marketRegime: req.nextUrl.searchParams.get("marketRegime"),
    playbookId: req.nextUrl.searchParams.get("playbookId"),
    chartFilter: req.nextUrl.searchParams.get("chartFilter"),
    symbol: req.nextUrl.searchParams.get("symbol"),
    limit: Number(req.nextUrl.searchParams.get("limit") ?? "50"),
  });
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = journalEntryPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const entry = await createJournalEntry(mapJournalPayloadToData(parsed.data));
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save journal entry." }, { status: 500 });
  }
}

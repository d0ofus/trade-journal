import { NextRequest, NextResponse } from "next/server";
import { journalSavedViewPayloadSchema } from "@/lib/journal/schema";
import { createJournalSavedView, listJournalSavedViews } from "@/lib/server/journal";

export async function GET(req: NextRequest) {
  const rows = await listJournalSavedViews(req.nextUrl.searchParams.get("viewType"));
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = journalSavedViewPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const view = await createJournalSavedView(parsed.data);
  return NextResponse.json({ view }, { status: 201 });
}

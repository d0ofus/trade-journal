import { NextRequest, NextResponse } from "next/server";
import { journalSavedViewPayloadSchema } from "@/lib/journal/schema";
import { createJournalSavedView, listJournalSavedViews } from "@/lib/server/journal";
import { requireApiSession } from "@/lib/server/api-auth";

export async function GET(req: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const rows = await listJournalSavedViews(req.nextUrl.searchParams.get("viewType"));
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const body = await req.json();
  const parsed = journalSavedViewPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const view = await createJournalSavedView(parsed.data);
  return NextResponse.json({ view }, { status: 201 });
}

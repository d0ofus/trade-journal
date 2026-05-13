import { NextRequest, NextResponse } from "next/server";
import { journalDraftPayloadSchema } from "@/lib/journal/schema";
import { createJournalDraft, mapJournalPayloadToData } from "@/lib/server/journal";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = journalDraftPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const entry = await createJournalDraft(mapJournalPayloadToData(parsed.data));
  return NextResponse.json({ entry }, { status: 201 });
}

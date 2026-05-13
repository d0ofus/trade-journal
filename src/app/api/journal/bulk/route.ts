import { NextRequest, NextResponse } from "next/server";
import { journalBulkPayloadSchema } from "@/lib/journal/schema";
import { bulkUpdateJournalEntries } from "@/lib/server/journal";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = journalBulkPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const rows = await bulkUpdateJournalEntries(parsed.data);
  return NextResponse.json({ rows });
}

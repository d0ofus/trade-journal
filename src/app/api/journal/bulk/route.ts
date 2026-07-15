import { NextRequest, NextResponse } from "next/server";
import { journalBulkPayloadSchema } from "@/lib/journal/schema";
import { bulkUpdateJournalEntries } from "@/lib/server/journal";
import { requireApiSession } from "@/lib/server/api-auth";

export async function POST(req: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const body = await req.json();
  const parsed = journalBulkPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const rows = await bulkUpdateJournalEntries(parsed.data);
  return NextResponse.json({ rows });
}

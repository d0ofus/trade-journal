import { NextRequest, NextResponse } from "next/server";
import { journalTagOperationSchema } from "@/lib/journal/schema";
import { removeJournalTag } from "@/lib/server/journal";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = journalTagOperationSchema.safeParse(body);
  if (!parsed.success || !parsed.data.name) {
    return NextResponse.json({ error: parsed.success ? "name is required." : parsed.error.flatten() }, { status: 400 });
  }
  const rows = await removeJournalTag({
    category: parsed.data.category,
    name: parsed.data.name,
    ids: parsed.data.ids,
  });
  return NextResponse.json({ rows });
}

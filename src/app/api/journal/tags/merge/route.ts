import { NextRequest, NextResponse } from "next/server";
import { journalTagOperationSchema } from "@/lib/journal/schema";
import { mergeJournalTag } from "@/lib/server/journal";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = journalTagOperationSchema.safeParse(body);
  if (!parsed.success || !parsed.data.from || !parsed.data.to) {
    return NextResponse.json({ error: parsed.success ? "from and to are required." : parsed.error.flatten() }, { status: 400 });
  }
  const rows = await mergeJournalTag({
    category: parsed.data.category,
    from: parsed.data.from,
    to: parsed.data.to,
    ids: parsed.data.ids,
  });
  return NextResponse.json({ rows });
}

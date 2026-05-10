import { NextRequest, NextResponse } from "next/server";
import { journalPlaybookPayloadSchema } from "@/lib/journal/schema";
import { createJournalPlaybook, listJournalPlaybooks } from "@/lib/server/journal";

export async function GET(req: NextRequest) {
  const rows = await listJournalPlaybooks({
    includeArchived: req.nextUrl.searchParams.get("includeArchived") === "true",
  });
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = journalPlaybookPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const playbook = await createJournalPlaybook(parsed.data);
  return NextResponse.json({ playbook }, { status: 201 });
}

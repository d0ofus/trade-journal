import { NextRequest, NextResponse } from "next/server";
import { journalPlaybookPayloadSchema } from "@/lib/journal/schema";
import { createJournalPlaybook, listJournalPlaybooks } from "@/lib/server/journal";
import { requireApiSession } from "@/lib/server/api-auth";

export async function GET(req: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const rows = await listJournalPlaybooks({
    includeArchived: req.nextUrl.searchParams.get("includeArchived") === "true",
  });
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const body = await req.json();
  const parsed = journalPlaybookPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const playbook = await createJournalPlaybook(parsed.data);
  return NextResponse.json({ playbook }, { status: 201 });
}

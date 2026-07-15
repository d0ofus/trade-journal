import { NextResponse } from "next/server";
import { listJournalInbox } from "@/lib/server/journal";
import { requireApiSession } from "@/lib/server/api-auth";

export async function GET() {
  const authError = await requireApiSession();
  if (authError) return authError;

  const inbox = await listJournalInbox();
  return NextResponse.json({ inbox });
}

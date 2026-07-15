import { NextResponse } from "next/server";
import { listJournalTags } from "@/lib/server/journal";
import { requireApiSession } from "@/lib/server/api-auth";

export async function GET() {
  const authError = await requireApiSession();
  if (authError) return authError;

  const rows = await listJournalTags();
  return NextResponse.json({ rows });
}

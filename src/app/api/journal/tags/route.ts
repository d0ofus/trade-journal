import { NextResponse } from "next/server";
import { listJournalTags } from "@/lib/server/journal";

export async function GET() {
  const rows = await listJournalTags();
  return NextResponse.json({ rows });
}

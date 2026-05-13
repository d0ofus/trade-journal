import { NextResponse } from "next/server";
import { listJournalInbox } from "@/lib/server/journal";

export async function GET() {
  const inbox = await listJournalInbox();
  return NextResponse.json({ inbox });
}

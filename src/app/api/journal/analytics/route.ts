import { NextResponse } from "next/server";
import { getJournalAnalytics } from "@/lib/server/journal";

export async function GET() {
  const analytics = await getJournalAnalytics();
  return NextResponse.json({ analytics });
}

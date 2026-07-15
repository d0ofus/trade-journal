import { NextResponse } from "next/server";
import { getJournalAnalytics } from "@/lib/server/journal";
import { requireApiSession } from "@/lib/server/api-auth";

export async function GET() {
  const authError = await requireApiSession();
  if (authError) return authError;

  const analytics = await getJournalAnalytics();
  return NextResponse.json({ analytics });
}

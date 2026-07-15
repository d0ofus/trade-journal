import { NextRequest, NextResponse } from "next/server";
import { journalReviewPayloadSchema } from "@/lib/journal/schema";
import { createJournalReview, listJournalReviews } from "@/lib/server/journal";
import { requireApiSession } from "@/lib/server/api-auth";

export async function GET() {
  const authError = await requireApiSession();
  if (authError) return authError;

  const rows = await listJournalReviews();
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const body = await req.json();
  const parsed = journalReviewPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const review = await createJournalReview(parsed.data);
  return NextResponse.json({ review }, { status: 201 });
}

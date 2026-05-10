import { NextRequest, NextResponse } from "next/server";
import { journalReviewPatchSchema } from "@/lib/journal/schema";
import { deleteJournalReview, updateJournalReview } from "@/lib/server/journal";

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  const body = await req.json();
  const parsed = journalReviewPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const review = await updateJournalReview(id, parsed.data);
  return NextResponse.json({ review });
}

export async function DELETE(_req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  await deleteJournalReview(id);
  return NextResponse.json({ ok: true });
}

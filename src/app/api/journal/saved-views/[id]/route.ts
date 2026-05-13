import { NextRequest, NextResponse } from "next/server";
import { journalSavedViewPatchSchema } from "@/lib/journal/schema";
import { deleteJournalSavedView, updateJournalSavedView } from "@/lib/server/journal";

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  const body = await req.json();
  const parsed = journalSavedViewPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const view = await updateJournalSavedView(id, parsed.data);
  return NextResponse.json({ view });
}

export async function DELETE(_req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  await deleteJournalSavedView(id);
  return NextResponse.json({ ok: true });
}

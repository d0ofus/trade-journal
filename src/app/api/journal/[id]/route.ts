import { NextRequest, NextResponse } from "next/server";
import { journalEntryPatchSchema } from "@/lib/journal/schema";
import {
  deleteJournalEntry,
  getJournalEntry,
  mapJournalPayloadToData,
  updateJournalEntry,
} from "@/lib/server/journal";

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  const entry = await getJournalEntry(id);
  if (!entry) return NextResponse.json({ error: "Journal entry not found." }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function PATCH(req: NextRequest, props: { params: Params }) {
  try {
    const { id } = await props.params;
    const body = await req.json();
    const parsed = journalEntryPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const entry = await updateJournalEntry(id, mapJournalPayloadToData(parsed.data));
    return NextResponse.json({ entry });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save journal entry." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  await deleteJournalEntry(id);
  return NextResponse.json({ ok: true });
}

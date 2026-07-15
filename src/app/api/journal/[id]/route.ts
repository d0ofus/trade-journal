import { NextRequest, NextResponse } from "next/server";
import { journalEntryDeleteSchema, journalEntryPatchSchema } from "@/lib/journal/schema";
import { requireApiSession } from "@/lib/server/api-auth";
import {
  deleteJournalEntry,
  getJournalEntry,
  JournalStaleWriteError,
  mapJournalPayloadToData,
  updateJournalEntry,
} from "@/lib/server/journal";

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, props: { params: Params }) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const { id } = await props.params;
  const entry = await getJournalEntry(id);
  if (!entry) return NextResponse.json({ error: "Journal entry not found." }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function PATCH(req: NextRequest, props: { params: Params }) {
  const authError = await requireApiSession();
  if (authError) return authError;

  try {
    const { id } = await props.params;
    const body = await req.json();
    const parsed = journalEntryPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    if (!parsed.data.expectedUpdatedAt) {
      return NextResponse.json({ error: "expectedUpdatedAt is required for journal entry updates." }, { status: 409 });
    }

    const entry = await updateJournalEntry(id, mapJournalPayloadToData(parsed.data));
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof JournalStaleWriteError) {
      return NextResponse.json(
        { error: error.message, currentUpdatedAt: error.currentUpdatedAt },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save journal entry." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, props: { params: Params }) {
  const authError = await requireApiSession();
  if (authError) return authError;

  try {
    const { id } = await props.params;
    const body = await req.json().catch(() => ({}));
    const parsed = journalEntryDeleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    if (!parsed.data.expectedUpdatedAt) {
      return NextResponse.json({ error: "expectedUpdatedAt is required for journal entry deletes." }, { status: 409 });
    }

    await deleteJournalEntry(id, { expectedUpdatedAt: parsed.data.expectedUpdatedAt });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof JournalStaleWriteError) {
      return NextResponse.json(
        { error: error.message, currentUpdatedAt: error.currentUpdatedAt },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete journal entry." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { journalPlaybookPatchSchema } from "@/lib/journal/schema";
import { deleteJournalPlaybook, JournalStaleWriteError, updateJournalPlaybook } from "@/lib/server/journal";
import { requireApiSession } from "@/lib/server/api-auth";

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, props: { params: Params }) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const { id } = await props.params;
  const body = await req.json();
  const parsed = journalPlaybookPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!parsed.data.expectedUpdatedAt) {
    return NextResponse.json({ error: "expectedUpdatedAt is required for playbook updates." }, { status: 409 });
  }

  try {
    const playbook = await updateJournalPlaybook(id, parsed.data);
    return NextResponse.json({ playbook });
  } catch (error) {
    if (error instanceof JournalStaleWriteError) {
      return NextResponse.json(
        { error: error.message, currentUpdatedAt: error.currentUpdatedAt },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save playbook." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Params }) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const { id } = await props.params;
  await deleteJournalPlaybook(id);
  return NextResponse.json({ ok: true });
}

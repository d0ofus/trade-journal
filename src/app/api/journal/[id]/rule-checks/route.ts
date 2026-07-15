import { NextRequest, NextResponse } from "next/server";
import { journalRuleChecksPayloadSchema } from "@/lib/journal/schema";
import { JournalStaleWriteError, syncJournalRuleChecks } from "@/lib/server/journal";
import { requireApiSession } from "@/lib/server/api-auth";

type Params = Promise<{ id: string }>;

async function upsertChecks(req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  const body = await req.json();
  const parsed = journalRuleChecksPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!parsed.data.expectedUpdatedAt) {
    return NextResponse.json({ error: "expectedUpdatedAt is required for rule check updates." }, { status: 409 });
  }

  try {
    const entry = await syncJournalRuleChecks(id, parsed.data.checks, {
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
    });
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof JournalStaleWriteError) {
      return NextResponse.json(
        { error: error.message, currentUpdatedAt: error.currentUpdatedAt },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save rule checks." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, props: { params: Params }) {
  const authError = await requireApiSession();
  if (authError) return authError;

  return upsertChecks(req, props);
}

export async function PATCH(req: NextRequest, props: { params: Params }) {
  const authError = await requireApiSession();
  if (authError) return authError;

  return upsertChecks(req, props);
}

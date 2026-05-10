import { NextRequest, NextResponse } from "next/server";
import { journalRuleChecksPayloadSchema } from "@/lib/journal/schema";
import { syncJournalRuleChecks } from "@/lib/server/journal";

type Params = Promise<{ id: string }>;

async function upsertChecks(req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  const body = await req.json();
  const parsed = journalRuleChecksPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const entry = await syncJournalRuleChecks(id, parsed.data.checks);
  return NextResponse.json({ entry });
}

export async function POST(req: NextRequest, props: { params: Params }) {
  return upsertChecks(req, props);
}

export async function PATCH(req: NextRequest, props: { params: Params }) {
  return upsertChecks(req, props);
}

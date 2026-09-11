import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/server/api-auth";
import { rejectE2eNonDemoClosedTrade } from "@/lib/server/e2e-demo-write-guard";
import { readWorkstationDocument, saveWorkstationDocument, WorkstationError } from "@/lib/server/trade-workstation";
import { workstationDocumentSchema } from "@/lib/workstation/schema";
import { REVIEW_PACKAGE_MAX_BYTES, REVIEW_PACKAGE_TOO_LARGE } from "@/lib/workstation/payload";
type Params = { params: Promise<{ groupKey: string }> };
export async function GET(_request: NextRequest, { params }: Params) {
  const error = await requireApiSession(); if (error) return error;
  if (process.env.TRADES_WORKSTATION_ENABLED !== "1") return NextResponse.json({ error: "Workstation is not enabled." }, { status: 404 });
  try { return NextResponse.json(await readWorkstationDocument((await params).groupKey), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { if (e instanceof WorkstationError) return NextResponse.json({ error: e.message }, { status: e.status }); throw e; }
}
export async function PATCH(request: NextRequest, { params }: Params) {
  const authError = await requireApiSession(); if (authError) return authError;
  if (process.env.TRADES_WORKSTATION_ENABLED !== "1") return NextResponse.json({ error: "Workstation is not enabled." }, { status: 404 });
  const groupKey = (await params).groupKey;
  const trade = await prisma.closedTrade.findUnique({ where: { groupKey }, select: { account: { select: { ibkrAccount: true } } } });
  if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  const guard = rejectE2eNonDemoClosedTrade(trade.account.ibkrAccount); if (guard) return guard;
  let raw: unknown; try { const body = await request.text(); if (new TextEncoder().encode(body).byteLength > REVIEW_PACKAGE_MAX_BYTES) return NextResponse.json({ error: REVIEW_PACKAGE_TOO_LARGE }, { status: 413 }); raw = JSON.parse(body); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = z.object({ expectedRevision: z.number().int().nonnegative(), document: workstationDocumentSchema }).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid review document", details: parsed.error.flatten() }, { status: 400 });
  try { return NextResponse.json(await saveWorkstationDocument(groupKey, parsed.data.document, parsed.data.expectedRevision)); }
  catch (e) { if (e instanceof WorkstationError) return NextResponse.json({ error: e.message }, { status: e.status }); throw e; }
}

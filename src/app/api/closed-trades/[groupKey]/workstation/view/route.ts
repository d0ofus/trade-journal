import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/server/api-auth";
import { rejectE2eNonDemoClosedTrade } from "@/lib/server/e2e-demo-write-guard";
import { WorkstationError } from "@/lib/server/trade-workstation";
import { readTradeView, saveTradeView } from "@/lib/server/workstation-trade-view";
import { tradeViewSchema } from "@/lib/workstation/trade-view";
type Params = { params: Promise<{ groupKey: string }> };
async function authorize(groupKey: string) {
  const auth = await requireApiSession(); if (auth) return auth;
  if (process.env.TRADES_WORKSTATION_ENABLED !== "1") return NextResponse.json({ error: "Workstation is not enabled." }, { status: 404 });
  const trade = await prisma.closedTrade.findUnique({ where: { groupKey }, select: { account: { select: { ibkrAccount: true } } } });
  if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  return trade;
}
export async function GET(_request: NextRequest, { params }: Params) {
  const { groupKey } = await params, auth = await authorize(groupKey); if (auth instanceof NextResponse) return auth;
  return NextResponse.json(await readTradeView(groupKey), { headers: { "Cache-Control": "private, no-store" } });
}
export async function PATCH(request: NextRequest, { params }: Params) {
  const { groupKey } = await params, auth = await authorize(groupKey); if (auth instanceof NextResponse) return auth;
  const guard = rejectE2eNonDemoClosedTrade(auth.account.ibkrAccount); if (guard) return guard;
  const origin = request.headers.get("origin");
  if (origin) { try { if (new URL(origin).host !== (request.headers.get("host") ?? request.nextUrl.host)) throw new Error(); } catch { return NextResponse.json({ error: "Cross-origin changes are not allowed." }, { status: 403 }); } }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 16000) return NextResponse.json({ error: "Chart view exceeds 16 KB." }, { status: 413 });
  let raw: unknown; try { raw = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = z.object({ expectedRevision: z.number().int().nonnegative(), view: tradeViewSchema }).strict().safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid chart view" }, { status: 400 });
  try { return NextResponse.json(await saveTradeView(groupKey, parsed.data.view, parsed.data.expectedRevision)); }
  catch (error) { if (error instanceof WorkstationError) return NextResponse.json({ error: error.message }, { status: error.status }); throw error; }
}

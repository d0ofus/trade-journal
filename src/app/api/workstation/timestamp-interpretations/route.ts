import { accountTimePolicyStatus, previewAccountTimePolicy, saveAccountTimePolicy, prepareAccountTimePolicies } from "@/lib/server/execution-time-policy";
import { timePolicyModes } from "@/lib/workstation/execution-time-provenance";
import { prepareCandlesAfterResponse } from "@/lib/server/workstation-cache-after";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/server/api-auth";
import { confirmBatchTimestamps, inspectBatchTimestamps, revokeBatchTimestamps, TimestampInterpretationError } from "@/lib/server/execution-time-interpretation";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
async function authorize() { return await requireApiSession() ?? (process.env.TRADES_WORKSTATION_ENABLED !== "1" ? NextResponse.json({ error: "Workstation is not enabled." }, { status: 404 }) : null); }
function failure(error: unknown) { return NextResponse.json({ error: error instanceof TimestampInterpretationError ? error.message : "Timestamp interpretation is unavailable. No imported records were changed." }, { status: error instanceof TimestampInterpretationError ? error.status : 500 }); }
export async function GET(request: NextRequest) {
  const auth = await authorize(); if (auth) return auth;
  try {
    if (request.nextUrl.searchParams.has("accounts")) return NextResponse.json({ accounts: await accountTimePolicyStatus() });
    const accountId = request.nextUrl.searchParams.get("accountId");
    if (accountId) {
      const mode = z.enum(timePolicyModes).optional().safeParse(request.nextUrl.searchParams.get("mode") ?? undefined);
      if (!mode.success) return NextResponse.json({ error: "Invalid account timestamp mode." }, { status: 400 });
      return NextResponse.json(await previewAccountTimePolicy(accountId, prisma, mode.data));
    }
    const id = request.nextUrl.searchParams.get("batchId");
    if (id) { const result = await inspectBatchTimestamps(id, request.nextUrl.searchParams.get("timezone") ?? "America/New_York"); return NextResponse.json({ ...result, rows: result.rows.slice(0, 200), total: result.rows.length, eligible: result.rows.filter(r => r.interpretedTime !== null).length }); }
    const cursor = request.nextUrl.searchParams.get("cursor");
    const batches = await prisma.importBatch.findMany({ where: { executions: { some: {} } }, orderBy: [{ importedAt: "desc" }, { id: "desc" }], take: 26, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, filename: true, importedAt: true, _count: { select: { executions: true } }, timeInterpretation: { select: { active: true, revision: true, timezone: true, basis: true } } } });
    return NextResponse.json({ batches: batches.slice(0, 25), nextCursor: batches.length > 25 ? batches[24].id : null });
  } catch (error) { return failure(error); }
}
const update = z.object({ batchId: z.string().min(1).max(160), expectedRevision: z.number().int().nonnegative(), action: z.enum(["confirm", "disable"]), timezone: z.enum(["America/New_York", "UTC"]).optional(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export async function PATCH(request: NextRequest) {
  const auth = await authorize(); if (auth) return auth;
  // Next may expose an internal hostname behind its server/proxy. Compare the browser's
  // origin with the incoming Host, not that internal URL (e.g. 127.0.0.1 vs localhost).
  const origin = request.headers.get("origin");
  if (origin) {
    try { const value = new URL(origin); if (!["http:", "https:"].includes(value.protocol) || value.host !== (request.headers.get("host") ?? request.nextUrl.host)) throw new Error("Origin mismatch"); }
    catch { return NextResponse.json({ error: "Cross-origin changes are not allowed." }, { status: 403 }); }
  }
  try {
    const raw = await request.json().catch(() => null);
    const account = z.object({ action: z.enum(["confirm-account", "disable-account", "prepare-account"]), accountId: z.string().min(1).max(160), expectedRevision: z.number().int().nonnegative(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(), mode: z.enum(timePolicyModes).optional() }).strict().safeParse(raw);
    if (account.success) {
      const a = account.data;
      if (a.action === "prepare-account") {
        const current = await prisma.accountExecutionTimePolicy.findUnique({ where: { accountId_source: { accountId: a.accountId, source: "IBKR_EXECUTIONS" } } });
        if (!current?.active || current.revision !== a.expectedRevision) throw new TimestampInterpretationError("Account policy changed. Refresh its status before resuming.");
        const result = await prepareAccountTimePolicies(100, a.accountId); prepareCandlesAfterResponse(); return NextResponse.json(result); }
      const saved = await saveAccountTimePolicy(a.accountId, a.expectedRevision, a.action === "confirm-account", a.fingerprint, a.mode);
      prepareCandlesAfterResponse();
      return NextResponse.json({ id: saved.id, active: saved.active, revision: saved.revision });
    }
    const body = update.safeParse(raw);
    if (!body.success) return NextResponse.json({ error: "Invalid timestamp confirmation." }, { status: 400 });
    const value = body.data;
    if (value.action === "disable") { await revokeBatchTimestamps(value.batchId, value.expectedRevision); prepareCandlesAfterResponse(); return NextResponse.json({ active: false }); }
    if (!value.timezone || !value.fingerprint) return NextResponse.json({ error: "Preview this batch before confirming." }, { status: 400 });
    const result = await confirmBatchTimestamps(value.batchId, { timezone: value.timezone, fingerprint: value.fingerprint, expectedRevision: value.expectedRevision });
    prepareCandlesAfterResponse();
    return NextResponse.json(result);
  } catch (error) { return failure(error); }
}

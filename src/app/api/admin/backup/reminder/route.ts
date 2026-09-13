import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/server/api-auth";
import { getBackupTableRowCounts, getLatestBackupRelevantUpdateAt } from "@/lib/server/queries";
import { buildBackupSourceMetadata } from "@/lib/server/backup-freshness";
import { backupReminderDue } from "@/lib/server/backup-reminder";
export async function GET() {
  const auth = await requireApiSession(); if (auth) return auth;
  const [audit, rowCounts, latestDataChangeAt] = await Promise.all([prisma.backupAudit.findFirst({ orderBy: { verifiedAt: "desc" } }), getBackupTableRowCounts(), getLatestBackupRelevantUpdateAt()]);
  const source = buildBackupSourceMetadata({ rowCounts, latestDataChangeAt });
  return NextResponse.json({ due: backupReminderDue(audit?.sourceSignature === source.signature, audit?.verifiedAt ?? null) }, { headers: { "Cache-Control": "private, no-store" } });
}

import { NextRequest, NextResponse } from "next/server";
import { requireBearerSecret } from "@/lib/server/api-auth";
import { maintainEvidence, refreshR2AccountUsage } from "@/lib/server/evidence-maintenance";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const authError = requireBearerSecret(request); if (authError) return authError;
  if (process.env.EVIDENCE_R2_MAINTENANCE_ENABLED !== "1") return NextResponse.json({ skipped: true, reason: "Evidence maintenance is disabled until rollout validation." });
  const results = await Promise.allSettled([maintainEvidence(), refreshR2AccountUsage()]);
  return NextResponse.json({ cleanup: results[0].status === "fulfilled" ? results[0].value : { error: "Cleanup paused; retained objects will be retried." }, usage: results[1].status === "fulfilled" ? results[1].value : { error: "Account metrics unavailable; last reading retained." } });
}

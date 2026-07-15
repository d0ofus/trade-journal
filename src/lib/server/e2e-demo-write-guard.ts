import { NextResponse } from "next/server";
import { DEMO_ACCOUNT_CODE, isDemoAccountCode, isE2eDemoOnlyWritesEnabled } from "@/lib/demo-safety";

export function rejectE2eBlockedMutation(action: string) {
  if (!isE2eDemoOnlyWritesEnabled()) return null;

  return NextResponse.json(
    { error: `E2E demo-only mode blocks ${action}.` },
    { status: 403 },
  );
}

export function rejectE2eNonDemoClosedTrade(accountCode: string | null | undefined) {
  if (!isE2eDemoOnlyWritesEnabled() || isDemoAccountCode(accountCode)) return null;

  return NextResponse.json(
    { error: `E2E demo-only mode can only edit ${DEMO_ACCOUNT_CODE} closed trades.` },
    { status: 403 },
  );
}

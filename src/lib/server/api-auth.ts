import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function requireApiSession() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function requireBearerSecret(req: NextRequest, envName: "CRON_SECRET" | "IBKR_FLEX_RUN_SECRET" = "CRON_SECRET") {
  const secret = process.env[envName];
  if (!secret) {
    return NextResponse.json({ ok: false, error: `${envName} is required.` }, { status: 401 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (token !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

export async function requireApiSessionOrBearerSecret(req: NextRequest, envName: "CRON_SECRET" | "IBKR_FLEX_RUN_SECRET" = "CRON_SECRET") {
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    return requireBearerSecret(req, envName);
  }

  return requireApiSession();
}
